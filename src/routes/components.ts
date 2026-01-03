// @ts-nocheck
import { Router } from "express";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { customComponentRepository, datasetRepository, connectionRepository } from "../db/index.js";
import { prisma } from "../db/client.js";
import { executeQuery } from "../services/databaseConnector.js";
import { executeApiRequest } from "../services/apiConnector.js";
import { fetchGoogleSheet } from "../services/googleSheetsConnector.js";

const router = Router();

router.use(authenticateToken);

// Get all custom components
router.get("/", async (req, res) => {
  try {
    const components = await prisma.customComponent.findMany({
      include: {
        connection: { select: { name: true, type: true } },
        dataset: { select: { name: true, dataset_type: true, source_type: true } },
        creator: { select: { name: true } },
      },
      orderBy: { updated_at: "desc" },
    });

    // Parse config JSON and format response
    const parsedComponents = components.map((comp) => ({
      ...comp,
      connection_name: comp.connection?.name,
      connection_type: comp.connection?.type,
      dataset_name: comp.dataset?.name,
      dataset_type: comp.dataset?.dataset_type,
      source_type: comp.dataset?.source_type,
      created_by_name: comp.creator?.name,
      config: comp.config ? JSON.parse(comp.config) : {},
      connection: undefined,
      dataset: undefined,
      creator: undefined,
    }));

    res.json({ components: parsedComponents });
  } catch (error) {
    console.error("Get components error:", error);
    res.status(500).json({ error: "Failed to fetch components" });
  }
});

// Get single component
router.get("/:id", async (req, res) => {
  try {
    const component = await prisma.customComponent.findUnique({
      where: { id: req.params.id },
      include: {
        connection: { select: { name: true, type: true } },
        dataset: { select: { name: true, dataset_type: true, source_type: true } },
      },
    });

    if (!component) {
      return res.status(404).json({ error: "Component not found" });
    }

    res.json({
      component: {
        ...component,
        connection_name: component.connection?.name,
        connection_type: component.connection?.type,
        dataset_name: component.dataset?.name,
        dataset_type: component.dataset?.dataset_type,
        source_type: component.dataset?.source_type,
        config: component.config ? JSON.parse(component.config) : {},
        connection: undefined,
        dataset: undefined,
      },
    });
  } catch (error) {
    console.error("Get component error:", error);
    res.status(500).json({ error: "Failed to fetch component" });
  }
});

// Create new component
router.post("/", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { name, description, html_content, css_content, js_content, config, dataset_id, connection_id, sql_query } = req.body;

    if (!name || !html_content) {
      return res.status(400).json({ error: "Name and HTML content are required" });
    }

    // Validate dataset if provided
    if (dataset_id) {
      const datasetExists = await datasetRepository.exists(dataset_id);
      if (!datasetExists) {
        return res.status(404).json({ error: "Dataset not found" });
      }
    }

    // Legacy: Validate connection if provided (backward compatibility)
    if (connection_id && !dataset_id) {
      const connectionExists = await connectionRepository.exists(connection_id);
      if (!connectionExists) {
        return res.status(404).json({ error: "Connection not found" });
      }
    }

    const component = await customComponentRepository.create({
      name,
      description,
      html_content,
      css_content,
      js_content,
      config: config ? JSON.stringify(config) : null,
      dataset_id,
      connection_id,
      sql_query,
      created_by: req.user.id,
    });

    res.status(201).json({
      component: {
        id: component.id,
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
router.put("/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { name, description, html_content, css_content, js_content, config, dataset_id, connection_id, sql_query } = req.body;
    const componentId = req.params.id;

    const existing = await customComponentRepository.findById(componentId);
    if (!existing) {
      return res.status(404).json({ error: "Component not found" });
    }

    // Validate dataset if provided
    if (dataset_id) {
      const datasetExists = await datasetRepository.exists(dataset_id);
      if (!datasetExists) {
        return res.status(404).json({ error: "Dataset not found" });
      }
    }

    await customComponentRepository.update(componentId, {
      name: name || existing.name,
      description: description !== undefined ? description : existing.description,
      html_content: html_content || existing.html_content,
      css_content: css_content !== undefined ? css_content : existing.css_content,
      js_content: js_content !== undefined ? js_content : existing.js_content,
      config: config ? JSON.stringify(config) : existing.config,
      dataset_id: dataset_id !== undefined ? dataset_id : existing.dataset_id,
      connection_id: connection_id !== undefined ? connection_id : existing.connection_id,
      sql_query: sql_query !== undefined ? sql_query : existing.sql_query,
    });

    res.json({ message: "Component updated successfully" });
  } catch (error) {
    console.error("Update component error:", error);
    res.status(500).json({ error: "Failed to update component" });
  }
});

// Delete component
router.delete("/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const componentId = req.params.id;

    const exists = await customComponentRepository.exists(componentId);
    if (!exists) {
      return res.status(404).json({ error: "Component not found" });
    }

    await customComponentRepository.delete(componentId);
    res.json({ message: "Component deleted successfully" });
  } catch (error) {
    console.error("Delete component error:", error);
    res.status(500).json({ error: "Failed to delete component" });
  }
});

