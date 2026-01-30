/**
 * Chart Management Tool
 * Full CRUD operations for charts
 * Refactored to use LangChain.js and Datasets as the data source
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { chartRepository } from "../../db/repositories/index.js";
import { executeQuery } from "../databaseConnector.js";
import { executeApiRequest } from "../apiConnector.js";
import { fetchGoogleSheet } from "../googleSheetsConnector.js";
import { findChart, findDataset } from "./utils.js";

const chartConfigSchema = z.object({
  // Simple config options (mapped to ECharts)
  xAxis: z.string().optional().describe("Column name for X axis"),
  yAxis: z.string().optional().describe("Column name for Y axis"),
  groupBy: z.string().optional().describe("Column to group data by"),
  colors: z.array(z.string()).optional().describe("Custom colors for chart"),
  showLegend: z.boolean().optional().describe("Show legend"),
  showGrid: z.boolean().optional().describe("Show grid lines"),
  title: z.string().optional().describe("Chart title override"),
  valueField: z.string().optional().describe("Value field for number/gauge charts"),
  aggregation: z.enum(["sum", "count", "avg", "min", "max"]).optional().describe("Aggregation function"),
  
  // Full ECharts options (RAG-powered) - use z.any() for Gemini API compatibility
  echarts: z.any().optional().describe(`Full ECharts configuration object (JSON). Use $DATA placeholder for dynamic data.
    Example: { "series": [{ "type": "bar", "data": "$DATA" }], "xAxis": { "type": "category" } }
    Supports: title, legend, grid, xAxis, yAxis, tooltip, series, dataZoom, visualMap, toolbox.`),
});

const chartDataSchema = z.object({
  name: z.string().optional().describe("Chart name/title"),
  description: z.string().optional().describe("Chart description"),
  chart_type: z
    .enum(["bar", "line", "pie", "area", "scatter", "donut", "table", "number", "gauge"])
    .optional()
    .describe("Type of chart visualization"),
  dataset_id: z.string().optional().describe("Dataset ID to use for chart data (preferred)"),
  config: chartConfigSchema.optional().describe("Chart configuration options"),
});

const chartManagementSchema = z.object({
  action: z.enum(["list", "get", "create", "update", "delete", "get_data"]).describe("The action to perform"),
  chartId: z.string().optional().describe("Chart ID (required for get, update, delete, get_data)"),
  data: chartDataSchema.optional().describe("Chart data (for create and update actions)"),
});

type ChartManagementInput = z.infer<typeof chartManagementSchema>;

async function executeChartManagement({ action, chartId, data }: ChartManagementInput): Promise<string> {
  try {
    switch (action) {
      case "list": {
        const charts = await prisma.chart.findMany({
          include: {
            dataset: { select: { name: true, dataset_type: true, source_type: true } }
          },
          orderBy: { updated_at: "desc" },
        });

        return JSON.stringify({
          success: true,
          action: "list",
          totalCharts: charts.length,
          charts: charts.map((chart: any) => ({
            id: chart.id,
            name: chart.name,
            description: chart.description,
            chartType: chart.chart_type,
            datasetId: chart.dataset_id,
            datasetName: chart.dataset?.name,
            datasetType: chart.dataset?.dataset_type,
            config: chart.config ? JSON.parse(chart.config) : {},
            createdAt: chart.created_at,
            updatedAt: chart.updated_at,
          })),
          chartTypeSummary: {
            bar: charts.filter((c: any) => c.chart_type === "bar").length,
            line: charts.filter((c: any) => c.chart_type === "line").length,
            pie: charts.filter((c: any) => c.chart_type === "pie").length,
            area: charts.filter((c: any) => c.chart_type === "area").length,
            scatter: charts.filter((c: any) => c.chart_type === "scatter").length,
            table: charts.filter((c: any) => c.chart_type === "table").length,
          },
        });
      }

      case "get": {
        if (!chartId) {
          return JSON.stringify({ success: false, error: "chartId is required for get action" });
        }

        const chartBase = await findChart(chartId);
        if (!chartBase) {
          return JSON.stringify({ success: false, error: "Chart not found", chartId });
        }

        const chart = await prisma.chart.findUnique({
          where: { id: chartBase.id },
          include: {
            dataset: { select: { id: true, name: true, dataset_type: true, source_type: true, table_name: true, sql_query: true } },
            dashboardCharts: {
              include: {
                dashboard: { select: { id: true, name: true } }
              }
            }
          }
        });

        if (!chart) {
          return JSON.stringify({ success: false, error: "Chart not found", chartId });
        }

        return JSON.stringify({
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
            config: chart.config ? JSON.parse(chart.config) : {},
            createdAt: chart.created_at,
            updatedAt: chart.updated_at,
            usedInDashboards: chart.dashboardCharts.map((dc: any) => dc.dashboard),
          },
        });
      }

      case "create": {
        if (!data) {
          return JSON.stringify({ success: false, error: "data is required for create action" });
        }

        const { name, description, chart_type, dataset_id, config } = data;

        if (!name || !chart_type || !dataset_id) {
          return JSON.stringify({
            success: false,
            error: "name, chart_type, and dataset_id are required. Use dataset_management tool to create a dataset first.",
          });
        }

        const dataset = await findDataset(dataset_id);
        if (!dataset) {
          return JSON.stringify({ 
            success: false, 
            error: "Dataset not found. Use dataset_management tool to create a dataset first.", 
            datasetId: dataset_id,
          });
        }

        const chartConfig = config || {};

        const newChart = await chartRepository.create({
          name,
          description: description || undefined,
          chart_type,
          config: JSON.stringify(chartConfig),
          dataset_id: dataset.id,
        });

        return JSON.stringify({
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
        });
      }

      case "update": {
        if (!chartId) {
          return JSON.stringify({ success: false, error: "chartId is required for update action" });
        }
        if (!data) {
          return JSON.stringify({ success: false, error: "data is required for update action" });
        }

        const existing = await findChart(chartId);
        if (!existing) {
          return JSON.stringify({ success: false, error: "Chart not found", chartId });
        }

        const { name, description, chart_type, dataset_id, config } = data;

        let datasetToUse = existing.dataset_id;
        if (dataset_id) {
          const dataset = await findDataset(dataset_id);
          if (!dataset) {
            return JSON.stringify({ 
              success: false, 
              error: "Dataset not found", 
              datasetId: dataset_id,
            });
          }
          datasetToUse = dataset.id;
        }

        let updatedConfig = existing.config;
        if (config) {
          const existingConfig = existing.config ? JSON.parse(existing.config) : {};
          updatedConfig = JSON.stringify({ ...existingConfig, ...config });
        }

        await chartRepository.update(existing.id, {
          name: name || undefined,
          description: description !== undefined ? description : undefined,
          chart_type: chart_type || undefined,
          config: updatedConfig || undefined,
          dataset_id: datasetToUse || undefined,
        });

        return JSON.stringify({
          success: true,
          action: "update",
          message: "Chart updated successfully",
          chartId: existing.id,
        });
      }

      case "delete": {
        if (!chartId) {
          return JSON.stringify({ success: false, error: "chartId is required for delete action" });
        }

        const existing = await findChart(chartId);
        if (!existing) {
          return JSON.stringify({ success: false, error: "Chart not found", chartId });
        }

        await prisma.dashboardChart.deleteMany({
          where: { chart_id: existing.id }
        });

        await chartRepository.delete(existing.id);

        return JSON.stringify({
          success: true,
          action: "delete",
          message: `Chart "${existing.name}" deleted successfully`,
          chartId: existing.id,
        });
      }

      case "get_data": {
        if (!chartId) {
          return JSON.stringify({ success: false, error: "chartId is required for get_data action" });
        }

        let chart = await prisma.chart.findUnique({
          where: { id: chartId },
          include: {
            dataset: { include: { connection: true } },
          }
        });
        
        if (!chart) {
          const chartByName = await findChart(chartId);
          if (!chartByName) {
            return JSON.stringify({ success: false, error: "Chart not found", chartId });
          }
          // Re-fetch with includes
          chart = await prisma.chart.findUnique({
            where: { id: chartByName.id },
            include: {
              dataset: { include: { connection: true } },
            }
          });
          if (!chart) {
            return JSON.stringify({ success: false, error: "Chart not found", chartId });
          }
        }

        if (!chart.dataset_id || !chart.dataset) {
          return JSON.stringify({ success: false, error: "Chart has no dataset configured" });
        }

        const dataset = chart.dataset as any;
        const connection = dataset.connection;
        
        if (!connection) {
          return JSON.stringify({ success: false, error: "Dataset connection not found" });
        }

        let result;

        // Handle different source types
        if (dataset.source_type === 'sql') {
          let sqlQuery;
          if (dataset.dataset_type === "physical") {
            const schemaPrefix = dataset.table_schema ? `"${dataset.table_schema}".` : '';
            sqlQuery = `SELECT * FROM ${schemaPrefix}"${dataset.table_name}"`;
          } else if (dataset.dataset_type === "virtual") {
            sqlQuery = dataset.sql_query;
          } else {
            return JSON.stringify({ success: false, error: "Unsupported dataset type" });
          }

          if (!sqlQuery) {
            return JSON.stringify({ success: false, error: "No SQL query defined for dataset" });
          }

          result = await executeQuery(connection, sqlQuery);
        } else if (dataset.source_type === 'api') {
          result = await executeApiRequest(connection);
        } else if (dataset.source_type === 'googlesheet') {
          result = await fetchGoogleSheet(connection);
        } else {
          return JSON.stringify({ success: false, error: `Unsupported source type: ${dataset.source_type}` });
        }

        const chartConfig = chart.config ? JSON.parse(chart.config) : {};
        const interpolatedConfig = interpolateDataInConfig(chartConfig, result.rows);

        return JSON.stringify({
          success: true,
          action: "get_data",
          chartId: chart.id,
          chartName: chart.name,
          chartType: chart.chart_type,
          datasetName: dataset.name,
          sourceType: dataset.source_type,
          data: result.rows,
          fields: result.fields,
          rowCount: result.rowCount,
          executionTime: `${result.executionTime}ms`,
          chartConfig: interpolatedConfig,
        });
      }

      default:
        return JSON.stringify({ success: false, error: `Unknown action: ${action}` });
    }
  } catch (error: any) {
    console.error("Chart management error:", error);
    return JSON.stringify({
      success: false,
      error: error.message || "Chart management failed",
      action,
    });
  }
}

/**
 * Interpolate $DATA placeholder in chart config with actual data rows.
 * Supports:
 * - "$DATA" string placeholder anywhere in config
 * - config.echarts field with $DATA placeholder
 * - Legacy dataset.source merging
 */
