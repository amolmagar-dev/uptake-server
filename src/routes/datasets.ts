// @ts-nocheck
import { Router } from "express";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { datasetRepository, connectionRepository, chartRepository } from "../db/index.js";
import { prisma } from "../db/client.js";
import { executeQuery, getTableList, getTableSchema } from "../services/databaseConnector.js";
import { executeApiRequest } from "../services/apiConnector.js";
import { fetchGoogleSheet } from "../services/googleSheetsConnector.js";

const router = Router();

router.use(authenticateToken);

// Get all datasets
router.get("/", async (req, res) => {
  try {
    const datasets = await prisma.dataset.findMany({
      include: {
        connection: { select: { name: true, type: true } },
        creator: { select: { name: true } },
      },
      orderBy: { updated_at: "desc" },
    });

    // Parse JSON fields and format response
    const parsedDatasets = datasets.map((dataset) => ({
      ...dataset,
      connection_name: dataset.connection?.name,
      connection_type: dataset.connection?.type,
      created_by_name: dataset.creator?.name,
      columns: dataset.columns ? JSON.parse(dataset.columns) : null,
      source_config: dataset.source_config ? JSON.parse(dataset.source_config) : null,
      connection: undefined,
      creator: undefined,
    }));

    res.json({ datasets: parsedDatasets });
  } catch (error) {
    console.error("Get datasets error:", error);
    res.status(500).json({ error: "Failed to fetch datasets" });
  }
});

