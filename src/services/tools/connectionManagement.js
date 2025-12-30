/**
 * Connection Management Tool
 * Full CRUD operations for database connections
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import db from "../../config/database.js";
import { testConnection, closeConnection } from "../databaseConnector.js";

const connectionManagementDef = toolDefinition({
  name: "connection_management",
  description: `Manage database connections. Supported actions:
- list: List all connections (optionally filter by type)
- get: Get details of a specific connection
- create: Create a new database connection (supports postgresql, mysql, sqlite)
- update: Update an existing connection
- delete: Delete a connection
- test: Test if a connection is working
Use this tool whenever user wants to view, add, modify, or remove database connections.`,
  inputSchema: z.object({
    action: z.enum(["list", "get", "create", "update", "delete", "test"]).describe("The action to perform"),
    connectionId: z.string().optional().describe("Connection ID (required for get, update, delete, test)"),
    filter: z
      .enum(["all", "mysql", "postgresql", "sqlite"])
      .optional()
      .describe("Filter connections by type (for list action)"),
    data: z
      .object({
        name: z.string().optional().describe("Connection name"),
        type: z.enum(["postgresql", "mysql", "sqlite"]).optional().describe("Database type"),
        host: z.string().optional().describe("Database host"),
        port: z.number().optional().describe("Database port"),
        database_name: z.string().optional().describe("Database name or file path for SQLite"),
        username: z.string().optional().describe("Database username"),
        password: z.string().optional().describe("Database password"),
        ssl: z.boolean().optional().describe("Enable SSL connection"),
      })
      .optional()
      .describe("Connection data (for create and update actions)"),
  }),
});

const connectionManagement = connectionManagementDef.server(
  async ({ action, connectionId, filter = "all", data }) => {
    try {
      switch (action) {
        case "list": {
          let query =
            "SELECT id, name, type, host, port, database_name, username, created_at FROM connections";
          let params = [];

          if (filter !== "all") {
            query += " WHERE type = ?";
            params = [filter];
          }
          query += " ORDER BY created_at DESC";

          const connections = db.prepare(query).all(...params);

          return {
            success: true,
            action: "list",
            filter: filter === "all" ? null : filter,
            totalConnections: connections.length,
            connections: connections.map((c) => ({
              id: c.id,
              name: c.name,
              type: c.type,
              host: c.host,
              port: c.port,
              database: c.database_name,
              username: c.username,
              createdAt: c.created_at,
            })),
            summary: {
              mysql: connections.filter((c) => c.type === "mysql").length,
              postgresql: connections.filter((c) => c.type === "postgresql").length,
              sqlite: connections.filter((c) => c.type === "sqlite").length,
            },
          };
        }

        case "get": {
          if (!connectionId) {
            return { success: false, error: "connectionId is required for get action" };
          }

          const connection = db
            .prepare(
              "SELECT id, name, type, host, port, database_name, username, ssl, created_at, updated_at FROM connections WHERE id = ?"
            )
            .get(connectionId);

          if (!connection) {
            return { success: false, error: "Connection not found", connectionId };
          }

          return {
            success: true,
            action: "get",
            connection: {
              id: connection.id,
              name: connection.name,
              type: connection.type,
              host: connection.host,
              port: connection.port,
              database: connection.database_name,
              username: connection.username,
              ssl: connection.ssl === 1,
              createdAt: connection.created_at,
              updatedAt: connection.updated_at,
            },
          };
        }

        case "create": {
          if (!data) {
            return { success: false, error: "data is required for create action" };
          }

          const { name, type, host, port, database_name, username, password, ssl } = data;

          if (!name || !type) {
            return { success: false, error: "name and type are required" };
          }

          if (type !== "sqlite" && (!host || !database_name)) {
            return { success: false, error: "host and database_name are required for non-SQLite connections" };
          }

          const newConnectionId = uuidv4();
          const defaultPort = type === "postgresql" ? 5432 : type === "mysql" ? 3306 : null;

          // Test connection first
          const testConfig = {
            id: newConnectionId,
            type,
            host: host || "",
            port: port || defaultPort,
            database_name: database_name || "",
            username: username || "",
            password: password || "",
            ssl: ssl ? 1 : 0,
          };

          const testResult = await testConnection(testConfig);
          if (!testResult.success) {
            return {
              success: false,
              error: `Connection test failed: ${testResult.message}`,
              hint: "Please verify your connection details",
            };
          }

          // Save connection
          db.prepare(
            `INSERT INTO connections (id, name, type, host, port, database_name, username, password, ssl)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            newConnectionId,
            name,
            type,
            host || null,
            port || defaultPort,
            database_name || null,
            username || null,
            password || null,
            ssl ? 1 : 0
          );

          return {
            success: true,
            action: "create",
            message: "Connection created and tested successfully",
            connection: {
              id: newConnectionId,
              name,
              type,
              host,
              port: port || defaultPort,
              database: database_name,
              username,
              ssl: ssl || false,
            },
          };
        }

        case "update": {
          if (!connectionId) {
            return { success: false, error: "connectionId is required for update action" };
          }
          if (!data) {
            return { success: false, error: "data is required for update action" };
          }

          const existing = db.prepare("SELECT * FROM connections WHERE id = ?").get(connectionId);
          if (!existing) {
            return { success: false, error: "Connection not found", connectionId };
          }

          closeConnection(connectionId);

          const { name, type, host, port, database_name, username, password, ssl } = data;

          // Test new configuration
          const testConfig = {
            id: connectionId,
            type: type || existing.type,
            host: host || existing.host,
            port: port || existing.port,
            database_name: database_name || existing.database_name,
            username: username || existing.username,
            password: password || existing.password,
            ssl: ssl !== undefined ? (ssl ? 1 : 0) : existing.ssl,
          };

          const testResult = await testConnection(testConfig);
          if (!testResult.success) {
            return {
              success: false,
              error: `Connection test failed: ${testResult.message}`,
            };
          }

          // Update connection
          db.prepare(
            `UPDATE connections SET 
              name = ?, type = ?, host = ?, port = ?, database_name = ?,
              username = ?, password = COALESCE(?, password), ssl = ?, 
              updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).run(
            name || existing.name,
            type || existing.type,
            host || existing.host,
            port || existing.port,
            database_name || existing.database_name,
            username || existing.username,
            password,
            ssl !== undefined ? (ssl ? 1 : 0) : existing.ssl,
            connectionId
          );

          return {
            success: true,
            action: "update",
            message: "Connection updated successfully",
            connectionId,
          };
        }

        case "delete": {
          if (!connectionId) {
            return { success: false, error: "connectionId is required for delete action" };
          }

          const existing = db.prepare("SELECT name FROM connections WHERE id = ?").get(connectionId);
          if (!existing) {
            return { success: false, error: "Connection not found", connectionId };
          }

          closeConnection(connectionId);
          db.prepare("DELETE FROM connections WHERE id = ?").run(connectionId);

          return {
            success: true,
            action: "delete",
            message: `Connection "${existing.name}" deleted successfully`,
            connectionId,
          };
        }

        case "test": {
          if (!connectionId) {
            return { success: false, error: "connectionId is required for test action" };
          }

          const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(connectionId);
          if (!connection) {
            return { success: false, error: "Connection not found", connectionId };
          }

          const result = await testConnection(connection);

          return {
            success: result.success,
            action: "test",
            connectionId,
            connectionName: connection.name,
            message: result.message,
            databaseType: connection.type,
          };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      console.error("Connection management error:", error);
      return {
        success: false,
        error: error.message || "Connection management failed",
        action,
      };
    }
  }
);

export default connectionManagement;

