// @ts-nocheck
/**
 * Chart Management Tool
 * Full CRUD operations for charts
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import db from "../../config/database.js";
import { executeQuery } from "../databaseConnector.js";
import { findConnection, findChart, getAvailableConnectionsList } from "./utils.js";

const chartManagementDef = toolDefinition({
  name: "chart_management",
  description: `Manage charts for data visualization. Supported actions:
- list: List all charts with their configurations
- get: Get details of a specific chart
- create: Create a new chart (bar, line, pie, area, scatter, table, etc.)
- update: Update an existing chart
- delete: Delete a chart
- get_data: Execute the chart's query and return data for visualization
Use this when user wants to create visualizations, modify charts, or view chart data.
Chart types supported: bar, line, pie, area, scatter, donut, table, number, gauge
You can use either chart ID or chart name for get, update, delete, and get_data actions.`,
  inputSchema: z.object({
    action: z.enum(["list", "get", "create", "update", "delete", "get_data"]).describe("The action to perform"),
    chartId: z.string().optional().describe("Chart ID (required for get, update, delete, get_data)"),
    data: z
      .object({
        name: z.string().optional().describe("Chart name/title"),
        description: z.string().optional().describe("Chart description"),
        chart_type: z
          .enum(["bar", "line", "pie", "area", "scatter", "donut", "table", "number", "gauge"])
          .optional()
          .describe("Type of chart visualization"),
        sql_query: z.string().optional().describe("SQL query to fetch data for the chart"),
        connection_id: z.string().optional().describe("Database connection ID to run the query on"),
        config: z
          .object({
            xAxis: z.string().optional().describe("Column name for X axis"),
            yAxis: z.string().optional().describe("Column name for Y axis"),
            groupBy: z.string().optional().describe("Column to group data by"),
            colors: z.array(z.string()).optional().describe("Custom colors for chart"),
            showLegend: z.boolean().optional().describe("Show legend"),
            showGrid: z.boolean().optional().describe("Show grid lines"),
            title: z.string().optional().describe("Chart title override"),
            valueField: z.string().optional().describe("Value field for number/gauge charts"),
            aggregation: z.enum(["sum", "count", "avg", "min", "max"]).optional().describe("Aggregation function"),
          })
          .optional()
          .describe("Chart configuration options"),
      })
      .optional()
      .describe("Chart data (for create and update actions)"),
  }),
});

const chartManagement = chartManagementDef.server(async ({ action, chartId, data }) => {
  try {
    switch (action) {
      case "list": {
        const charts = db
          .prepare(
            `SELECT ch.*, c.name as connection_name, c.type as connection_type
             FROM charts ch
             LEFT JOIN connections c ON ch.connection_id = c.id
             ORDER BY ch.updated_at DESC`
          )
          .all();

        return {
          success: true,
          action: "list",
          totalCharts: charts.length,
          charts: charts.map((chart) => ({
            id: chart.id,
            name: chart.name,
            description: chart.description,
            chartType: chart.chart_type,
            connectionId: chart.connection_id,
            connectionName: chart.connection_name,
            connectionType: chart.connection_type,
            sqlQuery: chart.sql_query,
            config: JSON.parse(chart.config),
            createdAt: chart.created_at,
            updatedAt: chart.updated_at,
          })),
          chartTypeSummary: {
            bar: charts.filter((c) => c.chart_type === "bar").length,
            line: charts.filter((c) => c.chart_type === "line").length,
            pie: charts.filter((c) => c.chart_type === "pie").length,
            area: charts.filter((c) => c.chart_type === "area").length,
            scatter: charts.filter((c) => c.chart_type === "scatter").length,
            table: charts.filter((c) => c.chart_type === "table").length,
            other: charts.filter(
              (c) => !["bar", "line", "pie", "area", "scatter", "table"].includes(c.chart_type)
            ).length,
          },
        };
      }

      case "get": {
        if (!chartId) {
          return { success: false, error: "chartId is required for get action" };
        }

        const chartBase = findChart(chartId);
        if (!chartBase) {
          return { success: false, error: "Chart not found", chartId };
        }

        const chart = db
          .prepare(
            `SELECT ch.*, c.name as connection_name, c.type as connection_type
             FROM charts ch
             LEFT JOIN connections c ON ch.connection_id = c.id
             WHERE ch.id = ?`
          )
          .get(chartBase.id);

        if (!chart) {
          return { success: false, error: "Chart not found", chartId };
        }

        // Get dashboards this chart is on
        const dashboards = db
          .prepare(
            `SELECT d.id, d.name FROM dashboards d
             JOIN dashboard_charts dc ON d.id = dc.dashboard_id
             WHERE dc.chart_id = ?`
          )
          .all(chartId);

        return {
          success: true,
          action: "get",
          chart: {
            id: chart.id,
            name: chart.name,
            description: chart.description,
            chartType: chart.chart_type,
            connectionId: chart.connection_id,
            connectionName: chart.connection_name,
            connectionType: chart.connection_type,
            sqlQuery: chart.sql_query,
            config: JSON.parse(chart.config),
            createdAt: chart.created_at,
            updatedAt: chart.updated_at,
            usedInDashboards: dashboards,
          },
        };
      }

      case "create": {
        if (!data) {
          return { success: false, error: "data is required for create action" };
        }

        const { name, description, chart_type, sql_query, connection_id, config } = data;

        if (!name || !chart_type || !sql_query || !connection_id) {
          return {
            success: false,
            error: "name, chart_type, sql_query, and connection_id are required",
          };
        }

        // Verify connection exists - supports ID or name
        const connection = findConnection(connection_id);
        if (!connection) {
          return { 
            success: false, 
            error: "Connection not found", 
            connectionId: connection_id,
            availableConnections: getAvailableConnectionsList(),
          };
        }

        const newChartId = uuidv4();
        const chartConfig = config || {};

        db.prepare(
          `INSERT INTO charts (id, name, description, chart_type, config, sql_query, connection_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(newChartId, name, description || null, chart_type, JSON.stringify(chartConfig), sql_query, connection.id);

        return {
          success: true,
          action: "create",
          message: "Chart created successfully",
          chart: {
            id: newChartId,
            name,
            description,
            chartType: chart_type,
            connectionId: connection.id,
            connectionName: connection.name,
            sqlQuery: sql_query,
            config: chartConfig,
          },
        };
      }

      case "update": {
        if (!chartId) {
          return { success: false, error: "chartId is required for update action" };
        }
        if (!data) {
          return { success: false, error: "data is required for update action" };
        }

        const existing = findChart(chartId);
        if (!existing) {
          return { success: false, error: "Chart not found", chartId };
        }

        const { name, description, chart_type, sql_query, connection_id, config } = data;

        // If changing connection, verify it exists
        let connectionToUse = existing.connection_id;
        if (connection_id) {
          const connection = findConnection(connection_id);
          if (!connection) {
            return { 
              success: false, 
              error: "Connection not found", 
              connectionId: connection_id,
              availableConnections: getAvailableConnectionsList(),
            };
          }
          connectionToUse = connection.id;
        }

        const updatedConfig = config
          ? JSON.stringify({ ...JSON.parse(existing.config), ...config })
          : existing.config;

        db.prepare(
          `UPDATE charts SET 
            name = ?, description = ?, chart_type = ?, config = ?, 
            sql_query = ?, connection_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(
          name || existing.name,
          description !== undefined ? description : existing.description,
          chart_type || existing.chart_type,
          updatedConfig,
          sql_query || existing.sql_query,
          connectionToUse,
          existing.id
        );

        return {
          success: true,
          action: "update",
          message: "Chart updated successfully",
          chartId,
        };
      }

      case "delete": {
        if (!chartId) {
          return { success: false, error: "chartId is required for delete action" };
        }

        const existing = findChart(chartId);
        if (!existing) {
          return { success: false, error: "Chart not found", chartId };
        }

        // Remove from dashboards first
        db.prepare("DELETE FROM dashboard_charts WHERE chart_id = ?").run(existing.id);
        db.prepare("DELETE FROM charts WHERE id = ?").run(existing.id);

        return {
          success: true,
          action: "delete",
          message: `Chart "${existing.name}" deleted successfully`,
          chartId,
        };
      }

      case "get_data": {
        if (!chartId) {
          return { success: false, error: "chartId is required for get_data action" };
        }

        const chart = findChart(chartId);
        if (!chart) {
          return { success: false, error: "Chart not found", chartId };
        }

        let sqlQuery = chart.sql_query;

        // If chart uses a saved query
        if (chart.query_id && !sqlQuery) {
          const savedQuery = db.prepare("SELECT sql_query FROM saved_queries WHERE id = ?").get(chart.query_id);
          if (!savedQuery) {
            return { success: false, error: "Associated query not found" };
          }
          sqlQuery = savedQuery.sql_query;
        }

        if (!sqlQuery) {
          return { success: false, error: "No SQL query associated with this chart" };
        }

        const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(chart.connection_id);
        if (!connection) {
          return { success: false, error: "Connection not found" };
        }

        const result = await executeQuery(connection, sqlQuery);

        return {
          success: true,
          action: "get_data",
          chartId,
          chartName: chart.name,
          chartType: chart.chart_type,
          data: result.rows,
          fields: result.fields,
          rowCount: result.rowCount,
          executionTime: `${result.executionTime}ms`,
          config: JSON.parse(chart.config),
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (error) {
    console.error("Chart management error:", error);
    return {
      success: false,
      error: error.message || "Chart management failed",
      action,
    };
  }
});

export default chartManagement;

