/**
 * Project Helper Tool
 * Provides project overview, search, and help functionality
 * Refactored to use LangChain.js
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "../../../db/client.js";

const projectHelperSchema = z.object({
  action: z
    .enum(["overview", "search", "help"])
    .describe("The action to perform"),
  searchTerm: z
    .string()
    .optional()
    .describe("Search term for finding charts, dashboards, connections, or queries (for search action)"),
});

type ProjectHelperInput = z.infer<typeof projectHelperSchema>;

async function executeProjectHelper({ action, searchTerm }: ProjectHelperInput): Promise<string> {
  try {
    switch (action) {
      case "overview": {
        const [connectionsCount, chartsCount, dashboardsCount, queriesCount, datasetsCount, componentsCount] = await Promise.all([
          prisma.connection.count(),
          prisma.chart.count(),
          prisma.dashboard.count(),
          prisma.savedQuery.count(),
          prisma.dataset.count(),
          prisma.customComponent.count(),
        ]);

        return JSON.stringify({
          success: true,
          action: "overview",
          counts: {
            connections: connectionsCount,
            charts: chartsCount,
            dashboards: dashboardsCount,
            savedQueries: queriesCount,
            datasets: datasetsCount,
            customComponents: componentsCount,
          },
          summary: `Project has ${connectionsCount} connection(s), ${chartsCount} chart(s), ${dashboardsCount} dashboard(s), ${queriesCount} saved quer${queriesCount === 1 ? 'y' : 'ies'}, ${datasetsCount} dataset(s), and ${componentsCount} custom component(s).`,
        });
      }

      case "search": {
        if (!searchTerm) {
          return JSON.stringify({
            success: false,
            error: "searchTerm is required for search action",
          });
        }

        const [connections, charts, dashboards, queries] = await Promise.all([
          prisma.connection.findMany({
            where: {
              OR: [
                { name: { contains: searchTerm, mode: 'insensitive' } },
                { type: { contains: searchTerm, mode: 'insensitive' } },
              ]
            },
            select: { id: true, name: true, type: true }
          }),
          prisma.chart.findMany({
            where: {
              OR: [
                { name: { contains: searchTerm, mode: 'insensitive' } },
                { chart_type: { contains: searchTerm, mode: 'insensitive' } },
              ]
            },
            select: { id: true, name: true, chart_type: true }
          }),
          prisma.dashboard.findMany({
            where: { name: { contains: searchTerm, mode: 'insensitive' } },
            select: { id: true, name: true }
          }),
          prisma.savedQuery.findMany({
            where: { name: { contains: searchTerm, mode: 'insensitive' } },
            select: { id: true, name: true }
          }),
        ]);

        const results = {
          connections: connections.map((c: any) => ({ id: c.id, name: c.name, type: c.type })),
          charts: charts.map((c: any) => ({ id: c.id, name: c.name, type: c.chart_type })),
          dashboards: dashboards.map((d: any) => ({ id: d.id, name: d.name })),
          savedQueries: queries.map((q: any) => ({ id: q.id, name: q.name })),
        };

        const totalMatches =
          results.connections.length +
          results.charts.length +
          results.dashboards.length +
          results.savedQueries.length;

        return JSON.stringify({
          success: true,
          action: "search",
          searchTerm,
          totalMatches,
          results,
        });
      }

      case "help": {
        return JSON.stringify({
          success: true,
          action: "help",
          availableTools: {
            database: [
              "database_operations - Execute SQL queries",
              "schema_explorer - Explore database structure",
              "list_tables - Quick table listing"
            ],
            connections: [
              "connection_management - Full CRUD for connections",
              "list_connections - Quick connection listing"
            ],
            visualization: [
              "chart_management - Create and manage charts"
            ],
            dashboards: [
              "dashboard_management - Create and manage dashboards"
            ],
            queries: [
              "query_management - Save and manage SQL queries"
            ],
            datasets: [
              "dataset_management - Manage datasets for charts"
            ],
            components: [
              "custom_component_management - Create custom React components"
            ],
            utility: [
              "project_helper - This tool - project overview and search"
            ]
          },
          commonTasks: [
            "To create a chart: Use chart_management with action='create'",
            "To view connections: Use list_connections or connection_management",
            "To execute a query: Use database_operations",
            "To create a dashboard: Use dashboard_management with action='create'",
            "To search the project: Use project_helper with action='search'",
          ],
        });
      }

      default:
        return JSON.stringify({
          success: false,
          error: `Unknown action: ${action}`,
        });
    }
  } catch (error: any) {
    console.error("Project helper error:", error);
    return JSON.stringify({
      success: false,
      error: error.message || "Project helper failed",
      action,
    });
  }
}

const projectHelper = tool(executeProjectHelper, {
  name: "project_helper",
  description: `Get project overview, search for specific items, or get help with available capabilities.
  
This tool helps you understand the current state of the project:
- Get counts of connections, charts, dashboards, and queries
- Search for items by name or type
- Get information about available tools and features`,
  schema: projectHelperSchema,
});

export default projectHelper;
