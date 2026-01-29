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
        dataset: { select: { name: true, dataset_type: true, source_type: true } },
        creator: { select: { name: true } },
      },
      orderBy: { updated_at: "desc" },
    });

    // Parse config JSON and format response
    const parsedCharts = charts.map((chart) => ({
      ...chart,
      dataset_name: chart.dataset?.name,
      dataset_type: chart.dataset?.dataset_type,
      source_type: chart.dataset?.source_type,
      created_by_name: chart.creator?.name,
      config: JSON.parse(chart.config),
      // Remove relation objects
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
        dataset: { select: { name: true, dataset_type: true, source_type: true } },
      },
    });

    if (!chart) {
      return res.status(404).json({ error: "Chart not found" });
    }

    res.json({
      chart: {
        ...chart,
        dataset_name: chart.dataset?.name,
        dataset_type: chart.dataset?.dataset_type,
        source_type: chart.dataset?.source_type,
        config: JSON.parse(chart.config),
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
    const { name, description, chart_type, config, dataset_id } = req.body;

    if (!name || !chart_type || !config) {
      return res.status(400).json({ error: "Name, chart type, and config are required" });
    }

    if (!dataset_id) {
      return res.status(400).json({ error: "dataset_id is required" });
    }

    // Validate dataset exists
    const exists = await datasetRepository.exists(dataset_id);
    if (!exists) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    const chart = await chartRepository.create({
      name,
      description,
      chart_type,
      config: JSON.stringify(config),
      dataset_id,
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
    const { name, description, chart_type, config, dataset_id } = req.body;
    const chartId = req.params.id;

    const existing = await chartRepository.findById(chartId);
    if (!existing) {
      return res.status(404).json({ error: "Chart not found" });
    }

    // Validate dataset if changing it
    if (dataset_id && dataset_id !== existing.dataset_id) {
      const exists = await datasetRepository.exists(dataset_id);
      if (!exists) {
        return res.status(404).json({ error: "Dataset not found" });
      }
    }

    await chartRepository.update(chartId, {
      name: name || existing.name,
      description: description !== undefined ? description : existing.description,
      chart_type: chart_type || existing.chart_type,
      config: config ? JSON.stringify(config) : existing.config,
      dataset_id: dataset_id !== undefined ? dataset_id : existing.dataset_id,
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

    if (!chart.dataset_id) {
      return res.status(400).json({ error: "Chart has no dataset configured" });
    }

    const dataset = await datasetRepository.findById(chart.dataset_id);
    if (!dataset) {
      return res.status(404).json({ error: "Associated dataset not found" });
    }

    const connection = await connectionRepository.findById(dataset.connection_id);
    if (!connection) {
      return res.status(404).json({ error: "Dataset connection not found" });
    }

    let result;

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

    res.json({
      data: result.rows,
      fields: result.fields,
      rowCount: result.rowCount,
      executionTime: result.executionTime,
      chartConfig: interpolateDataInConfig(JSON.parse(chart.config), result.rows),
    });
  } catch (error) {
    console.error("Get chart data error:", error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Interpolate $DATA placeholder in chart config with actual data rows.
 * Supports both "$DATA" string format and dataset.source merging.
 */
function interpolateDataInConfig(config: any, rows: any[]): any {
  // Convert to string and check for $DATA placeholder
  const configStr = JSON.stringify(config);
  
  if (configStr.includes('"$DATA"')) {
    // Replace "$DATA" with actual data array
    const interpolated = configStr.replace('"$DATA"', JSON.stringify(rows));
    return JSON.parse(interpolated);
  }
  
  // Legacy: merge into dataset.source if it exists
  if (config.dataset) {
    return { ...config, dataset: { ...config.dataset, source: rows } };
  }
  
  return config;
}

export default router;
