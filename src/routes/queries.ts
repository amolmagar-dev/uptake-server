// @ts-nocheck
import { Router } from "express";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { savedQueryRepository, connectionRepository } from "../db/index.js";
import { prisma } from "../db/client.js";
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

    const connection = await connectionRepository.findById(connectionId);
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
router.get("/", async (req, res) => {
  try {
    const queries = await prisma.savedQuery.findMany({
      include: {
        connection: { select: { name: true, type: true } },
        creator: { select: { name: true } },
      },
      orderBy: { updated_at: "desc" },
    });

    const formattedQueries = queries.map(q => ({
      ...q,
      connection_name: q.connection?.name,
      connection_type: q.connection?.type,
      created_by_name: q.creator?.name,
      connection: undefined,
      creator: undefined,
    }));

    res.json({ queries: formattedQueries });
  } catch (error) {
    console.error("Get queries error:", error);
    res.status(500).json({ error: "Failed to fetch queries" });
  }
});

// Get single saved query
router.get("/:id", async (req, res) => {
  try {
    const query = await prisma.savedQuery.findUnique({
      where: { id: req.params.id },
      include: {
        connection: { select: { name: true, type: true } },
      },
    });

    if (!query) {
      return res.status(404).json({ error: "Query not found" });
    }

    res.json({
      query: {
        ...query,
        connection_name: query.connection?.name,
        connection_type: query.connection?.type,
        connection: undefined,
      },
    });
  } catch (error) {
    console.error("Get query error:", error);
    res.status(500).json({ error: "Failed to fetch query" });
  }
});

// Save new query
router.post("/", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { name, description, sql_query, connection_id } = req.body;

    if (!name || !sql_query || !connection_id) {
      return res.status(400).json({ error: "Name, SQL query, and connection ID are required" });
    }

    const connectionExists = await connectionRepository.exists(connection_id);
    if (!connectionExists) {
      return res.status(404).json({ error: "Connection not found" });
    }

    const query = await savedQueryRepository.create({
      name,
      description,
      sql_query,
      connection_id,
      created_by: req.user.id,
    });

    res.status(201).json({
      query: {
        id: query.id,
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
router.put("/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { name, description, sql_query, connection_id } = req.body;
    const queryId = req.params.id;

    const existing = await savedQueryRepository.findById(queryId);
    if (!existing) {
      return res.status(404).json({ error: "Query not found" });
    }

    if (connection_id) {
      const connectionExists = await connectionRepository.exists(connection_id);
      if (!connectionExists) {
        return res.status(404).json({ error: "Connection not found" });
      }
    }

    await savedQueryRepository.update(queryId, {
      name: name || existing.name,
      description: description !== undefined ? description : existing.description,
      sql_query: sql_query || existing.sql_query,
      connection_id: connection_id || existing.connection_id,
    });

    res.json({ message: "Query updated successfully" });
  } catch (error) {
    console.error("Update query error:", error);
    res.status(500).json({ error: "Failed to update query" });
  }
});

// Delete saved query
router.delete("/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const queryId = req.params.id;

    const exists = await savedQueryRepository.exists(queryId);
    if (!exists) {
      return res.status(404).json({ error: "Query not found" });
    }

    await savedQueryRepository.delete(queryId);
    res.json({ message: "Query deleted successfully" });
  } catch (error) {
    console.error("Delete query error:", error);
    res.status(500).json({ error: "Failed to delete query" });
  }
});

// Execute a saved query
router.post("/:id/execute", async (req, res) => {
  try {
    const savedQuery = await savedQueryRepository.findById(req.params.id);

    if (!savedQuery) {
      return res.status(404).json({ error: "Query not found" });
    }

    const connection = await connectionRepository.findById(savedQuery.connection_id);
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
