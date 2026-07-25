import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { dashboardRepository } from "../../../db/repositories/index.js";
import { requireRole, toolOk as ok, toolFail as fail } from "./shared.js";
import type { UserProfile } from "../../../types/database.js";

const dashboardManagementSchema = z.object({
  action: z.enum(["list", "get", "create", "update", "delete", "add_chart", "remove_chart"]).describe("The action to perform"),
  dashboardId: z.string().optional().describe("Dashboard ID, required for get/update/delete/add_chart/remove_chart"),
  dashboardChartId: z.string().optional().describe("Dashboard-chart placement ID, required for remove_chart"),
  data: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      chartId: z.string().optional().describe("Chart to place on the dashboard (add_chart)"),
      componentId: z.string().optional().describe("Custom component to place on the dashboard (add_chart)"),
      positionX: z.number().int().optional(),
      positionY: z.number().int().optional(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
    })
    .optional(),
});

export function createDashboardManagementTool(user: UserProfile) {
  return tool(
    async (input: z.infer<typeof dashboardManagementSchema>) => {
      const { action, dashboardId, dashboardChartId, data } = input;
      try {
        switch (action) {
          case "list": {
            const dashboards = await dashboardRepository.findAll();
            return ok({ action, dashboards: dashboards.map((d) => ({ id: d.id, name: d.name })) });
          }
          case "get": {
            if (!dashboardId) return fail("dashboardId is required for get");
            const dashboard = await dashboardRepository.findByIdWithCharts(dashboardId);
            if (!dashboard) return fail(`Dashboard not found: ${dashboardId}`);
            return ok({ action, dashboard: { id: dashboard.id, name: dashboard.name, charts: dashboard.dashboardCharts } });
          }
          case "create": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!data?.name) return fail("name is required to create a dashboard");
            const dashboard = await dashboardRepository.create({
              name: data.name,
              description: data.description,
              layout: JSON.stringify([]),
              created_by: user.id,
            });
            return ok({ action, dashboard: { id: dashboard.id, name: dashboard.name } });
          }
          case "update": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!dashboardId) return fail("dashboardId is required for update");
            const existing = await dashboardRepository.findById(dashboardId);
            if (!existing) return fail(`Dashboard not found: ${dashboardId}`);
            const updated = await dashboardRepository.update(existing.id, { name: data?.name, description: data?.description });
            return ok({ action, dashboard: { id: updated.id, name: updated.name } });
          }
          case "delete": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!dashboardId) return fail("dashboardId is required for delete");
            const existing = await dashboardRepository.findById(dashboardId);
            if (!existing) return fail(`Dashboard not found: ${dashboardId}`);
            await dashboardRepository.delete(existing.id);
            return ok({ action, dashboardId: existing.id });
          }
          case "add_chart": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!dashboardId) return fail("dashboardId is required for add_chart");
            if (!data?.chartId && !data?.componentId) return fail("Either data.chartId or data.componentId is required for add_chart");
            const placement = await dashboardRepository.addChart({
              dashboard_id: dashboardId,
              chart_id: data.chartId,
              component_id: data.componentId,
              position_x: data.positionX ?? 0,
              position_y: data.positionY ?? 0,
              width: data.width ?? 6,
              height: data.height ?? 4,
            });
            return ok({ action, dashboardChart: placement });
          }
          case "remove_chart": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!dashboardChartId) return fail("dashboardChartId is required for remove_chart");
            await dashboardRepository.removeChart(dashboardChartId);
            return ok({ action, dashboardChartId });
          }
          default:
            return fail(`Unknown action: ${action}`);
        }
      } catch (err: any) {
        return fail(err.message || "An error occurred during dashboard management");
      }
    },
    {
      name: "dashboard_management",
      description:
        "Manage dashboards and their chart layout. Actions: list, get, create, update, delete, add_chart, remove_chart. " +
        "Requires admin or editor for anything except list/get.",
      schema: dashboardManagementSchema,
    }
  );
}
