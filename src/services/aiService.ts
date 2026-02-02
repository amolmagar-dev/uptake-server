/**
 * AI Service
 * Core AI functionality and chat management using LangChain.js
 */

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage, AIMessage, ToolMessage, BaseMessage } from "@langchain/core/messages";
import { getAllTools } from "./tools/index.js";
import { createLangfuseHandler } from "../config/langfuseConfig.js";

const SYSTEM_PROMPT = `You are an intelligent data assistant for Uptake, a data visualization and dashboard platform.

## YOUR CAPABILITIES
You help users with:
- Database connections (PostgreSQL, MySQL, SQLite)
- Schema exploration and SQL queries
- Dataset creation and management
- Chart and dashboard visualization
- Custom HTML/CSS/JS components

## TOOL ROUTING RULES
Use these rules to select the correct tool:

### Connections
- "list connections" / "show connections" / "what connections" → use \`list_connections\`
- "create/update/delete/test connection" → use \`connection_management\`

### Database
- "list tables" / "what tables" / "show tables" → use \`list_tables\`
- "describe table" / "table schema" / "columns in" → use \`schema_explorer\`
- "run query" / "execute SQL" / "SELECT/INSERT/UPDATE" → use \`database_operations\`
- "save query" / "saved queries" → use \`query_management\`

### Visualization
- "create chart" / "make chart" / "visualize" → use \`chart_management\` with action=create
- "list/update/delete chart" → use \`chart_management\`
- "create dashboard" / "make dashboard" → use \`dashboard_management\` with action=create  
- "list/update/delete dashboard" → use \`dashboard_management\`

### Data
- "create dataset" / "manage dataset" → use \`dataset_management\`
- "project overview" / "search" / "help" → use \`project_helper\`

### Components
- "custom component" / "HTML component" → use \`custom_component_management\`

## CHART TYPES
| Type | Use When |
|------|----------|
| bar | Comparing categories |
| line | Showing trends over time |
| pie/donut | Showing proportions (few categories) |
| area | Cumulative trends |
| scatter | Correlations between variables |
| table | Displaying raw data |
| number | Single KPI/metric |
| gauge | Progress toward a goal |

## DATASET TYPES
- **Physical**: References a database table directly (simple, fast)
- **Virtual**: Uses custom SQL query (for joins, filters, aggregations)

## OUTPUT GUIDELINES
1. Always report tool results clearly to the user
2. If a tool returns an error, explain what went wrong and suggest fixes
3. When creating resources, confirm the name and key settings used
4. For queries, show a preview of results (first few rows)
5. Be concise but thorough

## ERROR HANDLING
- If a connection is not found, list available connections
- If a required parameter is missing, ask the user for it
- If authorization fails, suggest checking credentials`;

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
