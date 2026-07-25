import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolMessage, AIMessage } from "@langchain/core/messages";
import { mapToolResultsToWidgets } from "./widgetMapper.js";

test("mapToolResultsToWidgets: maps a chart_management create result to a chart_preview widget", () => {
  const messages = [
    new ToolMessage({
      tool_call_id: "1",
      name: "chart_management",
      content: JSON.stringify({
        success: true,
        action: "create",
        chart: { id: "c1", name: "Revenue", chartType: "bar", datasetId: "ds-1", datasetName: "Sales" },
      }),
    }),
    new AIMessage("Created the chart."),
  ];
  const widgets = mapToolResultsToWidgets(messages);
  assert.equal(widgets.length, 1);
  assert.equal(widgets[0]!.type, "chart_preview");
  assert.equal(widgets[0]!.data.chartId, "c1");
});

test("mapToolResultsToWidgets: ignores a failed tool result", () => {
  const messages = [
    new ToolMessage({ tool_call_id: "1", name: "chart_management", content: JSON.stringify({ success: false, error: "nope" }) }),
  ];
  assert.deepEqual(mapToolResultsToWidgets(messages), []);
});

test("mapToolResultsToWidgets: maps a database_operations result to a query_result widget", () => {
  const messages = [
    new ToolMessage({
      tool_call_id: "1",
      name: "database_operations",
      content: JSON.stringify({ success: true, query: "SELECT 1", rows: [{ x: 1 }], fields: [{ name: "x" }], rowCount: 1 }),
    }),
  ];
  const widgets = mapToolResultsToWidgets(messages);
  assert.equal(widgets[0]!.type, "query_result");
  assert.deepEqual(widgets[0]!.data.rows, [{ x: 1 }]);
});

test("mapToolResultsToWidgets: unrecognized tool names produce no widget", () => {
  const messages = [new ToolMessage({ tool_call_id: "1", name: "project_helper", content: JSON.stringify({ success: true }) })];
  assert.deepEqual(mapToolResultsToWidgets(messages), []);
});

test("mapToolResultsToWidgets: maps a failed connection test to a connection_status widget with success=false", () => {
  const messages = [
    new ToolMessage({
      tool_call_id: "1",
      name: "connection_management",
      content: JSON.stringify({
        success: true,
        action: "test",
        connectionId: "c1",
        testResult: { success: false, message: "auth failed" },
      }),
    }),
  ];
  const widgets = mapToolResultsToWidgets(messages);
  assert.equal(widgets.length, 1);
  assert.equal(widgets[0]!.type, "connection_status");
  assert.equal(widgets[0]!.data.success, false);
  assert.equal(widgets[0]!.data.message, "auth failed");
});
