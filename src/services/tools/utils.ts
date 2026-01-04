// @ts-nocheck
/**
 * Shared utilities for AI tools
 */

import { prisma } from "../../db/client.js";

/**
 * Find a connection by ID or name
 * Tries ID first, then falls back to name matching
 * @param {string} connectionIdOrName - Connection ID or name
 * @returns {object|null} - Connection object or null if not found
 */
export async function findConnection(connectionIdOrName) {
  if (!connectionIdOrName) return null;

  // Try by ID first
  let connection = await prisma.connection.findUnique({
    where: { id: connectionIdOrName }
  });

  // If not found by ID, try by name (SQLite doesn't support case-insensitive mode)
  if (!connection) {
    const connections = await prisma.connection.findMany({
      where: {
        name: connectionIdOrName
      },
      take: 1
    });
    connection = connections[0] || null;
  }

  return connection;
}

/**
 * Get list of available connections for error messages
 * @returns {Array} - Array of connection summaries
 */
export async function getAvailableConnectionsList() {
  const connections = await prisma.connection.findMany({
    select: { id: true, name: true, type: true }
  });
  return connections.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    hint: `Use "${c.name}" or "${c.id}"`,
  }));
}

/**
 * Find a chart by ID or name
 * @param {string} chartIdOrName - Chart ID or name
 * @returns {object|null} - Chart object or null if not found
 */
export async function findChart(chartIdOrName) {
  if (!chartIdOrName) return null;

  let chart = await prisma.chart.findUnique({
    where: { id: chartIdOrName }
  });

  if (!chart) {
    const charts = await prisma.chart.findMany({
      where: {
        name: chartIdOrName
      },
      take: 1
    });
    chart = charts[0] || null;
  }

  return chart;
}

/**
 * Find a dashboard by ID or name
 * @param {string} dashboardIdOrName - Dashboard ID or name
 * @returns {object|null} - Dashboard object or null if not found
 */
export async function findDashboard(dashboardIdOrName) {
  if (!dashboardIdOrName) return null;

  let dashboard = await prisma.dashboard.findUnique({
    where: { id: dashboardIdOrName }
  });

  if (!dashboard) {
    const dashboards = await prisma.dashboard.findMany({
      where: {
        name: dashboardIdOrName
      },
      take: 1
    });
    dashboard = dashboards[0] || null;
  }

  return dashboard;
}

/**
 * Find a saved query by ID or name
 * @param {string} queryIdOrName - Query ID or name
 * @returns {object|null} - Query object or null if not found
 */
export async function findSavedQuery(queryIdOrName) {
  if (!queryIdOrName) return null;

  let query = await prisma.savedQuery.findUnique({
    where: { id: queryIdOrName }
  });

  if (!query) {
    const queries = await prisma.savedQuery.findMany({
      where: {
        name: queryIdOrName
      },
      take: 1
    });
    query = queries[0] || null;
  }

  return query;
}

/**
 * Find a dataset by ID or name
 * @param {string} datasetIdOrName - Dataset ID or name
 * @returns {object|null} - Dataset object or null if not found
 */
export async function findDataset(datasetIdOrName) {
  if (!datasetIdOrName) return null;

  let dataset = await prisma.dataset.findUnique({
    where: { id: datasetIdOrName }
  });

  if (!dataset) {
    const datasets = await prisma.dataset.findMany({
      where: {
        name: datasetIdOrName
      },
      take: 1
    });
    dataset = datasets[0] || null;
  }

  return dataset;
}
