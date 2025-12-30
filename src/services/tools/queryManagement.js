/**
 * Query Management Tool
 * Full CRUD operations for saved SQL queries
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import db from "../../config/database.js";
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
        const queries = db
          .prepare(
            `SELECT sq.*, c.name as connection_name, c.type as connection_type,
                    u.name as created_by_name
             FROM saved_queries sq
             LEFT JOIN connections c ON sq.connection_id = c.id
             LEFT JOIN users u ON sq.created_by = u.id
             ORDER BY sq.updated_at DESC`
          )
          .all();

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
            connectionName: q.connection_name,
            connectionType: q.connection_type,
            createdBy: q.created_by_name,
            createdAt: q.created_at,
            updatedAt: q.updated_at,
          })),
        };
      }

      case "get": {
        if (!queryId) {
          return { success: false, error: "queryId is required for get action" };
        }

        const queryBase = findSavedQuery(queryId);
        if (!queryBase) {
          return { success: false, error: "Query not found", queryId };
        }

        const query = db
          .prepare(
            `SELECT sq.*, c.name as connection_name, c.type as connection_type
             FROM saved_queries sq
             LEFT JOIN connections c ON sq.connection_id = c.id
             WHERE sq.id = ?`
          )
          .get(queryBase.id);

        if (!query) {
          return { success: false, error: "Query not found", queryId };
        }

        // Check if query is used by any charts
        const usedByCharts = db
          .prepare("SELECT id, name FROM charts WHERE query_id = ?")
          .all(queryId);

        return {
          success: true,
          action: "get",
          query: {
            id: query.id,
            name: query.name,
            description: query.description,
            sqlQuery: query.sql_query,
            connectionId: query.connection_id,
            connectionName: query.connection_name,
            connectionType: query.connection_type,
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
        const connection = findConnection(connection_id);
        if (!connection) {
          return { 
            success: false, 
            error: "Connection not found", 
            connectionId: connection_id,
            availableConnections: getAvailableConnectionsList(),
          };
        }

        const newQueryId = uuidv4();

        db.prepare(
          `INSERT INTO saved_queries (id, name, description, sql_query, connection_id)
           VALUES (?, ?, ?, ?, ?)`
        ).run(newQueryId, name, description || null, sql_query, connection.id);

        return {
          success: true,
          action: "create",
          message: "Query saved successfully",
          query: {
            id: newQueryId,
            name,
            description,
            sqlQuery: sql_query,
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

        const existing = findSavedQuery(queryId);
        if (!existing) {
          return { success: false, error: "Query not found", queryId };
        }

        const { name, description, sql_query, connection_id } = data;

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

        db.prepare(
          `UPDATE saved_queries SET 
            name = ?, description = ?, sql_query = ?, connection_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(
          name || existing.name,
          description !== undefined ? description : existing.description,
          sql_query || existing.sql_query,
          connectionToUse,
          existing.id
        );

        return {
          success: true,
          action: "update",
          message: "Query updated successfully",
          queryId,
        };
      }

      case "delete": {
        if (!queryId) {
          return { success: false, error: "queryId is required for delete action" };
        }

        const existing = findSavedQuery(queryId);
        if (!existing) {
          return { success: false, error: "Query not found", queryId };
        }

        // Check if any charts use this query
        const chartsUsingQuery = db.prepare("SELECT id, name FROM charts WHERE query_id = ?").all(existing.id);
        if (chartsUsingQuery.length > 0) {
          return {
            success: false,
            error: "Cannot delete query - it is used by charts",
            usedByCharts: chartsUsingQuery,
          };
        }

        db.prepare("DELETE FROM saved_queries WHERE id = ?").run(existing.id);

        return {
          success: true,
          action: "delete",
          message: `Query "${existing.name}" deleted successfully`,
          queryId,
        };
      }

      case "execute": {
        if (!queryId) {
          return { success: false, error: "queryId is required for execute action" };
        }

        const savedQuery = findSavedQuery(queryId);
        if (!savedQuery) {
          return { success: false, error: "Query not found", queryId };
        }

        const connection = findConnection(savedQuery.connection_id);
        if (!connection) {
          return { success: false, error: "Connection not found" };
        }

        const result = await executeQuery(connection, savedQuery.sql_query);

        return {
          success: true,
          action: "execute",
          queryId,
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