// Get component data (execute the component's query if it has one)
router.get("/:id/data", async (req, res) => {
  try {
    const component = await prisma.customComponent.findUnique({
      where: { id: req.params.id },
      include: {
        dataset: {
          include: { connection: true },
        },
        connection: true,
      },
    });

    if (!component) {
      return res.status(404).json({ error: "Component not found" });
    }

    let sqlQuery;
    let connection;
    let result;

    // Check if component uses a dataset
    if (component.dataset_id && component.dataset) {
      const dataset = component.dataset;
      connection = dataset.connection;

      if (!connection) {
        return res.json({
          component: {
            ...component,
            config: component.config ? JSON.parse(component.config) : {},
          },
          data: null,
          error: "No connection found for dataset",
        });
      }

      if (dataset.source_type === 'sql') {
        // Build query based on dataset type
        if (dataset.dataset_type === 'physical') {
          const schemaPrefix = dataset.table_schema ? `"${dataset.table_schema}".` : '';
          sqlQuery = `SELECT * FROM ${schemaPrefix}"${dataset.table_name}"`;
        } else if (dataset.dataset_type === 'virtual') {
          sqlQuery = dataset.sql_query;
        }

        if (!sqlQuery) {
          return res.json({
            component: { ...component, config: component.config ? JSON.parse(component.config) : {} },
            data: null,
            error: "No query available",
          });
        }

        result = await executeQuery(connection, sqlQuery);
      } else if (dataset.source_type === 'api') {
        result = await executeApiRequest(connection);
      } else if (dataset.source_type === 'googlesheet') {
        result = await fetchGoogleSheet(connection);
      } else {
        return res.json({
          component: { ...component, config: component.config ? JSON.parse(component.config) : {} },
          data: null,
          error: `Unsupported source type: ${dataset.source_type}`,
        });
      }
    } else if (component.connection_id && component.sql_query) {
      // Legacy: component uses connection directly
      sqlQuery = component.sql_query;
      connection = component.connection;

      if (!connection) {
        return res.json({
          component: { ...component, config: component.config ? JSON.parse(component.config) : {} },
          data: null,
          error: "No connection found",
        });
      }

      result = await executeQuery(connection, sqlQuery);
    } else {
      // No data source, return component without data
      return res.json({
        component: { ...component, config: component.config ? JSON.parse(component.config) : {} },
        data: null,
      });
    }

    res.json({
      component: {
        ...component,
        config: component.config ? JSON.parse(component.config) : {},
        dataset: undefined,
        connection: undefined,
      },
      data: result?.rows || [],
      fields: result?.fields,
      rowCount: result?.rowCount,
      executionTime: result?.executionTime,
    });
  } catch (error) {
    console.error("Get component data error:", error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
