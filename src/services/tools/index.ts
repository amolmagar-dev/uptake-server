// @ts-nocheck
/**
 * Tool Registry for AI Adapter
 * Centralized place to manage all available tools
 * These tools execute actual actions, not just provide guidance
 */

// Database & Schema Tools
import listTables from "./listTables.js";
import listConnections from "./listConnections.js";
import databaseOperations from "./databaseOperations.js";
import schemaExplorer from "./schemaExplorer.js";

// TODO: The following tools need refactoring to use Prisma repositories
// They are temporarily disabled until refactoring is complete
// import connectionManagement from "./connectionManagement.js";
// import chartManagement from "./chartManagement.js";
// import dashboardManagement from "./dashboardManagement.js";
// import queryManagement from "./queryManagement.js";

// Utility Tools
import projectHelper from "./projectHelper.js";

/**
 * Get all available tools for the AI chatbot
 * These tools provide full project capabilities:
 * 
 * - database_operations: Execute SQL queries on any connection
 * - schema_explorer: Explore database structure (tables, columns, relationships)
 * - project_helper: Project overview, search, and help
 * - list_tables: Quick table listing
 * - list_connections: Quick connection listing
 * 
 * NOTE: Management tools (connection_management, chart_management, dashboard_management, 
 * query_management) are temporarily disabled pending Prisma migration refactoring.
 */
export const getAllTools = () => [
  // Primary tools - most commonly used
  databaseOperations,
  schemaExplorer,
  
  // Utility
  projectHelper,
  
  // Legacy tools (kept for backward compatibility)
  listTables,
  listConnections,
];

/**
 * Get tool by name
 */
export const getToolByName = (name) => {
  const tools = getAllTools();
  return tools.find(tool => tool.name === name);
};

/**
 * Get tools grouped by category
 */
export const getToolsByCategory = () => ({
  database: [databaseOperations, schemaExplorer, listTables],
  connections: [listConnections],
  utility: [projectHelper],
  // Temporarily removed: visualization: [chartManagement],
  // Temporarily removed: dashboards: [dashboardManagement],
  // Temporarily removed: queries: [queryManagement],
});
