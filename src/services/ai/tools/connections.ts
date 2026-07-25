import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { connectionRepository } from "../../../db/repositories/index.js";
import { requireRole, toolOk as ok, toolFail as fail } from "./shared.js";
import { testConnection } from "../../databaseConnector.js";
import { testApiConnection } from "../../apiConnector.js";
import { testGoogleSheetsConnection } from "../../googleSheetsConnector.js";
import type { UserProfile } from "../../../types/database.js";

const sqlConnectionSchema = (type: "postgresql" | "mysql" | "sqlite") =>
  z.object({
    type: z.literal(type),
    host: z.string().optional().describe("Database host"),
    port: z.number().int().optional().describe("Database port"),
    database_name: z.string().optional().describe("Database name"),
    username: z.string().optional().describe("Database username"),
    password: z.string().optional().describe("Database password"),
    ssl: z.boolean().optional().describe("Whether to require SSL"),
  });

const apiConnectionSchema = z.object({
  type: z.literal("api"),
  url: z.string().optional().describe("API endpoint URL"),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).optional(),
  headers: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .optional()
    .describe("HTTP headers as key/value pairs"),
  auth_type: z.enum(["none", "api_key", "bearer", "basic"]).optional(),
  api_key: z.string().optional(),
  api_key_name: z.string().optional(),
  api_key_location: z.enum(["header", "query"]).optional(),
  bearer_token: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  body: z.string().optional().describe("Raw JSON string request body for POST/PUT/PATCH"),
  data_path: z.string().optional().describe("Dot-notation path to the data array in the response, e.g. data.items"),
});

const googleSheetsConnectionSchema = z.object({
  type: z.literal("googlesheets"),
  spreadsheet_id: z.string().describe("Spreadsheet ID or URL"),
  sheet_name: z.string().optional(),
  range: z.string().optional(),
  api_key: z.string().optional(),
});

const connectionConfigSchema = z.discriminatedUnion("type", [
  sqlConnectionSchema("postgresql"),
  sqlConnectionSchema("mysql"),
  sqlConnectionSchema("sqlite"),
  apiConnectionSchema,
  googleSheetsConnectionSchema,
]);

const connectionManagementSchema = z.object({
  action: z.enum(["list", "get", "create", "update", "delete", "test"]).describe("The action to perform"),
  connectionId: z.string().optional().describe("Connection ID, required for get/update/delete/test"),
  data: z
    .object({
      name: z.string().optional(),
      config: connectionConfigSchema.optional(),
    })
    .optional(),
});

function toStoredConnectionFields(config: z.infer<typeof connectionConfigSchema>) {
  if (config.type === "postgresql" || config.type === "mysql" || config.type === "sqlite") {
    return {
      type: config.type,
      host: config.host,
      port: config.port,
      database_name: config.database_name,
      username: config.username,
      password: config.password,
      ssl: config.ssl ? 1 : 0,
      config: undefined,
    };
  }
  if (config.type === "api") {
    const headers = config.headers
      ? Object.fromEntries(config.headers.map((h) => [h.key, h.value]))
      : undefined;
    return {
      type: "api",
      config: JSON.stringify({ ...config, headers, type: undefined }),
    };
  }
  return { type: "googlesheets", config: JSON.stringify({ ...config, type: undefined }) };
}

export function createConnectionManagementTool(user: UserProfile) {
  return tool(
    async (input: z.infer<typeof connectionManagementSchema>) => {
      const { action, connectionId, data } = input;
      try {
        switch (action) {
          case "list": {
            const connections = await connectionRepository.findAll();
            return ok({ action, connections: connections.map((c) => ({ id: c.id, name: c.name, type: c.type })) });
          }
          case "get": {
            if (!connectionId) return fail("connectionId is required for get");
            const connection = await connectionRepository.findById(connectionId);
            if (!connection) return fail(`Connection not found: ${connectionId}`);
            return ok({ action, connection: { id: connection.id, name: connection.name, type: connection.type } });
          }
          case "create": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!data?.name || !data.config) return fail("name and config are required to create a connection");
            if (data.config.type === "api" && !data.config.url) return fail("url is required for api connections");
            const fields = toStoredConnectionFields(data.config);
            const connection = await connectionRepository.create({ name: data.name, ...fields, created_by: user.id } as any);
            return ok({ action, connection: { id: connection.id, name: connection.name, type: connection.type } });
          }
          case "update": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!connectionId) return fail("connectionId is required for update");
            const existing = await connectionRepository.findById(connectionId);
            if (!existing) return fail(`Connection not found: ${connectionId}`);
            if (data?.config && data.config.type === "api" && !data.config.url) return fail("url is required for api connections");
            const fields = data?.config ? toStoredConnectionFields(data.config) : {};
            const updated = await connectionRepository.update(existing.id, { name: data?.name, ...fields } as any);
            return ok({ action, connection: { id: updated.id, name: updated.name, type: updated.type } });
          }
          case "delete": {
            const roleCheck = requireRole(user, ["admin"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!connectionId) return fail("connectionId is required for delete");
            const existing = await connectionRepository.findById(connectionId);
            if (!existing) return fail(`Connection not found: ${connectionId}`);
            await connectionRepository.delete(existing.id);
            return ok({ action, connectionId: existing.id });
          }
          case "test": {
            if (!connectionId) return fail("connectionId is required for test");
            const connection = await connectionRepository.findById(connectionId);
            if (!connection) return fail(`Connection not found: ${connectionId}`);
            const result =
              connection.type === "api"
                ? await testApiConnection(connection)
                : connection.type === "googlesheets"
                ? await testGoogleSheetsConnection(connection)
                : await testConnection(connection);
            return ok({ action, connectionId: connection.id, testResult: result });
          }
          default:
            return fail(`Unknown action: ${action}`);
        }
      } catch (err: any) {
        return fail(err.message || "An error occurred during connection management");
      }
    },
    {
      name: "connection_management",
      description:
        "Manage database/API/Google Sheets connections. Actions: list, get, create, update, delete, test. " +
        "config is discriminated by type: postgresql/mysql/sqlite need host+database_name; api needs url; googlesheets needs spreadsheet_id. " +
        "Creating and updating requires admin or editor; deleting requires admin.",
      schema: connectionManagementSchema,
    }
  );
}

export function createListConnectionsTool(_user: UserProfile) {
  return tool(
    async () => {
      const connections = await connectionRepository.findAll();
      return JSON.stringify({
        success: true,
        totalConnections: connections.length,
        connections: connections.map((c) => ({ id: c.id, name: c.name, type: c.type })),
      });
    },
    {
      name: "list_connections",
      description: "List all configured connections (database, API, and Google Sheets) with their id, name, and type.",
      schema: z.object({}),
    }
  );
}
