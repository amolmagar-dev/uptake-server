import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { connectionRepository, datasetRepository } from "../../../db/repositories/index.js";
import { getTableSchema } from "../../databaseConnector.js";
import { requireRole, toolOk as ok, toolFail as fail } from "./shared.js";
import type { UserProfile } from "../../../types/database.js";

const physicalDatasetSchema = z.object({
  dataset_type: z.literal("physical"),
  connection_id: z.string().describe("Connection this dataset reads from"),
  table_name: z.string().describe("Table to expose as a dataset"),
  table_schema: z.string().optional().describe("Schema name (default: public)"),
});

const virtualDatasetSchema = z.object({
  dataset_type: z.literal("virtual"),
  connection_id: z.string().describe("Connection this dataset reads from"),
  // Optional at the schema level (not required) so a missing sql_query fails gracefully via the
  // handler's own check below instead of throwing ToolInputParsingException out of tool.invoke() —
  // LangChain's tool() throws on required-field validation failures rather than returning a value,
  // which would bypass toolFail() and break direct-invoke tests/callers expecting a JSON result.
  sql_query: z.string().optional().describe("Custom SQL query defining this dataset (required for virtual datasets)"),
});

const datasetConfigSchema = z.discriminatedUnion("dataset_type", [physicalDatasetSchema, virtualDatasetSchema]);

const datasetManagementSchema = z.object({
  action: z.enum(["list", "get", "create", "update", "delete"]).describe("The action to perform"),
  datasetId: z.string().optional().describe("Dataset ID, required for get/update/delete"),
  data: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      config: datasetConfigSchema.optional(),
    })
    .optional(),
});

export function createDatasetManagementTool(user: UserProfile) {
  return tool(
    async (input: z.infer<typeof datasetManagementSchema>) => {
      const { action, datasetId, data } = input;
      try {
        switch (action) {
          case "list": {
            const datasets = await datasetRepository.findAll();
            return ok({ action, datasets: datasets.map((d) => ({ id: d.id, name: d.name, datasetType: d.dataset_type, sourceType: d.source_type })) });
          }
          case "get": {
            if (!datasetId) return fail("datasetId is required for get");
            const dataset = await datasetRepository.findById(datasetId);
            if (!dataset) return fail(`Dataset not found: ${datasetId}`);
            return ok({
              action,
              dataset: {
                id: dataset.id,
                name: dataset.name,
                datasetType: dataset.dataset_type,
                sourceType: dataset.source_type,
                columns: dataset.columns ? JSON.parse(dataset.columns) : [],
              },
            });
          }
          case "create": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!data?.name || !data.config) return fail("name and config are required to create a dataset");
            if (data.config.dataset_type === "virtual" && !data.config.sql_query) {
              return fail("sql_query is required for a virtual dataset");
            }

            const connection = await connectionRepository.findById(data.config.connection_id);
            if (!connection) return fail(`Connection not found: ${data.config.connection_id}`);

            let columns: { column_name: string; data_type: string }[] = [];
            if (data.config.dataset_type === "physical") {
              const schemaColumns = await getTableSchema(connection, data.config.table_name, data.config.table_schema);
              columns = schemaColumns.map((c: { column_name: string; data_type: string }) => ({
                column_name: c.column_name,
                data_type: c.data_type,
              }));
            }

            const dataset = await datasetRepository.create({
              name: data.name,
              description: data.description,
              source_type: connection.type === "api" ? "api" : connection.type === "googlesheets" ? "googlesheet" : "sql",
              dataset_type: data.config.dataset_type,
              connection_id: connection.id,
              table_name: data.config.dataset_type === "physical" ? data.config.table_name : undefined,
              table_schema: data.config.dataset_type === "physical" ? data.config.table_schema ?? "public" : undefined,
              sql_query: data.config.dataset_type === "virtual" ? data.config.sql_query : undefined,
              columns: JSON.stringify(columns),
              created_by: user.id,
            });
            return ok({ action, dataset: { id: dataset.id, name: dataset.name, datasetType: dataset.dataset_type } });
          }
          case "update": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!datasetId) return fail("datasetId is required for update");
            const existing = await datasetRepository.findById(datasetId);
            if (!existing) return fail(`Dataset not found: ${datasetId}`);

            const updated = await datasetRepository.update(existing.id, {
              name: data?.name,
              description: data?.description,
              dataset_type: data?.config?.dataset_type,
              connection_id: data?.config?.connection_id,
              table_name: data?.config?.dataset_type === "physical" ? data.config.table_name : undefined,
              table_schema: data?.config?.dataset_type === "physical" ? data.config.table_schema : undefined,
              sql_query: data?.config?.dataset_type === "virtual" ? data.config.sql_query : undefined,
            });
            return ok({ action, dataset: { id: updated.id, name: updated.name } });
          }
          case "delete": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!datasetId) return fail("datasetId is required for delete");
            const existing = await datasetRepository.findById(datasetId);
            if (!existing) return fail(`Dataset not found: ${datasetId}`);
            await datasetRepository.delete(existing.id);
            return ok({ action, datasetId: existing.id });
          }
          default:
            return fail(`Unknown action: ${action}`);
        }
      } catch (err: any) {
        return fail(err.message || "An error occurred during dataset management");
      }
    },
    {
      name: "dataset_management",
      description:
        "Manage datasets (the data source behind charts). Actions: list, get, create, update, delete. " +
        "config is discriminated by dataset_type: physical needs connection_id+table_name; virtual needs connection_id+sql_query. " +
        "Column schema is auto-discovered on create for physical datasets. Requires admin or editor to create/update/delete.",
      schema: datasetManagementSchema,
    }
  );
}
