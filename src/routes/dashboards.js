import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "../config/database.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { executeQuery } from "../services/databaseConnector.js";
import { executeApiRequest } from "../services/apiConnector.js";
import { fetchGoogleSheet } from "../services/googleSheetsConnector.js";

const router = Router();

// Public dashboards don't require authentication
router.get("/public/:id", async (req, res) => {
  try {
    const dashboard = db
      .prepare(
        `
      SELECT * FROM dashboards WHERE id = ? AND is_public = 1
    `
      )
      .get(req.params.id);

    if (!dashboard) {
      return res.status(404).json({ error: "Dashboard not found or not public" });
    }

    const dashboardCharts = db
      .prepare(
        `
      SELECT dc.*, ch.name, ch.chart_type, ch.config, ch.sql_query, ch.query_id, ch.connection_id
      FROM dashboard_charts dc
      JOIN charts ch ON dc.chart_id = ch.id
      WHERE dc.dashboard_id = ?
    `
      )
      .all(req.params.id);

    res.json({
      dashboard: {
        ...dashboard,
        layout: JSON.parse(dashboard.layout),
        charts: dashboardCharts.map((c) => ({
          ...c,
          config: JSON.parse(c.config),
        })),
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
router.get("/", (req, res) => {
  try {
    const dashboards = db
      .prepare(
        `
      SELECT d.*, u.name as created_by_name,
             (SELECT COUNT(*) FROM dashboard_charts WHERE dashboard_id = d.id) as chart_count
      FROM dashboards d
      LEFT JOIN users u ON d.created_by = u.id
      ORDER BY d.updated_at DESC
    `
      )
      .all();

    const parsedDashboards = dashboards.map((d) => ({
      ...d,
      layout: JSON.parse(d.layout),
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
    const dashboard = db
      .prepare(
        `
      SELECT d.*, u.name as created_by_name
      FROM dashboards d
      LEFT JOIN users u ON d.created_by = u.id
      WHERE d.id = ?
    `
      )
      .get(req.params.id);

    if (!dashboard) {
      return res.status(404).json({ error: "Dashboard not found" });
    }

    // Get dashboard items (both charts and custom components)
    const dashboardItems = db
      .prepare(
        `
      SELECT dc.*, 
             ch.name as chart_name, ch.chart_type, ch.config as chart_config, ch.sql_query as chart_sql_query, ch.query_id, ch.connection_id as chart_connection_id,
             c.name as chart_connection_name,
             cc.name as component_name, cc.html_content, cc.css_content, cc.js_content, cc.config as component_config, cc.sql_query as component_sql_query, cc.connection_id as component_connection_id
      FROM dashboard_charts dc
      LEFT JOIN charts ch ON dc.chart_id = ch.id
      LEFT JOIN connections c ON ch.connection_id = c.id
      LEFT JOIN custom_components cc ON dc.component_id = cc.id
      WHERE dc.dashboard_id = ?
    `
      )
      .all(req.params.id);

    // Transform to unified format
    const items = dashboardItems.map((item) => {
      if (item.chart_id) {
        return {
          ...item,
          type: 'chart',
          name: item.chart_name,
          chart_type: item.chart_type,
          config: item.chart_config ? JSON.parse(item.chart_config) : {},
          sql_query: item.chart_sql_query,
          connection_id: item.chart_connection_id,
          connection_name: item.chart_connection_name,
        };
      } else if (item.component_id) {
        return {
          ...item,
          type: 'component',
          name: item.component_name,
          config: item.component_config ? JSON.parse(item.component_config) : {},
          sql_query: item.component_sql_query,
          connection_id: item.component_connection_id,
        };
      }
      return item;
    });

    res.json({
      dashboard: {
        ...dashboard,
        layout: JSON.parse(dashboard.layout),
        charts: items, // Keep as 'charts' for backward compatibility
      },
    });
  } catch (error) {
    console.error("Get dashboard error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard" });
  }
});

// Create new dashboard
router.post("/", requireRole("admin", "editor"), (req, res) => {
  try {
    const { name, description, layout = [], is_public = false } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Dashboard name is required" });
    }

    const dashboardId = uuidv4();

    db.prepare(
      `
      INSERT INTO dashboards (id, name, description, layout, is_public, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(dashboardId, name, description || null, JSON.stringify(layout), is_public ? 1 : 0, req.user.id);

    res.status(201).json({
      dashboard: {
        id: dashboardId,
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
router.put("/:id", requireRole("admin", "editor"), (req, res) => {
  try {
    const { name, description, layout, is_public } = req.body;
    const dashboardId = req.params.id;

    const existing = db.prepare("SELECT * FROM dashboards WHERE id = ?").get(dashboardId);
    if (!existing) {
      return res.status(404).json({ error: "Dashboard not found" });
    }

    db.prepare(
      `
      UPDATE dashboards 
      SET name = ?, description = ?, layout = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(
      name || existing.name,
      description !== undefined ? description : existing.description,
      layout ? JSON.stringify(layout) : existing.layout,
      is_public !== undefined ? (is_public ? 1 : 0) : existing.is_public,
      dashboardId
    );

    res.json({ message: "Dashboard updated successfully" });
  } catch (error) {
    console.error("Update dashboard error:", error);
    res.status(500).json({ error: "Failed to update dashboard" });
  }
});

// Delete dashboard
router.delete("/:id", requireRole("admin", "editor"), (req, res) => {
  try {
    const dashboardId = req.params.id;

    const existing = db.prepare("SELECT id FROM dashboards WHERE id = ?").get(dashboardId);
    if (!existing) {
      return res.status(404).json({ error: "Dashboard not found" });
    }

    // Dashboard charts will be deleted by cascade
    db.prepare("DELETE FROM dashboard_charts WHERE dashboard_id = ?").run(dashboardId);
    db.prepare("DELETE FROM dashboards WHERE id = ?").run(dashboardId);

    res.json({ message: "Dashboard deleted successfully" });
  } catch (error) {
    console.error("Delete dashboard error:", error);
    res.status(500).json({ error: "Failed to delete dashboard" });
  }
});

// Add chart or component to dashboard
router.post("/:id/charts", requireRole("admin", "editor"), (req, res) => {
  try {
    const { chart_id, component_id, position_x = 0, position_y = 0, width = 6, height = 4 } = req.body;
    const dashboardId = req.params.id;

    if (!chart_id && !component_id) {
      return res.status(400).json({ error: "Either chart_id or component_id is required" });
    }

    const dashboard = db.prepare("SELECT id FROM dashboards WHERE id = ?").get(dashboardId);
    if (!dashboard) {
      return res.status(404).json({ error: "Dashboard not found" });
    }

    // Validate chart or component exists
    if (chart_id) {
      const chart = db.prepare("SELECT id FROM charts WHERE id = ?").get(chart_id);
      if (!chart) {
        return res.status(404).json({ error: "Chart not found" });
      }
    }
    if (component_id) {
      const component = db.prepare("SELECT id FROM custom_components WHERE id = ?").get(component_id);
      if (!component) {
        return res.status(404).json({ error: "Component not found" });
      }
    }

    const id = uuidv4();

    db.prepare(
      `
      INSERT INTO dashboard_charts (id, dashboard_id, chart_id, component_id, position_x, position_y, width, height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(id, dashboardId, chart_id || null, component_id || null, position_x, position_y, width, height);

    res.status(201).json({
      dashboardChart: { id, dashboard_id: dashboardId, chart_id, component_id, position_x, position_y, width, height },
      message: chart_id ? "Chart added to dashboard" : "Component added to dashboard",
    });
  } catch (error) {
    console.error("Add chart/component to dashboard error:", error);
    res.status(500).json({ error: "Failed to add item to dashboard" });
  }
});

// Update chart position in dashboard
router.put("/:id/charts/:chartId", requireRole("admin", "editor"), (req, res) => {
  try {
    const { position_x, position_y, width, height } = req.body;
    const { id: dashboardId, chartId } = req.params;

    const dashboardChart = db
      .prepare(
        `
      SELECT * FROM dashboard_charts WHERE dashboard_id = ? AND id = ?
    `
      )
      .get(dashboardId, chartId);

    if (!dashboardChart) {
      return res.status(404).json({ error: "Chart not found in dashboard" });
    }

    db.prepare(
      `
      UPDATE dashboard_charts 
      SET position_x = ?, position_y = ?, width = ?, height = ?
      WHERE id = ?
    `
    ).run(
      position_x ?? dashboardChart.position_x,
      position_y ?? dashboardChart.position_y,
      width ?? dashboardChart.width,
      height ?? dashboardChart.height,
      chartId
    );

    res.json({ message: "Chart position updated" });
  } catch (error) {
    console.error("Update chart position error:", error);
    res.status(500).json({ error: "Failed to update chart position" });
  }
});

// Remove chart from dashboard
router.delete("/:id/charts/:chartId", requireRole("admin", "editor"), (req, res) => {
  try {
    const { id: dashboardId, chartId } = req.params;

    const dashboardChart = db
      .prepare(
        `
      SELECT * FROM dashboard_charts WHERE dashboard_id = ? AND id = ?
    `
      )
      .get(dashboardId, chartId);

    if (!dashboardChart) {
      return res.status(404).json({ error: "Chart not found in dashboard" });
    }

    db.prepare("DELETE FROM dashboard_charts WHERE id = ?").run(chartId);
    res.json({ message: "Chart removed from dashboard" });
  } catch (error) {
    console.error("Remove chart from dashboard error:", error);
    res.status(500).json({ error: "Failed to remove chart from dashboard" });
  }
});

// Get all chart and component data for a dashboard
router.get("/:id/data", async (req, res) => {
  try {
    const dashboard = db.prepare("SELECT * FROM dashboards WHERE id = ?").get(req.params.id);

    if (!dashboard) {
      return res.status(404).json({ error: "Dashboard not found" });
    }

    // Get chart data - support both dataset_id and legacy connection_id
    const dashboardCharts = db
      .prepare(
        `
      SELECT dc.id as dashboard_chart_id, ch.*,
             d.id as d_id, d.source_type, d.dataset_type, d.table_name, d.table_schema, d.sql_query as dataset_sql_query, d.connection_id as dataset_connection_id,
             c.host, c.port, c.database_name, c.username, c.password, c.ssl, c.type as db_type, c.config as db_config,
             dc_conn.host as dc_host, dc_conn.port as dc_port, dc_conn.database_name as dc_database_name, 
             dc_conn.username as dc_username, dc_conn.password as dc_password, dc_conn.ssl as dc_ssl, dc_conn.type as dc_db_type, dc_conn.config as dc_db_config
      FROM dashboard_charts dc
      JOIN charts ch ON dc.chart_id = ch.id
      LEFT JOIN datasets d ON ch.dataset_id = d.id
      LEFT JOIN connections c ON d.connection_id = c.id
      LEFT JOIN connections dc_conn ON ch.connection_id = dc_conn.id
      WHERE dc.dashboard_id = ? AND dc.chart_id IS NOT NULL
    `
      )
      .all(req.params.id);

    // Get component data - support both dataset_id and legacy connection_id
    const dashboardComponents = db
      .prepare(
        `
      SELECT dc.id as dashboard_chart_id, cc.*,
             d.id as d_id, d.source_type, d.dataset_type, d.table_name, d.table_schema, d.sql_query as dataset_sql_query, d.connection_id as dataset_connection_id,
             d.id as d_id, d.source_type, d.dataset_type, d.table_name, d.table_schema, d.sql_query as dataset_sql_query, d.connection_id as dataset_connection_id,
             c.host, c.port, c.database_name, c.username, c.password, c.ssl, c.type as db_type, c.config as db_config,
             dc_conn.host as dc_host, dc_conn.port as dc_port, dc_conn.database_name as dc_database_name, 
             dc_conn.username as dc_username, dc_conn.password as dc_password, dc_conn.ssl as dc_ssl, dc_conn.type as dc_db_type, dc_conn.config as dc_db_config
      FROM dashboard_charts dc
      JOIN custom_components cc ON dc.component_id = cc.id
      LEFT JOIN datasets d ON cc.dataset_id = d.id
      LEFT JOIN connections c ON d.connection_id = c.id
      LEFT JOIN connections dc_conn ON cc.connection_id = dc_conn.id
      WHERE dc.dashboard_id = ? AND dc.component_id IS NOT NULL
    `
      )
      .all(req.params.id);

    // Process chart data
    const chartDataPromises = dashboardCharts.map(async (chart) => {
      try {
        let sqlQuery;
        let connection;

          // Check if chart uses a dataset
        if (chart.dataset_id && chart.d_id) {
          connection = {
            id: chart.dataset_connection_id,
            type: chart.db_type,
            host: chart.host,
            port: chart.port,
            database_name: chart.database_name,
            username: chart.username,
            password: chart.password,
            username: chart.username,
            password: chart.password,
            ssl: chart.ssl,
            config: chart.db_config,
          };

          let result;

          if (chart.source_type === 'sql') {
            // Build query based on dataset type
            if (chart.dataset_type === 'physical') {
              const schemaPrefix = chart.table_schema ? `"${chart.table_schema}".` : '';
              sqlQuery = `SELECT * FROM ${schemaPrefix}"${chart.table_name}"`;
            } else if (chart.dataset_type === 'virtual') {
              sqlQuery = chart.dataset_sql_query;
            }

            if (!sqlQuery) {
              return { chartId: chart.id, dashboardChartId: chart.dashboard_chart_id, error: "No query" };
            }
             
            result = await executeQuery(connection, sqlQuery);
          } else if (chart.source_type === 'api') {
            result = await executeApiRequest(connection);
          } else if (chart.source_type === 'googlesheet') {
            result = await fetchGoogleSheet(connection);
          } else {
            return { chartId: chart.id, dashboardChartId: chart.dashboard_chart_id, error: `Unsupported source type: ${chart.source_type}` };
          }

          return {
            chartId: chart.id,
            dashboardChartId: chart.dashboard_chart_id,
            data: result.rows,
            fields: result.fields,
            rowCount: result.rowCount,
            config: JSON.parse(chart.config),
          };
        } else {
          // Legacy: chart uses connection directly
          sqlQuery = chart.sql_query;

          if (chart.query_id && !sqlQuery) {
            const savedQuery = db.prepare("SELECT sql_query FROM saved_queries WHERE id = ?").get(chart.query_id);
            if (savedQuery) {
              sqlQuery = savedQuery.sql_query;
            }
          }

          connection = {
            id: chart.connection_id,
            type: chart.dc_db_type,
            host: chart.dc_host,
            port: chart.dc_port,
            database_name: chart.dc_database_name,
            username: chart.dc_username,
            password: chart.dc_password,
            username: chart.dc_username,
            password: chart.dc_password,
            ssl: chart.dc_ssl,
            config: chart.dc_db_config,
          };

          if (!sqlQuery) {
            return { chartId: chart.id, dashboardChartId: chart.dashboard_chart_id, error: "No query" };
          }
  
          if (!connection || !connection.host) {
            return { chartId: chart.id, dashboardChartId: chart.dashboard_chart_id, error: "No connection" };
          }
  
          const result = await executeQuery(connection, sqlQuery);

          return {
            chartId: chart.id,
            dashboardChartId: chart.dashboard_chart_id,
            data: result.rows,
            fields: result.fields,
            rowCount: result.rowCount,
            config: JSON.parse(chart.config),
          };
        }

        return {
          chartId: chart.id,
          dashboardChartId: chart.dashboard_chart_id,
          data: result.rows,
          fields: result.fields,
          rowCount: result.rowCount,
          config: JSON.parse(chart.config),
        };
      } catch (error) {
        return { chartId: chart.id, dashboardChartId: chart.dashboard_chart_id, error: error.message };
      }
    });

    // Process component data
    const componentDataPromises = dashboardComponents.map(async (component) => {
      try {
        let sqlQuery;
        let connection;

        // Check if component uses a dataset
        if (component.dataset_id && component.d_id) {
          connection = {
            id: component.dataset_connection_id,
            type: component.db_type,
            host: component.host,
            port: component.port,
            database_name: component.database_name,
            username: component.username,
            password: component.password,
            username: component.username,
            password: component.password,
            ssl: component.ssl,
            config: component.db_config,
          };

          let result;

          if (component.source_type === 'sql') {
            // Build query based on dataset type
            if (component.dataset_type === 'physical') {
              const schemaPrefix = component.table_schema ? `"${component.table_schema}".` : '';
              sqlQuery = `SELECT * FROM ${schemaPrefix}"${component.table_name}"`;
            } else if (component.dataset_type === 'virtual') {
              sqlQuery = component.dataset_sql_query;
            }

            if (!sqlQuery) {
              return { componentId: component.id, dashboardChartId: component.dashboard_chart_id, error: "No query" };
            }
             
            result = await executeQuery(connection, sqlQuery);
          } else if (component.source_type === 'api') {
            result = await executeApiRequest(connection);
          } else if (component.source_type === 'googlesheet') {
            result = await fetchGoogleSheet(connection);
          } else {
            return { componentId: component.id, dashboardChartId: component.dashboard_chart_id, error: `Unsupported source type: ${component.source_type}` };
          }

          return {
            componentId: component.id,
            dashboardChartId: component.dashboard_chart_id,
            data: result.rows,
            fields: result.fields,
            rowCount: result.rowCount,
            config: JSON.parse(component.config || '{}'),
          };
        } else {
          // Legacy check
          sqlQuery = component.sql_query;

          if (component.query_id && !sqlQuery) {
            const savedQuery = db.prepare("SELECT sql_query FROM saved_queries WHERE id = ?").get(component.query_id);
            if (savedQuery) {
              sqlQuery = savedQuery.sql_query;
            }
          }

          connection = {
            id: component.connection_id,
            type: component.dc_db_type,
            host: component.dc_host,
            port: component.dc_port,
            database_name: component.dc_database_name,
            username: component.dc_username,
            password: component.dc_password,
            username: component.dc_username,
            password: component.dc_password,
            ssl: component.dc_ssl,
            config: component.dc_db_config,
          };

          if (!sqlQuery) {
            return { componentId: component.id, dashboardChartId: component.dashboard_chart_id, error: "No query" };
          }
  
          if (!connection || !connection.host) {
            return { componentId: component.id, dashboardChartId: component.dashboard_chart_id, error: "No connection" };
          }
  
          const result = await executeQuery(connection, sqlQuery);

          return {
            componentId: component.id,
            dashboardChartId: component.dashboard_chart_id,
            data: result.rows,
            fields: result.fields,
            rowCount: result.rowCount,
            config: JSON.parse(component.config || '{}'),
          };
        }

        return {
          componentId: component.id,
          dashboardChartId: component.dashboard_chart_id,
          data: result.rows,
          fields: result.fields,
          rowCount: result.rowCount,
        };
      } catch (error) {
        return { componentId: component.id, dashboardChartId: component.dashboard_chart_id, error: error.message };
      }
    });

    const [chartData, componentData] = await Promise.all([
      Promise.all(chartDataPromises),
      Promise.all(componentDataPromises)
    ]);

    // Combine chart and component data, using chartId field for backward compatibility
    const allData = [
      ...chartData,
      ...componentData.map(c => ({ ...c, chartId: c.componentId }))
    ];

    res.json({ chartData: allData });
  } catch (error) {
    console.error("Get dashboard data error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

export default router;
