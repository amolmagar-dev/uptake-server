/**
 * Database Module Index
 * Main entry point for all database operations
 */

// Export Prisma client instance
export { prisma, initializePrisma, disconnectPrisma } from "./client.js";

// Export all repositories
export * from "./repositories/index.js";
