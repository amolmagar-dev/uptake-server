// @ts-nocheck
import { Router } from "express";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { dashboardRepository, chartRepository, connectionRepository, datasetRepository, savedQueryRepository, customComponentRepository } from "../db/index.js";
import { prisma } from "../db/client.js";
import { executeQuery } from "../services/databaseConnector.js";
import { executeApiRequest } from "../services/apiConnector.js";
import { fetchGoogleSheet } from "../services/googleSheetsConnector.js";

const router = Router();

// Public dashboards don't require authentication
router.get("/public/:id", async (req, res) => {
  try {
    const dashboard = await prisma.dashboard.findFirst({
      where: { id: req.params.id, is_public: 1 },
      include: {
        dashboardCharts: {
          include: {
            chart: true,
          },
        },
      },
    });

    if (!dashboard) {
      return res.status(404).json({ error: "Dashboard not found or not public" });
    }

    res.json({
      dashboard: {
        ...dashboard,
        layout: JSON.parse(dashboard.layout),
        charts: dashboard.dashboardCharts.map((dc) => ({
          ...dc,
          name: dc.chart?.name,
          chart_type: dc.chart?.chart_type,
          config: dc.chart?.config ? JSON.parse(dc.chart.config) : {},
          sql_query: dc.chart?.sql_query,
          query_id: dc.chart?.query_id,
          connection_id: dc.chart?.connection_id,
        })),
        dashboardCharts: undefined,
      },
    });
  } catch (error) {
    console.error("Get public dashboard error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard" });
  }
});

// All other routes require authentication
router.use(authenticateToken);

// Get all dashboards
router.get("/", async (req, res) => {
  try {
    const dashboards = await prisma.dashboard.findMany({
      include: {
        creator: { select: { name: true } },
        _count: { select: { dashboardCharts: true } },
      },
      orderBy: { updated_at: "desc" },
    });

    const parsedDashboards = dashboards.map((d) => ({
      ...d,
      layout: JSON.parse(d.layout),
      created_by_name: d.creator?.name,
      chart_count: d._count.dashboardCharts,
      creator: undefined,
      _count: undefined,
    }));

    res.json({ dashboards: parsedDashboards });
  } catch (error) {
    console.error("Get dashboards error:", error);
    res.status(500).json({ error: "Failed to fetch dashboards" });
  }
});

// Get single dashboard with charts and components
router.get("/:id", async (req, res) => {
  try {
    const dashboard = await prisma.dashboard.findUnique({
      where: { id: req.params.id },
      include: {
        creator: { select: { name: true } },
        dashboardCharts: {
          include: {
            chart: {
              include: { connection: { select: { name: true } } },
            },
            component: true,
          },
        },
      },
    });

    if (!dashboard) {
      return res.status(404).json({ error: "Dashboard not found" });
    }

    // Transform to unified format
    const items = dashboard.dashboardCharts.map((item) => {
      if (item.chart_id && item.chart) {
        return {
          id: item.id,
          dashboard_id: item.dashboard_id,
          chart_id: item.chart_id,
          component_id: item.component_id,
          position_x: item.position_x,
          position_y: item.position_y,
          width: item.width,
          height: item.height,
          type: 'chart',
          name: item.chart.name,
          chart_type: item.chart.chart_type,
          config: item.chart.config ? JSON.parse(item.chart.config) : {},
          sql_query: item.chart.sql_query,
          connection_id: item.chart.connection_id,
          connection_name: item.chart.connection?.name,
        };
      } else if (item.component_id && item.component) {
        return {
          id: item.id,
          dashboard_id: item.dashboard_id,
          chart_id: item.chart_id,
          component_id: item.component_id,
          position_x: item.position_x,
          position_y: item.position_y,
          width: item.width,
          height: item.height,
          type: 'component',
          name: item.component.name,
          config: item.component.config ? JSON.parse(item.component.config) : {},
          sql_query: item.component.sql_query,
          connection_id: item.component.connection_id,
        };
      }
      return item;
    });

    res.json({
      dashboard: {
        id: dashboard.id,
        name: dashboard.name,
        description: dashboard.description,
        is_public: dashboard.is_public,
        created_by: dashboard.created_by,
        created_at: dashboard.created_at,
        updated_at: dashboard.updated_at,
        created_by_name: dashboard.creator?.name,
        layout: JSON.parse(dashboard.layout),
        filters: JSON.parse(dashboard.filters || '[]'),
        charts: items,
      },
    });
  } catch (error) {
    console.error("Get dashboard error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard" });
  }
});

// Create new dashboard
router.post("/", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { name, description, layout = [], is_public = false } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Dashboard name is required" });
    }

    const dashboard = await dashboardRepository.create({
      name,
      description,
      layout: JSON.stringify(layout),
      is_public: is_public ? 1 : 0,
      created_by: req.user.id,
    });

    res.status(201).json({
      dashboard: {
        id: dashboard.id,
        name,
        description,
        layout,
        is_public,
      },
      message: "Dashboard created successfully",
    });
  } catch (error) {
    console.error("Create dashboard error:", error);
    res.status(500).json({ error: "Failed to create dashboard" });
  }
});

