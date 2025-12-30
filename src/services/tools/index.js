/**
 * Tool Registry for AI Adapter
 * Centralized place to manage all available tools
 * These tools execute actual actions, not just provide guidance
 */

import listTables from "./listTables.js";
import listConnections from "./listConnections.js";

// All available tools - pass directly to chat
export const getAllTools = () => [listTables, listConnections];
