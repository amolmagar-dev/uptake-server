/**
 * Widget Types for Backend
 * Shared type definitions for AI-driven widgets
 */

export type WidgetType = 
  | "query_result"
  | "chart_preview"
  | "data_insight"
  | "action_buttons"
  | "dataset_info"
  | "connection_status"
  | "schema_explorer";

export interface WidgetAction {
  id: string;
  label: string;
  icon?: string;
  tooltip?: string;
  variant?: "primary" | "secondary" | "ghost" | "error" | "success";
  clientTool?: string;
  params?: Record<string, any>;
}

export interface BaseWidget {
  type: WidgetType;
  id: string;
  data: any;
  actions?: WidgetAction[];
  metadata?: Record<string, any>;
}

export interface QueryResultWidgetData {
  query: string;
  rows: any[];
  columns: { name: string; type: string }[];
  rowCount: number;
  executionTime?: number;
}

export interface DataInsight {
  type: "success" | "warning" | "info" | "error";
  title: string;
  description: string;
  icon?: string;
}

export interface DataInsightWidgetData {
  insights: DataInsight[];
}
