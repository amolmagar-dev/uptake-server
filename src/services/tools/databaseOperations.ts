// @ts-nocheck
/**
 * Database Operations Tool
 * Execute SQL queries on any database connection
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { executeQuery } from "../databaseConnector.js";
import { findConnection, getAvailableConnectionsList } from "./utils.js";

const databaseOperationsDef = toolDefinition({
  name: "database_operations",
  description: `🔴 PRIMARY TOOL FOR DISPLAYING DATA TO USERS 🔴

Use this tool WHENEVER the user asks to see, show, display, preview, or fetch data from any source.

This is the ONLY tool that renders interactive data widgets in the UI. When you call this tool, the user will see:
- An interactive data table with their query results
- Action buttons to create charts, filter data, export CSV, etc.
- Professional formatting with row counts and execution time

Use this tool for:
- Run SELECT queries to fetch and DISPLAY data to the user
- Show sample data from tables or datasets
- Preview data before creating charts
- Execute any SQL query that returns results
- Run INSERT, UPDATE, DELETE for data manipulation

Returns query results with rows, fields, row count, execution time, and an interactive widget.

IMPORTANT:
- NEVER return data to users without using this tool
- DO NOT use dataset_management's preview action to show data - use this tool instead
- You can use either connection ID or connection name
- Dangerous operations (DROP DATABASE, TRUNCATE) are blocked for safety`,
  inputSchema: z.object({
    connectionId: z.string().describe("The database connection ID or name to execute query on"),
    sql: z.string().describe("The SQL query to execute"),
    params: z.array(z.any()).optional().describe("Query parameters for prepared statements (optional)"),
  }),
});

const databaseOperations = databaseOperationsDef.server(async ({ connectionId, sql, params = [] }) => {
  console.log("[TOOL] database_operations called with connection:", connectionId);
  try {
    // Get connection details - supports both ID and name
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

    // Prepare widget data for query results
    const widgetData = {
      type: "query_result",
      id: `query_${Date.now()}`,
      data: {
        query: sql,
        rows: result.rows,
        columns: result.fields.map(f => ({ name: f.name, type: f.type || 'unknown' })),
        rowCount: result.rowCount,
        executionTime: result.executionTime,
      },
      actions: [
        {
          id: "create_chart",
          label: "Create Chart",
          icon: "BarChart3",
          tooltip: "Create a chart from this data",
          variant: "primary",
          clientTool: "navigate_to_page",
          params: { page: "charts" },
        },
        {
          id: "filter_data",
          label: "Filter Data",
          icon: "Filter",
          tooltip: "Apply filters to this data",
          variant: "ghost",
        },
        {
          id: "show_trends",
          label: "Show Trends",
          icon: "TrendingUp",
          tooltip: "Analyze trends in this data",
          variant: "ghost",
        },
        {
          id: "export_csv",
          label: "Export CSV",
          icon: "Download",
          tooltip: "Download as CSV",
          variant: "ghost",
        },
      ],
    };

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
      widget: widgetData, // NEW: Include widget data for frontend rendering
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

