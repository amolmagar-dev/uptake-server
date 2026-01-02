// @ts-nocheck
/**
 * Schema Explorer Tool
 * Explore database schema - tables, columns, relationships
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { executeQuery } from "../databaseConnector.js";
import { findConnection, getAvailableConnectionsList } from "./utils.js";

const schemaExplorerDef = toolDefinition({
  name: "schema_explorer",
  description: `Explore database schema and structure. Supported actions:
- list_tables: List all tables in a database connection
- get_columns: Get column details for a specific table
- get_sample_data: Get sample rows from a table
- get_table_stats: Get row count and basic statistics for a table
- search_tables: Search for tables by name pattern
- get_relationships: Get foreign key relationships for a table (PostgreSQL/MySQL)
Use this to understand database structure before writing queries or creating charts.
You can use either connection ID or connection name.`,
  inputSchema: z.object({
    action: z
      .enum(["list_tables", "get_columns", "get_sample_data", "get_table_stats", "search_tables", "get_relationships"])
      .describe("The action to perform"),
    connectionId: z.string().describe("The database connection ID or name"),
    tableName: z.string().optional().describe("Table name (required for get_columns, get_sample_data, get_table_stats, get_relationships)"),
    schema: z.string().optional().describe("Schema name (default: 'public' for PostgreSQL)"),
    searchPattern: z.string().optional().describe("Search pattern for table names (for search_tables)"),
    limit: z.number().optional().describe("Number of sample rows to return (default: 10, max: 100)"),
  }),
});

const schemaExplorer = schemaExplorerDef.server(
  async ({ action, connectionId, tableName, schema = "public", searchPattern, limit = 10 }) => {
    console.log("[TOOL] schema_explorer called with action:", action, "connection:", connectionId);
    try {
      // Get connection details - supports both ID and name
      const connection = findConnection(connectionId);

      if (!connection) {
        console.warn("[TOOL] Connection not found:", connectionId);
        return {
          success: false,
          error: "Connection not found",
          connectionId,
          availableConnections: getAvailableConnectionsList(),
        };
      }
      console.log("[TOOL] Found connection:", connection.name, "Type:", connection.type);

      const dbType = connection.type.toLowerCase();

      switch (action) {
        case "list_tables": {
          let query;

          switch (dbType) {
            case "postgresql":
            case "postgres":
              query = `
                SELECT table_schema as schema, table_name as name, table_type as type
                FROM information_schema.tables 
                WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                ORDER BY table_schema, table_name
              `;
              break;
            case "mysql":
            case "mariadb":
              query = `
                SELECT table_schema as \`schema\`, table_name as name, table_type as type
                FROM information_schema.tables 
                WHERE table_schema = DATABASE()
                ORDER BY table_name
              `;
              break;
            case "sqlite":
              query = `
                SELECT '' as schema, name, type 
                FROM sqlite_master 
                WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
                ORDER BY name
              `;
              break;
            default:
              return { success: false, error: `Unsupported database type: ${dbType}` };
          }

          const result = await executeQuery(connection, query);

          return {
            success: true,
            action: "list_tables",
            connectionId,
            connectionName: connection.name,
            databaseType: dbType,
            tableCount: result.rowCount,
            tables: result.rows.map((t) => ({
              schema: t.schema || null,
              name: t.name,
              type: t.type,
            })),
          };
        }

        case "get_columns": {
          if (!tableName) {
            return { success: false, error: "tableName is required for get_columns action" };
          }

          let query, params;

          switch (dbType) {
            case "postgresql":
            case "postgres":
              query = `
                SELECT 
                  column_name as name,
                  data_type as type,
                  is_nullable as nullable,
                  column_default as default_value,
                  character_maximum_length as max_length
                FROM information_schema.columns 
                WHERE table_name = $1 AND table_schema = $2
                ORDER BY ordinal_position
              `;
              params = [tableName, schema];
              break;
            case "mysql":
            case "mariadb":
              query = `
                SELECT 
                  column_name as name,
                  data_type as type,
                  is_nullable as nullable,
                  column_default as default_value,
                  character_maximum_length as max_length,
                  column_key as key_type
                FROM information_schema.columns 
                WHERE table_name = ? AND table_schema = DATABASE()
                ORDER BY ordinal_position
              `;
              params = [tableName];
              break;
            case "sqlite":
              // SQLite uses PRAGMA
              const pragmaResult = await executeQuery(connection, `PRAGMA table_info("${tableName}")`);
              return {
                success: true,
                action: "get_columns",
                connectionId,
                tableName,
                columnCount: pragmaResult.rowCount,
                columns: pragmaResult.rows.map((col) => ({
                  name: col.name,
                  type: col.type,
                  nullable: col.notnull === 0 ? "YES" : "NO",
                  defaultValue: col.dflt_value,
                  isPrimaryKey: col.pk === 1,
                })),
              };
            default:
              return { success: false, error: `Unsupported database type: ${dbType}` };
          }

          const result = await executeQuery(connection, query, params);

          // Get primary key info for PostgreSQL/MySQL
          let primaryKeys = [];
          if (dbType === "postgresql" || dbType === "postgres") {
            const pkQuery = `
              SELECT column_name 
              FROM information_schema.table_constraints tc 
              JOIN information_schema.key_column_usage kcu 
              USING (constraint_name, table_schema, table_name)
              WHERE tc.constraint_type = 'PRIMARY KEY' 
              AND tc.table_name = $1 AND tc.table_schema = $2
            `;
            const pkResult = await executeQuery(connection, pkQuery, [tableName, schema]);
            primaryKeys = pkResult.rows.map((r) => r.column_name);
          }

          return {
            success: true,
            action: "get_columns",
            connectionId,
            tableName,
            schema: dbType === "sqlite" ? null : schema,
            columnCount: result.rowCount,
            columns: result.rows.map((col) => ({
              name: col.name,
              type: col.type,
              nullable: col.nullable,
              defaultValue: col.default_value,
              maxLength: col.max_length,
              isPrimaryKey: primaryKeys.includes(col.name),
              keyType: col.key_type,
            })),
          };
        }

        case "get_sample_data": {
          if (!tableName) {
            return { success: false, error: "tableName is required for get_sample_data action" };
          }

          const safeLimit = Math.min(Math.max(1, limit), 100);
          let query;

          switch (dbType) {
            case "postgresql":
            case "postgres":
              query = `SELECT * FROM "${schema}"."${tableName}" LIMIT ${safeLimit}`;
              break;
            case "mysql":
            case "mariadb":
              query = `SELECT * FROM \`${tableName}\` LIMIT ${safeLimit}`;
              break;
            case "sqlite":
              query = `SELECT * FROM "${tableName}" LIMIT ${safeLimit}`;
              break;
            default:
              return { success: false, error: `Unsupported database type: ${dbType}` };
          }

          const result = await executeQuery(connection, query);

          return {
            success: true,
            action: "get_sample_data",
            connectionId,
            tableName,
            limit: safeLimit,
            data: result.rows,
            fields: result.fields,
            rowCount: result.rowCount,
          };
        }

        case "get_table_stats": {
          if (!tableName) {
            return { success: false, error: "tableName is required for get_table_stats action" };
          }

          let countQuery;

          switch (dbType) {
            case "postgresql":
            case "postgres":
              countQuery = `SELECT COUNT(*) as count FROM "${schema}"."${tableName}"`;
              break;
            case "mysql":
            case "mariadb":
              countQuery = `SELECT COUNT(*) as count FROM \`${tableName}\``;
              break;
            case "sqlite":
              countQuery = `SELECT COUNT(*) as count FROM "${tableName}"`;
              break;
            default:
              return { success: false, error: `Unsupported database type: ${dbType}` };
          }

          const countResult = await executeQuery(connection, countQuery);
          const rowCount = countResult.rows[0]?.count || 0;

          return {
            success: true,
            action: "get_table_stats",
            connectionId,
            tableName,
            stats: {
              totalRows: rowCount,
            },
          };
        }

        case "search_tables": {
          if (!searchPattern) {
            return { success: false, error: "searchPattern is required for search_tables action" };
          }

          let query, params;
          const pattern = `%${searchPattern}%`;

          switch (dbType) {
            case "postgresql":
            case "postgres":
              query = `
                SELECT table_schema as schema, table_name as name, table_type as type
                FROM information_schema.tables 
                WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                AND table_name ILIKE $1
                ORDER BY table_schema, table_name
              `;
              params = [pattern];
              break;
            case "mysql":
            case "mariadb":
              query = `
                SELECT table_schema as \`schema\`, table_name as name, table_type as type
                FROM information_schema.tables 
                WHERE table_schema = DATABASE()
                AND table_name LIKE ?
                ORDER BY table_name
              `;
              params = [pattern];
              break;
            case "sqlite":
              query = `
                SELECT '' as schema, name, type 
                FROM sqlite_master 
                WHERE type IN ('table', 'view') 
                AND name NOT LIKE 'sqlite_%'
                AND name LIKE ?
                ORDER BY name
              `;
              params = [pattern];
              break;
            default:
              return { success: false, error: `Unsupported database type: ${dbType}` };
          }

          const result = await executeQuery(connection, query, params);

          return {
            success: true,
            action: "search_tables",
            connectionId,
            searchPattern,
            matchCount: result.rowCount,
            tables: result.rows.map((t) => ({
              schema: t.schema || null,
              name: t.name,
              type: t.type,
            })),
          };
        }

        case "get_relationships": {
          if (!tableName) {
            return { success: false, error: "tableName is required for get_relationships action" };
          }

          if (dbType === "sqlite") {
            // SQLite foreign keys via PRAGMA
            const fkResult = await executeQuery(connection, `PRAGMA foreign_key_list("${tableName}")`);
            return {
              success: true,
              action: "get_relationships",
              connectionId,
              tableName,
              foreignKeys: fkResult.rows.map((fk) => ({
                columnName: fk.from,
                referencedTable: fk.table,
                referencedColumn: fk.to,
                onUpdate: fk.on_update,
                onDelete: fk.on_delete,
              })),
            };
          }

          let query, params;

          switch (dbType) {
            case "postgresql":
            case "postgres":
              query = `
                SELECT
                  kcu.column_name as column_name,
                  ccu.table_name as referenced_table,
                  ccu.column_name as referenced_column,
                  rc.update_rule as on_update,
                  rc.delete_rule as on_delete
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu 
                  ON tc.constraint_name = kcu.constraint_name
                JOIN information_schema.referential_constraints rc 
                  ON tc.constraint_name = rc.constraint_name
                JOIN information_schema.constraint_column_usage ccu 
                  ON rc.unique_constraint_name = ccu.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
                AND tc.table_name = $1 AND tc.table_schema = $2
              `;
              params = [tableName, schema];
              break;
            case "mysql":
            case "mariadb":
              query = `
                SELECT
                  column_name as column_name,
                  referenced_table_name as referenced_table,
                  referenced_column_name as referenced_column
                FROM information_schema.key_column_usage
                WHERE table_name = ? 
                AND table_schema = DATABASE()
                AND referenced_table_name IS NOT NULL
              `;
              params = [tableName];
              break;
            default:
              return { success: false, error: `Unsupported database type: ${dbType}` };
          }

          const result = await executeQuery(connection, query, params);

          return {
            success: true,
            action: "get_relationships",
            connectionId,
            tableName,
            foreignKeyCount: result.rowCount,
            foreignKeys: result.rows.map((fk) => ({
              columnName: fk.column_name,
              referencedTable: fk.referenced_table,
              referencedColumn: fk.referenced_column,
              onUpdate: fk.on_update,
              onDelete: fk.on_delete,
            })),
          };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      console.error("Schema explorer error:", error);
      return {
        success: false,
        error: error.message || "Schema exploration failed",
        action,
      };
    }
  }
);

export default schemaExplorer;

