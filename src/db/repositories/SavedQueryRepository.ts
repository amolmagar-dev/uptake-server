/**
 * SavedQuery Repository
 * Handles all database operations for SavedQuery entity
 */

import { prisma } from "../client.js";
import type { SavedQuery } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

export interface CreateSavedQueryInput {
  name: string;
  description?: string;
  sql_query: string;
  connection_id: string;
  created_by?: string;
}

export interface UpdateSavedQueryInput {
  name?: string;
  description?: string;
  sql_query?: string;
  connection_id?: string;
}

class SavedQueryRepository {
  /**
   * Get all saved queries
   */
  async findAll(): Promise<SavedQuery[]> {
    return prisma.savedQuery.findMany({
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Find saved query by ID
   */
  async findById(id: string): Promise<SavedQuery | null> {
    return prisma.savedQuery.findUnique({ where: { id } });
  }

  /**
   * Find saved queries by connection
   */
  async findByConnection(connectionId: string): Promise<SavedQuery[]> {
    return prisma.savedQuery.findMany({
      where: { connection_id: connectionId },
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Create a new saved query
   */
  async create(data: CreateSavedQueryInput): Promise<SavedQuery> {
    return prisma.savedQuery.create({
      data: {
        id: uuidv4(),
        name: data.name,
        description: data.description,
        sql_query: data.sql_query,
        connection_id: data.connection_id,
        created_by: data.created_by,
      },
    });
  }

  /**
   * Update saved query
   */
  async update(id: string, data: UpdateSavedQueryInput): Promise<SavedQuery> {
    return prisma.savedQuery.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete saved query
   */
  async delete(id: string): Promise<void> {
    await prisma.savedQuery.delete({ where: { id } });
  }

  /**
   * Check if saved query exists
   */
  async exists(id: string): Promise<boolean> {
    const count = await prisma.savedQuery.count({ where: { id } });
    return count > 0;
  }
}

export const savedQueryRepository = new SavedQueryRepository();
