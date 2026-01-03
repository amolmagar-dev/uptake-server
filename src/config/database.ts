/**
 * Database Configuration and Initialization
 * Uses Prisma ORM for database operations
 */

import { initializePrisma, userRepository } from "../db/index.js";

/**
 * Initialize the database
 * - Connect to the database via Prisma
 * - Create default admin user if not exists
 */
export async function initializeDatabase(): Promise<void> {
  // Connect to database
  await initializePrisma();

  // Create default admin user if not exists
  const adminEmail = process.env.ADMIN_EMAIL || "admin@uptake.local";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

  await userRepository.createDefaultAdmin(adminEmail, adminPassword);
}
