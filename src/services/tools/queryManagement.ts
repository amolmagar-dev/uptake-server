// @ts-nocheck
/**
 * Query Management Tool
 * Full CRUD operations for saved SQL queries
 * Refactored to use Prisma repositories
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { savedQueryRepository } from "../../db/repositories/index.js";
import { executeQuery } from "../databaseConnector.js";
import { findConnection, findSavedQuery, getAvailableConnectionsList } from "./utils.js";

const queryManagementDef = toolDefinition({
  name: "query_management",
  description: `Manage saved SQL queries. Supported actions:
- list: List all saved queries
- get: Get details of a specific saved query
- create: Save a new SQL query for reuse
- update: Update an existing saved query
- delete: Delete a saved query
- execute: Execute a saved query and return results
Use this when user wants to save, modify, or reuse SQL queries.
Saved queries can be attached to charts for visualization.
You can use either query ID or query name for get, update, delete, and execute actions.`,
  inputSchema: z.object({
    action: z.enum(["list", "get", "create", "update", "delete", "execute"]).describe("The action to perform"),
    queryId: z.string().optional().describe("Query ID (required for get, update, delete, execute)"),
    data: z
      .object({
        name: z.string().optional().describe("Query name"),
        description: z.string().optional().describe("Query description"),
        sql_query: z.string().optional().describe("The SQL query text"),
        connection_id: z.string().optional().describe("Database connection ID to run this query on"),
      })
      .optional()
      .describe("Query data (for create and update actions)"),
  }),
});

const queryManagement = queryManagementDef.server(async ({ action, queryId, data }) => {
  try {
    switch (action) {
      case "list": {
        const queries = await prisma.savedQuery.findMany({
          include: {
            connection: { select: { name: true, type: true } },
            creator: { select: { name: true } }
          },
          orderBy: { updated_at: "desc" },
        });

        return {
          success: true,
          action: "list",
          totalQueries: queries.length,
          queries: queries.map((q) => ({
            id: q.id,
            name: q.name,
            description: q.description,
            sqlQuery: q.sql_query,
            connectionId: q.connection_id,
            connectionName: q.connection?.name,
            connectionType: q.connection?.type,
            createdBy: q.creator?.name,
            createdAt: q.created_at,
            updatedAt: q.updated_at,
          })),
        };
      }

      case "get": {
        if (!queryId) {
          return { success: false, error: "queryId is required for get action" };
        }

        const queryBase = await findSavedQuery(queryId);
        if (!queryBase) {
          return { success: false, error: "Query not found", queryId };
        }

        const query = await prisma.savedQuery.findUnique({
          where: { id: queryBase.id },
          include: {
            connection: { select: { name: true, type: true } }
          }
        });

        if (!query) {
          return { success: false, error: "Query not found", queryId };
        }

        // Check if query is used by any charts
        const usedByCharts = await prisma.chart.findMany({
          where: { query_id: query.id },
          select: { id: true, name: true }
        });

        return {
          success: true,
          action: "get",
          query: {
            id: query.id,
            name: query.name,
            description: query.description,
            sqlQuery: query.sql_query,
            connectionId: query.connection_id,
            connectionName: query.connection?.name,
            connectionType: query.connection?.type,
            createdAt: query.created_at,
            updatedAt: query.updated_at,
            usedByCharts,
          },
        };
      }

      case "create": {
        if (!data) {
          return { success: false, error: "data is required for create action" };
        }

        const { name, description, sql_query, connection_id } = data;

        if (!name || !sql_query || !connection_id) {
          return {
            success: false,
            error: "name, sql_query, and connection_id are required",
          };
        }

        // Verify connection exists - supports ID or name
        const connection = await findConnection(connection_id);
        if (!connection) {
          return { 
            success: false, 
            error: "Connection not found", 
            connectionId: connection_id,
            availableConnections: await getAvailableConnectionsList(),
          };
        }

        // Create query using repository
        const newQuery = await savedQueryRepository.create({
          name,
          description: description || undefined,
          sql_query,
          connection_id: connection.id,
        });

        return {
          success: true,
          action: "create",
          message: "Query saved successfully",
          query: {
            id: newQuery.id,
            name: newQuery.name,
            description: newQuery.description,
            sqlQuery: newQuery.sql_query,
            connectionId: connection.id,
            connectionName: connection.name,
          },
        };
      }

      case "update": {
        if (!queryId) {
          return { success: false, error: "queryId is required for update action" };
        }
        if (!data) {
          return { success: false, error: "data is required for update action" };
        }

        const existing = await findSavedQuery(queryId);
        if (!existing) {
          return { success: false, error: "Query not found", queryId };
        }

        const { name, description, sql_query, connection_id } = data;

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

        // Update query using repository
        await savedQueryRepository.update(existing.id, {
          name: name || undefined,
          description: description !== undefined ? description : undefined,
          sql_query: sql_query || undefined,
          connection_id: connectionToUse || undefined,
        });

        return {
          success: true,
          action: "update",
          message: "Query updated successfully",
          queryId: existing.id,
        };
      }

      case "delete": {
        if (!queryId) {
          return { success: false, error: "queryId is required for delete action" };
        }

        const existing = await findSavedQuery(queryId);
        if (!existing) {
          return { success: false, error: "Query not found", queryId };
        }

        // Check if any charts use this query
        const chartsUsingQuery = await prisma.chart.findMany({
          where: { query_id: existing.id },
          select: { id: true, name: true }
        });
        
        if (chartsUsingQuery.length > 0) {
          return {
            success: false,
            error: "Cannot delete query - it is used by charts",
            usedByCharts: chartsUsingQuery,
          };
        }

        // Delete query using repository
        await savedQueryRepository.delete(existing.id);

        return {
          success: true,
          action: "delete",
          message: `Query "${existing.name}" deleted successfully`,
          queryId: existing.id,
        };
      }

      case "execute": {
        if (!queryId) {
          return { success: false, error: "queryId is required for execute action" };
        }

        const savedQuery = await findSavedQuery(queryId);
        if (!savedQuery) {
          return { success: false, error: "Query not found", queryId };
        }

        const connection = await findConnection(savedQuery.connection_id);
        if (!connection) {
          return { success: false, error: "Connection not found" };
        }

        const result = await executeQuery(connection, savedQuery.sql_query);

        return {
          success: true,
          action: "execute",
          queryId: savedQuery.id,
          queryName: savedQuery.name,
          connectionName: connection.name,
          data: result.rows,
          fields: result.fields,
          rowCount: result.rowCount,
          executionTime: `${result.executionTime}ms`,
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (error) {
    console.error("Query management error:", error);
    return {
      success: false,
      error: error.message || "Query management failed",
      action,
    };
  }
});

export default queryManagement;
