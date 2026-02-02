/**
 * OpenTelemetry Instrumentation for Langfuse
 * 
 * This file initializes the OpenTelemetry SDK with the Langfuse span processor.
 * It MUST be imported at the very top of your entry point (index.ts) before any other imports.
 * 
 * Langfuse reads credentials from environment variables:
 * - LANGFUSE_SECRET_KEY
 * - LANGFUSE_PUBLIC_KEY
 * - LANGFUSE_BASE_URL
 * 
 * @see https://langfuse.com/docs/observability/get-started
 */

// Load environment variables FIRST (before any other code runs)
import dotenv from "dotenv";
dotenv.config();

import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

let sdk: NodeSDK | null = null;

/**
 * Check if Langfuse is enabled based on environment variables
 */
function isLangfuseEnabled(): boolean {
  const enabled = process.env.LANGFUSE_ENABLED === "true";
  const hasKeys = !!(process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY);
  
  // Debug logging
  console.log("[LANGFUSE] Config check:", {
    LANGFUSE_ENABLED: process.env.LANGFUSE_ENABLED,
    hasSecretKey: !!process.env.LANGFUSE_SECRET_KEY,
    hasPublicKey: !!process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
  });
  
  if (enabled && !hasKeys) {
    console.warn("[LANGFUSE] Enabled but missing API keys. Set LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY.");
    return false;
  }
  
  return enabled && hasKeys;
}

/**
 * Initialize OpenTelemetry with Langfuse if enabled
 */
export function initLangfuse(): void {
  if (!isLangfuseEnabled()) {
    console.log("[LANGFUSE] Tracing is disabled (set LANGFUSE_ENABLED=true to enable)");
    return;
  }
  
  try {
    sdk = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor()],
    });
    
    sdk.start();
    console.log("[LANGFUSE] OpenTelemetry SDK started with Langfuse span processor");
  } catch (error) {
    console.error("[LANGFUSE] Failed to initialize OpenTelemetry SDK:", error);
  }
}

/**
 * Shutdown the OpenTelemetry SDK (for graceful shutdown)
 */
export async function shutdownLangfuse(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      console.log("[LANGFUSE] OpenTelemetry SDK shutdown complete");
    } catch (error) {
      console.error("[LANGFUSE] Error during shutdown:", error);
    }
  }
}

// Auto-initialize when this module is imported
initLangfuse();
