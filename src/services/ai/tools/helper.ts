import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  connectionRepository,
  datasetRepository,
  chartRepository,
  dashboardRepository,
} from "../../../db/repositories/index.js";
import { toolOk as ok, toolFail as fail } from "./shared.js";
import type { UserProfile } from "../../../types/database.js";

const helperSchema = z.object({
  action: z.enum(["overview", "search"]).describe("overview: summarize everything; search: find items by name"),
  query: z.string().optional().describe("Search term, required when action is 'search'"),
});

export function createProjectHelperTool(_user: UserProfile) {
  return tool(
    async ({ action, query }: z.infer<typeof helperSchema>) => {
      const [connections, datasets, charts, dashboards] = await Promise.all([
        connectionRepository.findAll(),
        datasetRepository.findAll(),
        chartRepository.findAll(),
        dashboardRepository.findAll(),
      ]);

      if (action === "overview") {
        return ok({
          action,
          counts: { connections: connections.length, datasets: datasets.length, charts: charts.length, dashboards: dashboards.length },
          connections: connections.map((c) => ({ id: c.id, name: c.name, type: c.type })),
          datasets: datasets.map((d) => ({ id: d.id, name: d.name })),
          charts: charts.map((c) => ({ id: c.id, name: c.name, chartType: c.chart_type })),
          dashboards: dashboards.map((d) => ({ id: d.id, name: d.name })),
        });
      }

      if (!query) return fail("query is required for search");
      const needle = query.toLowerCase();
      const matches = (name: string) => name.toLowerCase().includes(needle);
      return ok({
        action,
        query,
        connections: connections.filter((c) => matches(c.name)).map((c) => ({ id: c.id, name: c.name, type: "connection" })),
        datasets: datasets.filter((d) => matches(d.name)).map((d) => ({ id: d.id, name: d.name, type: "dataset" })),
        charts: charts.filter((c) => matches(c.name)).map((c) => ({ id: c.id, name: c.name, type: "chart" })),
        dashboards: dashboards.filter((d) => matches(d.name)).map((d) => ({ id: d.id, name: d.name, type: "dashboard" })),
      });
    },
    {
      name: "project_helper",
      description:
        "Get oriented before acting. Actions: overview (counts + names of everything), search (find connections/datasets/charts/dashboards by name).",
      schema: helperSchema,
    }
  );
}
