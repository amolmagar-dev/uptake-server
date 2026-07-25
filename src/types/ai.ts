export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIContext {
  type: "connection" | "dataset" | "chart" | "dashboard" | "component" | "custom";
  id?: string;
  name: string;
  metadata?: Record<string, any>;
  customText?: string;
}

export interface WidgetAction {
  id: string;
  label: string;
  icon?: string;
  tooltip?: string;
  variant?: "primary" | "secondary" | "ghost" | "error" | "success";
  clientTool?: string;
  params?: Record<string, any>;
}

export type WidgetType =
  | "query_result"
  | "chart_preview"
  | "data_insight"
  | "action_buttons"
  | "dataset_info"
  | "connection_status"
  | "schema_explorer";

export interface BaseWidget {
  type: WidgetType;
  id: string;
  data: any;
  actions?: WidgetAction[];
  metadata?: Record<string, any>;
}
