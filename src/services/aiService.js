/**
 * AI Service
 * Core AI functionality and chat management
 */

import { chat } from "@tanstack/ai";
import { geminiText } from "@tanstack/ai-gemini";
import { getAllTools } from "./tools/index.js";

const DEFAULT_MODEL = "gemini-2.0-flash";

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
   * Run chat with accumulated text from stream
   */
  async runChat(messages) {
    this.validateMessages(messages);

    const stream = chat({
      adapter: geminiText(this.model),
      messages,
      tools: this.tools,
    });

    // Accumulate text from stream chunks
    let text = "";
    let toolCalls = [];

    for await (const chunk of stream) {
      if (chunk.type === "content" && chunk.content) {
        text = chunk.content; // content is cumulative, not delta
      }
      if (chunk.type === "tool-call") {
        toolCalls.push(chunk);
      }
    }

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
