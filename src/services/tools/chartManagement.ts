// @ts-nocheck
/**
 * Chart Management Tool
 * Full CRUD operations for charts
 * Refactored to use Datasets as the data source
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { chartRepository } from "../../db/repositories/index.js";
import { executeQuery } from "../databaseConnector.js";
import { findConnection, findChart, findDataset, getAvailableConnectionsList } from "./utils.js";

const chartManagementDef = toolDefinition({
  name: "chart_management",
  description: `Manage charts for data visualization. Supported actions:
- list: List all charts with their configurations
- get: Get details of a specific chart
- create: Create a new chart using a dataset
- update: Update an existing chart
- delete: Delete a chart
- get_data: Execute the chart's query and return data for visualization

Charts are linked to Datasets for their data source. Use dataset_management tool first to create a dataset, then use this tool to create charts from it.

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
        dataset_id: z.string().optional().describe("Dataset ID to use for chart data (preferred)"),
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
        const charts = await prisma.chart.findMany({
          include: {
            connection: { select: { name: true, type: true } },
            dataset: { select: { name: true, dataset_type: true, source_type: true } }
          },
          orderBy: { updated_at: "desc" },
        });

        return {
          success: true,
          action: "list",
          totalCharts: charts.length,
          charts: charts.map((chart) => ({
            id: chart.id,
            name: chart.name,
            description: chart.description,
            chartType: chart.chart_type,
            datasetId: chart.dataset_id,
            datasetName: chart.dataset?.name,
            datasetType: chart.dataset?.dataset_type,
            connectionId: chart.connection_id,
            connectionName: chart.connection?.name,
            connectionType: chart.connection?.type,
            config: chart.config ? JSON.parse(chart.config) : {},
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

        const chartBase = await findChart(chartId);
        if (!chartBase) {
          return { success: false, error: "Chart not found", chartId };
        }

        const chart = await prisma.chart.findUnique({
          where: { id: chartBase.id },
          include: {
            connection: { select: { name: true, type: true } },
            dataset: { select: { id: true, name: true, dataset_type: true, source_type: true, table_name: true, sql_query: true } },
            dashboardCharts: {
              include: {
                dashboard: { select: { id: true, name: true } }
              }
            }
          }
        });

        if (!chart) {
          return { success: false, error: "Chart not found", chartId };
        }

        return {
          success: true,
          action: "get",
          chart: {
            id: chart.id,
            name: chart.name,
            description: chart.description,
            chartType: chart.chart_type,
            datasetId: chart.dataset_id,
            dataset: chart.dataset ? {
              id: chart.dataset.id,
              name: chart.dataset.name,
              datasetType: chart.dataset.dataset_type,
              sourceType: chart.dataset.source_type,
              tableName: chart.dataset.table_name,
              sqlQuery: chart.dataset.sql_query,
            } : null,
            connectionId: chart.connection_id,
            connectionName: chart.connection?.name,
            connectionType: chart.connection?.type,
            config: chart.config ? JSON.parse(chart.config) : {},
            createdAt: chart.created_at,
            updatedAt: chart.updated_at,
            usedInDashboards: chart.dashboardCharts.map(dc => dc.dashboard),
          },
        };
      }

      case "create": {
        if (!data) {
          return { success: false, error: "data is required for create action" };
        }

        const { name, description, chart_type, dataset_id, config } = data;

        if (!name || !chart_type || !dataset_id) {
          return {
            success: false,
            error: "name, chart_type, and dataset_id are required. Use dataset_management tool to create a dataset first.",
          };
        }

        // Verify dataset exists
        const dataset = await findDataset(dataset_id);
        if (!dataset) {
          return { 
            success: false, 
            error: "Dataset not found. Use dataset_management tool to create a dataset first.", 
            datasetId: dataset_id,
          };
        }

        const chartConfig = config || {};

        // Create chart using repository
        const newChart = await chartRepository.create({
          name,
          description: description || undefined,
          chart_type,
          config: JSON.stringify(chartConfig),
          dataset_id: dataset.id,
          connection_id: dataset.connection_id,
        });

        return {
          success: true,
          action: "create",
          message: "Chart created successfully",
          chart: {
            id: newChart.id,
            name: newChart.name,
            description: newChart.description,
            chartType: newChart.chart_type,
            datasetId: dataset.id,
            datasetName: dataset.name,
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

        const existing = await findChart(chartId);
        if (!existing) {
          return { success: false, error: "Chart not found", chartId };
        }

        const { name, description, chart_type, dataset_id, config } = data;

        // If changing dataset, verify it exists
        let datasetToUse = existing.dataset_id;
        let connectionToUse = existing.connection_id;
        if (dataset_id) {
          const dataset = await findDataset(dataset_id);
          if (!dataset) {
            return { 
              success: false, 
              error: "Dataset not found", 
              datasetId: dataset_id,
            };
          }
          datasetToUse = dataset.id;
          connectionToUse = dataset.connection_id;
        }

        // Merge config if provided
        let updatedConfig = existing.config;
        if (config) {
          const existingConfig = existing.config ? JSON.parse(existing.config) : {};
          updatedConfig = JSON.stringify({ ...existingConfig, ...config });
        }

        // Update chart using repository
        await chartRepository.update(existing.id, {
          name: name || undefined,
          description: description !== undefined ? description : undefined,
          chart_type: chart_type || undefined,
          config: updatedConfig || undefined,
          dataset_id: datasetToUse || undefined,
          connection_id: connectionToUse || undefined,
        });

        return {
          success: true,
          action: "update",
          message: "Chart updated successfully",
          chartId: existing.id,
        };
      }

      case "delete": {
        if (!chartId) {
          return { success: false, error: "chartId is required for delete action" };
        }

        const existing = await findChart(chartId);
        if (!existing) {
          return { success: false, error: "Chart not found", chartId };
        }

        // Remove from dashboards first
        await prisma.dashboardChart.deleteMany({
          where: { chart_id: existing.id }
        });

        // Delete chart using repository
        await chartRepository.delete(existing.id);

        return {
          success: true,
          action: "delete",
          message: `Chart "${existing.name}" deleted successfully`,
          chartId: existing.id,
        };
      }

      case "get_data": {
        if (!chartId) {
          return { success: false, error: "chartId is required for get_data action" };
        }

        const chart = await prisma.chart.findUnique({
          where: { id: chartId },
          include: {
            dataset: { include: { connection: true } },
            connection: true
          }
        });
        
        if (!chart) {
          const chartByName = await findChart(chartId);
          if (!chartByName) {
            return { success: false, error: "Chart not found", chartId };
          }
          // Recursively call with actual ID
          return chartManagement({ action: "get_data", chartId: chartByName.id, data: undefined });
        }

        // Get data from dataset
        if (chart.dataset_id && chart.dataset) {
          const dataset = chart.dataset;
          const connection = dataset.connection;
          
          if (!connection) {
            return { success: false, error: "Dataset connection not found" };
          }

          let sqlQuery;
          if (dataset.dataset_type === "physical") {
            const schemaPrefix = dataset.table_schema ? `"${dataset.table_schema}".` : '';
            sqlQuery = `SELECT * FROM ${schemaPrefix}"${dataset.table_name}"`;
          } else if (dataset.dataset_type === "virtual") {
            sqlQuery = dataset.sql_query;
          } else {
            return { success: false, error: "Unsupported dataset type" };
          }

          if (!sqlQuery) {
            return { success: false, error: "No SQL query defined for dataset" };
          }

          const result = await executeQuery(connection, sqlQuery);

          return {
            success: true,
            action: "get_data",
            chartId: chart.id,
            chartName: chart.name,
            chartType: chart.chart_type,
            datasetName: dataset.name,
            data: result.rows,
            fields: result.fields,
            rowCount: result.rowCount,
            executionTime: `${result.executionTime}ms`,
            config: chart.config ? JSON.parse(chart.config) : {},
          };
        }

        // Legacy: If chart has direct sql_query (for backward compatibility)
        if (chart.sql_query && chart.connection) {
          const result = await executeQuery(chart.connection, chart.sql_query);

          return {
            success: true,
            action: "get_data",
            chartId: chart.id,
            chartName: chart.name,
            chartType: chart.chart_type,
            data: result.rows,
            fields: result.fields,
            rowCount: result.rowCount,
            executionTime: `${result.executionTime}ms`,
            config: chart.config ? JSON.parse(chart.config) : {},
          };
        }

        return { success: false, error: "No data source defined for this chart" };
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
