import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "../config/database.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { executeQuery, getTableList, getTableSchema } from "../services/databaseConnector.js";
import { executeApiRequest } from "../services/apiConnector.js";
import { fetchGoogleSheet } from "../services/googleSheetsConnector.js";

const router = Router();

router.use(authenticateToken);

// Get all datasets
router.get("/", (req, res) => {
  try {
    const datasets = db
      .prepare(
        `
      SELECT d.*, c.name as connection_name, c.type as connection_type,
             u.name as created_by_name
      FROM datasets d
      LEFT JOIN connections c ON d.connection_id = c.id
      LEFT JOIN users u ON d.created_by = u.id
      ORDER BY d.updated_at DESC
    `
      )
      .all();

    // Parse JSON fields
    const parsedDatasets = datasets.map((dataset) => ({
      ...dataset,
      columns: dataset.columns ? JSON.parse(dataset.columns) : null,
      source_config: dataset.source_config ? JSON.parse(dataset.source_config) : null,
    }));

    res.json({ datasets: parsedDatasets });
  } catch (error) {
    console.error("Get datasets error:", error);
    res.status(500).json({ error: "Failed to fetch datasets" });
  }
});

// Get single dataset
router.get("/:id", (req, res) => {
  try {
    const dataset = db
      .prepare(
        `
      SELECT d.*, c.name as connection_name, c.type as connection_type
      FROM datasets d
      LEFT JOIN connections c ON d.connection_id = c.id
      WHERE d.id = ?
    `
      )
      .get(req.params.id);

    if (!dataset) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    res.json({
      dataset: {
        ...dataset,
        columns: dataset.columns ? JSON.parse(dataset.columns) : null,
        source_config: dataset.source_config ? JSON.parse(dataset.source_config) : null,
      },
    });
  } catch (error) {
    console.error("Get dataset error:", error);
    res.status(500).json({ error: "Failed to fetch dataset" });
  }
});

