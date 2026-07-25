/**
 * Connection Repository
 * Handles all database operations for Connection entity
 */

import { prisma } from "../client.js";
import type { Connection } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

export interface CreateConnectionInput {
  name: string;
  type: string;
  host?: string;
  port?: number;
  database_name?: string;
  username?: string;
  password?: string;
  ssl?: number;
  config?: string;
  created_by?: string;
}

// The nullable columns accept `null` so a caller can explicitly clear them (e.g. when a
// connection changes type). Prisma treats `undefined` as "leave this column alone", so
// `null` is the only way to actually blank a field out.
export interface UpdateConnectionInput {
  name?: string;
  type?: string;
  host?: string | null;
  port?: number | null;
  database_name?: string | null;
  username?: string | null;
  password?: string | null;
  ssl?: number;
  config?: string | null;
}

class ConnectionRepository {
  /**
   * Get all connections
   */
  async findAll(): Promise<Connection[]> {
    return prisma.connection.findMany({
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Find connection by ID
   */
  async findById(id: string): Promise<Connection | null> {
    return prisma.connection.findUnique({ where: { id } });
  }

  /**
   * Find connections by type
   */
  async findByType(type: string): Promise<Connection[]> {
    return prisma.connection.findMany({
      where: { type },
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Find connections created by a specific user
   */
  async findByCreator(userId: string): Promise<Connection[]> {
    return prisma.connection.findMany({
      where: { created_by: userId },
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Create a new connection
   */
  async create(data: CreateConnectionInput): Promise<Connection> {
    return prisma.connection.create({
      data: {
        id: uuidv4(),
        name: data.name,
        type: data.type,
        host: data.host,
        port: data.port,
        database_name: data.database_name,
        username: data.username,
        password: data.password,
        ssl: data.ssl ?? 0,
        config: data.config,
        created_by: data.created_by,
      },
    });
  }

  /**
   * Update connection
   */
  async update(id: string, data: UpdateConnectionInput): Promise<Connection> {
    return prisma.connection.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete connection
   */
  async delete(id: string): Promise<void> {
    await prisma.connection.delete({ where: { id } });
  }

  /**
   * Check if connection exists
   */
  async exists(id: string): Promise<boolean> {
    const count = await prisma.connection.count({ where: { id } });
    return count > 0;
  }
}

export const connectionRepository = new ConnectionRepository();
