/**
 * Prisma Client Singleton with Multi-Database Support
 * Supports both SQLite (default) and PostgreSQL based on DATABASE_URL
 * Using driver adapters for Prisma 7 compatibility
 */

import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Get the database URL from environment
 */
function getDatabaseUrl(): string {
  return process.env.DATABASE_URL || "file:./data/uptake.db";
}

/**
 * Check if the database URL is for PostgreSQL
 */
function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

/**
 * Create the appropriate database adapter based on DATABASE_URL
 */
function createAdapter(databaseUrl: string) {
  if (isPostgresUrl(databaseUrl)) {
    // PostgreSQL adapter
    console.log("📦 Using PostgreSQL adapter");
    return new PrismaPg({ connectionString: databaseUrl });
  } else {
    // SQLite adapter (default)
    console.log("📦 Using SQLite adapter");
    return new PrismaBetterSqlite3(
      { url: databaseUrl },
      { timestampFormat: "unixepoch-ms" } // For backward compatibility with existing SQLite database
    );
  }
}

const databaseUrl = getDatabaseUrl();
const adapter = createAdapter(databaseUrl);

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
 * Check if using PostgreSQL database
 */
export function isUsingPostgres(): boolean {
  return isPostgresUrl(getDatabaseUrl());
}

/**
 * Initialize Prisma (connect to database)
 */
export async function initializePrisma(): Promise<void> {
  try {
    await prisma.$connect();
    const dbType = isPostgresUrl(getDatabaseUrl()) ? "PostgreSQL" : "SQLite";
    console.log(`✓ Prisma connected to ${dbType} database`);
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
