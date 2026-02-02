/**
 * Dashboard Management Tool
 * Full CRUD operations for dashboards including chart assignments
 * Refactored to use LangChain.js
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "../../../db/client.js";
import { dashboardRepository } from "../../../db/repositories/index.js";
import { executeQuery } from "../../databaseConnector.js";
import { findDashboard, findChart } from "../shared/utils.js";

const dashboardDataSchema = z.object({
  name: z.string().optional().describe("Dashboard name"),
  description: z.string().optional().describe("Dashboard description"),
  is_public: z.boolean().optional().describe("Make dashboard publicly accessible"),
  layout: z.array(z.any()).optional().describe("Dashboard layout configuration"),
  position_x: z.number().optional().describe("Chart X position (0-11, grid columns)"),
  position_y: z.number().optional().describe("Chart Y position (row number)"),
  width: z.number().optional().describe("Chart width (1-12 grid columns, default 6)"),
  height: z.number().optional().describe("Chart height (grid rows, default 4)"),
});

const dashboardManagementSchema = z.object({
  action: z
    .enum(["list", "get", "create", "update", "delete", "add_chart", "remove_chart", "update_chart_position", "get_data"])
    .describe("The action to perform"),
  dashboardId: z.string().optional().describe("Dashboard ID (required for most actions)"),
  chartId: z.string().optional().describe("Chart ID (for add_chart, remove_chart, update_chart_position)"),
  dashboardChartId: z.string().optional().describe("Dashboard-Chart relation ID (for update_chart_position, remove_chart)"),
  data: dashboardDataSchema.optional().describe("Dashboard or chart position data"),
});

type DashboardManagementInput = z.infer<typeof dashboardManagementSchema>;

async function executeDashboardManagement({ action, dashboardId, chartId, dashboardChartId, data }: DashboardManagementInput): Promise<string> {
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

        return JSON.stringify({
          success: true,
          action: "list",
          totalDashboards: dashboards.length,
          dashboards: dashboards.map((d: any) => ({
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
            public: dashboards.filter((d: any) => d.is_public === 1).length,
            private: dashboards.filter((d: any) => d.is_public === 0).length,
          },
        });
      }

      case "get": {
        if (!dashboardId) {
          return JSON.stringify({ success: false, error: "dashboardId is required for get action" });
        }

        const dashboardBase = await findDashboard(dashboardId);
        if (!dashboardBase) {
          return JSON.stringify({ success: false, error: "Dashboard not found", dashboardId });
        }

        const dashboard = await prisma.dashboard.findUnique({
          where: { id: dashboardBase.id },
          include: {
            creator: { select: { name: true } },
            dashboardCharts: {
              include: {
                chart: true
              }
            }
          }
        });

        if (!dashboard) {
          return JSON.stringify({ success: false, error: "Dashboard not found", dashboardId });
        }

        return JSON.stringify({
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
            charts: dashboard.dashboardCharts.map((dc: any) => ({
              dashboardChartId: dc.id,
              chartId: dc.chart?.id,
              name: dc.chart?.name,
              chartType: dc.chart?.chart_type,
              config: dc.chart?.config ? JSON.parse(dc.chart.config) : {},
              position: {
                x: dc.position_x,
                y: dc.position_y,
                width: dc.width,
                height: dc.height,
              },
            })),
          },
        });
      }

      case "create": {
        if (!data) {
          return JSON.stringify({ success: false, error: "data is required for create action" });
        }

        const { name, description, is_public, layout } = data;

        if (!name) {
          return JSON.stringify({ success: false, error: "name is required" });
        }

        const newDashboard = await dashboardRepository.create({
          name,
          description: description || undefined,
          layout: JSON.stringify(layout || []),
          is_public: is_public ? 1 : 0,
        });

        return JSON.stringify({
          success: true,
          action: "create",
          message: "Dashboard created successfully",
          dashboard: {
            id: newDashboard.id,
            name: newDashboard.name,
            description: newDashboard.description,
            isPublic: newDashboard.is_public === 1,
          },
        });
      }

      case "update": {
        if (!dashboardId) {
          return JSON.stringify({ success: false, error: "dashboardId is required for update action" });
        }
        if (!data) {
          return JSON.stringify({ success: false, error: "data is required for update action" });
        }

        const existing = await findDashboard(dashboardId);
        if (!existing) {
          return JSON.stringify({ success: false, error: "Dashboard not found", dashboardId });
        }

        const { name, description, is_public, layout } = data;

        await dashboardRepository.update(existing.id, {
          name: name || undefined,
          description: description !== undefined ? description : undefined,
          layout: layout ? JSON.stringify(layout) : undefined,
          is_public: is_public !== undefined ? (is_public ? 1 : 0) : undefined,
        });

        return JSON.stringify({
          success: true,
          action: "update",
          message: "Dashboard updated successfully",
          dashboardId: existing.id,
        });
      }

      case "delete": {
        if (!dashboardId) {
          return JSON.stringify({ success: false, error: "dashboardId is required for delete action" });
        }

        const existing = await findDashboard(dashboardId);
        if (!existing) {
          return JSON.stringify({ success: false, error: "Dashboard not found", dashboardId });
        }

        await dashboardRepository.delete(existing.id);

        return JSON.stringify({
          success: true,
          action: "delete",
          message: `Dashboard "${existing.name}" deleted successfully`,
          dashboardId: existing.id,
        });
      }

      case "add_chart": {
        if (!dashboardId) {
          return JSON.stringify({ success: false, error: "dashboardId is required for add_chart action" });
        }
        if (!chartId) {
          return JSON.stringify({ success: false, error: "chartId is required for add_chart action" });
        }

        const dashboard = await findDashboard(dashboardId);
        if (!dashboard) {
          return JSON.stringify({ success: false, error: "Dashboard not found", dashboardId });
        }

        const chart = await findChart(chartId);
        if (!chart) {
          return JSON.stringify({ success: false, error: "Chart not found", chartId });
        }

        const existingDC = await prisma.dashboardChart.findFirst({
          where: { dashboard_id: dashboard.id, chart_id: chart.id }
        });
        if (existingDC) {
          return JSON.stringify({
            success: false,
            error: "Chart is already on this dashboard",
            dashboardChartId: existingDC.id,
          });
        }

        const { position_x = 0, position_y = 0, width = 6, height = 4 } = data || {};

        const newDashboardChart = await dashboardRepository.addChart({
          dashboard_id: dashboard.id,
          chart_id: chart.id,
          position_x,
          position_y,
          width,
          height,
        });

        return JSON.stringify({
          success: true,
          action: "add_chart",
          message: `Chart "${chart.name}" added to dashboard "${dashboard.name}"`,
          dashboardChartId: newDashboardChart.id,
          position: { x: position_x, y: position_y, width, height },
        });
      }

      case "remove_chart": {
        if (!dashboardId) {
          return JSON.stringify({ success: false, error: "dashboardId is required for remove_chart action" });
        }

        const dashboard = await findDashboard(dashboardId);
        if (!dashboard) {
          return JSON.stringify({ success: false, error: "Dashboard not found", dashboardId });
        }

        let dashboardChartToRemove;

        if (dashboardChartId) {
          dashboardChartToRemove = await prisma.dashboardChart.findFirst({
            where: { id: dashboardChartId, dashboard_id: dashboard.id }
          });
        } else if (chartId) {
          const chart = await findChart(chartId);
          if (!chart) {
            return JSON.stringify({ success: false, error: "Chart not found", chartId });
          }
          dashboardChartToRemove = await prisma.dashboardChart.findFirst({
            where: { dashboard_id: dashboard.id, chart_id: chart.id }
          });
        } else {
          return JSON.stringify({ success: false, error: "Either dashboardChartId or chartId is required" });
        }

        if (!dashboardChartToRemove) {
          return JSON.stringify({ success: false, error: "Chart not found on this dashboard" });
        }

        await dashboardRepository.removeChart(dashboardChartToRemove.id);

        return JSON.stringify({
          success: true,
          action: "remove_chart",
          message: "Chart removed from dashboard",
          dashboardId: dashboard.id,
        });
      }

      case "update_chart_position": {
        if (!dashboardId) {
          return JSON.stringify({ success: false, error: "dashboardId is required for update_chart_position action" });
        }
        if (!data) {
          return JSON.stringify({ success: false, error: "data with position values is required" });
        }

        const dashboard = await findDashboard(dashboardId);
        if (!dashboard) {
          return JSON.stringify({ success: false, error: "Dashboard not found", dashboardId });
        }

        let dashboardChartToUpdate;

        if (dashboardChartId) {
          dashboardChartToUpdate = await prisma.dashboardChart.findFirst({
            where: { id: dashboardChartId, dashboard_id: dashboard.id }
          });
        } else if (chartId) {
          const chart = await findChart(chartId);
          if (!chart) {
            return JSON.stringify({ success: false, error: "Chart not found", chartId });
          }
          dashboardChartToUpdate = await prisma.dashboardChart.findFirst({
            where: { dashboard_id: dashboard.id, chart_id: chart.id }
          });
        } else {
          return JSON.stringify({ success: false, error: "Either dashboardChartId or chartId is required" });
        }

        if (!dashboardChartToUpdate) {
          return JSON.stringify({ success: false, error: "Chart not found on this dashboard" });
        }

        const { position_x, position_y, width, height } = data;

        await dashboardRepository.updateDashboardChart(dashboardChartToUpdate.id, {
          position_x: position_x ?? dashboardChartToUpdate.position_x,
          position_y: position_y ?? dashboardChartToUpdate.position_y,
          width: width ?? dashboardChartToUpdate.width,
          height: height ?? dashboardChartToUpdate.height,
        });

        return JSON.stringify({
          success: true,
          action: "update_chart_position",
          message: "Chart position updated",
          position: {
            x: position_x ?? dashboardChartToUpdate.position_x,
            y: position_y ?? dashboardChartToUpdate.position_y,
            width: width ?? dashboardChartToUpdate.width,
            height: height ?? dashboardChartToUpdate.height,
          },
        });
      }

      case "get_data": {
        if (!dashboardId) {
          return JSON.stringify({ success: false, error: "dashboardId is required for get_data action" });
        }

        const dashboard = await findDashboard(dashboardId);
        if (!dashboard) {
          return JSON.stringify({ success: false, error: "Dashboard not found", dashboardId });
        }

        const dashboardCharts = await prisma.dashboardChart.findMany({
          where: { dashboard_id: dashboard.id },
          include: {
            chart: {
              include: {
                dataset: { include: { connection: true } }
              }
            }
          }
        });

        const chartDataPromises = dashboardCharts.map(async (dc: any) => {
          try {
            const chart = dc.chart;
            if (!chart) {
              return { chartId: null, dashboardChartId: dc.id, name: "Unknown", error: "Chart not found" };
            }

            if (!chart.dataset?.connection) {
              return { chartId: chart.id, dashboardChartId: dc.id, name: chart.name, error: "No data source" };
            }

            const dataset = chart.dataset;
            const connection = dataset.connection;

            let sqlQuery;
            if (dataset.dataset_type === "physical") {
              const schemaPrefix = dataset.table_schema ? `"${dataset.table_schema}".` : '';
              sqlQuery = `SELECT * FROM ${schemaPrefix}"${dataset.table_name}" LIMIT 1000`;
            } else {
              sqlQuery = dataset.sql_query;
            }

            if (!sqlQuery) {
              return { chartId: chart.id, dashboardChartId: dc.id, name: chart.name, error: "No query defined" };
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
          } catch (error: any) {
            return {
              chartId: dc.chart?.id,
              dashboardChartId: dc.id,
              name: dc.chart?.name || "Unknown",
              error: error.message,
            };
          }
        });

        const chartData = await Promise.all(chartDataPromises);

        return JSON.stringify({
          success: true,
          action: "get_data",
          dashboardId: dashboard.id,
          dashboardName: dashboard.name,
          chartCount: chartData.length,
          successfulCharts: chartData.filter((c: any) => !c.error).length,
          chartData,
        });
      }

      default:
        return JSON.stringify({ success: false, error: `Unknown action: ${action}` });
    }
  } catch (error: any) {
    console.error("Dashboard management error:", error);
    return JSON.stringify({
      success: false,
      error: error.message || "Dashboard management failed",
      action,
    });
  }
}

const dashboardManagement = tool(executeDashboardManagement, {
  name: "dashboard_management",
  description: `Manage dashboards - containers for organizing multiple charts.

WHEN TO USE:
- "Create dashboard", "make a dashboard" → action=create
- "List dashboards", "show dashboards" → action=list
- "Add chart to dashboard" → action=add_chart
- "Show dashboard data" → action=get_data

IMPORTANT: Dashboards contain Charts. Create charts with chart_management first.

ACTIONS:
- list: List all dashboards
- get: Get dashboard with charts (requires dashboardId)
- create: New dashboard (requires data.name)
- update: Modify dashboard (requires dashboardId + data)
- delete: Remove dashboard (requires dashboardId)
- add_chart: Add chart to dashboard (requires dashboardId + chartId + position)
- remove_chart: Remove chart (requires dashboardId + chartId)
- update_chart_position: Move/resize chart (requires dashboardId + chartId + position)
- get_data: Fetch all chart data for display (requires dashboardId)

POSITION FORMAT: { x: 0-11, y: row, w: width, h: height }
Grid is 12 columns. Default: { x: 0, y: 0, w: 6, h: 4 }`,
  schema: dashboardManagementSchema,
});

export default dashboardManagement;
