// @ts-nocheck
import { Router } from "express";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { chartRepository, datasetRepository, connectionRepository, savedQueryRepository } from "../db/index.js";
import { prisma } from "../db/client.js";
import { executeQuery } from "../services/databaseConnector.js";
import { executeApiRequest } from "../services/apiConnector.js";
import { fetchGoogleSheet } from "../services/googleSheetsConnector.js";

const router = Router();

router.use(authenticateToken);

// Get all charts
router.get("/", async (req, res) => {
  try {
    const charts = await prisma.chart.findMany({
      include: {
        connection: { select: { name: true, type: true } },
        dataset: { select: { name: true, dataset_type: true, source_type: true } },
        creator: { select: { name: true } },
      },
      orderBy: { updated_at: "desc" },
    });

    // Parse config JSON and format response
    const parsedCharts = charts.map((chart) => ({
      ...chart,
      connection_name: chart.connection?.name,
      connection_type: chart.connection?.type,
      dataset_name: chart.dataset?.name,
      dataset_type: chart.dataset?.dataset_type,
      source_type: chart.dataset?.source_type,
      created_by_name: chart.creator?.name,
      config: JSON.parse(chart.config),
      // Remove relation objects
      connection: undefined,
      dataset: undefined,
      creator: undefined,
    }));

    res.json({ charts: parsedCharts });
  } catch (error) {
    console.error("Get charts error:", error);
    res.status(500).json({ error: "Failed to fetch charts" });
  }
});

// Get single chart
router.get("/:id", async (req, res) => {
  try {
    const chart = await prisma.chart.findUnique({
      where: { id: req.params.id },
      include: {
        connection: { select: { name: true, type: true } },
        dataset: { select: { name: true, dataset_type: true, source_type: true } },
      },
    });

    if (!chart) {
      return res.status(404).json({ error: "Chart not found" });
    }

    res.json({
      chart: {
        ...chart,
        connection_name: chart.connection?.name,
        connection_type: chart.connection?.type,
        dataset_name: chart.dataset?.name,
        dataset_type: chart.dataset?.dataset_type,
        source_type: chart.dataset?.source_type,
        config: JSON.parse(chart.config),
        connection: undefined,
        dataset: undefined,
      },
    });
  } catch (error) {
    console.error("Get chart error:", error);
    res.status(500).json({ error: "Failed to fetch chart" });
  }
});

// Create new chart
router.post("/", requireRole("admin", "editor"), async (req, res) => {
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
      const exists = await datasetRepository.exists(dataset_id);
      if (!exists) {
        return res.status(404).json({ error: "Dataset not found" });
      }
    }

    // Legacy: If using connection directly (backward compatibility)
    if (connection_id && !dataset_id) {
      const exists = await connectionRepository.exists(connection_id);
      if (!exists) {
        return res.status(404).json({ error: "Connection not found" });
      }

      if (!sql_query && !query_id) {
        return res.status(400).json({ error: "Either SQL query or query ID is required when using connection directly" });
      }
    }

    if (query_id) {
      const exists = await savedQueryRepository.exists(query_id);
      if (!exists) {
        return res.status(404).json({ error: "Query not found" });
      }
    }

    const chart = await chartRepository.create({
      name,
      description,
      chart_type,
      config: JSON.stringify(config),
      dataset_id,
      query_id,
      sql_query,
      connection_id,
      created_by: req.user.id,
    });

    res.status(201).json({
      chart: {
        id: chart.id,
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
router.put("/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { name, description, chart_type, config, dataset_id, query_id, sql_query, connection_id } = req.body;
    const chartId = req.params.id;

    const existing = await chartRepository.findById(chartId);
    if (!existing) {
      return res.status(404).json({ error: "Chart not found" });
    }

    await chartRepository.update(chartId, {
      name: name || existing.name,
      description: description !== undefined ? description : existing.description,
      chart_type: chart_type || existing.chart_type,
      config: config ? JSON.stringify(config) : existing.config,
      dataset_id: dataset_id !== undefined ? dataset_id : existing.dataset_id,
      query_id: query_id !== undefined ? query_id : existing.query_id,
      sql_query: sql_query !== undefined ? sql_query : existing.sql_query,
      connection_id: connection_id !== undefined ? connection_id : existing.connection_id,
    });

    res.json({ message: "Chart updated successfully" });
  } catch (error) {
    console.error("Update chart error:", error);
    res.status(500).json({ error: "Failed to update chart" });
  }
});

// Delete chart
router.delete("/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const chartId = req.params.id;

    const exists = await chartRepository.exists(chartId);
    if (!exists) {
      return res.status(404).json({ error: "Chart not found" });
    }

    // Also remove from dashboard_charts
    await prisma.dashboardChart.deleteMany({ where: { chart_id: chartId } });
    await chartRepository.delete(chartId);

    res.json({ message: "Chart deleted successfully" });
  } catch (error) {
    console.error("Delete chart error:", error);
    res.status(500).json({ error: "Failed to delete chart" });
  }
});

// Get chart data (execute the chart's query)
router.get("/:id/data", async (req, res) => {
  try {
    const chart = await chartRepository.findById(req.params.id);

    if (!chart) {
      return res.status(404).json({ error: "Chart not found" });
    }

    let result;

    // If chart uses a dataset, get data from dataset
    if (chart.dataset_id) {
      const dataset = await datasetRepository.findById(chart.dataset_id);
      if (!dataset) {
        return res.status(404).json({ error: "Associated dataset not found" });
      }

      const connection = await connectionRepository.findById(dataset.connection_id);
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
        const savedQuery = await savedQueryRepository.findById(chart.query_id);
        if (!savedQuery) {
          return res.status(404).json({ error: "Associated query not found" });
        }
        sqlQuery = savedQuery.sql_query;
      }

      if (!sqlQuery) {
        return res.status(400).json({ error: "No SQL query associated with this chart" });
      }

      const connection = await connectionRepository.findById(chart.connection_id);
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
