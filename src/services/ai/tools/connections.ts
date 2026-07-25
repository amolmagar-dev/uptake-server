import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { connectionRepository } from "../../../db/repositories/index.js";
import type { UpdateConnectionInput } from "../../../db/repositories/ConnectionRepository.js";
import { requireRole, toolOk as ok, toolFail as fail } from "./shared.js";
import { testConnection, closeConnection } from "../../databaseConnector.js";
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
  // Singular "googlesheet" is the value the rest of the app stores and reads for
  // Connection.type (see src/routes/connections.ts and the frontend's Connections page).
  type: z.literal("googlesheet"),
  // Optional at the schema level for the same reason as the api schema's `url` — a
  // missing required field makes LangChain's tool() throw ToolInputParsingException
  // instead of returning a toolFail() envelope. The handlers check it manually.
  spreadsheet_id: z.string().optional().describe("Spreadsheet ID or URL (required for googlesheet connections)"),
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

/**
 * Map a validated tool-input config onto the Connection table's columns.
 *
 * Fields that no longer apply after a type change are set to `null` rather than left
 * `undefined`, because Prisma's `update` treats `undefined` as "leave this column
 * alone" — so a SQL -> api switch would otherwise keep stale host/credentials, and an
 * api -> SQL switch would keep a stale config JSON blob.
 */
function toStoredConnectionFields(
  config: z.infer<typeof connectionConfigSchema>
): UpdateConnectionInput & { type: string } {
  if (config.type === "postgresql" || config.type === "mysql" || config.type === "sqlite") {
    const fields: UpdateConnectionInput & { type: string } = {
      type: config.type,
      host: config.host,
      port: config.port,
      database_name: config.database_name,
      username: config.username,
      password: config.password,
      // Clear the API/Sheets JSON blob when switching to (or staying on) a SQL type.
      config: null,
    };
    // Only write `ssl` when the caller actually said something about it. Unconditionally
    // coercing an absent `ssl` to 0 silently downgraded TLS on any partial update
    // (e.g. one that only changed the host) — mirrors routes/connections.ts, which uses
    // `ssl !== undefined ? (ssl ? 1 : 0) : existing.ssl`.
    if (config.ssl !== undefined) fields.ssl = config.ssl ? 1 : 0;
    return fields;
  }

  // Non-SQL types keep everything in the `config` JSON column, so clear the SQL columns.
  const clearedSqlFields = {
    host: null,
    port: null,
    database_name: null,
    username: null,
    password: null,
  } as const;

  if (config.type === "api") {
    const headers = config.headers
      ? Object.fromEntries(config.headers.map((h) => [h.key, h.value]))
      : undefined;
    return {
      type: "api",
      config: JSON.stringify({ ...config, headers, type: undefined }),
      ...clearedSqlFields,
    };
  }
  return {
    type: "googlesheet",
    config: JSON.stringify({ ...config, type: undefined }),
    ...clearedSqlFields,
  };
}

/**
 * Fields the tool schema leaves optional (to avoid ToolInputParsingException) but that
 * the underlying connector genuinely requires. Checked manually so a missing value comes
 * back as a normal toolFail() envelope the model can react to.
 */
function missingRequiredConfigField(
  config: z.infer<typeof connectionConfigSchema>
): string | null {
  if (config.type === "api" && !config.url) return "url is required for api connections";
  if (config.type === "googlesheet" && !config.spreadsheet_id) {
    return "spreadsheet_id is required for googlesheet connections";
  }
  return null;
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
            const missing = missingRequiredConfigField(data.config);
            if (missing) return fail(missing);
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
            if (data?.config) {
              const missing = missingRequiredConfigField(data.config);
              if (missing) return fail(missing);
            }
            const fields = data?.config ? toStoredConnectionFields(data.config) : {};
            // Drop any cached pool built from the old credentials before writing the new
            // ones, so the next query reconnects — routes/connections.ts does the same.
            // Called unconditionally (a no-op when no pool is cached) so it also covers a
            // SQL -> api/googlesheet type change, where a stale pool would otherwise linger.
            closeConnection(existing.id);
            const updated = await connectionRepository.update(existing.id, { name: data?.name, ...fields } as any);
            return ok({ action, connection: { id: updated.id, name: updated.name, type: updated.type } });
          }
          case "delete": {
            const roleCheck = requireRole(user, ["admin"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!connectionId) return fail("connectionId is required for delete");
            const existing = await connectionRepository.findById(connectionId);
            if (!existing) return fail(`Connection not found: ${connectionId}`);
            // Release the cached pool before dropping the row, as routes/connections.ts does.
            closeConnection(existing.id);
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
                : connection.type === "googlesheet"
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
        "config is discriminated by type: postgresql/mysql/sqlite need host+database_name; api needs url; googlesheet needs spreadsheet_id. " +
        "Creating and updating requires admin or editor; deleting requires admin.",
      schema: connectionManagementSchema,
    }
  );
}

export function createListConnectionsTool(_user: UserProfile) {
  return tool(
    async () => {
      try {
        const connections = await connectionRepository.findAll();
        return ok({
          totalConnections: connections.length,
          connections: connections.map((c) => ({ id: c.id, name: c.name, type: c.type })),
        });
      } catch (err: any) {
        return fail(err.message || "Failed to list connections");
      }
    },
    {
      name: "list_connections",
      description: "List all configured connections (database, API, and Google Sheets) with their id, name, and type.",
      schema: z.object({}),
    }
  );
}
