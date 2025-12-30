/**
 * Shared utilities for AI tools
 */

import db from "../../config/database.js";

/**
 * Find a connection by ID or name
 * Tries ID first, then falls back to case-insensitive name matching
 * @param {string} connectionIdOrName - Connection ID or name
 * @returns {object|null} - Connection object or null if not found
 */
export function findConnection(connectionIdOrName) {
  if (!connectionIdOrName) return null;

  // Try by ID first
  let connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(connectionIdOrName);

  // If not found by ID, try by name (case-insensitive)
  if (!connection) {
    connection = db
      .prepare("SELECT * FROM connections WHERE LOWER(name) = LOWER(?)")
      .get(connectionIdOrName);
  }

  return connection;
}

/**
 * Get list of available connections for error messages
 * @returns {Array} - Array of connection summaries
 */
export function getAvailableConnectionsList() {
  const connections = db.prepare("SELECT id, name, type FROM connections").all();
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
export function findChart(chartIdOrName) {
  if (!chartIdOrName) return null;

  let chart = db.prepare("SELECT * FROM charts WHERE id = ?").get(chartIdOrName);

  if (!chart) {
    chart = db.prepare("SELECT * FROM charts WHERE LOWER(name) = LOWER(?)").get(chartIdOrName);
  }

  return chart;
}

/**
 * Find a dashboard by ID or name
 * @param {string} dashboardIdOrName - Dashboard ID or name
 * @returns {object|null} - Dashboard object or null if not found
 */
export function findDashboard(dashboardIdOrName) {
  if (!dashboardIdOrName) return null;

  let dashboard = db.prepare("SELECT * FROM dashboards WHERE id = ?").get(dashboardIdOrName);

  if (!dashboard) {
    dashboard = db
      .prepare("SELECT * FROM dashboards WHERE LOWER(name) = LOWER(?)")
      .get(dashboardIdOrName);
  }

  return dashboard;
}

/**
 * Find a saved query by ID or name
 * @param {string} queryIdOrName - Query ID or name
 * @returns {object|null} - Query object or null if not found
 */
export function findSavedQuery(queryIdOrName) {
  if (!queryIdOrName) return null;

  let query = db.prepare("SELECT * FROM saved_queries WHERE id = ?").get(queryIdOrName);

  if (!query) {
    query = db.prepare("SELECT * FROM saved_queries WHERE LOWER(name) = LOWER(?)").get(queryIdOrName);
  }

  return query;
}

