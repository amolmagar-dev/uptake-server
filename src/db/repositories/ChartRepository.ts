/**
 * Chart Repository
 * Handles all database operations for Chart entity
 */

import { prisma } from "../client.js";
import type { Chart } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

export interface CreateChartInput {
  name: string;
  description?: string;
  chart_type: string;
  config: string;
  query_id?: string;
  sql_query?: string;
  connection_id?: string;
  dataset_id?: string;
  created_by?: string;
}

export interface UpdateChartInput {
  name?: string;
  description?: string;
  chart_type?: string;
  config?: string;
  query_id?: string;
  sql_query?: string;
  connection_id?: string;
  dataset_id?: string;
}

class ChartRepository {
  /**
   * Get all charts
   */
  async findAll(): Promise<Chart[]> {
    return prisma.chart.findMany({
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Find chart by ID
   */
  async findById(id: string): Promise<Chart | null> {
    return prisma.chart.findUnique({ where: { id } });
  }

  /**
   * Find charts by dataset
   */
  async findByDataset(datasetId: string): Promise<Chart[]> {
    return prisma.chart.findMany({
      where: { dataset_id: datasetId },
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Find charts by connection
   */
  async findByConnection(connectionId: string): Promise<Chart[]> {
    return prisma.chart.findMany({
      where: { connection_id: connectionId },
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Count charts using a dataset
   */
  async countByDataset(datasetId: string): Promise<number> {
    return prisma.chart.count({ where: { dataset_id: datasetId } });
  }

  /**
   * Create a new chart
   */
  async create(data: CreateChartInput): Promise<Chart> {
    return prisma.chart.create({
      data: {
        id: uuidv4(),
        name: data.name,
        description: data.description,
        chart_type: data.chart_type,
        config: data.config,
        query_id: data.query_id,
        sql_query: data.sql_query,
        connection_id: data.connection_id,
        dataset_id: data.dataset_id,
        created_by: data.created_by,
      },
    });
  }

  /**
   * Update chart
   */
  async update(id: string, data: UpdateChartInput): Promise<Chart> {
    return prisma.chart.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete chart
   */
  async delete(id: string): Promise<void> {
    await prisma.chart.delete({ where: { id } });
  }

  /**
   * Check if chart exists
   */
  async exists(id: string): Promise<boolean> {
    const count = await prisma.chart.count({ where: { id } });
    return count > 0;
  }
}

export const chartRepository = new ChartRepository();