// Update dashboard
router.put("/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { name, description, layout, is_public, filters } = req.body;
    const dashboardId = req.params.id;

    const existing = await dashboardRepository.findById(dashboardId);
    if (!existing) {
      return res.status(404).json({ error: "Dashboard not found" });
    }

    await dashboardRepository.update(dashboardId, {
      name: name || existing.name,
      description: description !== undefined ? description : existing.description,
      layout: layout ? JSON.stringify(layout) : existing.layout,
      is_public: is_public !== undefined ? (is_public ? 1 : 0) : existing.is_public,
      filters: filters ? JSON.stringify(filters) : (existing.filters || '[]'),
    });

    res.json({ message: "Dashboard updated successfully" });
  } catch (error) {
    console.error("Update dashboard error:", error);
    res.status(500).json({ error: "Failed to update dashboard" });
  }
});

// Delete dashboard
router.delete("/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const dashboardId = req.params.id;

    const exists = await dashboardRepository.exists(dashboardId);
    if (!exists) {
      return res.status(404).json({ error: "Dashboard not found" });
    }

    await dashboardRepository.delete(dashboardId);
    res.json({ message: "Dashboard deleted successfully" });
  } catch (error) {
    console.error("Delete dashboard error:", error);
    res.status(500).json({ error: "Failed to delete dashboard" });
  }
});

// Clone dashboard
router.post("/:id/clone", requireRole("admin", "editor"), async (req, res) => {
  try {
    const sourceDashboardId = req.params.id;
    const source = await dashboardRepository.findById(sourceDashboardId);
    
    if (!source) {
      return res.status(404).json({ error: "Dashboard not found" });
    }

    const newName = `${source.name} (Copy)`;
    const newDashboard = await dashboardRepository.duplicate(sourceDashboardId, newName, req.user.id);

    res.status(201).json({
      dashboard: {
        id: newDashboard.id,
        name: newName,
        description: source.description,
        is_public: 0,
      },
      message: "Dashboard cloned successfully",
    });
  } catch (error) {
    console.error("Clone dashboard error:", error);
    res.status(500).json({ error: "Failed to clone dashboard" });
  }
});

// Add chart or component to dashboard
router.post("/:id/charts", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { chart_id, component_id, position_x = 0, position_y = 0, width = 6, height = 4 } = req.body;
    const dashboardId = req.params.id;

    if (!chart_id && !component_id) {
      return res.status(400).json({ error: "Either chart_id or component_id is required" });
    }

    const dashboardExists = await dashboardRepository.exists(dashboardId);
    if (!dashboardExists) {
      return res.status(404).json({ error: "Dashboard not found" });
    }

    // Validate chart or component exists
    if (chart_id) {
      const chartExists = await chartRepository.exists(chart_id);
      if (!chartExists) {
        return res.status(404).json({ error: "Chart not found" });
      }
    }
    if (component_id) {
      const componentExists = await customComponentRepository.exists(component_id);
      if (!componentExists) {
        return res.status(404).json({ error: "Component not found" });
      }
    }

    const dashboardChart = await dashboardRepository.addChart({
      dashboard_id: dashboardId,
      chart_id: chart_id || null,
      component_id: component_id || null,
      position_x,
      position_y,
      width,
      height,
    });

    res.status(201).json({
      dashboardChart,
      message: chart_id ? "Chart added to dashboard" : "Component added to dashboard",
    });
  } catch (error) {
    console.error("Add chart/component to dashboard error:", error);
    res.status(500).json({ error: "Failed to add item to dashboard" });
  }
});

// Update chart position in dashboard
router.put("/:id/charts/:chartId", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { position_x, position_y, width, height } = req.body;
    const { id: dashboardId, chartId } = req.params;

    const dashboardChart = await prisma.dashboardChart.findFirst({
      where: { dashboard_id: dashboardId, id: chartId },
    });

    if (!dashboardChart) {
      return res.status(404).json({ error: "Chart not found in dashboard" });
    }

    await dashboardRepository.updateDashboardChart(chartId, {
      position_x: position_x ?? dashboardChart.position_x,
      position_y: position_y ?? dashboardChart.position_y,
      width: width ?? dashboardChart.width,
      height: height ?? dashboardChart.height,
    });

    res.json({ message: "Chart position updated" });
  } catch (error) {
    console.error("Update chart position error:", error);
    res.status(500).json({ error: "Failed to update chart position" });
  }
});

// Remove chart from dashboard
router.delete("/:id/charts/:chartId", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { id: dashboardId, chartId } = req.params;

    const dashboardChart = await prisma.dashboardChart.findFirst({
      where: { dashboard_id: dashboardId, id: chartId },
    });

    if (!dashboardChart) {
      return res.status(404).json({ error: "Chart not found in dashboard" });
    }

    await dashboardRepository.removeChart(chartId);
    res.json({ message: "Chart removed from dashboard" });
  } catch (error) {
    console.error("Remove chart from dashboard error:", error);
    res.status(500).json({ error: "Failed to remove chart from dashboard" });
  }
});