// Create new dataset
router.post("/", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { 
      name, 
      description, 
      source_type = 'sql',
      dataset_type,
      connection_id, 
      table_name, 
      table_schema = 'public',
      sql_query,
      source_config 
    } = req.body;

    if (!name || !dataset_type) {
      return res.status(400).json({ error: "Name and dataset type are required" });
    }

    // Validate based on source type
    if (source_type === 'sql') {
      if (!connection_id) {
        return res.status(400).json({ error: "Connection ID is required for SQL datasets" });
      }

      const connection = db.prepare("SELECT id FROM connections WHERE id = ?").get(connection_id);
      if (!connection) {
        return res.status(404).json({ error: "Connection not found" });
      }

      if (dataset_type === 'physical' && !table_name) {
        return res.status(400).json({ error: "Table name is required for physical datasets" });
      }

      if (dataset_type === 'virtual' && !sql_query) {
        return res.status(400).json({ error: "SQL query is required for virtual datasets" });
      }
    }

    const datasetId = uuidv4();

    // Fetch columns for SQL datasets
    let columns = null;
    if (source_type === 'sql' && connection_id) {
      try {
        const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(connection_id);
        if (dataset_type === 'physical' && table_name) {
          const schemaColumns = await getTableSchema(connection, table_name, table_schema);
          columns = schemaColumns;
        } else if (dataset_type === 'virtual' && sql_query) {
          // Execute query with LIMIT 0 to get column info
          const result = await executeQuery(connection, `SELECT * FROM (${sql_query}) AS subq LIMIT 0`);
          columns = result.fields.map(f => ({ column_name: f.name, data_type: f.type || 'unknown' }));
        }
      } catch (err) {
        console.warn("Could not fetch columns:", err.message);
      }
    }

    db.prepare(
      `
      INSERT INTO datasets (id, name, description, source_type, dataset_type, connection_id, table_name, table_schema, sql_query, source_config, columns, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      datasetId,
      name,
      description || null,
      source_type,
      dataset_type,
      connection_id || null,
      table_name || null,
      table_schema || null,
      sql_query || null,
      source_config ? JSON.stringify(source_config) : null,
      columns ? JSON.stringify(columns) : null,
      req.user.id
    );

    res.status(201).json({
      dataset: {
        id: datasetId,
        name,
        description,
        source_type,
        dataset_type,
        connection_id,
        table_name,
        table_schema,
        sql_query,
        source_config,
        columns,
      },
      message: "Dataset created successfully",
    });
  } catch (error) {
    console.error("Create dataset error:", error);
    res.status(500).json({ error: "Failed to create dataset" });
  }
});

// Update dataset
router.put("/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { 
      name, 
      description, 
      source_type,
      dataset_type,
      connection_id, 
      table_name, 
      table_schema,
      sql_query,
      source_config 
    } = req.body;
    const datasetId = req.params.id;

    const existing = db.prepare("SELECT * FROM datasets WHERE id = ?").get(datasetId);
    if (!existing) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    // Refetch columns if query or table changed
    let columns = existing.columns;
    const newSourceType = source_type || existing.source_type;
    const newDatasetType = dataset_type || existing.dataset_type;
    const newConnectionId = connection_id || existing.connection_id;
    const newTableName = table_name !== undefined ? table_name : existing.table_name;
    const newTableSchema = table_schema !== undefined ? table_schema : existing.table_schema;
    const newSqlQuery = sql_query !== undefined ? sql_query : existing.sql_query;

    if (newSourceType === 'sql' && newConnectionId) {
      const tableChanged = newTableName !== existing.table_name || newTableSchema !== existing.table_schema;
      const queryChanged = newSqlQuery !== existing.sql_query;

      if (tableChanged || queryChanged) {
        try {
          const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(newConnectionId);
          if (newDatasetType === 'physical' && newTableName) {
            const schemaColumns = await getTableSchema(connection, newTableName, newTableSchema);
            columns = JSON.stringify(schemaColumns);
          } else if (newDatasetType === 'virtual' && newSqlQuery) {
            const result = await executeQuery(connection, `SELECT * FROM (${newSqlQuery}) AS subq LIMIT 0`);
            columns = JSON.stringify(result.fields.map(f => ({ column_name: f.name, data_type: f.type || 'unknown' })));
          }
        } catch (err) {
          console.warn("Could not fetch columns:", err.message);
        }
      }
    }

    db.prepare(
      `
      UPDATE datasets 
      SET name = ?, description = ?, source_type = ?, dataset_type = ?, 
          connection_id = ?, table_name = ?, table_schema = ?, sql_query = ?,
          source_config = ?, columns = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(
      name || existing.name,
      description !== undefined ? description : existing.description,
      newSourceType,
      newDatasetType,
      newConnectionId,
      newTableName,
      newTableSchema,
      newSqlQuery,
      source_config ? JSON.stringify(source_config) : existing.source_config,
      columns,
      datasetId
    );

    res.json({ message: "Dataset updated successfully" });
  } catch (error) {
    console.error("Update dataset error:", error);
    res.status(500).json({ error: "Failed to update dataset" });
  }
});

// Delete dataset
router.delete("/:id", requireRole("admin", "editor"), (req, res) => {
  try {
    const datasetId = req.params.id;

    const existing = db.prepare("SELECT id FROM datasets WHERE id = ?").get(datasetId);
    if (!existing) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    // Check if any charts use this dataset
    const chartsUsingDataset = db.prepare("SELECT COUNT(*) as count FROM charts WHERE dataset_id = ?").get(datasetId);
    if (chartsUsingDataset && chartsUsingDataset.count > 0) {
      return res.status(400).json({ 
        error: `Cannot delete dataset: ${chartsUsingDataset.count} chart(s) are using this dataset` 
      });
    }

    db.prepare("DELETE FROM datasets WHERE id = ?").run(datasetId);

    res.json({ message: "Dataset deleted successfully" });
  } catch (error) {
    console.error("Delete dataset error:", error);
    res.status(500).json({ error: "Failed to delete dataset" });
  }
});

