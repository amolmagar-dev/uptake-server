/**
 * Dataset Repository
 * Handles all database operations for Dataset entity
 */

import { prisma } from "../client.js";
import type { Dataset } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

export interface CreateDatasetInput {
  name: string;
  description?: string;
  source_type?: string;
  dataset_type?: string;
  connection_id?: string;
  table_name?: string;
  table_schema?: string;
  sql_query?: string;
  source_config?: string;
  columns?: string;
  created_by?: string;
}

export interface UpdateDatasetInput {
  name?: string;
  description?: string;
  source_type?: string;
  dataset_type?: string;
  connection_id?: string;
  table_name?: string;
  table_schema?: string;
  sql_query?: string;
  source_config?: string;
  columns?: string;
}

class DatasetRepository {
  /**
   * Get all datasets
   */
  async findAll(): Promise<Dataset[]> {
    return prisma.dataset.findMany({
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Find dataset by ID
   */
  async findById(id: string): Promise<Dataset | null> {
    return prisma.dataset.findUnique({ where: { id } });
  }

  /**
   * Find datasets by connection
   */
  async findByConnection(connectionId: string): Promise<Dataset[]> {
    return prisma.dataset.findMany({
      where: { connection_id: connectionId },
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Find datasets by source type
   */
  async findBySourceType(sourceType: string): Promise<Dataset[]> {
    return prisma.dataset.findMany({
      where: { source_type: sourceType },
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Create a new dataset
   */
  async create(data: CreateDatasetInput): Promise<Dataset> {
    return prisma.dataset.create({
      data: {
        id: uuidv4(),
        name: data.name,
        description: data.description,
        source_type: data.source_type ?? "sql",
        dataset_type: data.dataset_type ?? "physical",
        connection_id: data.connection_id,
        table_name: data.table_name,
        table_schema: data.table_schema ?? "public",
        sql_query: data.sql_query,
        source_config: data.source_config,
        columns: data.columns,
        created_by: data.created_by,
      },
    });
  }

  /**
   * Update dataset
   */
  async update(id: string, data: UpdateDatasetInput): Promise<Dataset> {
    return prisma.dataset.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete dataset
   */
  async delete(id: string): Promise<void> {
    await prisma.dataset.delete({ where: { id } });
  }

  /**
   * Check if dataset exists
   */
  async exists(id: string): Promise<boolean> {
    const count = await prisma.dataset.count({ where: { id } });
    return count > 0;
  }

  /**
   * Count charts using this dataset
   */
  async countChartsUsing(datasetId: string): Promise<number> {
    return prisma.chart.count({ where: { dataset_id: datasetId } });
  }
}

export const datasetRepository = new DatasetRepository();
