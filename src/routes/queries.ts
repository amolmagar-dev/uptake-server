// @ts-nocheck
import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "../config/database.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { executeQuery } from "../services/databaseConnector.js";

const router = Router();

router.use(authenticateToken);

// Execute SQL query
router.post("/execute", async (req, res) => {
  try {
    const { connectionId, sql, params = [] } = req.body;

    if (!connectionId || !sql) {
      return res.status(400).json({ error: "Connection ID and SQL query are required" });
    }

    // Validate SQL (basic security check - prevent obviously dangerous operations)
    const sqlUpper = sql.trim().toUpperCase();
    const dangerousKeywords = ["DROP DATABASE", "DROP SCHEMA", "TRUNCATE", "DELETE FROM"];
    for (const keyword of dangerousKeywords) {
      if (sqlUpper.includes(keyword) && !sqlUpper.startsWith("--")) {
        return res.status(403).json({
          error: "Dangerous SQL operation detected. This operation is not allowed through the query interface.",
        });
      }
    }

    const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(connectionId);
    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    const result = await executeQuery(connection, sql, params);

    res.json({
      data: result.rows,
      fields: result.fields,
      rowCount: result.rowCount,
      executionTime: result.executionTime,
    });
  } catch (error) {
    console.error("Query execution error:", error);
    res.status(400).json({ error: error.message });
  }
});

// Get all saved queries
router.get("/", (req, res) => {
  try {
    const queries = db
      .prepare(
        `
      SELECT sq.*, c.name as connection_name, c.type as connection_type,
             u.name as created_by_name
      FROM saved_queries sq
      LEFT JOIN connections c ON sq.connection_id = c.id
      LEFT JOIN users u ON sq.created_by = u.id
      ORDER BY sq.updated_at DESC
    `
      )
      .all();

    res.json({ queries });
  } catch (error) {
    console.error("Get queries error:", error);
    res.status(500).json({ error: "Failed to fetch queries" });
  }
});

// Get single saved query
router.get("/:id", (req, res) => {
  try {
    const query = db
      .prepare(
        `
      SELECT sq.*, c.name as connection_name, c.type as connection_type
      FROM saved_queries sq
      LEFT JOIN connections c ON sq.connection_id = c.id
      WHERE sq.id = ?
    `
      )
      .get(req.params.id);

    if (!query) {
      return res.status(404).json({ error: "Query not found" });
    }

    res.json({ query });
  } catch (error) {
    console.error("Get query error:", error);
    res.status(500).json({ error: "Failed to fetch query" });
  }
});

// Save new query
router.post("/", requireRole("admin", "editor"), (req, res) => {
  try {
    const { name, description, sql_query, connection_id } = req.body;

    if (!name || !sql_query || !connection_id) {
      return res.status(400).json({ error: "Name, SQL query, and connection ID are required" });
    }

    const connection = db.prepare("SELECT id FROM connections WHERE id = ?").get(connection_id);
    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    const queryId = uuidv4();

    db.prepare(
      `
      INSERT INTO saved_queries (id, name, description, sql_query, connection_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(queryId, name, description || null, sql_query, connection_id, req.user.id);

    res.status(201).json({
      query: {
        id: queryId,
        name,
        description,
        sql_query,
        connection_id,
      },
      message: "Query saved successfully",
    });
  } catch (error) {
    console.error("Save query error:", error);
    res.status(500).json({ error: "Failed to save query" });
  }
});

// Update saved query
router.put("/:id", requireRole("admin", "editor"), (req, res) => {
  try {
    const { name, description, sql_query, connection_id } = req.body;
    const queryId = req.params.id;

    const existing = db.prepare("SELECT * FROM saved_queries WHERE id = ?").get(queryId);
    if (!existing) {
      return res.status(404).json({ error: "Query not found" });
    }

    if (connection_id) {
      const connection = db.prepare("SELECT id FROM connections WHERE id = ?").get(connection_id);
      if (!connection) {
        return res.status(404).json({ error: "Connection not found" });
      }
    }

    db.prepare(
      `
      UPDATE saved_queries 
      SET name = ?, description = ?, sql_query = ?, connection_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(
      name || existing.name,
      description !== undefined ? description : existing.description,
      sql_query || existing.sql_query,
      connection_id || existing.connection_id,
      queryId
    );

    res.json({ message: "Query updated successfully" });
  } catch (error) {
    console.error("Update query error:", error);
    res.status(500).json({ error: "Failed to update query" });
  }
});

// Delete saved query
router.delete("/:id", requireRole("admin", "editor"), (req, res) => {
  try {
    const queryId = req.params.id;

    const existing = db.prepare("SELECT id FROM saved_queries WHERE id = ?").get(queryId);
    if (!existing) {
      return res.status(404).json({ error: "Query not found" });
    }

    db.prepare("DELETE FROM saved_queries WHERE id = ?").run(queryId);
    res.json({ message: "Query deleted successfully" });
  } catch (error) {
    console.error("Delete query error:", error);
    res.status(500).json({ error: "Failed to delete query" });
  }
});

// Execute a saved query
router.post("/:id/execute", async (req, res) => {
  try {
    const savedQuery = db.prepare("SELECT * FROM saved_queries WHERE id = ?").get(req.params.id);

    if (!savedQuery) {
      return res.status(404).json({ error: "Query not found" });
    }

    const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(savedQuery.connection_id);
    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    const result = await executeQuery(connection, savedQuery.sql_query);

    res.json({
      data: result.rows,
      fields: result.fields,
      rowCount: result.rowCount,
      executionTime: result.executionTime,
    });
  } catch (error) {
    console.error("Execute saved query error:", error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
