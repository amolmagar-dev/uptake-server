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

// Management Tools (refactored to use Prisma)
import connectionManagement from "./connectionManagement.js";
import datasetManagement from "./datasetManagement.js";
import chartManagement from "./chartManagement.js";
import dashboardManagement from "./dashboardManagement.js";
import queryManagement from "./queryManagement.js";
import customComponentManagement from "./customComponentManagement.js";

// Utility Tools
import projectHelper from "./projectHelper.js";

/**
 * Get all available tools for the AI chatbot
 * These tools provide full project capabilities:
 * 
 * - database_operations: Execute SQL queries on any connection
 * - schema_explorer: Explore database structure (tables, columns, relationships)
 * - connection_management: CRUD operations for database connections
 * - dataset_management: CRUD operations for datasets (data sources for charts)
 * - chart_management: CRUD operations for charts and visualizations
 * - dashboard_management: CRUD operations for dashboards
 * - query_management: CRUD operations for saved SQL queries
 * - custom_component_management: CRUD operations for custom HTML/CSS/JS components
 * - project_helper: Project overview, search, and help
 * - list_tables: Quick table listing
 * - list_connections: Quick connection listing
 */
export const getAllTools = () => [
  // Primary tools - most commonly used
  databaseOperations,
  schemaExplorer,
  
  // Management tools
  connectionManagement,
  datasetManagement,
  chartManagement,
  dashboardManagement,
  queryManagement,
  customComponentManagement,
  
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
  connections: [listConnections, connectionManagement],
  datasets: [datasetManagement],
  visualization: [chartManagement, customComponentManagement],
  dashboards: [dashboardManagement],
  queries: [queryManagement],
  utility: [projectHelper],
});
