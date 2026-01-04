// @ts-nocheck
/**
 * Custom Component Management Tool
 * Full CRUD operations for custom HTML/CSS/JS components
 * Allows AI to create and manage custom dashboard components
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { customComponentRepository, datasetRepository } from "../../db/repositories/index.js";
import { findDataset, findConnection } from "./utils.js";

const customComponentManagementDef = toolDefinition({
  name: "custom_component_management",
  description: `Manage custom components for dasboards. Custom components allow creating bespoke visualizations using HTML, CSS, and JavaScript.

Supported actions:
- list: List all custom components
- get: Get details of a specific custom component
- create: Create a new custom component with HTML/CSS/JS code
- update: Update an existing custom component
- delete: Delete a custom component

Custom components can be linked to Datasets for dynamic data. The data from the dataset will be available as a \`data\` variable in the JavaScript code.

Use this for:
- Custom KPI cards with unique styling
- Specialized visualizations not available as standard charts
- Interactive widgets with custom behavior
- Custom HTML templates with data binding

You can use either component ID or component name for get, update, and delete actions.`,
  inputSchema: z.object({
    action: z.enum(["list", "get", "create", "update", "delete"]).describe("The action to perform"),
    componentId: z.string().optional().describe("Component ID or name (required for get, update, delete)"),
    data: z
      .object({
        name: z.string().optional().describe("Component name/title"),
        description: z.string().optional().describe("Component description"),
        html_content: z.string().optional().describe("HTML content/template for the component"),
        css_content: z.string().optional().describe("CSS styles for the component"),
        js_content: z.string().optional().describe("JavaScript code for the component. Data from dataset is available as 'data' variable."),
        dataset_id: z.string().optional().describe("Dataset ID to use for component data"),
        connection_id: z.string().optional().describe("Legacy: Connection ID for direct SQL query"),
        sql_query: z.string().optional().describe("Legacy: SQL query when using connection directly"),
        config: z
          .object({
            refreshInterval: z.number().optional().describe("Auto-refresh interval in seconds"),
            theme: z.string().optional().describe("Component theme (light/dark)"),
            height: z.string().optional().describe("Component height (e.g., '300px', '100%')"),
            width: z.string().optional().describe("Component width"),
          })
          .optional()
          .describe("Component configuration options"),
      })
      .optional()
      .describe("Component data (for create and update actions)"),
  }),
});

/**
 * Find a custom component by ID or name
 */
async function findComponent(idOrName: string) {
  // First try by ID
  let component = await prisma.customComponent.findUnique({
    where: { id: idOrName },
  });

  // If not found, try by name
  if (!component) {
    component = await prisma.customComponent.findFirst({
      where: { name: { equals: idOrName, mode: "insensitive" } },
    });
  }

  return component;
}

