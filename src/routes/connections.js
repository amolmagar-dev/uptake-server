import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "../config/database.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { testConnection, getTableList, getTableSchema, closeConnection } from "../services/databaseConnector.js";

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Get all connections
router.get("/", (req, res) => {
  try {
    const connections = db
      .prepare(
        `
      SELECT id, name, type, host, port, database_name, username, ssl, created_at, updated_at
      FROM connections
      ORDER BY name
    `
      )
      .all();

    res.json({ connections });
  } catch (error) {
    console.error("Get connections error:", error);
    res.status(500).json({ error: "Failed to fetch connections" });
  }
});

// Get single connection
router.get("/:id", (req, res) => {
  try {
    const connection = db
      .prepare(
        `
      SELECT id, name, type, host, port, database_name, username, ssl, created_at, updated_at
      FROM connections WHERE id = ?
    `
      )
      .get(req.params.id);

    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    res.json({ connection });
  } catch (error) {
    console.error("Get connection error:", error);
    res.status(500).json({ error: "Failed to fetch connection" });
  }
});

// Create new connection
router.post("/", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { name, type, host, port, database_name, username, password, ssl } = req.body;

    if (!name || !type || !host || !database_name) {
      return res.status(400).json({ error: "Name, type, host, and database name are required" });
    }

    const connectionId = uuidv4();

    // Test connection first
    const testConfig = {
      id: connectionId,
      type,
      host,
      port: port || (type === "postgresql" ? 5432 : 3306),
      database_name,
      username,
      password,
      ssl: ssl ? 1 : 0,
    };

    const testResult = await testConnection(testConfig);
    if (!testResult.success) {
      return res.status(400).json({ error: `Connection test failed: ${testResult.message}` });
    }

    db.prepare(
      `
      INSERT INTO connections (id, name, type, host, port, database_name, username, password, ssl, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      connectionId,
      name,
      type,
      host,
      port || (type === "postgresql" ? 5432 : 3306),
      database_name,
      username,
      password,
      ssl ? 1 : 0,
      req.user.id
    );

    res.status(201).json({
      connection: {
        id: connectionId,
        name,
        type,
        host,
        port: port || (type === "postgresql" ? 5432 : 3306),
        database_name,
        username,
        ssl: ssl ? 1 : 0,
      },
      message: "Connection created successfully",
    });
  } catch (error) {
    console.error("Create connection error:", error);
    res.status(500).json({ error: "Failed to create connection" });
  }
});

// Update connection
router.put("/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { name, type, host, port, database_name, username, password, ssl } = req.body;
    const connectionId = req.params.id;

    const existing = db.prepare("SELECT * FROM connections WHERE id = ?").get(connectionId);
    if (!existing) {
      return res.status(404).json({ error: "Connection not found" });
    }

    // Close existing connection pool
    closeConnection(connectionId);

    // Test new connection configuration
    const testConfig = {
      id: connectionId,
      type: type || existing.type,
      host: host || existing.host,
      port: port || existing.port,
      database_name: database_name || existing.database_name,
      username: username || existing.username,
      password: password || existing.password,
      ssl: ssl !== undefined ? (ssl ? 1 : 0) : existing.ssl,
    };

    const testResult = await testConnection(testConfig);
    if (!testResult.success) {
      return res.status(400).json({ error: `Connection test failed: ${testResult.message}` });
    }

    db.prepare(
      `
      UPDATE connections 
      SET name = ?, type = ?, host = ?, port = ?, database_name = ?, 
          username = ?, password = COALESCE(?, password), ssl = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(
      name || existing.name,
      type || existing.type,
      host || existing.host,
      port || existing.port,
      database_name || existing.database_name,
      username || existing.username,
      password,
      ssl !== undefined ? (ssl ? 1 : 0) : existing.ssl,
      connectionId
    );

    res.json({ message: "Connection updated successfully" });
  } catch (error) {
    console.error("Update connection error:", error);
    res.status(500).json({ error: "Failed to update connection" });
  }
});

// Delete connection
router.delete("/:id", requireRole("admin"), (req, res) => {
  try {
    const connectionId = req.params.id;

    const existing = db.prepare("SELECT id FROM connections WHERE id = ?").get(connectionId);
    if (!existing) {
      return res.status(404).json({ error: "Connection not found" });
    }

    closeConnection(connectionId);
    db.prepare("DELETE FROM connections WHERE id = ?").run(connectionId);

    res.json({ message: "Connection deleted successfully" });
  } catch (error) {
    console.error("Delete connection error:", error);
    res.status(500).json({ error: "Failed to delete connection" });
  }
});

// Test connection
router.post("/:id/test", async (req, res) => {
  try {
    const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(req.params.id);

    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    const result = await testConnection(connection);
    res.json(result);
  } catch (error) {
    console.error("Test connection error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get tables for a connection
router.get("/:id/tables", async (req, res) => {
  try {
    const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(req.params.id);

    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    const tables = await getTableList(connection);
    res.json({ tables });
  } catch (error) {
    console.error("Get tables error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get table schema
router.get("/:id/tables/:tableName/schema", async (req, res) => {
  try {
    const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(req.params.id);

    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    const schema = req.query.schema || "public";
    const columns = await getTableSchema(connection, req.params.tableName, schema);
    res.json({ columns });
  } catch (error) {
    console.error("Get schema error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
