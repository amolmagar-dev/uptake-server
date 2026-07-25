import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Connection } from "@prisma/client";
import { connectionRepository } from "../../../db/repositories/index.js";
import { getTableList, getTableSchema, executeQuery } from "../../databaseConnector.js";
import { assertReadOnlyQuery, toolOk as ok, toolFail as fail } from "./shared.js";
import type { UserProfile } from "../../../types/database.js";

/** Matches the app-wide preview cap used by the REST dataset/query preview routes. */
const MAX_PREVIEW_ROWS = 100;

async function requireSqlConnection(
  connectionId: string
): Promise<{ error: string } | { connection: Connection }> {
  const connection = await connectionRepository.findById(connectionId);
  if (!connection) return { error: `Connection not found: ${connectionId}` };
  if (!["postgresql", "mysql", "sqlite"].includes(connection.type)) {
    return { error: `This tool only applies to SQL connections; "${connection.id}" is type "${connection.type}"` };
  }
  return { connection };
}

export function createListTablesTool(_user: UserProfile) {
  return tool(
    async ({ connectionId }: { connectionId: string }) => {
      try {
        const lookup = await requireSqlConnection(connectionId);
        if ("error" in lookup) return fail(lookup.error);
        const tables = await getTableList(lookup.connection);
        return ok({ connectionId, tables });
      } catch (err: any) {
        return fail(err.message || "Failed to list tables for this connection");
      }
    },
    {
      name: "list_tables",
      description: "List all tables (with schema and type) available in a SQL connection.",
      schema: z.object({ connectionId: z.string().describe("The SQL connection to inspect") }),
    }
  );
}

export function createSchemaExplorerTool(_user: UserProfile) {
  return tool(
    async ({ connectionId, tableName, tableSchema }: { connectionId: string; tableName: string; tableSchema?: string }) => {
      try {
        const lookup = await requireSqlConnection(connectionId);
        if ("error" in lookup) return fail(lookup.error);
        const columns = await getTableSchema(lookup.connection, tableName, tableSchema);
        return ok({ connectionId, tableName, columns });
      } catch (err: any) {
        return fail(err.message || `Failed to describe table "${tableName}"`);
      }
    },
    {
      name: "schema_explorer",
      description: "Describe a table's columns (name, data type, nullability) in a SQL connection.",
      schema: z.object({
        connectionId: z.string().describe("The SQL connection to inspect"),
        tableName: z.string().describe("Table to describe"),
        tableSchema: z.string().optional().describe("Schema name (default: public)"),
      }),
    }
  );
}

export function createDatabaseOperationsTool(_user: UserProfile) {
  return tool(
    async ({ connectionId, sqlQuery }: { connectionId: string; sqlQuery: string }) => {
      try {
        const readOnlyCheck = assertReadOnlyQuery(sqlQuery);
        if (!readOnlyCheck.ok) return fail(readOnlyCheck.error);
        const lookup = await requireSqlConnection(connectionId);
        if ("error" in lookup) return fail(lookup.error);
        const result = await executeQuery(lookup.connection, sqlQuery);
        const rows: any[] = Array.isArray(result.rows) ? result.rows : [];
        return ok({
          connectionId,
          query: sqlQuery,
          // Capped so a wide-open SELECT can't blow up the model's context. rowCount stays
          // the true total so the model knows more data exists than it can see.
          rows: rows.slice(0, MAX_PREVIEW_ROWS),
          fields: result.fields,
          rowCount: result.rowCount,
          truncated: rows.length > MAX_PREVIEW_ROWS ? { returnedRows: MAX_PREVIEW_ROWS, limit: MAX_PREVIEW_ROWS } : undefined,
          executionTime: result.executionTime,
        });
      } catch (err: any) {
        return fail(err.message || "Query execution failed");
      }
    },
    {
      name: "database_operations",
      description:
        "Run an ad hoc read-only SELECT query against a SQL connection and return the rows. " +
        "Only a single SELECT statement is allowed (a leading WITH ... SELECT CTE is also allowed) — " +
        `use dataset_management or chart_management for anything meant to persist. At most ${MAX_PREVIEW_ROWS} ` +
        "rows are returned; rowCount reports the true total, so add your own LIMIT/aggregation for larger result sets.",
      schema: z.object({
        connectionId: z.string().describe("The SQL connection to query"),
        sqlQuery: z.string().describe("A single read-only SELECT statement"),
      }),
    }
  );
}
