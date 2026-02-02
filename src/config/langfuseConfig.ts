/**
 * Langfuse Configuration
 * LLM observability and tracing for LangChain.js
 * 
 * Langfuse reads credentials from environment variables automatically:
 * - LANGFUSE_SECRET_KEY
 * - LANGFUSE_PUBLIC_KEY
 * - LANGFUSE_BASE_URL (optional, defaults to https://cloud.langfuse.com)
 * 
 * @see https://langfuse.com/docs/integrations/langchain/tracing
 */

import { CallbackHandler } from "@langfuse/langchain";

interface LangfuseConfig {
  enabled: boolean;
  secretKey?: string;
  publicKey?: string;
  baseUrl?: string;
}

/**
 * Get Langfuse configuration from environment variables
 */
export function getLangfuseConfig(): LangfuseConfig {
  return {
    enabled: process.env.LANGFUSE_ENABLED === "true",
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
  };
}

/**
 * Check if Langfuse is properly configured and enabled
 */
export function isLangfuseEnabled(): boolean {
  const config = getLangfuseConfig();
  
  if (!config.enabled) {
    return false;
  }
  
  if (!config.secretKey || !config.publicKey) {
    console.warn("[LANGFUSE] Enabled but missing API keys. Set LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY.");
    return false;
  }
  
  return true;
}

/**
 * Create a Langfuse callback handler for LangChain tracing
 * 
 * Note: Langfuse reads credentials from environment variables automatically:
 * - LANGFUSE_SECRET_KEY
 * - LANGFUSE_PUBLIC_KEY  
 * - LANGFUSE_BASE_URL
 * 
 * @param options - Optional trace attributes
 * @returns CallbackHandler instance or null if Langfuse is not enabled
 */
export function createLangfuseHandler(options?: {
  sessionId?: string;
  userId?: string;
  tags?: string[];
  version?: string;
  traceMetadata?: Record<string, unknown>;
}): CallbackHandler | null {
  if (!isLangfuseEnabled()) {
    return null;
  }
  
  try {
    // CallbackHandler reads API keys from environment variables automatically
    const handler = new CallbackHandler({
      sessionId: options?.sessionId,
      userId: options?.userId,
      tags: options?.tags,
      version: options?.version,
      traceMetadata: options?.traceMetadata,
    });
    
    console.log("[LANGFUSE] Handler created", {
      sessionId: options?.sessionId,
      userId: options?.userId,
      tags: options?.tags,
    });
    
    return handler;
  } catch (error) {
    console.error("[LANGFUSE] Failed to create handler:", error);
    return null;
  }
}