// Get all chart and component data for a dashboard
router.get("/:id/data", async (req, res) => {
  try {
    const dashboard = await dashboardRepository.findById(req.params.id);

    if (!dashboard) {
      return res.status(404).json({ error: "Dashboard not found" });
    }

    // Get all dashboard items with related data
    const dashboardItems = await prisma.dashboardChart.findMany({
      where: { dashboard_id: req.params.id },
      include: {
        chart: {
          include: {
            dataset: { include: { connection: true } },
            connection: true,
            savedQuery: true,
          },
        },
        component: {
          include: {
            dataset: { include: { connection: true } },
            connection: true,
          },
        },
      },
    });

    const dataPromises = dashboardItems.map(async (item) => {
      try {
        if (item.chart_id && item.chart) {
          const chart = item.chart;
          let result;

          // If chart uses a dataset
          if (chart.dataset_id && chart.dataset) {
            const dataset = chart.dataset;
            const connection = dataset.connection;

            if (!connection) {
              return { chartId: chart.id, dashboardChartId: item.id, error: "No connection" };
            }

            if (dataset.source_type === 'sql') {
              let sqlQuery;
              if (dataset.dataset_type === 'physical') {
                const schemaPrefix = dataset.table_schema ? `"${dataset.table_schema}".` : '';
                sqlQuery = `SELECT * FROM ${schemaPrefix}"${dataset.table_name}"`;
              } else if (dataset.dataset_type === 'virtual') {
                sqlQuery = dataset.sql_query;
              }

              if (!sqlQuery) {
                return { chartId: chart.id, dashboardChartId: item.id, error: "No query" };
              }

              result = await executeQuery(connection, sqlQuery);
            } else if (dataset.source_type === 'api') {
              result = await executeApiRequest(connection);
            } else if (dataset.source_type === 'googlesheet') {
              result = await fetchGoogleSheet(connection);
            }
          } else {
            // Legacy: chart uses connection directly
            let sqlQuery = chart.sql_query;

            if (chart.query_id && chart.savedQuery && !sqlQuery) {
              sqlQuery = chart.savedQuery.sql_query;
            }

            if (!sqlQuery) {
              return { chartId: chart.id, dashboardChartId: item.id, error: "No query" };
            }

            if (!chart.connection) {
              return { chartId: chart.id, dashboardChartId: item.id, error: "No connection" };
            }

            result = await executeQuery(chart.connection, sqlQuery);
          }

          return {
            chartId: chart.id,
            dashboardChartId: item.id,
            data: result?.rows || [],
            fields: result?.fields,
            rowCount: result?.rowCount,
            config: JSON.parse(chart.config),
          };
        } else if (item.component_id && item.component) {
          const component = item.component;
          let result;

          // If component uses a dataset
          if (component.dataset_id && component.dataset) {
            const dataset = component.dataset;
            const connection = dataset.connection;

            if (!connection) {
              return { componentId: component.id, chartId: component.id, dashboardChartId: item.id, error: "No connection" };
            }

            if (dataset.source_type === 'sql') {
              let sqlQuery;
              if (dataset.dataset_type === 'physical') {
                const schemaPrefix = dataset.table_schema ? `"${dataset.table_schema}".` : '';
                sqlQuery = `SELECT * FROM ${schemaPrefix}"${dataset.table_name}"`;
              } else if (dataset.dataset_type === 'virtual') {
                sqlQuery = dataset.sql_query;
              }

              if (!sqlQuery) {
                return { componentId: component.id, chartId: component.id, dashboardChartId: item.id, error: "No query" };
              }

              result = await executeQuery(connection, sqlQuery);
            } else if (dataset.source_type === 'api') {
              result = await executeApiRequest(connection);
            } else if (dataset.source_type === 'googlesheet') {
              result = await fetchGoogleSheet(connection);
            }
          } else if (component.sql_query) {
            // Legacy: component uses connection directly
            if (!component.connection) {
              return { componentId: component.id, chartId: component.id, dashboardChartId: item.id, error: "No connection" };
            }

            result = await executeQuery(component.connection, component.sql_query);
          }

          return {
            componentId: component.id,
            chartId: component.id, // For backward compatibility
            dashboardChartId: item.id,
            data: result?.rows || [],
            fields: result?.fields,
            rowCount: result?.rowCount,
            config: JSON.parse(component.config || '{}'),
          };
        }

        return { dashboardChartId: item.id, error: "Unknown item type" };
      } catch (error) {
        return { dashboardChartId: item.id, error: error.message };
      }
    });

    const chartData = await Promise.all(dataPromises);
    res.json({ chartData });
  } catch (error) {
    console.error("Get dashboard data error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

export default router;