function interpolateDataInConfig(config: any, rows: any[]): any {
  // If config has echarts field, process it separately
  if (config.echarts) {
    const echartsConfig = config.echarts;
    const echartsStr = JSON.stringify(echartsConfig);
    
    if (echartsStr.includes('"$DATA"')) {
      const interpolated = echartsStr.replace(/"\\$DATA"/g, JSON.stringify(rows));
      return { ...config, echarts: JSON.parse(interpolated) };
    }
    
    // Auto-inject data if series exists but has no data
    if (echartsConfig.series) {
      const series = Array.isArray(echartsConfig.series) ? echartsConfig.series : [echartsConfig.series];
      const updatedSeries = series.map((s: any) => ({
        ...s,
        data: s.data || rows,
      }));
      return { ...config, echarts: { ...echartsConfig, series: updatedSeries } };
    }
    
    return config;
  }
  
  // Convert to string and check for $DATA placeholder
  const configStr = JSON.stringify(config);
  
  if (configStr.includes('"$DATA"')) {
    // Replace "$DATA" with actual data array
    const interpolated = configStr.replace(/"\\$DATA"/g, JSON.stringify(rows));
    return JSON.parse(interpolated);
  }
  
  // Legacy: merge into dataset.source if it exists
  if (config.dataset) {
    return { ...config, dataset: { ...config.dataset, source: rows } };
  }
  
  return config;
}

