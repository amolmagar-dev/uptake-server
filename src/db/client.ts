/**
 * Prisma Client Singleton with SQLite Driver Adapter
 * Ensures only one instance of Prisma Client exists throughout the application
 * Using better-sqlite3 driver adapter for Prisma 7 compatibility
 */

import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Create adapter for better-sqlite3
const adapter = new PrismaBetterSqlite3(
  { url: process.env.DATABASE_URL || "file:./data/uptake.db" },
  { timestampFormat: "unixepoch-ms" } // For backward compatibility with existing SQLite database
);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Initialize Prisma (connect to database)
 */
export async function initializePrisma(): Promise<void> {
  try {
    await prisma.$connect();
    console.log("✓ Prisma connected to database");
  } catch (error) {
    console.error("Failed to connect to database:", error);
    throw error;
  }
}

/**
 * Disconnect Prisma (cleanup on server shutdown)
 */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  console.log("✓ Prisma disconnected from database");
}

// Graceful shutdown
process.on("beforeExit", async () => {
  await disconnectPrisma();
});
