/**
 * Custom Component Management Tool
 * Full CRUD operations for custom HTML/CSS/JS components
 * Refactored to use LangChain.js
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "../../../db/client.js";
import { customComponentRepository } from "../../../db/repositories/index.js";

const componentDataSchema = z.object({
  name: z.string().optional().describe("Component name"),
  description: z.string().optional().describe("Component description"),
  html_content: z.string().optional().describe("HTML content for the component"),
  css_content: z.string().optional().describe("CSS styles for the component"),
  js_content: z.string().optional().describe("JavaScript code for the component"),
  config: z.any().optional().describe("Configuration JSON for the component"),
  dataset_id: z.string().optional().describe("Dataset ID to link data to the component"),
});

const customComponentManagementSchema = z.object({
  action: z.enum(["list", "get", "create", "update", "delete", "preview"]).describe("The action to perform"),
  componentId: z.string().optional().describe("Component ID (required for get, update, delete, preview)"),
  data: componentDataSchema.optional().describe("Component data (for create and update actions)"),
});

type CustomComponentManagementInput = z.infer<typeof customComponentManagementSchema>;

async function executeCustomComponentManagement({ action, componentId, data }: CustomComponentManagementInput): Promise<string> {
  try {
    switch (action) {
      case "list": {
        const components = await prisma.customComponent.findMany({
          include: {
            creator: { select: { name: true } },
            dataset: { select: { name: true } },
          },
          orderBy: { updated_at: "desc" },
        });

        return JSON.stringify({
          success: true,
          action: "list",
          totalComponents: components.length,
          components: components.map((c: any) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            datasetId: c.dataset_id,
            datasetName: c.dataset?.name,
            createdBy: c.creator?.name,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
          })),
        });
      }

      case "get": {
        if (!componentId) {
          return JSON.stringify({ success: false, error: "componentId is required for get action" });
        }

        const component = await prisma.customComponent.findFirst({
          where: {
            OR: [
              { id: componentId },
              { name: { equals: componentId, mode: 'insensitive' } }
            ]
          },
          include: {
            creator: { select: { name: true } },
            dataset: { select: { id: true, name: true } },
          }
        });

        if (!component) {
          return JSON.stringify({ success: false, error: "Component not found", componentId });
        }

        return JSON.stringify({
          success: true,
          action: "get",
          component: {
            id: component.id,
            name: component.name,
            description: component.description,
            htmlContent: component.html_content,
            cssContent: component.css_content,
            jsContent: component.js_content,
            config: component.config ? JSON.parse(component.config) : null,
            datasetId: component.dataset_id,
            datasetName: component.dataset?.name,
            createdBy: component.creator?.name,
            createdAt: component.created_at,
            updatedAt: component.updated_at,
          },
        });
      }

      case "create": {
        if (!data) {
          return JSON.stringify({ success: false, error: "data is required for create action" });
        }

        const { name, description, html_content, css_content, js_content, config, dataset_id } = data;

        if (!name || !html_content) {
          return JSON.stringify({
            success: false,
            error: "name and html_content are required",
          });
        }

        const existingComponent = await prisma.customComponent.findFirst({
          where: { name: { equals: name, mode: 'insensitive' } }
        });
        if (existingComponent) {
          return JSON.stringify({
            success: false,
            error: `A component with name "${name}" already exists`,
          });
        }

        // Validate dataset_id if provided
        if (dataset_id) {
          const dataset = await prisma.dataset.findUnique({ where: { id: dataset_id } });
          if (!dataset) {
            return JSON.stringify({
              success: false,
              error: `Dataset with ID "${dataset_id}" not found. Create a dataset first or omit dataset_id for a static component.`,
            });
          }
        }

        const newComponent = await customComponentRepository.create({
          name,
          description: description || undefined,
          html_content,
          css_content: css_content || undefined,
          js_content: js_content || undefined,
          config: config ? JSON.stringify(config) : undefined,
          dataset_id: dataset_id || undefined,
        });

        return JSON.stringify({
          success: true,
          action: "create",
          message: "Custom component created successfully",
          component: {
            id: newComponent.id,
            name: newComponent.name,
          },
        });
      }

      case "update": {
        if (!componentId) {
          return JSON.stringify({ success: false, error: "componentId is required for update action" });
        }
        if (!data) {
          return JSON.stringify({ success: false, error: "data is required for update action" });
        }

        const existing = await prisma.customComponent.findFirst({
          where: {
            OR: [
              { id: componentId },
              { name: { equals: componentId, mode: 'insensitive' } }
            ]
          }
        });

        if (!existing) {
          return JSON.stringify({ success: false, error: "Component not found", componentId });
        }

        const { name, description, html_content, css_content, js_content, config, dataset_id } = data;

        if (name && name !== existing.name) {
          const duplicateName = await prisma.customComponent.findFirst({
            where: { 
              name: { equals: name, mode: 'insensitive' },
              NOT: { id: existing.id }
            }
          });
          if (duplicateName) {
            return JSON.stringify({
              success: false,
              error: `A component with name "${name}" already exists`,
            });
          }
        }

        await customComponentRepository.update(existing.id, {
          name: name || undefined,
          description: description !== undefined ? description : undefined,
          html_content: html_content || undefined,
          css_content: css_content !== undefined ? css_content : undefined,
          js_content: js_content !== undefined ? js_content : undefined,
          config: config ? JSON.stringify(config) : undefined,
          dataset_id: dataset_id || undefined,
        });

        return JSON.stringify({
          success: true,
          action: "update",
          message: "Custom component updated successfully",
          componentId: existing.id,
        });
      }

      case "delete": {
        if (!componentId) {
          return JSON.stringify({ success: false, error: "componentId is required for delete action" });
        }

        const existing = await prisma.customComponent.findFirst({
          where: {
            OR: [
              { id: componentId },
              { name: { equals: componentId, mode: 'insensitive' } }
            ]
          }
        });

        if (!existing) {
          return JSON.stringify({ success: false, error: "Component not found", componentId });
        }

        await customComponentRepository.delete(existing.id);

        return JSON.stringify({
          success: true,
          action: "delete",
          message: `Component "${existing.name}" deleted successfully`,
          componentId: existing.id,
        });
      }

      case "preview": {
        if (!componentId) {
          return JSON.stringify({ success: false, error: "componentId is required for preview action" });
        }

        const component = await prisma.customComponent.findFirst({
          where: {
            OR: [
              { id: componentId },
              { name: { equals: componentId, mode: 'insensitive' } }
            ]
          }
        });

        if (!component) {
          return JSON.stringify({ success: false, error: "Component not found", componentId });
        }

        return JSON.stringify({
          success: true,
          action: "preview",
          component: {
            id: component.id,
            name: component.name,
            htmlContent: component.html_content,
            cssContent: component.css_content,
            jsContent: component.js_content,
            config: component.config ? JSON.parse(component.config) : null,
          },
        });
      }

      default:
        return JSON.stringify({ success: false, error: `Unknown action: ${action}` });
    }
  } catch (error: any) {
    console.error("Custom component management error:", error);
    return JSON.stringify({
      success: false,
      error: error.message || "Custom component management failed",
      action,
    });
  }
}

const customComponentManagement = tool(executeCustomComponentManagement, {
  name: "custom_component_management",
  description: `Manage custom HTML/CSS/JS components. Supported actions:
- list: List all custom components
- get: Get details of a specific component including code
- create: Create a new custom component
- update: Update an existing component
- delete: Delete a component
- preview: Get component code for preview

Components can be linked to datasets for dynamic data.
You can use either component ID or component name for get, update, delete, and preview actions.`,
  schema: customComponentManagementSchema,
});

export default customComponentManagement;
