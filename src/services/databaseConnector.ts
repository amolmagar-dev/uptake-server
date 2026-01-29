// @ts-nocheck
import pg from "pg";
import mysql from "mysql2/promise";

const { Pool } = pg;

// Connection pool cache
const connectionPools = new Map();

export async function getConnection(connectionConfig) {
  const { id, type, host, port, database_name, username, password, ssl } = connectionConfig;

  // Check if we already have a pool for this connection
  if (connectionPools.has(id)) {
    return connectionPools.get(id);
  }

  let pool;

  switch (type.toLowerCase()) {
    case "postgresql":
    case "postgres":
      pool = new Pool({
        host,
        port: port || 5432,
        database: database_name,
        user: username,
        password,
        ssl: ssl ? { rejectUnauthorized: false } : false,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });
      break;

    case "mysql":
    case "mariadb":
      pool = mysql.createPool({
        host,
        port: port || 3306,
        database: database_name,
        user: username,
        password,
        ssl: ssl ? { rejectUnauthorized: false } : undefined,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      });
      break;

    default:
      throw new Error(`Unsupported database type: ${type}`);
  }

  connectionPools.set(id, { pool, type });
  return { pool, type };
}

export async function executeQuery(connectionConfig, sqlQuery, params = []) {
  const { pool, type } = await getConnection(connectionConfig);

  const startTime = Date.now();
  let result;

  try {
    switch (type.toLowerCase()) {
      case "postgresql":
      case "postgres":
        result = await pool.query(sqlQuery, params);
        return {
          rows: result.rows,
          fields: result.fields?.map((f) => ({ name: f.name, dataType: f.dataTypeID })),
          rowCount: result.rowCount,
          executionTime: Date.now() - startTime,
        };

      case "mysql":
      case "mariadb":
        const [rows, fields] = await pool.execute(sqlQuery, params);
        return {
          rows: Array.isArray(rows) ? rows : [],
          fields: fields?.map((f) => ({ name: f.name, dataType: f.type })),
          rowCount: Array.isArray(rows) ? rows.length : 0,
          executionTime: Date.now() - startTime,
        };

      default:
        throw new Error(`Unsupported database type: ${type}`);
    }
  } catch (error) {
    throw new Error(`Query execution failed: ${error.message}`);
  }
}

export async function testConnection(connectionConfig) {
  try {
    const { pool, type } = await getConnection(connectionConfig);

    // Test query based on database type
    let testQuery;
    switch (type.toLowerCase()) {
      case "postgresql":
      case "postgres":
        testQuery = "SELECT 1 as test";
        break;
      case "mysql":
      case "mariadb":
        testQuery = "SELECT 1 as test";
        break;
      default:
        testQuery = "SELECT 1";
    }

    await executeQuery(connectionConfig, testQuery);
    return { success: true, message: "Connection successful" };
  } catch (error) {
    // Remove failed connection from cache
    connectionPools.delete(connectionConfig.id);
    return { success: false, message: error.message };
  }
}

export async function getTableList(connectionConfig) {
  const { type } = connectionConfig;

  let query;
  switch (type.toLowerCase()) {
    case "postgresql":
    case "postgres":
      query = `
        SELECT table_schema, table_name, table_type
        FROM information_schema.tables 
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
      `;
      break;
    case "mysql":
    case "mariadb":
      query = `
        SELECT table_schema, table_name, table_type
        FROM information_schema.tables 
        WHERE table_schema = DATABASE()
        ORDER BY table_name
      `;
      break;
    default:
      throw new Error(`Unsupported database type: ${type}`);
  }

  const result = await executeQuery(connectionConfig, query);
  return result.rows;
}

export async function getTableSchema(connectionConfig, tableName, schema = "public") {
  const { type } = connectionConfig;

  let query;
  switch (type.toLowerCase()) {
    case "postgresql":
    case "postgres":
      query = `
        SELECT 
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length
        FROM information_schema.columns 
        WHERE table_name = $1 AND table_schema = $2
        ORDER BY ordinal_position
      `;
      return (await executeQuery(connectionConfig, query, [tableName, schema])).rows;

    case "mysql":
    case "mariadb":
      query = `
        SELECT 
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length
        FROM information_schema.columns 
        WHERE table_name = ? AND table_schema = DATABASE()
        ORDER BY ordinal_position
      `;
      return (await executeQuery(connectionConfig, query, [tableName])).rows;

    default:
      throw new Error(`Unsupported database type: ${type}`);
  }
}

export function closeConnection(connectionId) {
  const conn = connectionPools.get(connectionId);
  if (conn) {
    if (conn.pool.end) {
      conn.pool.end();
    }
    connectionPools.delete(connectionId);
  }
}

export function closeAllConnections() {
  for (const [id, conn] of connectionPools) {
    if (conn.pool.end) {
      conn.pool.end();
    }
  }
  connectionPools.clear();
}
