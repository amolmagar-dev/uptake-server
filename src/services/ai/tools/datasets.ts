import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { connectionRepository, datasetRepository } from "../../../db/repositories/index.js";
import { getTableSchema } from "../../databaseConnector.js";
import { requireRole, toolOk as ok, toolFail as fail, orJsonString, parseConfigInput } from "./shared.js";
import { logger } from "../../../utils/logger.js";
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
      config: orJsonString(datasetConfigSchema)
        .optional()
        .describe(
          "A JSON-encoded string is also accepted if your tool-calling client stringifies nested objects."
        ),
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

            const configResult = parseConfigInput(datasetConfigSchema, data.config);
            if (!configResult.ok) return fail(configResult.error);
            const config = configResult.value!;

            if (config.dataset_type === "virtual" && !config.sql_query) {
              return fail("sql_query is required for a virtual dataset");
            }

            const connection = await connectionRepository.findById(config.connection_id);
            if (!connection) return fail(`Connection not found: ${config.connection_id}`);

            logger.info(
              { connectionId: connection.id, connectionType: connection.type, datasetType: config.dataset_type },
              "[dataset_management.create] resolved connection"
            );

            let columns: { column_name: string; data_type: string }[] = [];
            const isSqlConnection = ["postgresql", "mysql", "sqlite"].includes(connection.type);
            if (config.dataset_type === "physical") {
              logger.info(
                { connectionType: connection.type, isSqlConnection, tableName: config.table_name },
                isSqlConnection
                  ? "[dataset_management.create] discovering SQL table schema via getTableSchema (this opens a real DB connection and can hang up to connectionTimeoutMillis if unreachable)"
                  : "[dataset_management.create] non-SQL connection — skipping SQL schema discovery, columns left empty"
              );
              // getTableSchema is a SQL-only function (databaseConnector.ts): calling it for a
              // non-SQL connection tries to open a real pg/mysql2 connection using that
              // connection's (irrelevant) host/port fields, which hangs until
              // connectionTimeoutMillis and then throws — matches the pattern
              // routes/datasets.ts already follows (only discovers schema when source_type is
              // 'sql').
              if (isSqlConnection) {
                const schemaColumns = await getTableSchema(connection, config.table_name, config.table_schema);
                logger.info({ columnCount: schemaColumns.length }, "[dataset_management.create] getTableSchema returned");
                columns = schemaColumns.map((c: { column_name: string; data_type: string }) => ({
                  column_name: c.column_name,
                  data_type: c.data_type,
                }));
              }
            }

            const dataset = await datasetRepository.create({
              name: data.name,
              description: data.description,
              // Connection.type and Dataset.source_type both use the singular
              // "googlesheet" everywhere else in the app (routes/connections.ts,
              // routes/datasets.ts, the frontend, and the existing rows in the DB).
              source_type: connection.type === "api" ? "api" : connection.type === "googlesheet" ? "googlesheet" : "sql",
              dataset_type: config.dataset_type,
              connection_id: connection.id,
              table_name: config.dataset_type === "physical" ? config.table_name : undefined,
              table_schema: config.dataset_type === "physical" ? config.table_schema ?? "public" : undefined,
              sql_query: config.dataset_type === "virtual" ? config.sql_query : undefined,
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

            const configResult = parseConfigInput(datasetConfigSchema, data?.config);
            if (!configResult.ok) return fail(configResult.error);
            const config = configResult.value;

            const updated = await datasetRepository.update(existing.id, {
              name: data?.name,
              description: data?.description,
              dataset_type: config?.dataset_type,
              connection_id: config?.connection_id,
              table_name: config?.dataset_type === "physical" ? config.table_name : undefined,
              table_schema: config?.dataset_type === "physical" ? config.table_schema : undefined,
              sql_query: config?.dataset_type === "virtual" ? config.sql_query : undefined,
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
