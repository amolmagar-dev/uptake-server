/**
 * CustomComponent Repository
 * Handles all database operations for CustomComponent entity
 */

import { prisma } from "../client.js";
import type { CustomComponent } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

export interface CreateCustomComponentInput {
  name: string;
  description?: string;
  html_content: string;
  css_content?: string;
  js_content?: string;
  config?: string;
  connection_id?: string;
  sql_query?: string;
  dataset_id?: string;
  created_by?: string;
}

export interface UpdateCustomComponentInput {
  name?: string;
  description?: string;
  html_content?: string;
  css_content?: string;
  js_content?: string;
  config?: string;
  connection_id?: string;
  sql_query?: string;
  dataset_id?: string;
}

class CustomComponentRepository {
  /**
   * Get all custom components
   */
  async findAll(): Promise<CustomComponent[]> {
    return prisma.customComponent.findMany({
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Find custom component by ID
   */
  async findById(id: string): Promise<CustomComponent | null> {
    return prisma.customComponent.findUnique({ where: { id } });
  }

  /**
   * Find custom components by dataset
   */
  async findByDataset(datasetId: string): Promise<CustomComponent[]> {
    return prisma.customComponent.findMany({
      where: { dataset_id: datasetId },
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Find custom components by connection
   */
  async findByConnection(connectionId: string): Promise<CustomComponent[]> {
    return prisma.customComponent.findMany({
      where: { connection_id: connectionId },
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Create a new custom component
   */
  async create(data: CreateCustomComponentInput): Promise<CustomComponent> {
    return prisma.customComponent.create({
      data: {
        id: uuidv4(),
        name: data.name,
        description: data.description,
        html_content: data.html_content,
        css_content: data.css_content,
        js_content: data.js_content,
        config: data.config,
        connection_id: data.connection_id,
        sql_query: data.sql_query,
        dataset_id: data.dataset_id,
        // Only set created_by if it's provided (not set when created via AI)
        ...(data.created_by ? { created_by: data.created_by } : {}),
      },
    });
  }

  /**
   * Update custom component
   */
  async update(
    id: string,
    data: UpdateCustomComponentInput
  ): Promise<CustomComponent> {
    return prisma.customComponent.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete custom component
   */
  async delete(id: string): Promise<void> {
    await prisma.customComponent.delete({ where: { id } });
  }

  /**
   * Check if custom component exists
   */
  async exists(id: string): Promise<boolean> {
    const count = await prisma.customComponent.count({ where: { id } });
    return count > 0;
  }
}

export const customComponentRepository = new CustomComponentRepository();
