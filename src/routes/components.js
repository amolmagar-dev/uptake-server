import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "../config/database.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { executeQuery } from "../services/databaseConnector.js";

const router = Router();

router.use(authenticateToken);

// Get all custom components
router.get("/", (req, res) => {
  try {
    const components = db
      .prepare(
        `
      SELECT cc.*, 
             c.name as connection_name, c.type as connection_type,
             d.name as dataset_name, d.dataset_type, d.source_type,
             u.name as created_by_name
      FROM custom_components cc
      LEFT JOIN connections c ON cc.connection_id = c.id
      LEFT JOIN datasets d ON cc.dataset_id = d.id
      LEFT JOIN users u ON cc.created_by = u.id
      ORDER BY cc.updated_at DESC
    `
      )
      .all();

    // Parse config JSON
    const parsedComponents = components.map((comp) => ({
      ...comp,
      config: comp.config ? JSON.parse(comp.config) : {},
    }));

    res.json({ components: parsedComponents });
  } catch (error) {
    console.error("Get components error:", error);
    res.status(500).json({ error: "Failed to fetch components" });
  }
});

// Get single component
router.get("/:id", (req, res) => {
  try {
    const component = db
      .prepare(
        `
      SELECT cc.*, 
             c.name as connection_name, c.type as connection_type,
             d.name as dataset_name, d.dataset_type, d.source_type
      FROM custom_components cc
      LEFT JOIN connections c ON cc.connection_id = c.id
      LEFT JOIN datasets d ON cc.dataset_id = d.id
      WHERE cc.id = ?
    `
      )
      .get(req.params.id);

    if (!component) {
      return res.status(404).json({ error: "Component not found" });
    }

    res.json({
      component: {
        ...component,
        config: component.config ? JSON.parse(component.config) : {},
      },
    });
  } catch (error) {
    console.error("Get component error:", error);
    res.status(500).json({ error: "Failed to fetch component" });
  }
});

