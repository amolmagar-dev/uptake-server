// @ts-nocheck
/**
 * AI Service
 * Core AI functionality and chat management
 */

import { chat } from "@tanstack/ai";
import { geminiText } from "@tanstack/ai-gemini";
import { getAllTools } from "./tools/index.js";

const DEFAULT_MODEL = "gemini-2.5-pro";

const SYSTEM_PROMPT = `You are an intelligent data assistant for Uptake, a data visualization and dashboard platform. You have full access to the project's capabilities through tools.

## Your Capabilities:
1. **Database Operations**: Execute SQL queries on connected databases
2. **Schema Exploration**: Explore tables, columns, and relationships in databases
3. **Dataset Management**: Create and manage datasets (data sources for charts)
4. **Chart Creation**: Create various charts (bar, line, pie, area, scatter, table, etc.)
5. **Dashboard Management**: Create and organize dashboards with multiple charts
6. **Connection Management**: Add, test, and manage database connections
7. **Query Management**: Save and reuse SQL queries
8. **Custom Component Management**: Create custom HTML/CSS/JS components for specialized visualizations

## Guidelines:
- When asked to create a chart, first create a dataset, then create the chart using that dataset
- For custom components, create HTML/CSS/JS and optionally link to a dataset for dynamic data
- Always use the appropriate tool - don't just describe what should be done, DO IT
- For data questions, first list available connections if none is specified
- When creating charts, ask for clarification on chart type and axes if not specified
- Provide helpful summaries of tool results in natural language
- If a tool call fails, explain the error and suggest solutions
- For complex requests, break them down into steps and execute each

## IMPORTANT - Tool Call Rules:
- **Make ONE tool call at a time.** Wait for the result before making the next call.
- Do NOT try to batch multiple tool calls together.
- When adding multiple charts to a dashboard, add them one at a time.

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
- Virtual: Uses a custom SQL query (for filtering columns, joining tables, etc.)

Remember: You can execute actions directly. Don't just tell users what to do - help them by doing it!`;

class AIService {
  constructor(model = null) {
    this.model = model || process.env.AI_MODEL || DEFAULT_MODEL;
    this.tools = getAllTools();
  }

  /**
   * Validate messages format
   */
  validateMessages(messages) {
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
  buildContextPrompt(contexts) {
    if (!contexts || contexts.length === 0) return '';

    let contextPrompt = '\n\n## USER PROVIDED CONTEXT:\nThe user has selected the following items to provide context for this conversation. Use this information to better understand what they want to work with:\n';

    for (const ctx of contexts) {
      contextPrompt += `\n### ${ctx.type.toUpperCase()}: ${ctx.name}`;
      
      if (ctx.type === 'connection' && ctx.metadata) {
        if (ctx.metadata.connectionType) {
          contextPrompt += ` (${ctx.metadata.connectionType} database)`;
        }
        if (ctx.metadata.tables && ctx.metadata.tables.length > 0) {
          contextPrompt += `\n   Selected tables: ${ctx.metadata.tables.join(', ')}`;
        }
      }
      
      if (ctx.type === 'dataset' && ctx.metadata) {
        if (ctx.metadata.datasetType) {
          contextPrompt += ` (${ctx.metadata.datasetType} dataset)`;
        }
        if (ctx.metadata.columns && ctx.metadata.columns.length > 0) {
          contextPrompt += `\n   Available columns: ${ctx.metadata.columns.slice(0, 10).join(', ')}${ctx.metadata.columns.length > 10 ? '...' : ''}`;
        }
      }
      
      if (ctx.type === 'chart' && ctx.metadata?.chartType) {
        contextPrompt += ` (${ctx.metadata.chartType} chart)`;
      }

      if (ctx.type === 'component' && ctx.metadata) {
        contextPrompt += ` (custom HTML/CSS/JS component)`;
        if (ctx.metadata.datasetType) {
          contextPrompt += `\n   Data source: ${ctx.metadata.datasetType}`;
        }
      }
      
      if (ctx.customText) {
        contextPrompt += `\n   User notes: ${ctx.customText}`;
      }
      
      contextPrompt += '\n';
    }

    contextPrompt += '\nWhen responding, prioritize working with the above context items. If the user asks about data, queries, or visualizations, assume they want to use the selected contexts unless they specify otherwise.';

    return contextPrompt;
  }

  /**
   * Add system prompt to messages if not present
   */
  prepareMessages(messages, contexts = []) {
    // Check if there's already a system message
    const hasSystem = messages.some((m) => m.role === "system");
    if (hasSystem) {
      return messages;
    }
    // Build context-aware system prompt
    const contextPrompt = this.buildContextPrompt(contexts);
    // Prepend system message with context
    return [{ role: "system", content: SYSTEM_PROMPT + contextPrompt }, ...messages];
  }

  /**
   * Run chat with accumulated text from stream
   */
  async runChat(messages, contexts = []) {
    console.log("[AI SERVICE] Chat called with", messages.length, "messages");
    if (contexts && contexts.length > 0) {
      console.log("[AI SERVICE] Context items:", contexts.length);
    }
    console.log("[AI SERVICE] Available tools:", this.tools.length, "tools");
    this.validateMessages(messages);
    const preparedMessages = this.prepareMessages(messages, contexts);
    console.log("[AI SERVICE] Messages prepared, starting chat stream...");
    const stream = chat({
      adapter: geminiText(this.model),
      messages: preparedMessages,
      tools: this.tools.length > 0 ? this.tools : undefined,
    });

    // Accumulate text from stream chunks
    let text = "";
    let toolCalls = [];

    for await (const chunk of stream) {
      if (chunk.type === "content" && chunk.content) {
        console.log("[AI SERVICE] Content chunk received, length:", chunk.content.length);
        text = chunk.content; // content is cumulative, not delta
      }
      if (chunk.type === "tool-call") {
        console.log("[AI SERVICE] Tool call detected:", chunk.toolName || chunk.name);
        toolCalls.push(chunk);
      }
    }

    console.log("[AI SERVICE] Stream complete. Text length:", text.length, "Tool calls:", toolCalls.length);
    return {
      text: text || "No response.",
      model: this.model,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
    };
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
  setModel(model) {
    this.model = model;
    return this;
  }
}

export default AIService;
