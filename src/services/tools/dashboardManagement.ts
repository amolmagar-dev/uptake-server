// @ts-nocheck
/**
 * Dashboard Management Tool
 * Full CRUD operations for dashboards including chart assignments
 * Refactored to use Prisma repositories
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { dashboardRepository } from "../../db/repositories/index.js";
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
          const dashboards = await prisma.dashboard.findMany({
            include: {
              creator: { select: { name: true } },
              _count: { select: { dashboardCharts: true } }
            },
            orderBy: { updated_at: "desc" },
          });

          return {
            success: true,
            action: "list",
            totalDashboards: dashboards.length,
            dashboards: dashboards.map((d) => ({
              id: d.id,
              name: d.name,
              description: d.description,
              chartCount: d._count.dashboardCharts,
              isPublic: d.is_public === 1,
              createdBy: d.creator?.name,
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

          const dashboardBase = await findDashboard(dashboardId);
          if (!dashboardBase) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          const dashboard = await prisma.dashboard.findUnique({
            where: { id: dashboardBase.id },
            include: {
              creator: { select: { name: true } },
              dashboardCharts: {
                include: {
                  chart: {
                    include: {
                      connection: { select: { name: true } }
                    }
                  }
                }
              }
            }
          });

          if (!dashboard) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          return {
            success: true,
            action: "get",
            dashboard: {
              id: dashboard.id,
              name: dashboard.name,
              description: dashboard.description,
              isPublic: dashboard.is_public === 1,
              layout: dashboard.layout ? JSON.parse(dashboard.layout) : [],
              createdBy: dashboard.creator?.name,
              createdAt: dashboard.created_at,
              updatedAt: dashboard.updated_at,
              chartCount: dashboard.dashboardCharts.length,
              charts: dashboard.dashboardCharts.map((dc) => ({
                dashboardChartId: dc.id,
                chartId: dc.chart?.id,
                name: dc.chart?.name,
                chartType: dc.chart?.chart_type,
                config: dc.chart?.config ? JSON.parse(dc.chart.config) : {},
                connectionName: dc.chart?.connection?.name,
                position: {
                  x: dc.position_x,
                  y: dc.position_y,
                  width: dc.width,
                  height: dc.height,
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

          // Create dashboard using repository
          const newDashboard = await dashboardRepository.create({
            name,
            description: description || undefined,
            layout: JSON.stringify(layout || []),
            is_public: is_public ? 1 : 0,
          });

          return {
            success: true,
            action: "create",
            message: "Dashboard created successfully",
            dashboard: {
              id: newDashboard.id,
              name: newDashboard.name,
              description: newDashboard.description,
              isPublic: newDashboard.is_public === 1,
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

          const existing = await findDashboard(dashboardId);
          if (!existing) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          const { name, description, is_public, layout } = data;

          // Update dashboard using repository
          await dashboardRepository.update(existing.id, {
            name: name || undefined,
            description: description !== undefined ? description : undefined,
            layout: layout ? JSON.stringify(layout) : undefined,
            is_public: is_public !== undefined ? (is_public ? 1 : 0) : undefined,
          });

          return {
            success: true,
            action: "update",
            message: "Dashboard updated successfully",
            dashboardId: existing.id,
          };
        }

        case "delete": {
          if (!dashboardId) {
            return { success: false, error: "dashboardId is required for delete action" };
          }

          const existing = await findDashboard(dashboardId);
          if (!existing) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          // Delete dashboard using repository (cascades to dashboard_charts)
          await dashboardRepository.delete(existing.id);

          return {
            success: true,
            action: "delete",
            message: `Dashboard "${existing.name}" deleted successfully`,
            dashboardId: existing.id,
          };
        }

        case "add_chart": {
          if (!dashboardId) {
            return { success: false, error: "dashboardId is required for add_chart action" };
          }
          if (!chartId) {
            return { success: false, error: "chartId is required for add_chart action" };
          }

          const dashboard = await findDashboard(dashboardId);
          if (!dashboard) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          const chart = await findChart(chartId);
          if (!chart) {
            return { success: false, error: "Chart not found", chartId };
          }

          // Check if already added
          const existingDC = await prisma.dashboardChart.findFirst({
            where: { dashboard_id: dashboard.id, chart_id: chart.id }
          });
          if (existingDC) {
            return {
              success: false,
              error: "Chart is already on this dashboard",
              dashboardChartId: existingDC.id,
            };
          }

          const { position_x = 0, position_y = 0, width = 6, height = 4 } = data || {};

          // Add chart to dashboard using repository
          const newDashboardChart = await dashboardRepository.addChart({
            dashboard_id: dashboard.id,
            chart_id: chart.id,
            position_x,
            position_y,
            width,
            height,
          });

          return {
            success: true,
            action: "add_chart",
            message: `Chart "${chart.name}" added to dashboard "${dashboard.name}"`,
            dashboardChartId: newDashboardChart.id,
            position: { x: position_x, y: position_y, width, height },
          };
        }

        case "remove_chart": {
          if (!dashboardId) {
            return { success: false, error: "dashboardId is required for remove_chart action" };
          }

          const dashboard = await findDashboard(dashboardId);
          if (!dashboard) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          // Find the dashboard chart to remove
          let dashboardChartToRemove;

          if (dashboardChartId) {
            dashboardChartToRemove = await prisma.dashboardChart.findFirst({
              where: { id: dashboardChartId, dashboard_id: dashboard.id }
            });
          } else if (chartId) {
            const chart = await findChart(chartId);
            if (!chart) {
              return { success: false, error: "Chart not found", chartId };
            }
            dashboardChartToRemove = await prisma.dashboardChart.findFirst({
              where: { dashboard_id: dashboard.id, chart_id: chart.id }
            });
          } else {
            return { success: false, error: "Either dashboardChartId or chartId is required" };
          }

          if (!dashboardChartToRemove) {
            return { success: false, error: "Chart not found on this dashboard" };
          }

          // Remove chart using repository
          await dashboardRepository.removeChart(dashboardChartToRemove.id);

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

          const dashboardForPos = await findDashboard(dashboardId);
          if (!dashboardForPos) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          // Find the dashboard chart to update
          let dashboardChartToUpdate;

          if (dashboardChartId) {
            dashboardChartToUpdate = await prisma.dashboardChart.findFirst({
              where: { id: dashboardChartId, dashboard_id: dashboardForPos.id }
            });
          } else if (chartId) {
            const chart = await findChart(chartId);
            if (!chart) {
              return { success: false, error: "Chart not found", chartId };
            }
            dashboardChartToUpdate = await prisma.dashboardChart.findFirst({
              where: { dashboard_id: dashboardForPos.id, chart_id: chart.id }
            });
          } else {
            return { success: false, error: "Either dashboardChartId or chartId is required" };
          }

          if (!dashboardChartToUpdate) {
            return { success: false, error: "Chart not found on this dashboard" };
          }

          const { position_x, position_y, width, height } = data;

          // Update position using repository
          await dashboardRepository.updateDashboardChart(dashboardChartToUpdate.id, {
            position_x: position_x ?? dashboardChartToUpdate.position_x,
            position_y: position_y ?? dashboardChartToUpdate.position_y,
            width: width ?? dashboardChartToUpdate.width,
            height: height ?? dashboardChartToUpdate.height,
          });

          return {
            success: true,
            action: "update_chart_position",
            message: "Chart position updated",
            position: {
              x: position_x ?? dashboardChartToUpdate.position_x,
              y: position_y ?? dashboardChartToUpdate.position_y,
              width: width ?? dashboardChartToUpdate.width,
              height: height ?? dashboardChartToUpdate.height,
            },
          };
        }

        case "get_data": {
          if (!dashboardId) {
            return { success: false, error: "dashboardId is required for get_data action" };
          }

          const dashboard = await findDashboard(dashboardId);
          if (!dashboard) {
            return { success: false, error: "Dashboard not found", dashboardId };
          }

          const dashboardCharts = await prisma.dashboardChart.findMany({
            where: { dashboard_id: dashboard.id },
            include: {
              chart: {
                include: {
                  connection: true,
                  savedQuery: { select: { sql_query: true } }
                }
              }
            }
          });

          const chartDataPromises = dashboardCharts.map(async (dc) => {
            try {
              const chart = dc.chart;
              if (!chart) {
                return {
                  chartId: null,
                  dashboardChartId: dc.id,
                  name: "Unknown",
                  error: "Chart not found",
                };
              }

              let sqlQuery = chart.sql_query;

              if (chart.query_id && !sqlQuery) {
                sqlQuery = dc.chart?.savedQuery?.sql_query || null;
              }

              if (!sqlQuery) {
                return {
                  chartId: chart.id,
                  dashboardChartId: dc.id,
                  name: chart.name,
                  error: "No query defined",
                };
              }

              const connection = chart.connection;
              if (!connection) {
                return {
                  chartId: chart.id,
                  dashboardChartId: dc.id,
                  name: chart.name,
                  error: "Connection not found",
                };
              }

              const result = await executeQuery(connection, sqlQuery);

              return {
                chartId: chart.id,
                dashboardChartId: dc.id,
                name: chart.name,
                chartType: chart.chart_type,
                data: result.rows,
                fields: result.fields,
                rowCount: result.rowCount,
                config: chart.config ? JSON.parse(chart.config) : {},
              };
            } catch (error) {
              return {
                chartId: dc.chart?.id,
                dashboardChartId: dc.id,
                name: dc.chart?.name || "Unknown",
                error: error.message,
              };
            }
          });

          const chartData = await Promise.all(chartDataPromises);

          return {
            success: true,
            action: "get_data",
            dashboardId: dashboard.id,
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
