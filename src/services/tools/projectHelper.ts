// @ts-nocheck
/**
 * Project Helper Tool
 * General project utilities and information
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import db from "../../config/database.js";

const projectHelperDef = toolDefinition({
  name: "project_helper",
  description: `Get project-wide information and summaries. Supported actions:
- overview: Get complete project overview (connections, charts, dashboards counts)
- recent_activity: Get recently created/modified items
- search: Search across all project items (connections, charts, dashboards, queries) by name
- help: Get help on how to use the chatbot capabilities
Use this for general project inquiries, summaries, and when user needs guidance.`,
  inputSchema: z.object({
    action: z.enum(["overview", "recent_activity", "search", "help"]).describe("The action to perform"),
    searchQuery: z.string().optional().describe("Search query text (for search action)"),
    limit: z.number().optional().describe("Number of recent items to return (default: 5)"),
  }),
});

const projectHelper = projectHelperDef.server(async ({ action, searchQuery, limit = 5 }) => {
  try {
    switch (action) {
      case "overview": {
        const connectionCount = db.prepare("SELECT COUNT(*) as count FROM connections").get().count;
        const chartCount = db.prepare("SELECT COUNT(*) as count FROM charts").get().count;
        const dashboardCount = db.prepare("SELECT COUNT(*) as count FROM dashboards").get().count;
        const queryCount = db.prepare("SELECT COUNT(*) as count FROM saved_queries").get().count;
        const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;

        // Get connection types breakdown
        const connectionTypes = db
          .prepare(
            "SELECT type, COUNT(*) as count FROM connections GROUP BY type"
          )
          .all();

        // Get chart types breakdown
        const chartTypes = db
          .prepare(
            "SELECT chart_type, COUNT(*) as count FROM charts GROUP BY chart_type"
          )
          .all();

        // Get public vs private dashboards
        const publicDashboards = db
          .prepare("SELECT COUNT(*) as count FROM dashboards WHERE is_public = 1")
          .get().count;

        return {
          success: true,
          action: "overview",
          summary: {
            totalConnections: connectionCount,
            totalCharts: chartCount,
            totalDashboards: dashboardCount,
            totalSavedQueries: queryCount,
            totalUsers: userCount,
          },
          connectionsByType: connectionTypes.reduce((acc, c) => {
            acc[c.type] = c.count;
            return acc;
          }, {}),
          chartsByType: chartTypes.reduce((acc, c) => {
            acc[c.chart_type] = c.count;
            return acc;
          }, {}),
          dashboardVisibility: {
            public: publicDashboards,
            private: dashboardCount - publicDashboards,
          },
          capabilities: [
            "Execute SQL queries on connected databases",
            "Create and manage database connections",
            "Build charts and visualizations",
            "Create dashboards with multiple charts",
            "Save and reuse SQL queries",
            "Explore database schemas",
          ],
        };
      }

      case "recent_activity": {
        const safeLimit = Math.min(Math.max(1, limit), 20);

        const recentCharts = db
          .prepare(
            `SELECT id, name, chart_type, updated_at, 'chart' as item_type 
             FROM charts ORDER BY updated_at DESC LIMIT ?`
          )
          .all(safeLimit);

        const recentDashboards = db
          .prepare(
            `SELECT id, name, updated_at, 'dashboard' as item_type 
             FROM dashboards ORDER BY updated_at DESC LIMIT ?`
          )
          .all(safeLimit);

        const recentQueries = db
          .prepare(
            `SELECT id, name, updated_at, 'query' as item_type 
             FROM saved_queries ORDER BY updated_at DESC LIMIT ?`
          )
          .all(safeLimit);

        const recentConnections = db
          .prepare(
            `SELECT id, name, type, updated_at, 'connection' as item_type 
             FROM connections ORDER BY updated_at DESC LIMIT ?`
          )
          .all(safeLimit);

        // Combine and sort by updated_at
        const allRecent = [
          ...recentCharts,
          ...recentDashboards,
          ...recentQueries,
          ...recentConnections,
        ]
          .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
          .slice(0, safeLimit);

        return {
          success: true,
          action: "recent_activity",
          recentItems: allRecent.map((item) => ({
            id: item.id,
            name: item.name,
            type: item.item_type,
            subType: item.chart_type || item.type || null,
            updatedAt: item.updated_at,
          })),
          breakdown: {
            charts: recentCharts.length,
            dashboards: recentDashboards.length,
            queries: recentQueries.length,
            connections: recentConnections.length,
          },
        };
      }

      case "search": {
        if (!searchQuery) {
          return { success: false, error: "searchQuery is required for search action" };
        }

        const pattern = `%${searchQuery}%`;

        const matchingConnections = db
          .prepare(
            `SELECT id, name, type, 'connection' as item_type 
             FROM connections WHERE name LIKE ? LIMIT 10`
          )
          .all(pattern);

        const matchingCharts = db
          .prepare(
            `SELECT id, name, chart_type, 'chart' as item_type 
             FROM charts WHERE name LIKE ? OR description LIKE ? LIMIT 10`
          )
          .all(pattern, pattern);

        const matchingDashboards = db
          .prepare(
            `SELECT id, name, 'dashboard' as item_type 
             FROM dashboards WHERE name LIKE ? OR description LIKE ? LIMIT 10`
          )
          .all(pattern, pattern);

        const matchingQueries = db
          .prepare(
            `SELECT id, name, 'query' as item_type 
             FROM saved_queries WHERE name LIKE ? OR description LIKE ? LIMIT 10`
          )
          .all(pattern, pattern);

        const allResults = [
          ...matchingConnections,
          ...matchingCharts,
          ...matchingDashboards,
          ...matchingQueries,
        ];

        return {
          success: true,
          action: "search",
          searchQuery,
          totalMatches: allResults.length,
          results: allResults.map((item) => ({
            id: item.id,
            name: item.name,
            type: item.item_type,
            subType: item.chart_type || item.type || null,
          })),
          breakdown: {
            connections: matchingConnections.length,
            charts: matchingCharts.length,
            dashboards: matchingDashboards.length,
            queries: matchingQueries.length,
          },
        };
      }

      case "help": {
        return {
          success: true,
          action: "help",
          capabilities: {
            database_operations: {
              description: "Execute SQL queries on database connections",
              examples: [
                "Run this query on my postgres connection: SELECT * FROM users",
                "Show me sales data from the products table",
              ],
            },
            connection_management: {
              description: "Create, update, delete database connections",
              examples: [
                "Add a new PostgreSQL connection",
                "List all my database connections",
                "Test if my MySQL connection is working",
              ],
            },
            chart_management: {
              description: "Create and manage data visualizations",
              examples: [
                "Create a bar chart showing sales by month",
                "List all my charts",
                "Update the chart to use a line graph instead",
              ],
            },
            dashboard_management: {
              description: "Create dashboards and organize charts",
              examples: [
                "Create a new sales dashboard",
                "Add the revenue chart to my main dashboard",
                "Make the dashboard public",
              ],
            },
            query_management: {
              description: "Save and reuse SQL queries",
              examples: [
                "Save this query for later use",
                "Show me my saved queries",
                "Execute my monthly report query",
              ],
            },
            schema_explorer: {
              description: "Explore database tables and structures",
              examples: [
                "What tables are in my database?",
                "Show me the columns in the users table",
                "Get sample data from the orders table",
              ],
            },
          },
          tips: [
            "I can help you create charts automatically from natural language descriptions",
            "Ask me to explore your database structure before writing queries",
            "I can execute SQL and show you the results immediately",
            "Tell me what kind of visualization you want and I'll create the chart",
          ],
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
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

