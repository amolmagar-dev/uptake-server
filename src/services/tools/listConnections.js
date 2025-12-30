/**
 * List Connections Tool
 * Lists all available database connections
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import db from "../../config/database.js";

const listConnectionsDef = toolDefinition({
  name: "list_connections",
  description: "List all available database connections with their details (name, type, host, etc.)",
  inputSchema: z.object({
    filter: z
      .enum(["all", "mysql", "postgresql", "sqlite"])
      .optional()
      .describe("Filter connections by database type (optional)"),
  }),
});

const listConnections = listConnectionsDef.server(async ({ filter = "all" }) => {
  try {
    let query = "SELECT id, name, type, host, port, database_name, username, created_by, created_at FROM connections";
    let params = [];

    // Filter by type if specified
    if (filter !== "all") {
      query += " WHERE type = ?";
      params = [filter];
    }

    query += " ORDER BY created_at DESC";

    const connections = db.prepare(query).all(...params);

    // Get user names for created_by
    const connectionsWithUsers = connections.map((conn) => {
      let createdByName = "Unknown";
      if (conn.created_by) {
        const user = db.prepare("SELECT name FROM users WHERE id = ?").get(conn.created_by);
        if (user) {
          createdByName = user.name;
        }
      }

      return {
        id: conn.id,
        name: conn.name,
        type: conn.type,
        host: conn.host,
        port: conn.port,
        database: conn.database_name,
        username: conn.username,
        createdBy: createdByName,
        createdAt: conn.created_at,
      };
    });

    return {
      success: true,
      filter: filter === "all" ? null : filter,
      totalConnections: connectionsWithUsers.length,
      connections: connectionsWithUsers,
      summary: {
        mysql: connectionsWithUsers.filter((c) => c.type === "mysql").length,
        postgresql: connectionsWithUsers.filter((c) => c.type === "postgresql").length,
        sqlite: connectionsWithUsers.filter((c) => c.type === "sqlite").length,
      },
    };
  } catch (error) {
    console.error("Error listing connections:", error);
    return {
      success: false,
      error: error.message || "Failed to list connections",
    };
  }
});

export default listConnections;
