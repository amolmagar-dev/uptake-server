import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "../config/database.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { executeQuery } from "../services/databaseConnector.js";

const router = Router();

router.use(authenticateToken);

// Get all charts
router.get("/", (req, res) => {
  try {
    const charts = db
      .prepare(
        `
      SELECT ch.*, c.name as connection_name, c.type as connection_type,
             u.name as created_by_name
      FROM charts ch
      LEFT JOIN connections c ON ch.connection_id = c.id
      LEFT JOIN users u ON ch.created_by = u.id
      ORDER BY ch.updated_at DESC
    `
      )
      .all();

    // Parse config JSON
    const parsedCharts = charts.map((chart) => ({
      ...chart,
      config: JSON.parse(chart.config),
    }));

    res.json({ charts: parsedCharts });
  } catch (error) {
    console.error("Get charts error:", error);
    res.status(500).json({ error: "Failed to fetch charts" });
  }
});

// Get single chart
router.get("/:id", (req, res) => {
  try {
    const chart = db
      .prepare(
        `
      SELECT ch.*, c.name as connection_name, c.type as connection_type
      FROM charts ch
      LEFT JOIN connections c ON ch.connection_id = c.id
      WHERE ch.id = ?
    `
      )
      .get(req.params.id);

    if (!chart) {
      return res.status(404).json({ error: "Chart not found" });
    }

    res.json({
      chart: {
        ...chart,
        config: JSON.parse(chart.config),
      },
    });
  } catch (error) {
    console.error("Get chart error:", error);
    res.status(500).json({ error: "Failed to fetch chart" });
  }
});

// Create new chart
router.post("/", requireRole("admin", "editor"), (req, res) => {
  try {
    const { name, description, chart_type, config, query_id, sql_query, connection_id } = req.body;

    if (!name || !chart_type || !config || !connection_id) {
      return res.status(400).json({ error: "Name, chart type, config, and connection ID are required" });
    }

    if (!sql_query && !query_id) {
      return res.status(400).json({ error: "Either SQL query or query ID is required" });
    }

    const connection = db.prepare("SELECT id FROM connections WHERE id = ?").get(connection_id);
    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    if (query_id) {
      const query = db.prepare("SELECT id FROM saved_queries WHERE id = ?").get(query_id);
      if (!query) {
        return res.status(404).json({ error: "Query not found" });
      }
    }

    const chartId = uuidv4();

    db.prepare(
      `
      INSERT INTO charts (id, name, description, chart_type, config, query_id, sql_query, connection_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      chartId,
      name,
      description || null,
      chart_type,
      JSON.stringify(config),
      query_id || null,
      sql_query || null,
      connection_id,
      req.user.id
    );

    res.status(201).json({
      chart: {
        id: chartId,
        name,
        description,
        chart_type,
        config,
        query_id,
        sql_query,
        connection_id,
      },
      message: "Chart created successfully",
    });
  } catch (error) {
    console.error("Create chart error:", error);
    res.status(500).json({ error: "Failed to create chart" });
  }
});

// Update chart
router.put("/:id", requireRole("admin", "editor"), (req, res) => {
  try {
    const { name, description, chart_type, config, query_id, sql_query, connection_id } = req.body;
    const chartId = req.params.id;

    const existing = db.prepare("SELECT * FROM charts WHERE id = ?").get(chartId);
    if (!existing) {
      return res.status(404).json({ error: "Chart not found" });
    }

    db.prepare(
      `
      UPDATE charts 
      SET name = ?, description = ?, chart_type = ?, config = ?, 
          query_id = ?, sql_query = ?, connection_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(
      name || existing.name,
      description !== undefined ? description : existing.description,
      chart_type || existing.chart_type,
      config ? JSON.stringify(config) : existing.config,
      query_id !== undefined ? query_id : existing.query_id,
      sql_query !== undefined ? sql_query : existing.sql_query,
      connection_id || existing.connection_id,
      chartId
    );

    res.json({ message: "Chart updated successfully" });
  } catch (error) {
    console.error("Update chart error:", error);
    res.status(500).json({ error: "Failed to update chart" });
  }
});

// Delete chart
router.delete("/:id", requireRole("admin", "editor"), (req, res) => {
  try {
    const chartId = req.params.id;

    const existing = db.prepare("SELECT id FROM charts WHERE id = ?").get(chartId);
    if (!existing) {
      return res.status(404).json({ error: "Chart not found" });
    }

    // Also remove from dashboard_charts
    db.prepare("DELETE FROM dashboard_charts WHERE chart_id = ?").run(chartId);
    db.prepare("DELETE FROM charts WHERE id = ?").run(chartId);

    res.json({ message: "Chart deleted successfully" });
  } catch (error) {
    console.error("Delete chart error:", error);
    res.status(500).json({ error: "Failed to delete chart" });
  }
});

// Get chart data (execute the chart's query)
router.get("/:id/data", async (req, res) => {
  try {
    const chart = db.prepare("SELECT * FROM charts WHERE id = ?").get(req.params.id);

    if (!chart) {
      return res.status(404).json({ error: "Chart not found" });
    }

    let sqlQuery = chart.sql_query;

    // If chart uses a saved query, get it
    if (chart.query_id && !sqlQuery) {
      const savedQuery = db.prepare("SELECT sql_query FROM saved_queries WHERE id = ?").get(chart.query_id);
      if (!savedQuery) {
        return res.status(404).json({ error: "Associated query not found" });
      }
      sqlQuery = savedQuery.sql_query;
    }

    if (!sqlQuery) {
      return res.status(400).json({ error: "No SQL query associated with this chart" });
    }

    const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(chart.connection_id);
    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    const result = await executeQuery(connection, sqlQuery);

    res.json({
      data: result.rows,
      fields: result.fields,
      rowCount: result.rowCount,
      executionTime: result.executionTime,
      chartConfig: JSON.parse(chart.config),
    });
  } catch (error) {
    console.error("Get chart data error:", error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