// Preview dataset data (first 100 rows)
router.get("/:id/preview", async (req, res) => {
  try {
    const dataset = db.prepare("SELECT * FROM datasets WHERE id = ?").get(req.params.id);

    if (!dataset) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    let result;

    if (dataset.source_type === 'sql') {
      const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(dataset.connection_id);
      if (!connection) {
        return res.status(404).json({ error: "Connection not found" });
      }

      let sqlQuery;
      if (dataset.dataset_type === 'physical') {
        const schemaPrefix = dataset.table_schema ? `"${dataset.table_schema}".` : '';
        sqlQuery = `SELECT * FROM ${schemaPrefix}"${dataset.table_name}" LIMIT 100`;
      } else {
        sqlQuery = `SELECT * FROM (${dataset.sql_query}) AS preview_subquery LIMIT 100`;
      }

      result = await executeQuery(connection, sqlQuery);
    } else if (dataset.source_type === 'api') {
      const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(dataset.connection_id);
      if (!connection) {
        return res.status(404).json({ error: "API connection not found" });
      }
      result = await executeApiRequest(connection);
      // Limit to 100 rows for preview
      result.rows = result.rows.slice(0, 100);
      result.rowCount = result.rows.length;
    } else if (dataset.source_type === 'googlesheet') {
      const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(dataset.connection_id);
      if (!connection) {
        return res.status(404).json({ error: "Google Sheets connection not found" });
      }
      result = await fetchGoogleSheet(connection);
      // Limit to 100 rows for preview
      result.rows = result.rows.slice(0, 100);
      result.rowCount = result.rows.length;
    } else {
      return res.status(400).json({ error: `Unsupported source type: ${dataset.source_type}` });
    }

    res.json({
      data: result.rows,
      fields: result.fields,
      rowCount: result.rowCount,
      executionTime: result.executionTime,
    });
  } catch (error) {
    console.error("Preview dataset error:", error);
    res.status(400).json({ error: error.message });
  }
});

// Get dataset columns
router.get("/:id/columns", async (req, res) => {
  try {
    const dataset = db.prepare("SELECT * FROM datasets WHERE id = ?").get(req.params.id);

    if (!dataset) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    // Return cached columns if available
    if (dataset.columns) {
      return res.json({ columns: JSON.parse(dataset.columns) });
    }

    // Fetch columns dynamically for SQL datasets
    if (dataset.source_type === 'sql' && dataset.connection_id) {
      const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(dataset.connection_id);
      if (!connection) {
        return res.status(404).json({ error: "Connection not found" });
      }

      let columns;
      if (dataset.dataset_type === 'physical' && dataset.table_name) {
        columns = await getTableSchema(connection, dataset.table_name, dataset.table_schema);
      } else if (dataset.dataset_type === 'virtual' && dataset.sql_query) {
        const result = await executeQuery(connection, `SELECT * FROM (${dataset.sql_query}) AS subq LIMIT 0`);
        columns = result.fields.map(f => ({ column_name: f.name, data_type: f.type || 'unknown' }));
      }

      // Cache the columns
      if (columns) {
        db.prepare("UPDATE datasets SET columns = ? WHERE id = ?").run(JSON.stringify(columns), dataset.id);
      }

      return res.json({ columns: columns || [] });
    }

    res.json({ columns: [] });
  } catch (error) {
    console.error("Get columns error:", error);
    res.status(400).json({ error: error.message });
  }
});

// Refresh dataset columns (re-fetch from source)
router.post("/:id/refresh-columns", requireRole("admin", "editor"), async (req, res) => {
  try {
    const dataset = db.prepare("SELECT * FROM datasets WHERE id = ?").get(req.params.id);

    if (!dataset) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    if (dataset.source_type !== 'sql' || !dataset.connection_id) {
      return res.status(400).json({ error: "Column refresh only supported for SQL datasets" });
    }

    const connection = db.prepare("SELECT * FROM connections WHERE id = ?").get(dataset.connection_id);
    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    let columns;
    if (dataset.dataset_type === 'physical' && dataset.table_name) {
      columns = await getTableSchema(connection, dataset.table_name, dataset.table_schema);
    } else if (dataset.dataset_type === 'virtual' && dataset.sql_query) {
      const result = await executeQuery(connection, `SELECT * FROM (${dataset.sql_query}) AS subq LIMIT 0`);
      columns = result.fields.map(f => ({ column_name: f.name, data_type: f.type || 'unknown' }));
    }

    if (columns) {
      db.prepare("UPDATE datasets SET columns = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(JSON.stringify(columns), dataset.id);
    }

    res.json({ columns: columns || [], message: "Columns refreshed successfully" });
  } catch (error) {
    console.error("Refresh columns error:", error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
