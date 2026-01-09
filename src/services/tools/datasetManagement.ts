// @ts-nocheck
/**
 * Dataset Management Tool
 * Full CRUD operations for datasets
 * Datasets are data source abstractions used by charts
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { datasetRepository } from "../../db/repositories/index.js";
import { executeQuery } from "../databaseConnector.js";
import { findConnection, findDataset, getAvailableConnectionsList } from "./utils.js";

const datasetManagementDef = toolDefinition({
  name: "dataset_management",
  description: `Manage datasets - data source abstractions for charts. Supported actions:
- list: List all datasets with their configurations
- get: Get details of a specific dataset (metadata only)
- create: Create a new dataset (physical table or virtual SQL query)
- update: Update an existing dataset (can change type, columns, query, etc.)
- delete: Delete a dataset
- get_columns: Get column information for a dataset

⚠️ IMPORTANT: DO NOT use the preview action to show data to users!
- If the user wants to SEE/DISPLAY/PREVIEW data, use the database_operations tool instead
- The preview action is for internal validation only, not for displaying data to users
- Only database_operations creates interactive data widgets

Datasets are the data layer between connections and charts:
- Physical datasets: Reference a table directly (SELECT * FROM table)
- Virtual datasets: Use a custom SQL query (can SELECT specific columns, add WHERE, JOIN, etc.)

IMPORTANT: You CAN update existing datasets! To modify which columns are shown:
1. Update the dataset_type from "physical" to "virtual"
2. Set a custom sql_query like "SELECT col1, col2, col3 FROM table_name" (excluding unwanted columns)

This effectively creates a filtered view of the data without creating a new dataset.

You can use either dataset ID or dataset name for get, update, delete, and get_columns actions.

Supports Nunjucks templating in virtual dataset SQL queries for dynamic filtering:
- Variables: {{ filters.name }}
- Filters:
  - safely escape strings: {{ filters.val | safe_string }}
  - format lists for IN clauses: {{ filters.vals | safe_list }}
  - validate numbers: {{ filters.num | safe_number }}
  - validate dates: {{ filters.date | safe_date }}
- Example: SELECT * FROM users WHERE status = '{{ filters.status | safe_string }}' AND id IN ({{ filters.ids | safe_list }})`,
  inputSchema: z.object({
    action: z.enum(["list", "get", "create", "update", "delete", "preview", "get_columns"]).describe("The action to perform"),
    datasetId: z.string().optional().describe("Dataset ID (required for get, update, delete, preview, get_columns)"),
    data: z
      .object({
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
      })
      .optional()
      .describe("Dataset data (for create and update actions)"),
    limit: z.number().optional().describe("Number of preview rows to return (default: 10, max: 100)"),
  }),
});

const datasetManagement = datasetManagementDef.server(async ({ action, datasetId, data, limit = 10 }) => {
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

        return {
          success: true,
          action: "list",
          totalDatasets: datasets.length,
          datasets: datasets.map((ds) => ({
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
            physical: datasets.filter((ds) => ds.dataset_type === "physical").length,
            virtual: datasets.filter((ds) => ds.dataset_type === "virtual").length,
            sql: datasets.filter((ds) => ds.source_type === "sql").length,
            api: datasets.filter((ds) => ds.source_type === "api").length,
            googlesheet: datasets.filter((ds) => ds.source_type === "googlesheet").length,
          },
        };
      }

      case "get": {
        if (!datasetId) {
          return { success: false, error: "datasetId is required for get action" };
        }

        const datasetBase = await findDataset(datasetId);
        if (!datasetBase) {
          return { success: false, error: "Dataset not found", datasetId };
        }

        const dataset = await prisma.dataset.findUnique({
          where: { id: datasetBase.id },
          include: {
            connection: { select: { name: true, type: true } },
            charts: { select: { id: true, name: true, chart_type: true } }
          }
        });

        if (!dataset) {
          return { success: false, error: "Dataset not found", datasetId };
        }

        return {
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
        };
      }

      case "create": {
        if (!data) {
          return { success: false, error: "data is required for create action" };
        }

        const { name, description, dataset_type = "physical", source_type = "sql", connection_id, table_name, table_schema = "public", sql_query, columns } = data;

        if (!name || !connection_id) {
          return {
            success: false,
            error: "name and connection_id are required",
          };
        }

        // Verify connection exists
        const connection = await findConnection(connection_id);
        if (!connection) {
          return { 
            success: false, 
            error: "Connection not found", 
            connectionId: connection_id,
            availableConnections: await getAvailableConnectionsList(),
          };
        }

        // Validate based on dataset type
        if (dataset_type === "physical" && !table_name) {
          return { success: false, error: "table_name is required for physical datasets" };
        }
        if (dataset_type === "virtual" && !sql_query) {
          return { success: false, error: "sql_query is required for virtual datasets" };
        }

        // Create dataset
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

        return {
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
        };
      }

      case "update": {
        if (!datasetId) {
          return { success: false, error: "datasetId is required for update action" };
        }
        if (!data) {
          return { success: false, error: "data is required for update action" };
        }

        const existing = await findDataset(datasetId);
        if (!existing) {
          return { success: false, error: "Dataset not found", datasetId };
        }

        const { name, description, dataset_type, source_type, connection_id, table_name, table_schema, sql_query, columns } = data;

        // If changing connection, verify it exists
        let connectionToUse = existing.connection_id;
        if (connection_id) {
          const connection = await findConnection(connection_id);
          if (!connection) {
            return { 
              success: false, 
              error: "Connection not found", 
              connectionId: connection_id,
              availableConnections: await getAvailableConnectionsList(),
            };
          }
          connectionToUse = connection.id;
        }

        // Update dataset
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

        return {
          success: true,
          action: "update",
          message: "Dataset updated successfully",
          datasetId: existing.id,
        };
      }

      case "delete": {
        if (!datasetId) {
          return { success: false, error: "datasetId is required for delete action" };
        }

        const existing = await findDataset(datasetId);
        if (!existing) {
          return { success: false, error: "Dataset not found", datasetId };
        }

        // Check if any charts use this dataset
        const chartCount = await datasetRepository.countChartsUsing(existing.id);
        if (chartCount > 0) {
          return {
            success: false,
            error: `Cannot delete dataset - it is used by ${chartCount} chart(s)`,
            chartCount,
          };
        }

        // Delete dataset
        await datasetRepository.delete(existing.id);

        return {
          success: true,
          action: "delete",
          message: `Dataset "${existing.name}" deleted successfully`,
          datasetId: existing.id,
        };
      }

      case "preview": {
        if (!datasetId) {
          return { success: false, error: "datasetId is required for preview action" };
        }

        const dataset = await findDataset(datasetId);
        if (!dataset) {
          return { success: false, error: "Dataset not found", datasetId };
        }

        const connection = await prisma.connection.findUnique({
          where: { id: dataset.connection_id }
        });
        if (!connection) {
          return { success: false, error: "Connection not found" };
        }

        // Build SQL query based on dataset type
        let sqlQuery;
        if (dataset.dataset_type === "physical") {
          const schemaPrefix = dataset.table_schema ? `"${dataset.table_schema}".` : '';
          sqlQuery = `SELECT * FROM ${schemaPrefix}"${dataset.table_name}" LIMIT ${Math.min(limit, 100)}`;
        } else if (dataset.dataset_type === "virtual") {
          // Wrap virtual query to add limit
          sqlQuery = `SELECT * FROM (${dataset.sql_query}) AS virtual_dataset LIMIT ${Math.min(limit, 100)}`;
        } else {
          return { success: false, error: "Unsupported dataset type for preview" };
        }

        const result = await executeQuery(connection, sqlQuery);

        return {
          success: true,
          action: "preview",
          datasetId: dataset.id,
          datasetName: dataset.name,
          datasetType: dataset.dataset_type,
          data: result.rows,
          fields: result.fields,
          rowCount: result.rowCount,
          executionTime: `${result.executionTime}ms`,
        };
      }

      case "get_columns": {
        if (!datasetId) {
          return { success: false, error: "datasetId is required for get_columns action" };
        }

        const dataset = await findDataset(datasetId);
        if (!dataset) {
          return { success: false, error: "Dataset not found", datasetId };
        }

        // If columns are already stored, return them
        if (dataset.columns) {
          return {
            success: true,
            action: "get_columns",
            datasetId: dataset.id,
            datasetName: dataset.name,
            columns: JSON.parse(dataset.columns),
            source: "stored",
          };
        }

        // Otherwise, infer from a sample query
        const connection = await prisma.connection.findUnique({
          where: { id: dataset.connection_id }
        });
        if (!connection) {
          return { success: false, error: "Connection not found" };
        }

        let sqlQuery;
        if (dataset.dataset_type === "physical") {
          const schemaPrefix = dataset.table_schema ? `"${dataset.table_schema}".` : '';
          sqlQuery = `SELECT * FROM ${schemaPrefix}"${dataset.table_name}" LIMIT 1`;
        } else if (dataset.dataset_type === "virtual") {
          sqlQuery = `SELECT * FROM (${dataset.sql_query}) AS virtual_dataset LIMIT 1`;
        } else {
          return { success: false, error: "Unsupported dataset type" };
        }

        const result = await executeQuery(connection, sqlQuery);

        return {
          success: true,
          action: "get_columns",
          datasetId: dataset.id,
          datasetName: dataset.name,
          columns: result.fields,
          source: "inferred",
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (error) {
    console.error("Dataset management error:", error);
    return {
      success: false,
      error: error.message || "Dataset management failed",
      action,
    };
  }
});

export default datasetManagement;
