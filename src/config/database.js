import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Local SQLite database for storing app data (connections, dashboards, charts, users)
const dbPath = join(__dirname, "../../data/uptake.db");
const db = new Database(dbPath);

// Initialize tables
export async function initializeDatabase() {
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT,
      role TEXT DEFAULT 'viewer',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Database connections table
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      host TEXT,
      port INTEGER,
      database_name TEXT,
      username TEXT,
      password TEXT,
      ssl INTEGER DEFAULT 0,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  // Saved queries table
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_queries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sql_query TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connection_id) REFERENCES connections(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  // Charts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS charts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      chart_type TEXT NOT NULL,
      config TEXT NOT NULL,
      query_id TEXT,
      sql_query TEXT,
      connection_id TEXT NOT NULL,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (query_id) REFERENCES saved_queries(id),
      FOREIGN KEY (connection_id) REFERENCES connections(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  // Dashboards table
  db.exec(`
    CREATE TABLE IF NOT EXISTS dashboards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      layout TEXT NOT NULL,
      is_public INTEGER DEFAULT 0,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  // Dashboard charts junction table
  db.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_charts (
      id TEXT PRIMARY KEY,
      dashboard_id TEXT NOT NULL,
      chart_id TEXT NOT NULL,
      position_x INTEGER DEFAULT 0,
      position_y INTEGER DEFAULT 0,
      width INTEGER DEFAULT 6,
      height INTEGER DEFAULT 4,
      FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE,
      FOREIGN KEY (chart_id) REFERENCES charts(id) ON DELETE CASCADE
    )
  `);

  // Create default admin user if not exists
  const adminEmail = process.env.ADMIN_EMAIL || "admin@uptake.local";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

  const existingAdmin = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
  if (!existingAdmin) {
    const hashedPassword = bcrypt.hashSync(adminPassword, 10);
    db.prepare(
      `
      INSERT INTO users (id, email, password, name, role) 
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(uuidv4(), adminEmail, hashedPassword, "Administrator", "admin");
    console.log(`Created default admin user: ${adminEmail}`);
  }
}

export default db;