const chartManagement = tool(executeChartManagement, {
  name: "chart_management",
  description: `Manage charts for data visualization using ECharts. Supported actions:
- list: List all charts with their configurations
- get: Get details of a specific chart
- create: Create a new chart using a dataset
- update: Update an existing chart
- delete: Delete a chart
- get_data: Execute the chart's query and return data for visualization

Charts are linked to Datasets for their data source. Use dataset_management tool first to create a dataset.

## ECharts Configuration Reference

Use the 'config.echarts' field for full ECharts customization. Use "$DATA" placeholder for dynamic data.

### Key ECharts Options:
- **title**: { text, subtext, left, top, textStyle }
- **legend**: { show, orient, left, top, data }
- **grid**: { left, right, top, bottom, containLabel }
- **xAxis**: { type: "category"|"value"|"time", data, name, axisLabel }
- **yAxis**: { type: "value"|"category", name, min, max, axisLabel }
- **tooltip**: { trigger: "item"|"axis", formatter }
- **series**: [{ type, name, data: "$DATA", itemStyle, label, emphasis }]
- **color**: ["#5470c6", "#91cc75", ...] - Global color palette
- **dataZoom**: [{ type: "inside"|"slider" }] - For large datasets

### Series Types:
line, bar, pie, scatter, radar, gauge, funnel, heatmap, treemap, sunburst, graph, sankey

### Chart Type Templates:
- **bar/line**: xAxis(category), yAxis(value), series[{type, data}]
- **pie/donut**: series[{type:"pie", radius, data:[{name,value}]}]
- **gauge**: series[{type:"gauge", min, max, data:[{value,name}]}]
- **scatter**: xAxis(value), yAxis(value), series[{type, data:[[x,y],...]}]

### Example Configs:
Bar: { "echarts": { "xAxis": {"type":"category"}, "yAxis": {"type":"value"}, "series": [{"type":"bar", "data":"$DATA"}] }}
Pie: { "echarts": { "series": [{"type":"pie", "radius":"50%", "data":"$DATA"}] }}

Supported data sources: SQL databases, APIs, Google Sheets
Chart types: bar, line, pie, area, scatter, donut, table, number, gauge`,
  schema: chartManagementSchema,
});

export default chartManagement;

