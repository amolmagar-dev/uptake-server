/**
 * Tool Registry for AI Adapter
 * Centralized place to manage all available tools
 * 
 * NOTE: Tools are temporarily disabled during LangChain.js migration
 * They will be re-implemented step by step
 */

// Database & Schema Tools (disabled)
// import listTables from "./listTables.js";
// import listConnections from "./listConnections.js";
// import databaseOperations from "./databaseOperations.js";
// import schemaExplorer from "./schemaExplorer.js";

// Management Tools (disabled)
// import connectionManagement from "./connectionManagement.js";
// import datasetManagement from "./datasetManagement.js";
// import chartManagement from "./chartManagement.js";
// import dashboardManagement from "./dashboardManagement.js";
// import queryManagement from "./queryManagement.js";
// import customComponentManagement from "./customComponentManagement.js";

// Utility Tools (disabled)
// import projectHelper from "./projectHelper.js";

/**
 * Get all available tools for the AI chatbot
 * Currently returns empty array - tools will be added incrementally
 */
export const getAllTools = () => [];

/**
 * Get tool by name
 */
export const getToolByName = (name: string) => {
  const tools = getAllTools();
  return tools.find((tool: any) => tool.name === name);
};

/**
 * Get tools grouped by category
 */
export const getToolsByCategory = () => ({
  database: [],
  connections: [],
  datasets: [],
  visualization: [],
  dashboards: [],
  queries: [],
  utility: [],
});
