import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "../config/database.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { executeQuery } from "../services/databaseConnector.js";
import { executeApiRequest } from "../services/apiConnector.js";
import { fetchGoogleSheet } from "../services/googleSheetsConnector.js";

const router = Router();

router.use(authenticateToken);

// Get all charts
router.get("/", (req, res) => {
  try {
    const charts = db
      .prepare(
        `
      SELECT ch.*, 
             c.name as connection_name, c.type as connection_type,
             d.name as dataset_name, d.dataset_type, d.source_type,
             u.name as created_by_name
      FROM charts ch
      LEFT JOIN connections c ON ch.connection_id = c.id
      LEFT JOIN datasets d ON ch.dataset_id = d.id
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
      SELECT ch.*, 
             c.name as connection_name, c.type as connection_type,
             d.name as dataset_name, d.dataset_type, d.source_type
      FROM charts ch
      LEFT JOIN connections c ON ch.connection_id = c.id
      LEFT JOIN datasets d ON ch.dataset_id = d.id
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
    const { name, description, chart_type, config, dataset_id, query_id, sql_query, connection_id } = req.body;

    if (!name || !chart_type || !config) {
      return res.status(400).json({ error: "Name, chart type, and config are required" });
    }

    // New charts should use dataset_id, but support legacy connection_id for backward compatibility
    if (!dataset_id && !connection_id) {
      return res.status(400).json({ error: "Either dataset_id or connection_id is required" });
    }

    // If using dataset, validate it exists
    if (dataset_id) {
      const dataset = db.prepare("SELECT id FROM datasets WHERE id = ?").get(dataset_id);
      if (!dataset) {
        return res.status(404).json({ error: "Dataset not found" });
      }
    }

    // Legacy: If using connection directly (backward compatibility)
    if (connection_id && !dataset_id) {
      const connection = db.prepare("SELECT id FROM connections WHERE id = ?").get(connection_id);
      if (!connection) {
        return res.status(404).json({ error: "Connection not found" });
      }

      if (!sql_query && !query_id) {
        return res.status(400).json({ error: "Either SQL query or query ID is required when using connection directly" });
      }
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
      INSERT INTO charts (id, name, description, chart_type, config, dataset_id, query_id, sql_query, connection_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      chartId,
      name,
      description || null,
      chart_type,
      JSON.stringify(config),
      dataset_id || null,
      query_id || null,
      sql_query || null,
      connection_id || null,
      req.user.id
    );

    res.status(201).json({
      chart: {
        id: chartId,
        name,
        description,
        chart_type,
        config,
        dataset_id,
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
    const { name, description, chart_type, config, dataset_id, query_id, sql_query, connection_id } = req.body;
    const chartId = req.params.id;

    const existing = db.prepare("SELECT * FROM charts WHERE id = ?").get(chartId);
    if (!existing) {
      return res.status(404).json({ error: "Chart not found" });
    }

    db.prepare(
      `
      UPDATE charts 
      SET name = ?, description = ?, chart_type = ?, config = ?, 
          dataset_id = ?, query_id = ?, sql_query = ?, connection_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(
      name || existing.name,
      description !== undefined ? description : existing.description,
      chart_type || existing.chart_type,
      config ? JSON.stringify(config) : existing.config,
      dataset_id !== undefined ? dataset_id : existing.dataset_id,
      query_id !== undefined ? query_id : existing.query_id,
      sql_query !== undefined ? sql_query : existing.sql_query,
      connection_id !== undefined ? connection_id : existing.connection_id,
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

    let result;

    // If chart uses a dataset, get data from dataset
    if (chart.dataset_id) {
      const dataset = db.prepare("SELECT * FROM datasets WHERE id = ?").get(chart.dataset_id);
      if (!dataset) {
        return res.status(404).json({ error: "Associated dataset not found" });
      }

      const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(dataset.connection_id);
      if (!connection) {
        return res.status(404).json({ error: "Dataset connection not found" });
      }

      if (dataset.source_type === 'sql') {
        // Build SQL query based on dataset type
        let sqlQuery;
        if (dataset.dataset_type === 'physical') {
          const schemaPrefix = dataset.table_schema ? `"${dataset.table_schema}".` : '';
          sqlQuery = `SELECT * FROM ${schemaPrefix}"${dataset.table_name}"`;
        } else if (dataset.dataset_type === 'virtual') {
          sqlQuery = dataset.sql_query;
        }
        result = await executeQuery(connection, sqlQuery);
      } else if (dataset.source_type === 'api') {
        result = await executeApiRequest(connection);
      } else if (dataset.source_type === 'googlesheet') {
        result = await fetchGoogleSheet(connection);
      } else {
        return res.status(400).json({ error: `Unsupported source type: ${dataset.source_type}` });
      }
    } else {
      // Legacy: chart uses connection directly
      let sqlQuery = chart.sql_query;
      
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

      result = await executeQuery(connection, sqlQuery);
    }

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