// Create new component
router.post("/", requireRole("admin", "editor"), (req, res) => {
  try {
    const { name, description, html_content, css_content, js_content, config, dataset_id, connection_id, sql_query } = req.body;

    if (!name || !html_content) {
      return res.status(400).json({ error: "Name and HTML content are required" });
    }

    // Validate dataset if provided
    if (dataset_id) {
      const dataset = db.prepare("SELECT id FROM datasets WHERE id = ?").get(dataset_id);
      if (!dataset) {
        return res.status(404).json({ error: "Dataset not found" });
      }
    }

    // Legacy: Validate connection if provided (backward compatibility)
    if (connection_id && !dataset_id) {
      const connection = db.prepare("SELECT id FROM connections WHERE id = ?").get(connection_id);
      if (!connection) {
        return res.status(404).json({ error: "Connection not found" });
      }
    }

    const componentId = uuidv4();

    db.prepare(
      `
      INSERT INTO custom_components (id, name, description, html_content, css_content, js_content, config, dataset_id, connection_id, sql_query, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      componentId,
      name,
      description || null,
      html_content,
      css_content || null,
      js_content || null,
      config ? JSON.stringify(config) : null,
      dataset_id || null,
      connection_id || null,
      sql_query || null,
      req.user.id
    );

    res.status(201).json({
      component: {
        id: componentId,
        name,
        description,
        html_content,
        css_content,
        js_content,
        config,
        dataset_id,
        connection_id,
        sql_query,
      },
      message: "Component created successfully",
    });
  } catch (error) {
    console.error("Create component error:", error);
    res.status(500).json({ error: "Failed to create component" });
  }
});

// Update component
router.put("/:id", requireRole("admin", "editor"), (req, res) => {
  try {
    const { name, description, html_content, css_content, js_content, config, dataset_id, connection_id, sql_query } = req.body;
    const componentId = req.params.id;

    const existing = db.prepare("SELECT * FROM custom_components WHERE id = ?").get(componentId);
    if (!existing) {
      return res.status(404).json({ error: "Component not found" });
    }

    // Validate dataset if provided
    if (dataset_id) {
      const dataset = db.prepare("SELECT id FROM datasets WHERE id = ?").get(dataset_id);
      if (!dataset) {
        return res.status(404).json({ error: "Dataset not found" });
      }
    }

    db.prepare(
      `
      UPDATE custom_components 
      SET name = ?, description = ?, html_content = ?, css_content = ?, js_content = ?,
          config = ?, dataset_id = ?, connection_id = ?, sql_query = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(
      name || existing.name,
      description !== undefined ? description : existing.description,
      html_content || existing.html_content,
      css_content !== undefined ? css_content : existing.css_content,
      js_content !== undefined ? js_content : existing.js_content,
      config ? JSON.stringify(config) : existing.config,
      dataset_id !== undefined ? dataset_id : existing.dataset_id,
      connection_id !== undefined ? connection_id : existing.connection_id,
      sql_query !== undefined ? sql_query : existing.sql_query,
      componentId
    );

    res.json({ message: "Component updated successfully" });
  } catch (error) {
    console.error("Update component error:", error);
    res.status(500).json({ error: "Failed to update component" });
  }
});

// Delete component
router.delete("/:id", requireRole("admin", "editor"), (req, res) => {
  try {
    const componentId = req.params.id;

    const existing = db.prepare("SELECT id FROM custom_components WHERE id = ?").get(componentId);
    if (!existing) {
      return res.status(404).json({ error: "Component not found" });
    }

    db.prepare("DELETE FROM custom_components WHERE id = ?").run(componentId);

    res.json({ message: "Component deleted successfully" });
  } catch (error) {
    console.error("Delete component error:", error);
    res.status(500).json({ error: "Failed to delete component" });
  }
});

// Get component data (execute the component's query if it has one)
router.get("/:id/data", async (req, res) => {
  try {
    const component = db
      .prepare(
        `
      SELECT cc.*, 
             d.source_type, d.dataset_type, d.table_name, d.table_schema, d.sql_query as dataset_sql_query, d.connection_id as dataset_connection_id,
             c.host, c.port, c.database_name, c.username, c.password, c.ssl, c.type as db_type,
             dc.host as dc_host, dc.port as dc_port, dc.database_name as dc_database_name, 
             dc.username as dc_username, dc.password as dc_password, dc.ssl as dc_ssl, dc.type as dc_db_type
      FROM custom_components cc
      LEFT JOIN datasets d ON cc.dataset_id = d.id
      LEFT JOIN connections c ON d.connection_id = c.id
      LEFT JOIN connections dc ON cc.connection_id = dc.id
      WHERE cc.id = ?
    `
      )
      .get(req.params.id);

    if (!component) {
      return res.status(404).json({ error: "Component not found" });
    }

    let sqlQuery;
    let connection;

    // Check if component uses a dataset
    if (component.dataset_id) {
      if (component.source_type !== 'sql') {
        return res.json({
          component: {
            ...component,
            config: component.config ? JSON.parse(component.config) : {},
          },
          data: null,
          error: `Unsupported source type: ${component.source_type}`,
        });
      }

      // Build query based on dataset type
      if (component.dataset_type === 'physical') {
        const schemaPrefix = component.table_schema ? `"${component.table_schema}".` : '';
        sqlQuery = `SELECT * FROM ${schemaPrefix}"${component.table_name}"`;
      } else if (component.dataset_type === 'virtual') {
        sqlQuery = component.dataset_sql_query;
      }

      connection = {
        id: component.dataset_connection_id,
        type: component.db_type,
        host: component.host,
        port: component.port,
        database_name: component.database_name,
        username: component.username,
        password: component.password,
        ssl: component.ssl,
      };
    } else if (component.connection_id && component.sql_query) {
      // Legacy: component uses connection directly
      sqlQuery = component.sql_query;
      connection = {
        id: component.connection_id,
        type: component.dc_db_type,
        host: component.dc_host,
        port: component.dc_port,
        database_name: component.dc_database_name,
        username: component.dc_username,
        password: component.dc_password,
        ssl: component.dc_ssl,
      };
    }

    // If no data source, return component without data
    if (!sqlQuery || !connection || !connection.host) {
      return res.json({
        component: {
          ...component,
          config: component.config ? JSON.parse(component.config) : {},
        },
        data: null,
      });
    }

    const result = await executeQuery(connection, sqlQuery);

    res.json({
      component: {
        ...component,
        config: component.config ? JSON.parse(component.config) : {},
      },
      data: result.rows,
      fields: result.fields,
      rowCount: result.rowCount,
      executionTime: result.executionTime,
    });
  } catch (error) {
    console.error("Get component data error:", error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
