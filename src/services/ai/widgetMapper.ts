import { v4 as uuidv4 } from "uuid";
import { ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseWidget } from "../../types/ai.js";

function buildWidgetForTool(toolName: string, payload: any): BaseWidget | null {
  switch (toolName) {
    case "chart_management": {
      if (!["create", "update", "get_data"].includes(payload.action)) return null;
      const chart = payload.chart ?? payload;
      return {
        type: "chart_preview",
        id: uuidv4(),
        data: {
          chartId: chart.id ?? chart.chartId,
          chartType: chart.chartType,
          datasetName: chart.datasetName ?? "",
          config: payload.echartsOption ?? chart.config,
        },
        actions: [
          {
            id: "open-chart-editor",
            label: "Open Chart Editor",
            clientTool: "navigate_to_page",
            params: { page: "chart-editor", params: { chartId: chart.id ?? chart.chartId } },
          },
        ],
      };
    }
    case "dataset_management": {
      if (!["create", "get"].includes(payload.action)) return null;
      const dataset = payload.dataset;
      if (!dataset) return null;
      return {
        type: "dataset_info",
        id: uuidv4(),
        data: {
          datasetId: dataset.id,
          name: dataset.name,
          type: dataset.datasetType,
          columnCount: Array.isArray(dataset.columns) ? dataset.columns.length : undefined,
          columns: dataset.columns,
        },
      };
    }
    case "connection_management": {
      if (payload.action !== "test") return null;
      return {
        type: "connection_status",
        id: uuidv4(),
        data: { success: payload.success, message: payload.message },
      };
    }
    case "database_operations": {
      return {
        type: "query_result",
        id: uuidv4(),
        data: {
          query: payload.query,
          rows: payload.rows,
          columns: payload.fields,
          rowCount: payload.rowCount,
          executionTime: payload.executionTime,
        },
      };
    }
    default:
      return null;
  }
}

export function mapToolResultsToWidgets(messages: BaseMessage[]): BaseWidget[] {
  const widgets: BaseWidget[] = [];
  for (const message of messages) {
    if (!(message instanceof ToolMessage)) continue;
    const toolName = message.name;
    if (!toolName) continue;
    let payload: any;
    try {
      payload = JSON.parse(String(message.content));
    } catch {
      continue;
    }
    if (!payload?.success) continue;
    const widget = buildWidgetForTool(toolName, payload);
    if (widget) widgets.push(widget);
  }
  return widgets;
}
