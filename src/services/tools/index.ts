/**
 * AI Tools Registry
 * Central registry for all AI tools using LangChain.js
 */

import { StructuredToolInterface } from "@langchain/core/tools";

// Import all LangChain tools
import connectionManagement from "./connectionManagement.js";
import chartManagement from "./chartManagement.js";
import customComponentManagement from "./customComponentManagement.js";
import dashboardManagement from "./dashboardManagement.js";
import datasetManagement from "./datasetManagement.js";
import queryManagement from "./queryManagement.js";
import databaseOperations from "./databaseOperations.js";
import listTables from "./listTables.js";
import listConnections from "./listConnections.js";
import schemaExplorer from "./schemaExplorer.js";
import projectHelper from "./projectHelper.js";

// Export all tools
export {
  connectionManagement,
  chartManagement,
  customComponentManagement,
  dashboardManagement,
  datasetManagement,
  queryManagement,
  databaseOperations,
  listTables,
  listConnections,
  schemaExplorer,
  projectHelper,
};

/**
 * Get all available tools as an array for binding to LangChain model
 */
export function getAllTools(): StructuredToolInterface[] {
  return [
    connectionManagement,
    chartManagement,
    customComponentManagement,
    dashboardManagement,
    datasetManagement,
    queryManagement,
    databaseOperations,
    listTables,
    listConnections,
    schemaExplorer,
    projectHelper,
  ];
}

/**
 * Get tools by category
 */
export function getToolsByCategory(): Record<string, StructuredToolInterface[]> {
  return {
    connections: [connectionManagement, listConnections],
    database: [databaseOperations, listTables, schemaExplorer],
    charts: [chartManagement],
    dashboards: [dashboardManagement],
    queries: [queryManagement],
    datasets: [datasetManagement],
    components: [customComponentManagement],
    utility: [projectHelper],
  };
}

/**
 * Get a tool by name
 */
export function getToolByName(name: string): StructuredToolInterface | undefined {
  const allTools = getAllTools();
  return allTools.find(tool => tool.name === name);
}

/**
 * Get tool names for display
 */
export function getToolNames(): string[] {
  return getAllTools().map(tool => tool.name);
}
