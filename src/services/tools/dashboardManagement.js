/**
 * Dashboard Management Tool
 * Full CRUD operations for dashboards including chart assignments
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import db from "../../config/database.js";
import { executeQuery } from "../databaseConnector.js";
import { findDashboard, findChart } from "./utils.js";

const dashboardManagementDef = toolDefinition({
  name: "dashboard_management",
  description: `Manage dashboards and their charts. Supported actions:
- list: List all dashboards with chart counts
- get: Get dashboard details with all its charts
- create: Create a new dashboard
- update: Update dashboard name, description, layout, or visibility
- delete: Delete a dashboard
- add_chart: Add an existing chart to a dashboard
- remove_chart: Remove a chart from a dashboard
- update_chart_position: Update chart position/size in dashboard
- get_data: Get all chart data for a dashboard
Use this when user wants to create, modify dashboards or organize charts on dashboards.
You can use either dashboard ID or dashboard name, and chart ID or chart name.`,
  inputSchema: z.object({
    action: z
      .enum(["list", "get", "create", "update", "delete", "add_chart", "remove_chart", "update_chart_position", "get_data"])
      .describe("The action to perform"),
    dashboardId: z
      .string()
      .optional()
      .describe("Dashboard ID (required for get, update, delete, add_chart, remove_chart, update_chart_position, get_data)"),
    chartId: z.string().optional().describe("Chart ID (for add_chart, remove_chart, update_chart_position)"),
    dashboardChartId: z.string().optional().describe("Dashboard-Chart relation ID (for update_chart_position, remove_chart)"),
    data: z
      .object({
        name: z.string().optional().describe("Dashboard name"),
        description: z.string().optional().describe("Dashboard description"),
        is_public: z.boolean().optional().describe("Make dashboard publicly accessible"),
        layout: z.array(z.any()).optional().describe("Dashboard layout configuration"),
        position_x: z.number().optional().describe("Chart X position (0-11, grid columns)"),
        position_y: z.number().optional().describe("Chart Y position (row number)"),
        width: z.number().optional().describe("Chart width (1-12 grid columns, default 6)"),
        height: z.number().optional().describe("Chart height (grid rows, default 4)"),
      })
      .optional()
      .describe("Dashboard or chart position data"),
  }),
});

const dashboardManagement = dashboardManagementDef.server(
  async ({ action, dashboardId, chartId, dashboardChartId, data }) => {
    try {
      switch (action) {
        case "list": {
          const dashboards = db
            .prepare(
              `SELECT d.*, 
                (SELECT COUNT(*) FROM dashboard_charts WHERE dashboard_id = d.id) as chart_count,
                u.name as created_by_name
               FROM dashboards d
               LEFT JOIN users u ON d.created_by = u.id
               ORDER BY d.updated_at DESC`
            )
            .all();

          return {
            success: true,
            action: "list",
            totalDashboards: dashboards.length,
            dashboards: dashboards.map((d) => ({
              id: d.id,
              name: d.name,
              description: d.description,
              chartCount: d.chart_count,
              isPublic: d.is_public === 1,
              createdBy: d.created_by_name,
              createdAt: d.created_at,
              updatedAt: d.updated_at,
            })),
            summary: {
              public: dashboards.filter((d) => d.is_public === 1).length,
              private: dashboards.filter((d) => d.is_public === 0).length,
            },
          };
        }

        case "get": {
          if (!dashboardId) {
            return { success: false, error: "dashboardId is required for get action" };
          }

          const dashboardBase = findDashboard(dashboardId);
          if (!dashboardBase) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          const dashboard = db
            .prepare(
              `SELECT d.*, u.name as created_by_name
               FROM dashboards d
               LEFT JOIN users u ON d.created_by = u.id
               WHERE d.id = ?`
            )
            .get(dashboardBase.id);

          if (!dashboard) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          const charts = db
            .prepare(
              `SELECT dc.id as dashboard_chart_id, dc.position_x, dc.position_y, dc.width, dc.height,
                      ch.id, ch.name, ch.chart_type, ch.config, ch.sql_query,
                      c.name as connection_name
               FROM dashboard_charts dc
               JOIN charts ch ON dc.chart_id = ch.id
               LEFT JOIN connections c ON ch.connection_id = c.id
               WHERE dc.dashboard_id = ?`
            )
            .all(dashboardId);

          return {
            success: true,
            action: "get",
            dashboard: {
              id: dashboard.id,
              name: dashboard.name,
              description: dashboard.description,
              isPublic: dashboard.is_public === 1,
              layout: JSON.parse(dashboard.layout),
              createdBy: dashboard.created_by_name,
              createdAt: dashboard.created_at,
              updatedAt: dashboard.updated_at,
              chartCount: charts.length,
              charts: charts.map((ch) => ({
                dashboardChartId: ch.dashboard_chart_id,
                chartId: ch.id,
                name: ch.name,
                chartType: ch.chart_type,
                config: JSON.parse(ch.config),
                connectionName: ch.connection_name,
                position: {
                  x: ch.position_x,
                  y: ch.position_y,
                  width: ch.width,
                  height: ch.height,
                },
              })),
            },
          };
        }

        case "create": {
          if (!data) {
            return { success: false, error: "data is required for create action" };
          }

          const { name, description, is_public, layout } = data;

          if (!name) {
            return { success: false, error: "name is required" };
          }

          const newDashboardId = uuidv4();

          db.prepare(
            `INSERT INTO dashboards (id, name, description, layout, is_public)
             VALUES (?, ?, ?, ?, ?)`
          ).run(newDashboardId, name, description || null, JSON.stringify(layout || []), is_public ? 1 : 0);

          return {
            success: true,
            action: "create",
            message: "Dashboard created successfully",
            dashboard: {
              id: newDashboardId,
              name,
              description,
              isPublic: is_public || false,
            },
          };
        }

        case "update": {
          if (!dashboardId) {
            return { success: false, error: "dashboardId is required for update action" };
          }
          if (!data) {
            return { success: false, error: "data is required for update action" };
          }

          const existing = findDashboard(dashboardId);
          if (!existing) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          const { name, description, is_public, layout } = data;

          db.prepare(
            `UPDATE dashboards SET 
              name = ?, description = ?, layout = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).run(
            name || existing.name,
            description !== undefined ? description : existing.description,
            layout ? JSON.stringify(layout) : existing.layout,
            is_public !== undefined ? (is_public ? 1 : 0) : existing.is_public,
            existing.id
          );

          return {
            success: true,
            action: "update",
            message: "Dashboard updated successfully",
            dashboardId,
          };
        }

        case "delete": {
          if (!dashboardId) {
            return { success: false, error: "dashboardId is required for delete action" };
          }

          const existing = findDashboard(dashboardId);
          if (!existing) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          // Remove chart associations and delete dashboard
          db.prepare("DELETE FROM dashboard_charts WHERE dashboard_id = ?").run(existing.id);
          db.prepare("DELETE FROM dashboards WHERE id = ?").run(existing.id);

          return {
            success: true,
            action: "delete",
            message: `Dashboard "${existing.name}" deleted successfully`,
            dashboardId,
          };
        }

        case "add_chart": {
          if (!dashboardId) {
            return { success: false, error: "dashboardId is required for add_chart action" };
          }
          if (!chartId) {
            return { success: false, error: "chartId is required for add_chart action" };
          }

          const dashboard = findDashboard(dashboardId);
          if (!dashboard) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          const chart = findChart(chartId);
          if (!chart) {
            return { success: false, error: "Chart not found", chartId };
          }

          // Check if already added
          const existing = db
            .prepare("SELECT id FROM dashboard_charts WHERE dashboard_id = ? AND chart_id = ?")
            .get(dashboard.id, chart.id);
          if (existing) {
            return {
              success: false,
              error: "Chart is already on this dashboard",
              dashboardChartId: existing.id,
            };
          }

          const { position_x = 0, position_y = 0, width = 6, height = 4 } = data || {};

          const newDashboardChartId = uuidv4();

          db.prepare(
            `INSERT INTO dashboard_charts (id, dashboard_id, chart_id, position_x, position_y, width, height)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(newDashboardChartId, dashboard.id, chart.id, position_x, position_y, width, height);

          return {
            success: true,
            action: "add_chart",
            message: `Chart "${chart.name}" added to dashboard "${dashboard.name}"`,
            dashboardChartId: newDashboardChartId,
            position: { x: position_x, y: position_y, width, height },
          };
        }

        case "remove_chart": {
          if (!dashboardId) {
            return { success: false, error: "dashboardId is required for remove_chart action" };
          }

          const dashboard = findDashboard(dashboardId);
          if (!dashboard) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          // Can use either dashboardChartId or chartId
          let whereClause = "dashboard_id = ?";
          let params = [dashboard.id];

          if (dashboardChartId) {
            whereClause += " AND id = ?";
            params.push(dashboardChartId);
          } else if (chartId) {
            const chart = findChart(chartId);
            if (!chart) {
              return { success: false, error: "Chart not found", chartId };
            }
            whereClause += " AND chart_id = ?";
            params.push(chart.id);
          } else {
            return { success: false, error: "Either dashboardChartId or chartId is required" };
          }

          const existingDC = db.prepare(`SELECT * FROM dashboard_charts WHERE ${whereClause}`).get(...params);
          if (!existingDC) {
            return { success: false, error: "Chart not found on this dashboard" };
          }

          db.prepare(`DELETE FROM dashboard_charts WHERE ${whereClause}`).run(...params);

          return {
            success: true,
            action: "remove_chart",
            message: "Chart removed from dashboard",
            dashboardId: dashboard.id,
          };
        }

        case "update_chart_position": {
          if (!dashboardId) {
            return { success: false, error: "dashboardId is required for update_chart_position action" };
          }
          if (!data) {
            return { success: false, error: "data with position values is required" };
          }

          const dashboardForPos = findDashboard(dashboardId);
          if (!dashboardForPos) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          // Can use either dashboardChartId or chartId
          let whereClause = "dashboard_id = ?";
          let params = [dashboardForPos.id];

          if (dashboardChartId) {
            whereClause += " AND id = ?";
            params.push(dashboardChartId);
          } else if (chartId) {
            const chart = findChart(chartId);
            if (!chart) {
              return { success: false, error: "Chart not found", chartId };
            }
            whereClause += " AND chart_id = ?";
            params.push(chart.id);
          } else {
            return { success: false, error: "Either dashboardChartId or chartId is required" };
          }

          const existing = db.prepare(`SELECT * FROM dashboard_charts WHERE ${whereClause}`).get(...params);
          if (!existing) {
            return { success: false, error: "Chart not found on this dashboard" };
          }

          const { position_x, position_y, width, height } = data;

          db.prepare(
            `UPDATE dashboard_charts SET 
              position_x = ?, position_y = ?, width = ?, height = ?
             WHERE id = ?`
          ).run(
            position_x ?? existing.position_x,
            position_y ?? existing.position_y,
            width ?? existing.width,
            height ?? existing.height,
            existing.id
          );

          return {
            success: true,
            action: "update_chart_position",
            message: "Chart position updated",
            position: {
              x: position_x ?? existing.position_x,
              y: position_y ?? existing.position_y,
              width: width ?? existing.width,
              height: height ?? existing.height,
            },
          };
        }

        case "get_data": {
          if (!dashboardId) {
            return { success: false, error: "dashboardId is required for get_data action" };
          }

          const dashboard = findDashboard(dashboardId);
          if (!dashboard) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          const dashboardCharts = db
            .prepare(
              `SELECT dc.id as dashboard_chart_id, ch.*, 
                      c.host, c.port, c.database_name, c.username, c.password, c.ssl, c.type as db_type
               FROM dashboard_charts dc
               JOIN charts ch ON dc.chart_id = ch.id
               JOIN connections c ON ch.connection_id = c.id
               WHERE dc.dashboard_id = ?`
            )
            .all(dashboardId);

          const chartDataPromises = dashboardCharts.map(async (chart) => {
            try {
              let sqlQuery = chart.sql_query;

              if (chart.query_id && !sqlQuery) {
                const savedQuery = db.prepare("SELECT sql_query FROM saved_queries WHERE id = ?").get(chart.query_id);
                if (savedQuery) {
                  sqlQuery = savedQuery.sql_query;
                }
              }

              if (!sqlQuery) {
                return {
                  chartId: chart.id,
                  dashboardChartId: chart.dashboard_chart_id,
                  name: chart.name,
                  error: "No query defined",
                };
              }

              const connection = {
                id: chart.connection_id,
                type: chart.db_type,
                host: chart.host,
                port: chart.port,
                database_name: chart.database_name,
                username: chart.username,
                password: chart.password,
                ssl: chart.ssl,
              };

              const result = await executeQuery(connection, sqlQuery);

              return {
                chartId: chart.id,
                dashboardChartId: chart.dashboard_chart_id,
                name: chart.name,
                chartType: chart.chart_type,
                data: result.rows,
                fields: result.fields,
                rowCount: result.rowCount,
                config: JSON.parse(chart.config),
              };
            } catch (error) {
              return {
                chartId: chart.id,
                dashboardChartId: chart.dashboard_chart_id,
                name: chart.name,
                error: error.message,
              };
            }
          });

          const chartData = await Promise.all(chartDataPromises);

          return {
            success: true,
            action: "get_data",
            dashboardId,
            dashboardName: dashboard.name,
            chartCount: chartData.length,
            successfulCharts: chartData.filter((c) => !c.error).length,
            chartData,
          };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      console.error("Dashboard management error:", error);
      return {
        success: false,
        error: error.message || "Dashboard management failed",
        action,
      };
    }
  }
);

export default dashboardManagement;

