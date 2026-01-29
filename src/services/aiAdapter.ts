// @ts-nocheck
/**
 * AI Adapter - Backward Compatibility Layer
 * Maintains existing API while using new refactored service
 */

import AIService from "./aiService.js";

const aiService = new AIService();

/**
 * Legacy function - maintained for backward compatibility
 * Consider using AIService directly in new code
 */
export async function runChat(messages) {
  return aiService.runChat(messages);
}

/**
 * Export service for direct usage
 */
export { AIService as default };