const customComponentManagement = customComponentManagementDef.server(async ({ action, componentId, data }) => {
  try {
    switch (action) {
      case "list": {
        const components = await prisma.customComponent.findMany({
          include: {
            connection: { select: { name: true, type: true } },
            dataset: { select: { name: true, dataset_type: true, source_type: true } },
            creator: { select: { name: true } },
          },
          orderBy: { updated_at: "desc" },
        });

        return {
          success: true,
          action: "list",
          totalComponents: components.length,
          components: components.map((comp) => ({
            id: comp.id,
            name: comp.name,
            description: comp.description,
            datasetId: comp.dataset_id,
            datasetName: comp.dataset?.name,
            datasetType: comp.dataset?.dataset_type,
            connectionId: comp.connection_id,
            connectionName: comp.connection?.name,
            connectionType: comp.connection?.type,
            hasSqlQuery: !!comp.sql_query,
            hasHtml: !!comp.html_content,
            hasCss: !!comp.css_content,
            hasJs: !!comp.js_content,
            config: comp.config ? JSON.parse(comp.config) : {},
            createdBy: comp.creator?.name,
            createdAt: comp.created_at,
            updatedAt: comp.updated_at,
          })),
        };
      }

      case "get": {
        if (!componentId) {
          return { success: false, error: "componentId is required for get action" };
        }

        const component = await findComponent(componentId);
        if (!component) {
          return { success: false, error: "Component not found", componentId };
        }

        // Get full details with relations
        const fullComponent = await prisma.customComponent.findUnique({
          where: { id: component.id },
          include: {
            connection: { select: { name: true, type: true } },
            dataset: { select: { id: true, name: true, dataset_type: true, source_type: true, table_name: true } },
            creator: { select: { name: true } },
          },
        });

        return {
          success: true,
          action: "get",
          component: {
            id: fullComponent.id,
            name: fullComponent.name,
            description: fullComponent.description,
            htmlContent: fullComponent.html_content,
            cssContent: fullComponent.css_content,
            jsContent: fullComponent.js_content,
            sqlQuery: fullComponent.sql_query,
            dataset: fullComponent.dataset
              ? {
                  id: fullComponent.dataset.id,
                  name: fullComponent.dataset.name,
                  datasetType: fullComponent.dataset.dataset_type,
                  sourceType: fullComponent.dataset.source_type,
                  tableName: fullComponent.dataset.table_name,
                }
              : null,
            connection: fullComponent.connection
              ? {
                  name: fullComponent.connection.name,
                  type: fullComponent.connection.type,
                }
              : null,
            config: fullComponent.config ? JSON.parse(fullComponent.config) : {},
            createdBy: fullComponent.creator?.name,
            createdAt: fullComponent.created_at,
            updatedAt: fullComponent.updated_at,
          },
        };
      }

      case "create": {
        if (!data) {
          return { success: false, error: "data is required for create action" };
        }

        const { name, description, html_content, css_content, js_content, dataset_id, connection_id, sql_query, config } = data;

        if (!name || !html_content) {
          return {
            success: false,
            error: "name and html_content are required for creating a custom component",
          };
        }

        // Verify dataset exists if provided
        let datasetInfo = null;
        if (dataset_id) {
          const dataset = await findDataset(dataset_id);
          if (!dataset) {
            return {
              success: false,
              error: "Dataset not found. Use dataset_management tool to create a dataset first.",
              datasetId: dataset_id,
            };
          }
          datasetInfo = dataset;
        }

        // Verify connection exists if provided (legacy support)
        if (connection_id && !dataset_id) {
          const connection = await findConnection(connection_id);
          if (!connection) {
            return {
              success: false,
              error: "Connection not found",
              connectionId: connection_id,
            };
          }
        }

        // Create the component
        const newComponent = await customComponentRepository.create({
          name,
          description: description || undefined,
          html_content,
          css_content: css_content || undefined,
          js_content: js_content || undefined,
          dataset_id: dataset_id || undefined,
          connection_id: connection_id || undefined,
          sql_query: sql_query || undefined,
          config: config ? JSON.stringify(config) : undefined,
        });

        return {
          success: true,
          action: "create",
          message: "Custom component created successfully",
          component: {
            id: newComponent.id,
            name: newComponent.name,
            description: newComponent.description,
            datasetId: dataset_id,
            datasetName: datasetInfo?.name,
            htmlContentLength: html_content.length,
            hasCss: !!css_content,
            hasJs: !!js_content,
            config: config || {},
          },
          tip: "You can now add this component to a dashboard using dashboard_management tool.",
        };
      }

      case "update": {
        if (!componentId) {
          return { success: false, error: "componentId is required for update action" };
        }
        if (!data) {
          return { success: false, error: "data is required for update action" };
        }

        const existing = await findComponent(componentId);
        if (!existing) {
          return { success: false, error: "Component not found", componentId };
        }

        const { name, description, html_content, css_content, js_content, dataset_id, connection_id, sql_query, config } = data;

        // Verify dataset if changing it
        if (dataset_id) {
          const dataset = await findDataset(dataset_id);
          if (!dataset) {
            return {
              success: false,
              error: "Dataset not found",
              datasetId: dataset_id,
            };
          }
        }

        // Merge config if provided
        let updatedConfig = existing.config;
        if (config) {
          const existingConfig = existing.config ? JSON.parse(existing.config) : {};
          updatedConfig = JSON.stringify({ ...existingConfig, ...config });
        }

        // Update the component
        await customComponentRepository.update(existing.id, {
          name: name || undefined,
          description: description !== undefined ? description : undefined,
          html_content: html_content || undefined,
          css_content: css_content !== undefined ? css_content : undefined,
          js_content: js_content !== undefined ? js_content : undefined,
          dataset_id: dataset_id !== undefined ? dataset_id : undefined,
          connection_id: connection_id !== undefined ? connection_id : undefined,
          sql_query: sql_query !== undefined ? sql_query : undefined,
          config: updatedConfig || undefined,
        });

        return {
          success: true,
          action: "update",
          message: "Custom component updated successfully",
          componentId: existing.id,
          componentName: name || existing.name,
        };
      }

      case "delete": {
        if (!componentId) {
          return { success: false, error: "componentId is required for delete action" };
        }

        const existing = await findComponent(componentId);
        if (!existing) {
          return { success: false, error: "Component not found", componentId };
        }

        // Delete the component
        await customComponentRepository.delete(existing.id);

        return {
          success: true,
          action: "delete",
          message: `Custom component "${existing.name}" deleted successfully`,
          componentId: existing.id,
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (error) {
    console.error("Custom component management error:", error);
    return {
      success: false,
      error: error.message || "Custom component management failed",
      action,
    };
  }
});

export default customComponentManagement;