// Get single dataset
router.get("/:id", async (req, res) => {
  try {
    const dataset = await prisma.dataset.findUnique({
      where: { id: req.params.id },
      include: {
        connection: { select: { name: true, type: true } },
      },
    });

    if (!dataset) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    res.json({
      dataset: {
        ...dataset,
        connection_name: dataset.connection?.name,
        connection_type: dataset.connection?.type,
        columns: dataset.columns ? JSON.parse(dataset.columns) : null,
        source_config: dataset.source_config ? JSON.parse(dataset.source_config) : null,
        connection: undefined,
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

      const connectionExists = await connectionRepository.exists(connection_id);
      if (!connectionExists) {
        return res.status(404).json({ error: "Connection not found" });
      }

      if (dataset_type === 'physical' && !table_name) {
        return res.status(400).json({ error: "Table name is required for physical datasets" });
      }

      if (dataset_type === 'virtual' && !sql_query) {
        return res.status(400).json({ error: "SQL query is required for virtual datasets" });
      }
    }

    // Fetch columns based on source type
    let columns = null;
    if (connection_id) {
      try {
        const connection = await connectionRepository.findById(connection_id);
        
        if (source_type === 'sql') {
          if (dataset_type === 'physical' && table_name) {
            const schemaColumns = await getTableSchema(connection, table_name, table_schema);
            columns = schemaColumns;
          } else if (dataset_type === 'virtual' && sql_query) {
            const result = await executeQuery(connection, `SELECT * FROM (${sql_query}) AS subq LIMIT 0`);
            columns = result.fields.map(f => ({ column_name: f.name, data_type: f.type || 'unknown' }));
          }
        } else if (source_type === 'api') {
          const result = await executeApiRequest(connection);
          columns = result.fields.map(f => ({ column_name: f.name, data_type: 'text' }));
        } else if (source_type === 'googlesheet') {
          const result = await fetchGoogleSheet(connection);
          columns = result.fields.map(f => ({ column_name: f.name, data_type: 'text' }));
        }
      } catch (err) {
        console.warn("Could not fetch columns:", err.message);
      }
    }

    const dataset = await datasetRepository.create({
      name,
      description,
      source_type,
      dataset_type,
      connection_id,
      table_name,
      table_schema,
      sql_query,
      source_config: source_config ? JSON.stringify(source_config) : null,
      columns: columns ? JSON.stringify(columns) : null,
      created_by: req.user.id,
    });

    res.status(201).json({
      dataset: {
        id: dataset.id,
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

    const existing = await datasetRepository.findById(datasetId);
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
          const connection = await connectionRepository.findById(newConnectionId);
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

    await datasetRepository.update(datasetId, {
      name: name || existing.name,
      description: description !== undefined ? description : existing.description,
      source_type: newSourceType,
      dataset_type: newDatasetType,
      connection_id: newConnectionId,
      table_name: newTableName,
      table_schema: newTableSchema,
      sql_query: newSqlQuery,
      source_config: source_config ? JSON.stringify(source_config) : existing.source_config,
      columns,
    });

    res.json({ message: "Dataset updated successfully" });
  } catch (error) {
    console.error("Update dataset error:", error);
    res.status(500).json({ error: "Failed to update dataset" });
  }
});

// Delete dataset
router.delete("/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const datasetId = req.params.id;

    const exists = await datasetRepository.exists(datasetId);
    if (!exists) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    // Check if any charts use this dataset
    const chartsCount = await datasetRepository.countChartsUsing(datasetId);
    if (chartsCount > 0) {
      return res.status(400).json({ 
        error: `Cannot delete dataset: ${chartsCount} chart(s) are using this dataset` 
      });
    }

    await datasetRepository.delete(datasetId);
    res.json({ message: "Dataset deleted successfully" });
  } catch (error) {
    console.error("Delete dataset error:", error);
    res.status(500).json({ error: "Failed to delete dataset" });
  }
});

// Preview dataset data (first 100 rows)
router.get("/:id/preview", async (req, res) => {
  try {
    const dataset = await datasetRepository.findById(req.params.id);

    if (!dataset) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    let result;

    if (dataset.source_type === 'sql') {
      const connection = await connectionRepository.findById(dataset.connection_id);
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
      const connection = await connectionRepository.findById(dataset.connection_id);
      if (!connection) {
        return res.status(404).json({ error: "API connection not found" });
      }
      result = await executeApiRequest(connection);
      result.rows = result.rows.slice(0, 100);
      result.rowCount = result.rows.length;
    } else if (dataset.source_type === 'googlesheet') {
      const connection = await connectionRepository.findById(dataset.connection_id);
      if (!connection) {
        return res.status(404).json({ error: "Google Sheets connection not found" });
      }
      result = await fetchGoogleSheet(connection);
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
    const dataset = await datasetRepository.findById(req.params.id);

    if (!dataset) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    // Return cached columns if available
    if (dataset.columns) {
      return res.json({ columns: JSON.parse(dataset.columns) });
    }

    let columns = [];

    // Fetch columns dynamically based on source type
    if (dataset.source_type === 'sql' && dataset.connection_id) {
      const connection = await connectionRepository.findById(dataset.connection_id);
      if (!connection) {
        return res.status(404).json({ error: "Connection not found" });
      }

      if (dataset.dataset_type === 'physical' && dataset.table_name) {
        columns = await getTableSchema(connection, dataset.table_name, dataset.table_schema);
      } else if (dataset.dataset_type === 'virtual' && dataset.sql_query) {
        const result = await executeQuery(connection, `SELECT * FROM (${dataset.sql_query}) AS subq LIMIT 0`);
        columns = result.fields.map(f => ({ column_name: f.name, data_type: f.type || 'unknown' }));
      }
    } else if (dataset.source_type === 'api' && dataset.connection_id) {
      const connection = await connectionRepository.findById(dataset.connection_id);
      if (connection) {
        try {
          const result = await executeApiRequest(connection);
          columns = result.fields.map(f => ({ column_name: f.name, data_type: 'text' }));
        } catch (err) {
          console.warn("Could not fetch API columns:", err.message);
        }
      }
    } else if (dataset.source_type === 'googlesheet' && dataset.connection_id) {
      const connection = await connectionRepository.findById(dataset.connection_id);
      if (connection) {
        try {
          const result = await fetchGoogleSheet(connection);
          columns = result.fields.map(f => ({ column_name: f.name, data_type: 'text' }));
        } catch (err) {
          console.warn("Could not fetch Google Sheets columns:", err.message);
        }
      }
    }

    // Cache the columns if we got any
    if (columns.length > 0) {
      await datasetRepository.update(dataset.id, { columns: JSON.stringify(columns) });
    }

    return res.json({ columns });
  } catch (error) {
    console.error("Get columns error:", error);
    res.status(400).json({ error: error.message });
  }
});

// Refresh dataset columns (re-fetch from source)
router.post("/:id/refresh-columns", requireRole("admin", "editor"), async (req, res) => {
  try {
    const dataset = await datasetRepository.findById(req.params.id);

    if (!dataset) {
      return res.status(404).json({ error: "Dataset not found" });
    }

    if (!dataset.connection_id) {
      return res.status(400).json({ error: "Dataset has no connection" });
    }

    const connection = await connectionRepository.findById(dataset.connection_id);
    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    let columns = [];

    if (dataset.source_type === 'sql') {
      if (dataset.dataset_type === 'physical' && dataset.table_name) {
        columns = await getTableSchema(connection, dataset.table_name, dataset.table_schema);
      } else if (dataset.dataset_type === 'virtual' && dataset.sql_query) {
        const result = await executeQuery(connection, `SELECT * FROM (${dataset.sql_query}) AS subq LIMIT 0`);
        columns = result.fields.map(f => ({ column_name: f.name, data_type: f.type || 'unknown' }));
      }
    } else if (dataset.source_type === 'api') {
      const result = await executeApiRequest(connection);
      columns = result.fields.map(f => ({ column_name: f.name, data_type: 'text' }));
    } else if (dataset.source_type === 'googlesheet') {
      const result = await fetchGoogleSheet(connection);
      columns = result.fields.map(f => ({ column_name: f.name, data_type: 'text' }));
    }

    if (columns.length > 0) {
      await datasetRepository.update(dataset.id, { columns: JSON.stringify(columns) });
    }

    res.json({ columns, message: "Columns refreshed successfully" });
  } catch (error) {
    console.error("Refresh columns error:", error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
