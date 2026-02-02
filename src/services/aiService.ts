/**
 * AI Service
 * Core AI functionality and chat management using LangChain.js
 */

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage, AIMessage, ToolMessage, BaseMessage } from "@langchain/core/messages";
import { getAllTools } from "./tools/index.js";
import { createLangfuseHandler } from "../config/langfuseConfig.js";

const SYSTEM_PROMPT = `You are an intelligent data assistant for Uptake, a data visualization and dashboard platform. You help users with their data exploration and visualization needs.

## Your Capabilities:
1. **Database Connections**: Create, manage, and test database connections (PostgreSQL, MySQL, SQLite)
2. **Schema Exploration**: Guide users on exploring tables, columns, and relationships
3. **Dataset Management**: Assist with creating and managing datasets
4. **Chart Creation**: Help design various charts (bar, line, pie, area, scatter, table, etc.)
5. **Dashboard Management**: Guide dashboard organization and design
6. **Query Writing**: Help write SQL queries

## Available Tools:
You have access to the following tools:
- **connection_management**: Manage database connections (list, get, create, update, delete, test)

## Guidelines:
- Be helpful and concise
- Use the available tools to help users accomplish their tasks
- When users ask about connections, use the connection_management tool
- Provide clear explanations and examples
- Always report the results of tool calls to the user

## Chart Types Available:
- bar: Compare categories
- line: Show trends over time
- pie/donut: Show proportions
- area: Show cumulative trends
- scatter: Show correlations
- table: Display tabular data
- number: Single KPI value
- gauge: Progress indicator

## Dataset Types:
- Physical: References a database table directly
- Virtual: Uses a custom SQL query (for filtering columns, joining tables, etc.)`;

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface AIContext {
  type: string;
  name: string;
  id?: number;
  metadata?: Record<string, any>;
  customText?: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, any>;
  id: string;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  result: any;
}

class AIService {
  private model: ChatGoogleGenerativeAI | null = null;
  private modelWithTools: any = null;
  private modelName: string;
  private tools: any[];

  constructor(model: string | null = null) {
    this.modelName = model || process.env.AI_MODEL || "gemini-1.5-flash";
    this.tools = getAllTools();
  }

