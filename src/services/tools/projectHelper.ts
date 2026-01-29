// @ts-nocheck
/**
 * Project Helper Tool
 * Provides project overview, search, and help functionality
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { prisma } from "../../db/client.js";

const projectHelperDef = toolDefinition({
  name: "project_helper",
  description: `Get project overview, search for specific items, or get help with available capabilities.
  
This tool helps you understand the current state of the project:
- Get counts of connections, charts, dashboards, and queries
- Search for items by name or type
- Get information about available tools and features`,
  inputSchema: z.object({
    action: z
      .enum(["overview", "search", "help"])
      .describe("The action to perform"),
    searchTerm: z
      .string()
      .optional()
      .describe("Search term for finding charts, dashboards, connections, or queries (for search action)"),
  }),
});

const projectHelper = projectHelperDef.server(async ({ action, searchTerm }) => {
  try {
    switch (action) {
      case "overview": {
        // Get counts of all major entities
        const [connectionsCount, chartsCount, dashboardsCount, queriesCount, datasetsCount, componentsCount] = await Promise.all([
          prisma.connection.count(),
          prisma.chart.count(),
          prisma.dashboard.count(),
          prisma.savedQuery.count(),
          prisma.dataset.count(),
          prisma.customComponent.count(),
        ]);

        return {
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
        };
      }

      case "search": {
        if (!searchTerm) {
          return {
            success: false,
            error: "searchTerm is required for search action",
          };
        }

        // Search across all entity types
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
          connections: connections.map(c => ({ id: c.id, name: c.name, type: c.type })),
          charts: charts.map(c => ({ id: c.id, name: c.name, type: c.chart_type })),
          dashboards: dashboards.map(d => ({ id: d.id, name: d.name })),
          savedQueries: queries.map(q => ({ id: q.id, name: q.name })),
        };

        const totalMatches =
          results.connections.length +
          results.charts.length +
          results.dashboards.length +
          results.savedQueries.length;

        return {
          success: true,
          action: "search",
          searchTerm,
          totalMatches,
          results,
        };
      }

      case "help": {
        return {
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
        };
      }

      default:
        return {
          success: false,
          error: `Unknown action: ${action}`,
        };
    }
  } catch (error) {
    console.error("Project helper error:", error);
    return {
      success: false,
      error: error.message || "Project helper failed",
      action,
    };
  }
});

export default projectHelper;
