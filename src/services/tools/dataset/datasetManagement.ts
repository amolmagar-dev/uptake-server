/**
 * Dataset Management Tool
 * Full CRUD operations for datasets
 * Refactored to use LangChain.js
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "../../../db/client.js";
import { datasetRepository } from "../../../db/repositories/index.js";
import { executeQuery } from "../../databaseConnector.js";
import { findConnection, findDataset, getAvailableConnectionsList } from "../shared/utils.js";

const datasetDataSchema = z.object({
  name: z.string().optional().describe("Dataset name"),
  description: z.string().optional().describe("Dataset description"),
  dataset_type: z.enum(["physical", "virtual"]).optional().describe("Dataset type: physical (table) or virtual (SQL query)"),
  source_type: z.enum(["sql", "api", "googlesheet"]).optional().describe("Source type (default: sql)"),
  connection_id: z.string().optional().describe("Database connection ID"),
  table_name: z.string().optional().describe("Table name (for physical datasets)"),
  table_schema: z.string().optional().describe("Table schema (default: public)"),
  sql_query: z.string().optional().describe("SQL query (for virtual datasets)"),
  columns: z.array(z.object({
    name: z.string(),
    type: z.string(),
  })).optional().describe("Column definitions"),
});

const datasetManagementSchema = z.object({
  action: z.enum(["list", "get", "create", "update", "delete", "preview", "get_columns"]).describe("The action to perform"),
  datasetId: z.string().optional().describe("Dataset ID (required for get, update, delete, preview, get_columns)"),
  data: datasetDataSchema.optional().describe("Dataset data (for create and update actions)"),
  limit: z.number().optional().describe("Number of preview rows to return (default: 10, max: 100)"),
});

type DatasetManagementInput = z.infer<typeof datasetManagementSchema>;

async function executeDatasetManagement({ action, datasetId, data, limit = 10 }: DatasetManagementInput): Promise<string> {
  try {
    switch (action) {
      case "list": {
        const datasets = await prisma.dataset.findMany({
          include: {
            connection: { select: { name: true, type: true } },
            _count: { select: { charts: true } }
          },
          orderBy: { updated_at: "desc" },
        });

        return JSON.stringify({
          success: true,
          action: "list",
          totalDatasets: datasets.length,
          datasets: datasets.map((ds: any) => ({
            id: ds.id,
            name: ds.name,
            description: ds.description,
            datasetType: ds.dataset_type,
            sourceType: ds.source_type,
            connectionId: ds.connection_id,
            connectionName: ds.connection?.name,
            connectionType: ds.connection?.type,
            tableName: ds.table_name,
            tableSchema: ds.table_schema,
            chartCount: ds._count.charts,
            createdAt: ds.created_at,
            updatedAt: ds.updated_at,
          })),
          summary: {
            physical: datasets.filter((ds: any) => ds.dataset_type === "physical").length,
            virtual: datasets.filter((ds: any) => ds.dataset_type === "virtual").length,
          },
        });
      }

      case "get": {
        if (!datasetId) {
          return JSON.stringify({ success: false, error: "datasetId is required for get action" });
        }

        const datasetBase = await findDataset(datasetId);
        if (!datasetBase) {
          return JSON.stringify({ success: false, error: "Dataset not found", datasetId });
        }

        const dataset = await prisma.dataset.findUnique({
          where: { id: datasetBase.id },
          include: {
            connection: { select: { name: true, type: true } },
            charts: { select: { id: true, name: true, chart_type: true } }
          }
        });

        if (!dataset) {
          return JSON.stringify({ success: false, error: "Dataset not found", datasetId });
        }

        return JSON.stringify({
          success: true,
          action: "get",
          dataset: {
            id: dataset.id,
            name: dataset.name,
            description: dataset.description,
            datasetType: dataset.dataset_type,
            sourceType: dataset.source_type,
            connectionId: dataset.connection_id,
            connectionName: dataset.connection?.name,
            connectionType: dataset.connection?.type,
            tableName: dataset.table_name,
            tableSchema: dataset.table_schema,
            sqlQuery: dataset.sql_query,
            columns: dataset.columns ? JSON.parse(dataset.columns) : null,
            createdAt: dataset.created_at,
            updatedAt: dataset.updated_at,
            usedByCharts: dataset.charts,
          },
        });
      }

      case "create": {
        if (!data) {
          return JSON.stringify({ success: false, error: "data is required for create action" });
        }

        const { name, description, dataset_type = "physical", source_type = "sql", connection_id, table_name, table_schema = "public", sql_query, columns } = data;

        if (!name || !connection_id) {
          return JSON.stringify({
            success: false,
            error: "name and connection_id are required",
          });
        }

        const connection = await findConnection(connection_id);
        if (!connection) {
          return JSON.stringify({ 
            success: false, 
            error: "Connection not found", 
            connectionId: connection_id,
            availableConnections: await getAvailableConnectionsList(),
          });
        }

        if (dataset_type === "physical" && !table_name) {
          return JSON.stringify({ success: false, error: "table_name is required for physical datasets" });
        }
        if (dataset_type === "virtual" && !sql_query) {
          return JSON.stringify({ success: false, error: "sql_query is required for virtual datasets" });
        }

        const newDataset = await datasetRepository.create({
          name,
          description: description || undefined,
          dataset_type,
          source_type,
          connection_id: connection.id,
          table_name: table_name || undefined,
          table_schema: table_schema || "public",
          sql_query: sql_query || undefined,
          columns: columns ? JSON.stringify(columns) : undefined,
        });

        return JSON.stringify({
          success: true,
          action: "create",
          message: "Dataset created successfully",
          dataset: {
            id: newDataset.id,
            name: newDataset.name,
            description: newDataset.description,
            datasetType: newDataset.dataset_type,
            sourceType: newDataset.source_type,
            connectionId: connection.id,
            connectionName: connection.name,
            tableName: newDataset.table_name,
            tableSchema: newDataset.table_schema,
            sqlQuery: newDataset.sql_query,
          },
        });
      }

      case "update": {
        if (!datasetId) {
          return JSON.stringify({ success: false, error: "datasetId is required for update action" });
        }
        if (!data) {
          return JSON.stringify({ success: false, error: "data is required for update action" });
        }

        const existing = await findDataset(datasetId);
        if (!existing) {
          return JSON.stringify({ success: false, error: "Dataset not found", datasetId });
        }

        const { name, description, dataset_type, source_type, connection_id, table_name, table_schema, sql_query, columns } = data;

        let connectionToUse = existing.connection_id;
        if (connection_id) {
          const connection = await findConnection(connection_id);
          if (!connection) {
            return JSON.stringify({ 
              success: false, 
              error: "Connection not found", 
              connectionId: connection_id,
              availableConnections: await getAvailableConnectionsList(),
            });
          }
          connectionToUse = connection.id;
        }

        await datasetRepository.update(existing.id, {
          name: name || undefined,
          description: description !== undefined ? description : undefined,
          dataset_type: dataset_type || undefined,
          source_type: source_type || undefined,
          connection_id: connectionToUse || undefined,
          table_name: table_name || undefined,
          table_schema: table_schema || undefined,
          sql_query: sql_query || undefined,
          columns: columns ? JSON.stringify(columns) : undefined,
        });

        return JSON.stringify({
          success: true,
          action: "update",
          message: "Dataset updated successfully",
          datasetId: existing.id,
        });
      }

      case "delete": {
        if (!datasetId) {
          return JSON.stringify({ success: false, error: "datasetId is required for delete action" });
        }

        const existing = await findDataset(datasetId);
        if (!existing) {
          return JSON.stringify({ success: false, error: "Dataset not found", datasetId });
        }

        const chartCount = await datasetRepository.countChartsUsing(existing.id);
        if (chartCount > 0) {
          return JSON.stringify({
            success: false,
            error: `Cannot delete dataset - it is used by ${chartCount} chart(s)`,
            chartCount,
          });
        }

        await datasetRepository.delete(existing.id);

        return JSON.stringify({
          success: true,
          action: "delete",
          message: `Dataset "${existing.name}" deleted successfully`,
          datasetId: existing.id,
        });
      }

      case "preview": {
        if (!datasetId) {
          return JSON.stringify({ success: false, error: "datasetId is required for preview action" });
        }

        const dataset = await findDataset(datasetId);
        if (!dataset) {
          return JSON.stringify({ success: false, error: "Dataset not found", datasetId });
        }

        if (!dataset.connection_id) {
          return JSON.stringify({ success: false, error: "Dataset has no connection" });
        }

        const connection = await prisma.connection.findUnique({
          where: { id: dataset.connection_id }
        });
        if (!connection) {
          return JSON.stringify({ success: false, error: "Connection not found" });
        }

        let sqlQuery;
        if (dataset.dataset_type === "physical") {
          const schemaPrefix = dataset.table_schema ? `"${dataset.table_schema}".` : '';
          sqlQuery = `SELECT * FROM ${schemaPrefix}"${dataset.table_name}" LIMIT ${Math.min(limit, 100)}`;
        } else if (dataset.dataset_type === "virtual") {
          sqlQuery = `SELECT * FROM (${dataset.sql_query}) AS virtual_dataset LIMIT ${Math.min(limit, 100)}`;
        } else {
          return JSON.stringify({ success: false, error: "Unsupported dataset type for preview" });
        }

        const result = await executeQuery(connection, sqlQuery);

        return JSON.stringify({
          success: true,
          action: "preview",
          datasetId: dataset.id,
          datasetName: dataset.name,
          datasetType: dataset.dataset_type,
          data: result.rows,
          fields: result.fields,
          rowCount: result.rowCount,
          executionTime: `${result.executionTime}ms`,
        });
      }

      case "get_columns": {
        if (!datasetId) {
          return JSON.stringify({ success: false, error: "datasetId is required for get_columns action" });
        }

        const dataset = await findDataset(datasetId);
        if (!dataset) {
          return JSON.stringify({ success: false, error: "Dataset not found", datasetId });
        }

        if (dataset.columns) {
          return JSON.stringify({
            success: true,
            action: "get_columns",
            datasetId: dataset.id,
            datasetName: dataset.name,
            columns: JSON.parse(dataset.columns),
            source: "stored",
          });
        }

        if (!dataset.connection_id) {
          return JSON.stringify({ success: false, error: "Dataset has no connection" });
        }

        const connection = await prisma.connection.findUnique({
          where: { id: dataset.connection_id }
        });
        if (!connection) {
          return JSON.stringify({ success: false, error: "Connection not found" });
        }

        let sqlQuery;
        if (dataset.dataset_type === "physical") {
          const schemaPrefix = dataset.table_schema ? `"${dataset.table_schema}".` : '';
          sqlQuery = `SELECT * FROM ${schemaPrefix}"${dataset.table_name}" LIMIT 1`;
        } else if (dataset.dataset_type === "virtual") {
          sqlQuery = `SELECT * FROM (${dataset.sql_query}) AS virtual_dataset LIMIT 1`;
        } else {
          return JSON.stringify({ success: false, error: "Unsupported dataset type" });
        }

        const result = await executeQuery(connection, sqlQuery);

        return JSON.stringify({
          success: true,
          action: "get_columns",
          datasetId: dataset.id,
          datasetName: dataset.name,
          columns: result.fields,
          source: "inferred",
        });
      }

      default:
        return JSON.stringify({ success: false, error: `Unknown action: ${action}` });
    }
  } catch (error: any) {
    console.error("Dataset management error:", error);
    return JSON.stringify({
      success: false,
      error: error.message || "Dataset management failed",
      action,
    });
  }
}

const datasetManagement = tool(executeDatasetManagement, {
  name: "dataset_management",
  description: `Manage datasets - data source abstractions for charts. Supported actions:
- list: List all datasets with their configurations
- get: Get details of a specific dataset (metadata only)
- create: Create a new dataset (physical table or virtual SQL query)
- update: Update an existing dataset
- delete: Delete a dataset
- preview: Preview data from a dataset
- get_columns: Get column information for a dataset

Datasets are the data layer between connections and charts:
- Physical datasets: Reference a table directly
- Virtual datasets: Use a custom SQL query

You can use either dataset ID or dataset name for get, update, delete, preview, and get_columns actions.`,
  schema: datasetManagementSchema,
});

export default datasetManagement;
