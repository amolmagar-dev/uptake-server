// @ts-nocheck
/**
 * List Tables Tool
 * Lists all tables and their columns from a database connection
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { findConnection, getAvailableConnectionsList } from "./utils.js";

const listTablesDef = toolDefinition({
  name: "list_tables",
  description:
    "List all tables and their columns (with data types) from a database connection. You can use either connection ID or connection name.",
  inputSchema: z.object({
    connectionId: z.string().describe("The database connection ID or name to list tables from"),
  }),
});

const listTables = listTablesDef.server(async ({ connectionId }) => {
  console.log("[TOOL] list_tables called with connectionId:", connectionId);
  try {
    // Get connection details - supports both ID and name
    console.log("[TOOL] Fetching connection details for:", connectionId);
    const connection = await findConnection(connectionId);

    if (!connection) {
      console.warn("[TOOL] Connection not found:", connectionId);
      return {
        success: false,
        error: "Connection not found",
        connectionId,
        availableConnections: await getAvailableConnectionsList(),
      };
    }

    console.log("[TOOL] Found connection:", connection.name, "Type:", connection.type);
    let tables = [];

    // Handle different database types
    if (connection.type === "sqlite") {
      console.log("[TOOL] Listing SQLite tables...");
      tables = await listSqliteTables(connection);
    } else if (connection.type === "mysql") {
      console.log("[TOOL] Listing MySQL tables...");
      tables = await listMysqlTables(connection);
    } else if (connection.type === "postgresql") {
      console.log("[TOOL] Listing PostgreSQL tables...");
      tables = await listPostgresTables(connection);
    } else {
      console.error("[TOOL] Unsupported database type:", connection.type);
      return {
        success: false,
        error: `Unsupported database type: ${connection.type}`,
      };
    }

    console.log("[TOOL] Found", tables.length, "tables");
    const result = {
      success: true,
      connectionId,
      connectionName: connection.name,
      databaseType: connection.type,
      databaseName: connection.database_name,
      tableCount: tables.length,
      tables: tables.sort((a, b) => a.name.localeCompare(b.name)),
    };
    console.log("[TOOL] list_tables returning success with", tables.length, "tables");
    return result;
  } catch (error) {
    console.error("[TOOL] Error listing tables:", error);
    return {
      success: false,
      error: error.message || "Failed to list tables",
    };
  }
});

/**
 * List tables for SQLite
 */
async function listSqliteTables(connection) {
  try {
    const dbInstance = await import("better-sqlite3");
    const sqlite = dbInstance.default;
    const sqliteDb = new sqlite(connection.database);

    // Get all tables
    const tables = sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();

    const result = [];
    for (const table of tables) {
      const columns = sqliteDb.prepare(`PRAGMA table_info(${table.name})`).all();

      result.push({
        name: table.name,
        columnCount: columns.length,
        columns: columns.map((col) => ({
          name: col.name,
          type: col.type,
          nullable: col.notnull === 0,
          primaryKey: col.pk === 1,
        })),
      });
    }

    sqliteDb.close();
    return result;
  } catch (error) {
    throw new Error(`Failed to list SQLite tables: ${error.message}`);
  }
}

/**
 * List tables for MySQL
 */
async function listMysqlTables(connection) {
  try {
    const mysql = await import("mysql2/promise");
    const connectionPool = await mysql.createConnection({
      host: connection.host,
      port: connection.port || 3306,
      user: connection.username,
      password: connection.password,
      database: connection.database,
    });

    // Get all tables
    const [tables] = await connectionPool.execute(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()"
    );

    const result = [];
    for (const table of tables) {
      const [columns] = await connectionPool.execute(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY 
         FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table.TABLE_NAME]
      );

      result.push({
        name: table.TABLE_NAME,
        columnCount: columns.length,
        columns: columns.map((col) => ({
          name: col.COLUMN_NAME,
          type: col.COLUMN_TYPE,
          nullable: col.IS_NULLABLE === "YES",
          primaryKey: col.COLUMN_KEY === "PRI",
        })),
      });
    }

    await connectionPool.end();
    return result;
  } catch (error) {
    throw new Error(`Failed to list MySQL tables: ${error.message}`);
  }
}

/**
 * List tables for PostgreSQL
 */
async function listPostgresTables(connection) {
  try {
    const pg = await import("pg");
    const { Client } = pg;
    const client = new Client({
      host: connection.host,
      port: connection.port || 5432,
      user: connection.username,
      password: connection.password,
      database: connection.database,
    });

    await client.connect();

    // Get all tables
    const tablesResult = await client.query(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = 'public'`
    );

    const result = [];
    for (const tableRow of tablesResult.rows) {
      const tableName = tableRow.table_name;
      const columnsResult = await client.query(
        `SELECT column_name, data_type, is_nullable 
         FROM information_schema.columns 
         WHERE table_name = $1`,
        [tableName]
      );

      // Get primary key info
      const pkResult = await client.query(
        `SELECT column_name FROM information_schema.table_constraints tc 
         JOIN information_schema.key_column_usage kcu 
         USING (constraint_name, table_schema, table_name)
         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1`,
        [tableName]
      );

      const pkColumns = pkResult.rows.map((row) => row.column_name);

      result.push({
        name: tableName,
        columnCount: columnsResult.rows.length,
        columns: columnsResult.rows.map((col) => ({
          name: col.column_name,
          type: col.data_type,
          nullable: col.is_nullable === "YES",
          primaryKey: pkColumns.includes(col.column_name),
        })),
      });
    }

    await client.end();
    return result;
  } catch (error) {
    throw new Error(`Failed to list PostgreSQL tables: ${error.message}`);
  }
}

export default listTables;
