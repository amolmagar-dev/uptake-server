import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { chartRepository, datasetRepository, connectionRepository } from "../../../db/repositories/index.js";
import { chartConfigSchema } from "./chartSchema.js";
import { parseAdvancedOptions, buildEChartsOption } from "./chartDataBuilder.js";
import { requireRole, toolOk as ok, toolFail as fail } from "./shared.js";
import { executeQuery } from "../../databaseConnector.js";
import { executeApiRequest } from "../../apiConnector.js";
import { fetchGoogleSheet } from "../../googleSheetsConnector.js";
import type { UserProfile } from "../../../types/database.js";

const chartManagementSchema = z.object({
  action: z.enum(["list", "get", "create", "update", "delete", "get_data"]).describe("The action to perform"),
  chartId: z.string().optional().describe("Chart ID, required for get/update/delete/get_data"),
  data: z
    .object({
      name: z.string().optional().describe("Chart name"),
      description: z.string().optional().describe("Chart description"),
      dataset_id: z.string().optional().describe("Dataset ID this chart reads from"),
      config: chartConfigSchema.optional().describe("Chart configuration, discriminated by chart_type"),
    })
    .optional()
    .describe("Chart data, required for create and update"),
});

async function fetchRowsForDataset(dataset: any): Promise<{ rows: any[]; fields: any }> {
  const connection = await connectionRepository.findById(dataset.connection_id);
  if (!connection) throw new Error("Dataset connection not found");

  if (dataset.source_type === "sql") {
    const sqlQuery =
      dataset.dataset_type === "physical"
        ? `SELECT * FROM ${dataset.table_schema ? `"${dataset.table_schema}".` : ""}"${dataset.table_name}"`
        : dataset.sql_query;
    if (!sqlQuery) throw new Error("No SQL query defined for dataset");
    return executeQuery(connection, sqlQuery);
  }
  if (dataset.source_type === "api") return executeApiRequest(connection);
  if (dataset.source_type === "googlesheet") return fetchGoogleSheet(connection);
  throw new Error(`Unsupported source type: ${dataset.source_type}`);
}

export function createChartManagementTool(user: UserProfile) {
  return tool(
    async (input: z.infer<typeof chartManagementSchema>) => {
      const { action, chartId, data } = input;
      try {
        switch (action) {
          case "list": {
            const charts = await chartRepository.findAll();
            return ok({ action, charts: charts.map((c) => ({ id: c.id, name: c.name, chartType: c.chart_type, datasetId: c.dataset_id })) });
          }

          case "get": {
            if (!chartId) return fail("chartId is required for get");
            const chart = await chartRepository.findById(chartId);
            if (!chart) return fail(`Chart not found: ${chartId}`);
            return ok({ action, chart: { id: chart.id, name: chart.name, chartType: chart.chart_type, datasetId: chart.dataset_id, config: JSON.parse(chart.config) } });
          }

          case "create": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!data?.name || !data.dataset_id || !data.config) {
              return fail("name, dataset_id, and config are required to create a chart");
            }

            const advanced = parseAdvancedOptions(data.config.advanced_options);
            if (!advanced.ok) return fail(advanced.error);

            const dataset = await datasetRepository.findById(data.dataset_id);
            if (!dataset) return fail(`Dataset not found: ${data.dataset_id}`);

            const chart = await chartRepository.create({
              name: data.name,
              description: data.description,
              chart_type: data.config.chart_type,
              config: JSON.stringify(data.config),
              dataset_id: dataset.id,
              created_by: user.id,
            });
            return ok({ action, chart: { id: chart.id, name: chart.name, chartType: chart.chart_type, datasetId: dataset.id, datasetName: dataset.name } });
          }

          case "update": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!chartId || !data) return fail("chartId and data are required for update");

            const config = data.config;
            if (config) {
              const advanced = parseAdvancedOptions(config.advanced_options);
              if (!advanced.ok) return fail(advanced.error);
            }

            const existing = await chartRepository.findById(chartId);
            if (!existing) return fail(`Chart not found: ${chartId}`);

            const updated = await chartRepository.update(existing.id, {
              name: data.name,
              description: data.description,
              chart_type: config?.chart_type,
              config: config ? JSON.stringify(config) : undefined,
              dataset_id: data.dataset_id,
            });
            return ok({ action, chart: { id: updated.id, name: updated.name, chartType: updated.chart_type } });
          }

          case "delete": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!chartId) return fail("chartId is required for delete");
            const existing = await chartRepository.findById(chartId);
            if (!existing) return fail(`Chart not found: ${chartId}`);
            await chartRepository.delete(existing.id);
            return ok({ action, chartId: existing.id });
          }

          case "get_data": {
            if (!chartId) return fail("chartId is required for get_data");
            const chart = await chartRepository.findById(chartId);
            if (!chart) return fail(`Chart not found: ${chartId}`);
            const dataset = await datasetRepository.findById(chart.dataset_id);
            if (!dataset) return fail("Chart's dataset not found");

            const config = chartConfigSchema.parse(JSON.parse(chart.config));
            const advanced = parseAdvancedOptions(config.advanced_options);
            if (!advanced.ok) return fail(advanced.error);

            const { rows, fields } = await fetchRowsForDataset(dataset);
            const echartsOption = buildEChartsOption(config, rows, advanced.value);
            return ok({
              action,
              chartId: chart.id,
              chartName: chart.name,
              chartType: chart.chart_type,
              datasetName: dataset.name,
              rows,
              fields,
              rowCount: rows.length,
              echartsOption,
            });
          }

          default:
            return fail(`Unknown action: ${action}`);
        }
      } catch (err: any) {
        return fail(err.message || "An error occurred during chart management");
      }
    },
    {
      name: "chart_management",
      description:
        "Manage charts for data visualization. Actions: list, get, create, update, delete, get_data. " +
        "Charts read from a dataset (create a dataset first with dataset_management). " +
        "config is discriminated by chart_type: bar/line/area need x_axis+y_axis; pie/donut need label_field+value_field; " +
        "scatter needs x_axis+y_axis (both numeric); table needs columns; number and gauge need value_field. " +
        "Use advanced_options (a JSON string) only for ECharts options not covered by the typed fields.",
      schema: chartManagementSchema,
    }
  );
}
