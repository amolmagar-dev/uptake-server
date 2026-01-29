// @ts-nocheck
/**
 * Connection Management Tool
 * Full CRUD operations for database connections
 * Refactored to use Prisma repositories
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { connectionRepository } from "../../db/repositories/index.js";
import { testConnection, closeConnection } from "../databaseConnector.js";
import { findConnection, getAvailableConnectionsList } from "./utils.js";

const connectionManagementDef = toolDefinition({
  name: "connection_management",
  description: `Manage database connections. Supported actions:
- list: List all connections (optionally filter by type)
- get: Get details of a specific connection
- create: Create a new database connection (supports postgresql, mysql, sqlite)
- update: Update an existing connection
- delete: Delete a connection
- test: Test if a connection is working
Use this tool whenever user wants to view, add, modify, or remove database connections.
You can use either connection ID or connection name for get, update, delete, and test actions.`,
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
          // Build filter condition for Prisma
          const whereCondition = filter !== "all" ? { type: filter } : {};

          const connections = await prisma.connection.findMany({
            where: whereCondition,
            select: {
              id: true,
              name: true,
              type: true,
              host: true,
              port: true,
              database_name: true,
              username: true,
              created_at: true,
            },
            orderBy: { created_at: "desc" },
          });

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

          const connection = await findConnection(connectionId);

          if (!connection) {
            return { 
              success: false, 
              error: "Connection not found", 
              connectionId,
              availableConnections: await getAvailableConnectionsList(),
            };
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

          const defaultPort = type === "postgresql" ? 5432 : type === "mysql" ? 3306 : null;

          // Test connection first
          const testConfig = {
            id: "test-connection",
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

          // Create connection using repository
          const newConnection = await connectionRepository.create({
            name,
            type,
            host: host || undefined,
            port: port || defaultPort || undefined,
            database_name: database_name || undefined,
            username: username || undefined,
            password: password || undefined,
            ssl: ssl ? 1 : 0,
          });

          return {
            success: true,
            action: "create",
            message: "Connection created and tested successfully",
            connection: {
              id: newConnection.id,
              name: newConnection.name,
              type: newConnection.type,
              host: newConnection.host,
              port: newConnection.port,
              database: newConnection.database_name,
              username: newConnection.username,
              ssl: newConnection.ssl === 1,
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

          const existing = await findConnection(connectionId);
          if (!existing) {
            return { 
              success: false, 
              error: "Connection not found", 
              connectionId,
              availableConnections: await getAvailableConnectionsList(),
            };
          }

          closeConnection(existing.id);

          const { name, type, host, port, database_name, username, password, ssl } = data;

          // Test new configuration
          const testConfig = {
            id: existing.id,
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

          // Update connection using repository
          await connectionRepository.update(existing.id, {
            name: name || undefined,
            type: type || undefined,
            host: host || undefined,
            port: port || undefined,
            database_name: database_name || undefined,
            username: username || undefined,
            password: password || undefined,
            ssl: ssl !== undefined ? (ssl ? 1 : 0) : undefined,
          });

          return {
            success: true,
            action: "update",
            message: "Connection updated successfully",
            connectionId: existing.id,
          };
        }

        case "delete": {
          if (!connectionId) {
            return { success: false, error: "connectionId is required for delete action" };
          }

          const existing = await findConnection(connectionId);
          if (!existing) {
            return { 
              success: false, 
              error: "Connection not found", 
              connectionId,
              availableConnections: await getAvailableConnectionsList(),
            };
          }

          closeConnection(existing.id);
          
          // Delete connection using repository
          await connectionRepository.delete(existing.id);

          return {
            success: true,
            action: "delete",
            message: `Connection "${existing.name}" deleted successfully`,
            connectionId: existing.id,
          };
        }

        case "test": {
          if (!connectionId) {
            return { success: false, error: "connectionId is required for test action" };
          }

          const connection = await findConnection(connectionId);
          if (!connection) {
            return { 
              success: false, 
              error: "Connection not found", 
              connectionId,
              availableConnections: await getAvailableConnectionsList(),
            };
          }

          const result = await testConnection(connection);

          return {
            success: result.success,
            action: "test",
            connectionId: connection.id,
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
