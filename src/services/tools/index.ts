/**
 * AI Tools Registry
 * Central registry for all AI tools using LangChain.js
 */

import { StructuredToolInterface } from "@langchain/core/tools";

// Import all LangChain tools
import connectionManagement from "./connections/connectionManagement.js";
import listConnections from "./connections/listConnections.js";

import chartManagement from "./charts/chartManagement.js";

import databaseOperations from "./database/databaseOperations.js";
import listTables from "./database/listTables.js";
import schemaExplorer from "./database/schemaExplorer.js";
import queryManagement from "./database/queryManagement.js";

import dashboardManagement from "./dashboard/dashboardManagement.js";

import datasetManagement from "./dataset/datasetManagement.js";

import customComponentManagement from "./components/customComponentManagement.js";

import projectHelper from "./shared/projectHelper.js";

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
