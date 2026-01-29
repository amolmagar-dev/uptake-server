// @ts-nocheck
/**
 * List Connections Tool
 * Lists all available database connections
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { prisma } from "../../db/client.js";

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
  console.log("[TOOL] list_connections called with filter:", filter);
  try {
    console.log("[TOOL] Querying connections from database...");
    
    // Build filter condition
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
        created_by: true,
        created_at: true,
        creator: { select: { name: true } }
      },
      orderBy: { created_at: "desc" }
    });

    // Format connections with user names
    const connectionsWithUsers = connections.map((conn) => ({
      id: conn.id,
      name: conn.name,
      type: conn.type,
      host: conn.host,
      port: conn.port,
      database: conn.database_name,
      username: conn.username,
      createdBy: conn.creator?.name || "Unknown",
      createdAt: conn.created_at,
    }));

    console.log("[TOOL] Found", connectionsWithUsers.length, "connections");
    const result = {
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
    console.log("[TOOL] list_connections returning:", JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("[TOOL] Error listing connections:", error);
    return {
      success: false,
      error: error.message || "Failed to list connections",
    };
  }
});

export default listConnections;
