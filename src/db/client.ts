/**
 * Prisma Client Singleton with PostgreSQL Support
 * Using driver adapter for Prisma 7 compatibility
 */

// Load environment variables FIRST before any other imports
import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Get the database URL from environment
 */
function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  return url;
}

const databaseUrl = getDatabaseUrl();

// Create PostgreSQL adapter
console.log("📦 Using PostgreSQL adapter");
const adapter = new PrismaPg({ connectionString: databaseUrl });

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
    console.log("✓ Prisma connected to PostgreSQL database");
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
