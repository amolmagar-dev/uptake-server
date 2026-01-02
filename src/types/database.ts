/**
 * Database Entity Types
 * Type definitions for all database entities
 */

export interface User {
  id: string;
  email: string;
  password: string;
  name: string | null;
  role: 'admin' | 'editor' | 'viewer';
  created_at: string;
  updated_at: string;
}

export interface Connection {
  id: string;
  name: string;
  type: 'mysql' | 'postgresql' | 'sqlite' | 'api' | 'googlesheets';
  host: string | null;
  port: number | null;
  database_name: string | null;
  username: string | null;
  password: string | null;
  ssl: number;
  config: string | null; // JSON string for API and Google Sheets configs
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  description: string | null;
  sql_query: string;
  connection_id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Dataset {
  id: string;
  name: string;
  description: string | null;
  source_type: 'sql' | 'api' | 'googlesheets';
  dataset_type: 'physical' | 'virtual';
  connection_id: string | null;
  table_name: string | null;
  table_schema: string;
  sql_query: string | null;
  source_config: string | null; // JSON string
  columns: string | null; // JSON string
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Chart {
  id: string;
  name: string;
  description: string | null;
  chart_type: string;
  config: string; // JSON string
  query_id: string | null;
  sql_query: string | null;
  connection_id: string | null;
  dataset_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Dashboard {
  id: string;
  name: string;
  description: string | null;
  layout: string; // JSON string
  filters: string; // JSON string
  is_public: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardChart {
  id: string;
  dashboard_id: string;
  chart_id: string | null;
  component_id: string | null;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
}

export interface CustomComponent {
  id: string;
  name: string;
  description: string | null;
  html_content: string;
  css_content: string | null;
  js_content: string | null;
  config: string | null; // JSON string
  connection_id: string | null;
  sql_query: string | null;
  dataset_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Sanitized user type for API responses (no password)
export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'editor' | 'viewer';
}
