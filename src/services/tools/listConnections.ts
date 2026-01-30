/**
 * List Connections Tool
 * Lists all available database connections
 * Refactored to use LangChain.js
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "../../db/client.js";

const listConnectionsSchema = z.object({
  filter: z
    .enum(["all", "mysql", "postgresql", "sqlite"])
    .optional()
    .describe("Filter connections by database type (optional)"),
});

type ListConnectionsInput = z.infer<typeof listConnectionsSchema>;

async function executeListConnections({ filter = "all" }: ListConnectionsInput): Promise<string> {
  console.log("[TOOL] list_connections called with filter:", filter);
  try {
    console.log("[TOOL] Querying connections from database...");
    
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

    const connectionsWithUsers = connections.map((conn: any) => ({
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
    return JSON.stringify(result);
  } catch (error: any) {
    console.error("[TOOL] Error listing connections:", error);
    return JSON.stringify({
      success: false,
      error: error.message || "Failed to list connections",
    });
  }
}

const listConnections = tool(executeListConnections, {
  name: "list_connections",
  description: "List all available database connections with their details (name, type, host, etc.)",
  schema: listConnectionsSchema,
});

export default listConnections;
