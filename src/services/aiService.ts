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
3. **Chart Creation**: Create various charts (bar, line, pie, area, scatter, table, etc.)
4. **Dashboard Management**: Create and organize dashboards with multiple charts
5. **Connection Management**: Add, test, and manage database connections
6. **Query Management**: Save and reuse SQL queries

## Guidelines:
- When asked to create a chart, first explore the schema to understand available columns
- Always use the appropriate tool - don't just describe what should be done, DO IT
- For data questions, first list available connections if none is specified
- When creating charts, ask for clarification on chart type and axes if not specified
- Provide helpful summaries of tool results in natural language
- If a tool call fails, explain the error and suggest solutions
- For complex requests, break them down into steps and execute each

## Chart Types Available:
- bar: Compare categories
- line: Show trends over time
- pie/donut: Show proportions
- area: Show cumulative trends
- scatter: Show correlations
- table: Display tabular data
- number: Single KPI value
- gauge: Progress indicator

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
   * Add system prompt to messages if not present
   */
  prepareMessages(messages) {
    // Check if there's already a system message
    const hasSystem = messages.some((m) => m.role === "system");
    if (hasSystem) {
      return messages;
    }
    // Prepend system message
    return [{ role: "system", content: SYSTEM_PROMPT }, ...messages];
  }

  /**
   * Run chat with accumulated text from stream
   */
  async runChat(messages) {
    console.log("[AI SERVICE] Chat called with", messages.length, "messages");
    console.log("[AI SERVICE] Available tools:", this.tools.length, "tools");
    this.validateMessages(messages);
    const preparedMessages = this.prepareMessages(messages);
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
