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

// Management Tools
import connectionManagement from "./connectionManagement.js";
import chartManagement from "./chartManagement.js";
import dashboardManagement from "./dashboardManagement.js";
import queryManagement from "./queryManagement.js";

// Utility Tools
import projectHelper from "./projectHelper.js";

/**
 * Get all available tools for the AI chatbot
 * These tools provide full project capabilities:
 * 
 * - database_operations: Execute SQL queries on any connection
 * - connection_management: CRUD for database connections
 * - chart_management: CRUD for charts/visualizations
 * - dashboard_management: CRUD for dashboards + chart assignments
 * - query_management: CRUD for saved SQL queries
 * - schema_explorer: Explore database structure (tables, columns, relationships)
 * - project_helper: Project overview, search, and help
 * - list_tables: Quick table listing (legacy, use schema_explorer for more features)
 * - list_connections: Quick connection listing (legacy, use connection_management for more features)
 */
export const getAllTools = () => [
  // Primary tools - most commonly used
  databaseOperations,
  schemaExplorer,
  chartManagement,
  dashboardManagement,
  
  // Management tools
  connectionManagement,
  queryManagement,
  
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
  connections: [connectionManagement, listConnections],
  visualization: [chartManagement],
  dashboards: [dashboardManagement],
  queries: [queryManagement],
  utility: [projectHelper],
});
