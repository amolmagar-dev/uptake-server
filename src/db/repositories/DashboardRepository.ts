/**
 * Dashboard Repository
 * Handles all database operations for Dashboard entity
 */

import { prisma } from "../client.js";
import type { Dashboard, DashboardChart } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

export interface CreateDashboardInput {
  name: string;
  description?: string;
  layout: string;
  filters?: string;
  is_public?: number;
  created_by?: string;
}

export interface UpdateDashboardInput {
  name?: string;
  description?: string;
  layout?: string;
  filters?: string;
  is_public?: number;
}

export interface AddChartInput {
  dashboard_id: string;
  chart_id?: string;
  component_id?: string;
  position_x?: number;
  position_y?: number;
  width?: number;
  height?: number;
}

export interface UpdateDashboardChartInput {
  position_x?: number;
  position_y?: number;
  width?: number;
  height?: number;
}

export interface DashboardWithCharts extends Dashboard {
  dashboardCharts: DashboardChart[];
}

class DashboardRepository {
  /**
   * Get all dashboards
   */
  async findAll(): Promise<Dashboard[]> {
    return prisma.dashboard.findMany({
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Find dashboard by ID
   */
  async findById(id: string): Promise<Dashboard | null> {
    return prisma.dashboard.findUnique({ where: { id } });
  }

  /**
   * Find dashboard by ID with all charts
   */
  async findByIdWithCharts(id: string): Promise<DashboardWithCharts | null> {
    return prisma.dashboard.findUnique({
      where: { id },
      include: { dashboardCharts: true },
    });
  }

  /**
   * Create a new dashboard
   */
  async create(data: CreateDashboardInput): Promise<Dashboard> {
    return prisma.dashboard.create({
      data: {
        id: uuidv4(),
        name: data.name,
        description: data.description,
        layout: data.layout,
        filters: data.filters ?? "[]",
        is_public: data.is_public ?? 0,
        created_by: data.created_by,
      },
    });
  }

  /**
   * Update dashboard
   */
  async update(id: string, data: UpdateDashboardInput): Promise<Dashboard> {
    return prisma.dashboard.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete dashboard (cascades to dashboard_charts)
   */
  async delete(id: string): Promise<void> {
    // Delete associated dashboard charts first
    await prisma.dashboardChart.deleteMany({ where: { dashboard_id: id } });
    // Then delete the dashboard
    await prisma.dashboard.delete({ where: { id } });
  }

  /**
   * Check if dashboard exists
   */
  async exists(id: string): Promise<boolean> {
    const count = await prisma.dashboard.count({ where: { id } });
    return count > 0;
  }

  /**
   * Add a chart to a dashboard
   */
  async addChart(data: AddChartInput): Promise<DashboardChart> {
    return prisma.dashboardChart.create({
      data: {
        id: uuidv4(),
        dashboard_id: data.dashboard_id,
        chart_id: data.chart_id,
        component_id: data.component_id,
        position_x: data.position_x ?? 0,
        position_y: data.position_y ?? 0,
        width: data.width ?? 6,
        height: data.height ?? 4,
      },
    });
  }

  /**
   * Update a dashboard chart position/size
   */
  async updateDashboardChart(
    id: string,
    data: UpdateDashboardChartInput
  ): Promise<DashboardChart> {
    return prisma.dashboardChart.update({
      where: { id },
      data,
    });
  }

  /**
   * Remove a chart from a dashboard
   */
  async removeChart(dashboardChartId: string): Promise<void> {
    await prisma.dashboardChart.delete({ where: { id: dashboardChartId } });
  }

  /**
   * Get dashboard charts for a dashboard
   */
  async getDashboardCharts(dashboardId: string): Promise<DashboardChart[]> {
    return prisma.dashboardChart.findMany({
      where: { dashboard_id: dashboardId },
    });
  }

  /**
   * Duplicate a dashboard
   */
  async duplicate(
    sourceDashboardId: string,
    newName: string,
    createdBy?: string
  ): Promise<Dashboard> {
    const source = await this.findByIdWithCharts(sourceDashboardId);
    if (!source) {
      throw new Error("Source dashboard not found");
    }

    // Create new dashboard
    const newDashboard = await this.create({
      name: newName,
      description: source.description ?? undefined,
      layout: source.layout,
      filters: source.filters,
      is_public: source.is_public,
      created_by: createdBy,
    });

    // Copy all dashboard charts
    for (const chart of source.dashboardCharts) {
      await this.addChart({
        dashboard_id: newDashboard.id,
        chart_id: chart.chart_id ?? undefined,
        component_id: chart.component_id ?? undefined,
        position_x: chart.position_x,
        position_y: chart.position_y,
        width: chart.width,
        height: chart.height,
      });
    }

    return newDashboard;
  }
}

export const dashboardRepository = new DashboardRepository();
