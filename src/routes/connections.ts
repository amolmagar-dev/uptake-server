// @ts-nocheck
import { Router } from "express";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { connectionRepository } from "../db/index.js";
import { testConnection, getTableList, getTableSchema, closeConnection } from "../services/databaseConnector.js";
import { testApiConnection } from "../services/apiConnector.js";
import { testGoogleSheetsConnection } from "../services/googleSheetsConnector.js";

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Get all connections
router.get("/", async (req, res) => {
  try {
    const connections = await connectionRepository.findAll();

    // Parse config JSON for each connection (hide password)
    const parsedConnections = connections.map(conn => ({
      id: conn.id,
      name: conn.name,
      type: conn.type,
      host: conn.host,
      port: conn.port,
      database_name: conn.database_name,
      username: conn.username,
      ssl: conn.ssl,
      config: conn.config ? JSON.parse(conn.config) : null,
      created_at: conn.created_at,
      updated_at: conn.updated_at,
    }));

    res.json({ connections: parsedConnections });
  } catch (error) {
    console.error("Get connections error:", error);
    res.status(500).json({ error: "Failed to fetch connections" });
  }
});

// Get single connection
router.get("/:id", async (req, res) => {
  try {
    const connection = await connectionRepository.findById(req.params.id);

    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    res.json({ 
      connection: {
        id: connection.id,
        name: connection.name,
        type: connection.type,
        host: connection.host,
        port: connection.port,
        database_name: connection.database_name,
        username: connection.username,
        ssl: connection.ssl,
        config: connection.config ? JSON.parse(connection.config) : null,
        created_at: connection.created_at,
        updated_at: connection.updated_at,
      }
    });
  } catch (error) {
    console.error("Get connection error:", error);
    res.status(500).json({ error: "Failed to fetch connection" });
  }
});

// Create new connection
router.post("/", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { name, type, host, port, database_name, username, password, ssl, config } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: "Name and type are required" });
    }

    // Generate a temporary ID for testing
    const tempId = crypto.randomUUID();

    // Different validation and testing based on connection type
    if (type === 'api') {
      // API connection
      if (!config?.url) {
        return res.status(400).json({ error: "API URL is required" });
      }

      const testConfig = { id: tempId, type, config };
      const testResult = await testApiConnection(testConfig);
      if (!testResult.success) {
        return res.status(400).json({ error: `API connection test failed: ${testResult.message}` });
      }

      const connection = await connectionRepository.create({
        name,
        type,
        config: JSON.stringify(config),
        created_by: req.user.id,
      });

      res.status(201).json({
        connection: { id: connection.id, name, type },
        message: "Connection created successfully",
      });

    } else if (type === 'googlesheet') {
      // Google Sheets connection
      if (!config?.spreadsheet_id) {
        return res.status(400).json({ error: "Spreadsheet ID is required" });
      }

      const testConfig = { id: tempId, type, config };
      const testResult = await testGoogleSheetsConnection(testConfig);
      if (!testResult.success) {
        return res.status(400).json({ error: `Google Sheets test failed: ${testResult.message}` });
      }

      const connection = await connectionRepository.create({
        name,
        type,
        config: JSON.stringify(config),
        created_by: req.user.id,
      });

      res.status(201).json({
        connection: { id: connection.id, name, type },
        message: "Connection created successfully",
      });

    } else {
      // SQL database connection
      if (!host || !database_name) {
        return res.status(400).json({ error: "Host and database name are required for SQL connections" });
      }

      const testConfig = {
        id: tempId,
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

      const connection = await connectionRepository.create({
        name,
        type,
        host,
        port: port || (type === "postgresql" ? 5432 : 3306),
        database_name,
        username,
        password,
        ssl: ssl ? 1 : 0,
        created_by: req.user.id,
      });

      res.status(201).json({
        connection: { id: connection.id, name, type },
        message: "Connection created successfully",
      });
    }
  } catch (error) {
    console.error("Create connection error:", error);
    res.status(500).json({ error: "Failed to create connection" });
  }
});

// Update connection
router.put("/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { name, type, host, port, database_name, username, password, ssl, config } = req.body;
    const connectionId = req.params.id;

    const existing = await connectionRepository.findById(connectionId);
    if (!existing) {
      return res.status(404).json({ error: "Connection not found" });
    }

    const connType = type || existing.type;

    if (connType === 'api' || connType === 'googlesheet') {
      // API or Google Sheets connection
      const newConfig = config || (existing.config ? JSON.parse(existing.config) : {});
      
      let testResult;
      if (connType === 'api') {
        testResult = await testApiConnection({ id: connectionId, type: connType, config: newConfig });
      } else {
        testResult = await testGoogleSheetsConnection({ id: connectionId, type: connType, config: newConfig });
      }

      if (!testResult.success) {
        return res.status(400).json({ error: `Connection test failed: ${testResult.message}` });
      }

      await connectionRepository.update(connectionId, {
        name: name || existing.name,
        type: connType,
        config: JSON.stringify(newConfig),
      });

    } else {
      // SQL database connection
      closeConnection(connectionId);

      const testConfig = {
        id: connectionId,
        type: connType,
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

      await connectionRepository.update(connectionId, {
        name: name || existing.name,
        type: connType,
        host: host || existing.host,
        port: port || existing.port,
        database_name: database_name || existing.database_name,
        username: username || existing.username,
        password: password || existing.password,
        ssl: ssl !== undefined ? (ssl ? 1 : 0) : existing.ssl,
      });
    }

    res.json({ message: "Connection updated successfully" });
  } catch (error) {
    console.error("Update connection error:", error);
    res.status(500).json({ error: "Failed to update connection" });
  }
});

// Delete connection
router.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    const connectionId = req.params.id;

    const existing = await connectionRepository.findById(connectionId);
    if (!existing) {
      return res.status(404).json({ error: "Connection not found" });
    }

    // Close SQL connection pool if applicable
    if (!['api', 'googlesheet'].includes(existing.type)) {
      closeConnection(connectionId);
    }
    
    await connectionRepository.delete(connectionId);

    res.json({ message: "Connection deleted successfully" });
  } catch (error) {
    console.error("Delete connection error:", error);
    res.status(500).json({ error: "Failed to delete connection" });
  }
});

// Test connection
router.post("/:id/test", async (req, res) => {
  try {
    const connection = await connectionRepository.findById(req.params.id);

    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    let result;
    if (connection.type === 'api') {
      const config = connection.config ? JSON.parse(connection.config) : {};
      result = await testApiConnection({ ...connection, config });
    } else if (connection.type === 'googlesheet') {
      const config = connection.config ? JSON.parse(connection.config) : {};
      result = await testGoogleSheetsConnection({ ...connection, config });
    } else {
      result = await testConnection(connection);
    }

    res.json(result);
  } catch (error) {
    console.error("Test connection error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get tables for a connection (SQL only)
router.get("/:id/tables", async (req, res) => {
  try {
    const connection = await connectionRepository.findById(req.params.id);

    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    if (['api', 'googlesheet'].includes(connection.type)) {
      return res.json({ tables: [] }); // Non-SQL connections don't have tables
    }

    const tables = await getTableList(connection);
    res.json({ tables });
  } catch (error) {
    console.error("Get tables error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get table schema (SQL only)
router.get("/:id/tables/:tableName/schema", async (req, res) => {
  try {
    const connection = await connectionRepository.findById(req.params.id);

    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    if (['api', 'googlesheet'].includes(connection.type)) {
      return res.json({ columns: [] }); // Non-SQL connections don't have table schemas
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
