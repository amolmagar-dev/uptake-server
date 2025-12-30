/**
 * Database Operations Tool
 * Execute SQL queries on any database connection
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import db from "../../config/database.js";
import { executeQuery } from "../databaseConnector.js";

const databaseOperationsDef = toolDefinition({
  name: "database_operations",
  description: `Execute SQL queries on database connections. Use this tool to:
- Run SELECT queries to fetch data
- Run INSERT, UPDATE, DELETE for data manipulation
- Run any valid SQL supported by the connection's database type
Returns query results with rows, fields, row count, and execution time.
Note: Dangerous operations (DROP DATABASE, TRUNCATE) are blocked for safety.`,
  inputSchema: z.object({
    connectionId: z.string().describe("The database connection ID to execute query on"),
    sql: z.string().describe("The SQL query to execute"),
    params: z.array(z.any()).optional().describe("Query parameters for prepared statements (optional)"),
  }),
});

const databaseOperations = databaseOperationsDef.server(async ({ connectionId, sql, params = [] }) => {
  try {
    // Get connection details
    const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(connectionId);

    if (!connection) {
      return {
        success: false,
        error: "Connection not found",
        connectionId,
      };
    }

    // Security check - block dangerous operations
    const sqlUpper = sql.trim().toUpperCase();
    const dangerousKeywords = ["DROP DATABASE", "DROP SCHEMA", "TRUNCATE"];
    for (const keyword of dangerousKeywords) {
      if (sqlUpper.includes(keyword)) {
        return {
          success: false,
          error: `Blocked: ${keyword} operations are not allowed through the chat interface for safety.`,
        };
      }
    }

    // Execute the query
    const result = await executeQuery(connection, sql, params);

    return {
      success: true,
      connectionId,
      connectionName: connection.name,
      databaseType: connection.type,
      query: sql,
      data: result.rows,
      fields: result.fields,
      rowCount: result.rowCount,
      executionTime: `${result.executionTime}ms`,
    };
  } catch (error) {
    console.error("Database operations error:", error);
    return {
      success: false,
      error: error.message || "Query execution failed",
      connectionId,
      query: sql,
    };
  }
});

export default databaseOperations;

