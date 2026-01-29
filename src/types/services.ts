/**
 * Service Types
 * Type definitions for service layer operations
 */

// Database Connection Configurations
export interface MySQLConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
}

export interface PostgreSQLConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
}

export interface APIConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  authType?: 'none' | 'bearer' | 'basic' | 'apikey';
  authToken?: string;
  authUsername?: string;
  authPassword?: string;
  apiKeyHeader?: string;
  apiKeyValue?: string;
  dataPath?: string;
}

export interface GoogleSheetsConfig {
  spreadsheetId: string;
  sheetName?: string;
  range?: string;
  apiKey?: string;
}

// Query Result Types
export interface QueryResult {
  rows: any[];
  fields?: string[];
  rowCount: number;
}

// AI Message Types
export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// AI Tool Definition
export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: any;
  execute?: (...args: any[]) => Promise<any>;
}

// AI Chat Response
export interface AIChatResponse {
  text: string;
  model: string;
  toolCalls: any[] | null;
}