  /**
   * Get or create the model instance (lazy initialization)
   */
  private getModel(): ChatGoogleGenerativeAI {
    if (!this.model) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable is required");
      }
      this.model = new ChatGoogleGenerativeAI({
        model: this.modelName,
        apiKey,
      });
    }
    return this.model;
  }

  /**
   * Get model with tools bound
   */
  private getModelWithTools() {
    if (!this.modelWithTools) {
      const model = this.getModel();
      if (this.tools.length > 0) {
        this.modelWithTools = model.bindTools(this.tools);
      } else {
        this.modelWithTools = model;
      }
    }
    return this.modelWithTools;
  }

  /**
   * Validate messages format
   */
  validateMessages(messages: ChatMessage[]): boolean {
    if (!Array.isArray(messages)) {
      throw new Error("Messages must be an array");
    }
    if (messages.length === 0) {
      throw new Error("Messages array cannot be empty");
    }
    return true;
  }

  /**
   * Build context prompt from user-provided contexts
   */
  buildContextPrompt(contexts: AIContext[]): string {
    if (!contexts || contexts.length === 0) return "";

    let contextPrompt =
      "\n\n## USER PROVIDED CONTEXT:\nThe user has selected the following items to provide context for this conversation. Use this information to better understand what they want to work with:\n";

    for (const ctx of contexts) {
      contextPrompt += `\n### ${ctx.type.toUpperCase()}: ${ctx.name}`;

      if (ctx.type === "connection" && ctx.metadata) {
        if (ctx.metadata.connectionType) {
          contextPrompt += ` (${ctx.metadata.connectionType} database)`;
        }
        if (ctx.metadata.tables && ctx.metadata.tables.length > 0) {
          contextPrompt += `\n   Selected tables: ${ctx.metadata.tables.join(", ")}`;
        }
      }

      if (ctx.type === "dataset" && ctx.metadata) {
        if (ctx.metadata.datasetType) {
          contextPrompt += ` (${ctx.metadata.datasetType} dataset)`;
        }
        if (ctx.metadata.columns && ctx.metadata.columns.length > 0) {
          contextPrompt += `\n   Available columns: ${ctx.metadata.columns.slice(0, 10).join(", ")}${ctx.metadata.columns.length > 10 ? "..." : ""}`;
        }
      }

      if (ctx.type === "chart" && ctx.metadata?.chartType) {
        contextPrompt += ` (${ctx.metadata.chartType} chart)`;
      }

      if (ctx.type === "component" && ctx.metadata) {
        contextPrompt += ` (custom HTML/CSS/JS component)`;
        if (ctx.metadata.datasetType) {
          contextPrompt += `\n   Data source: ${ctx.metadata.datasetType}`;
        }
      }

      if (ctx.customText) {
        contextPrompt += `\n   User notes: ${ctx.customText}`;
      }

      contextPrompt += "\n";
    }

    contextPrompt +=
      "\nWhen responding, prioritize working with the above context items. If the user asks about data, queries, or visualizations, assume they want to use the selected contexts unless they specify otherwise.";

    return contextPrompt;
  }

  /**
   * Convert messages to LangChain format
   */
  convertToLangChainMessages(messages: ChatMessage[], contexts: AIContext[] = []): BaseMessage[] {
    const langChainMessages: BaseMessage[] = [];

    // Check if there's already a system message
    const hasSystem = messages.some((m) => m.role === "system");

    if (!hasSystem) {
      // Build context-aware system prompt
      const contextPrompt = this.buildContextPrompt(contexts);
      langChainMessages.push(new SystemMessage(SYSTEM_PROMPT + contextPrompt));
    }

    for (const msg of messages) {
      switch (msg.role) {
        case "system":
          langChainMessages.push(new SystemMessage(msg.content));
          break;
        case "user":
          langChainMessages.push(new HumanMessage(msg.content));
          break;
        case "assistant":
          langChainMessages.push(new AIMessage(msg.content));
          break;
      }
    }

    return langChainMessages;
  }

  /**
   * Execute a tool call
   */
  async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
    console.log(`[AI SERVICE] Executing tool: ${toolCall.name}`);
    
    const tool = this.tools.find((t) => t.name === toolCall.name);
    if (!tool) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: JSON.stringify({ error: `Tool not found: ${toolCall.name}` }),
      };
    }

    try {
      const result = await tool.invoke(toolCall.args);
      console.log(`[AI SERVICE] Tool ${toolCall.name} executed successfully`);
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
      };
    } catch (error: any) {
      console.error(`[AI SERVICE] Tool execution error:`, error);
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: JSON.stringify({ error: error.message || "Tool execution failed" }),
      };
    }
  }

  /**
   * Run chat with LangChain and tool support
   */
  async runChat(
    messages: ChatMessage[], 
    contexts: AIContext[] = [],
    options?: {
      sessionId?: string;
      userId?: string;
      tags?: string[];
    }
  ) {
    console.log("[AI SERVICE] Chat called with", messages.length, "messages");
    if (contexts && contexts.length > 0) {
      console.log("[AI SERVICE] Context items:", contexts.length);
    }

    this.validateMessages(messages);

    const langChainMessages = this.convertToLangChainMessages(messages, contexts);
    console.log("[AI SERVICE] Messages prepared, invoking LangChain with tools...");

    // Create Langfuse handler for tracing (if enabled)
    const langfuseHandler = createLangfuseHandler({
      sessionId: options?.sessionId,
      userId: options?.userId,
      tags: options?.tags || ["uptake-chat"],
    });

    // Build callback config
    const callbackConfig = langfuseHandler 
      ? { callbacks: [langfuseHandler] } 
      : {};

    try {
      const modelWithTools = this.getModelWithTools();
      let response = await modelWithTools.invoke(langChainMessages, callbackConfig);
      
      // Handle tool calls in a loop
      const allToolCalls: ToolCall[] = [];
      const allToolResults: ToolResult[] = [];

      while (response.tool_calls && response.tool_calls.length > 0) {
        console.log(`[AI SERVICE] Model requested ${response.tool_calls.length} tool call(s)`);
        
        // Add assistant message with tool calls
        langChainMessages.push(response);
        
        // Execute all tool calls
        for (const toolCall of response.tool_calls) {
          const tc: ToolCall = {
            name: toolCall.name,
            args: toolCall.args,
            id: toolCall.id || `call_${Date.now()}`,
          };
          allToolCalls.push(tc);
          
          const result = await this.executeToolCall(tc);
          allToolResults.push(result);
          
          // Add tool result message
          langChainMessages.push(new ToolMessage({
            tool_call_id: tc.id,
            content: typeof result.result === "string" ? result.result : JSON.stringify(result.result),
          }));
        }
        
        // Get next response from model
        response = await modelWithTools.invoke(langChainMessages, callbackConfig);
      }

      const text =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

      console.log("[AI SERVICE] Response received. Text length:", text.length);
      console.log("[AI SERVICE] Total tool calls:", allToolCalls.length);

      // Log Langfuse trace ID for debugging (if available)
      if (langfuseHandler && langfuseHandler.last_trace_id) {
        console.log("[AI SERVICE] Langfuse trace ID:", langfuseHandler.last_trace_id);
      }

      return {
        text: text || "No response.",
        model: this.modelName,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : null,
        toolResults: allToolResults.length > 0 ? allToolResults : null,
        widgets: null,
      };
    } catch (error) {
      console.error("[AI SERVICE] Error invoking LangChain:", error);
      throw error;
    }
  }

  /**
   * Get available tools metadata
   */
  getAvailableTools() {
    return this.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  }

  /**
   * Set custom model
   */
  setModel(model: string) {
    this.modelName = model;
    this.model = null;
    this.modelWithTools = null;
    return this;
  }

  /**
   * Refresh tools (useful if tools are dynamically updated)
   */
  refreshTools() {
    this.tools = getAllTools();
    this.modelWithTools = null;
    return this;
  }
}

export default AIService;
