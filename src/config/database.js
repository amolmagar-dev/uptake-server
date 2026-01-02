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

  // Migration: Add config column to connections for API and Google Sheets
  const connectionsTableInfo = db.pragma('table_info(connections)');
  const hasConfigColumn = connectionsTableInfo.some(col => col.name === 'config');
  if (!hasConfigColumn) {
    console.log('Migrating connections table to add config column...');
    db.exec(`ALTER TABLE connections ADD COLUMN config TEXT`);
    console.log('Connections table migration complete!');
  }

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

  // Datasets table - abstraction layer between connections and charts
  db.exec(`
    CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      source_type TEXT NOT NULL DEFAULT 'sql',
      dataset_type TEXT NOT NULL DEFAULT 'physical',
      connection_id TEXT,
      table_name TEXT,
      table_schema TEXT DEFAULT 'public',
      sql_query TEXT,
      source_config TEXT,
      columns TEXT,
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
      connection_id TEXT,
      dataset_id TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (query_id) REFERENCES saved_queries(id),
      FOREIGN KEY (connection_id) REFERENCES connections(id),
      FOREIGN KEY (dataset_id) REFERENCES datasets(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  // Migration: Add dataset_id column to existing charts table if not exists
  const chartsTableInfo = db.pragma('table_info(charts)');
  const hasDatasetId = chartsTableInfo.some(col => col.name === 'dataset_id');
  if (!hasDatasetId) {
    console.log('Migrating charts table to add dataset_id column...');
    db.exec(`ALTER TABLE charts ADD COLUMN dataset_id TEXT REFERENCES datasets(id)`);
    console.log('Charts table migration complete!');
  }

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

  // Migration: Add filters column to dashboards table
  const dashboardsTableInfo = db.pragma('table_info(dashboards)');
  const hasFiltersColumn = dashboardsTableInfo.some(col => col.name === 'filters');
  if (!hasFiltersColumn) {
    console.log('Migrating dashboards table to add filters column...');
    db.exec(`ALTER TABLE dashboards ADD COLUMN filters TEXT DEFAULT '[]'`);
    console.log('Dashboards table migration complete!');
  }

  // Dashboard charts junction table (supports both charts and custom components)
  // Check if we need to migrate the old table (chart_id was NOT NULL before)
  const tableInfo = db.pragma('table_info(dashboard_charts)');
  const needsMigration = tableInfo.some(col => col.name === 'chart_id' && col.notnull === 1);
  
  if (needsMigration) {
    console.log('Migrating dashboard_charts table to support custom components...');
    // Backup existing data
    db.exec(`CREATE TABLE IF NOT EXISTS dashboard_charts_backup AS SELECT * FROM dashboard_charts`);
    // Drop old table
    db.exec(`DROP TABLE dashboard_charts`);
    // Create new table with nullable chart_id and component_id
    db.exec(`
      CREATE TABLE dashboard_charts (
        id TEXT PRIMARY KEY,
        dashboard_id TEXT NOT NULL,
        chart_id TEXT,
        component_id TEXT,
        position_x INTEGER DEFAULT 0,
        position_y INTEGER DEFAULT 0,
        width INTEGER DEFAULT 6,
        height INTEGER DEFAULT 4,
        FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE,
        FOREIGN KEY (chart_id) REFERENCES charts(id) ON DELETE CASCADE,
        FOREIGN KEY (component_id) REFERENCES custom_components(id) ON DELETE CASCADE
      )
    `);
    // Restore data
    db.exec(`INSERT INTO dashboard_charts SELECT *, NULL FROM dashboard_charts_backup`);
    db.exec(`DROP TABLE dashboard_charts_backup`);
    console.log('Migration complete!');
  } else if (tableInfo.length === 0) {
    // Table doesn't exist, create it fresh
    db.exec(`
      CREATE TABLE IF NOT EXISTS dashboard_charts (
        id TEXT PRIMARY KEY,
        dashboard_id TEXT NOT NULL,
        chart_id TEXT,
        component_id TEXT,
        position_x INTEGER DEFAULT 0,
        position_y INTEGER DEFAULT 0,
        width INTEGER DEFAULT 6,
        height INTEGER DEFAULT 4,
        FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE,
        FOREIGN KEY (chart_id) REFERENCES charts(id) ON DELETE CASCADE,
        FOREIGN KEY (component_id) REFERENCES custom_components(id) ON DELETE CASCADE
      )
    `);
  }

  // Custom components table for user-created HTML/CSS/JS components
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_components (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      html_content TEXT NOT NULL,
      css_content TEXT,
      js_content TEXT,
      config TEXT,
      connection_id TEXT,
      sql_query TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connection_id) REFERENCES connections(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  // Migration: Add dataset_id column to custom_components if not exists
  const componentsTableInfo = db.pragma('table_info(custom_components)');
  const hasComponentDatasetId = componentsTableInfo.some(col => col.name === 'dataset_id');
  if (!hasComponentDatasetId) {
    console.log('Migrating custom_components table to add dataset_id column...');
    db.exec(`ALTER TABLE custom_components ADD COLUMN dataset_id TEXT REFERENCES datasets(id)`);
    console.log('Custom components table migration complete!');
  }

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
