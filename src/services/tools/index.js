/**
 * Tool Registry for AI Adapter
 * Centralized place to manage all available tools
 */

import { getCalendarEventsTool } from "./calendar.js";

/**
 * Get all tool definitions for the AI chat
 * Returns the actual toolDefinition objects that the adapter expects
 */
export const getAllTools = () => [getCalendarEventsTool.definition];

/**
 * Get metadata about available tools for documentation/discovery
 */
export const getToolsMetadata = () => [
  {
    name: getCalendarEventsTool.name,
    description: getCalendarEventsTool.definition.description,
  },
];
