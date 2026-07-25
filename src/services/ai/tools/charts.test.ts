import { test } from "node:test";
import assert from "node:assert/strict";
import { createChartManagementTool } from "./charts.js";
import { getOpenRouterModel } from "../../../config/openrouter.js";

const adminUser = { id: "u1", role: "admin" } as any;
const viewerUser = { id: "u2", role: "viewer" } as any;

test("chart_management: create rejects a viewer with a role error", async () => {
  const tool = createChartManagementTool(viewerUser);
  const result = JSON.parse(
    await tool.invoke({
      action: "create",
      data: { name: "Test", dataset_id: "does-not-matter", config: { chart_type: "bar", x_axis: "a", y_axis: "b" } },
    })
  );
  assert.equal(result.success, false);
  assert.match(result.error, /role/i);
});

test("chart_management: create rejects malformed advanced_options JSON before touching the DB", async () => {
  const tool = createChartManagementTool(adminUser);
  const result = JSON.parse(
    await tool.invoke({
      action: "create",
      data: {
        name: "Test",
        dataset_id: "does-not-matter",
        config: { chart_type: "bar", x_axis: "a", y_axis: "b", advanced_options: "{not json" },
      },
    })
  );
  assert.equal(result.success, false);
  assert.match(result.error, /advanced_options/i);
});

test("chart_management: get_data requires chartId", async () => {
  const tool = createChartManagementTool(adminUser);
  const result = JSON.parse(await tool.invoke({ action: "get_data" }));
  assert.equal(result.success, false);
});

test(
  "chart_management schema is accepted by the configured OpenRouter model (no 400 on tool registration)",
  { skip: !process.env.OPENROUTER_API_KEY ? "OPENROUTER_API_KEY not set" : false },
  async () => {
    const model = getOpenRouterModel();
    const chartTool = createChartManagementTool(adminUser);
    const modelWithTools = model.bindTools([chartTool]);
    const response = await modelWithTools.invoke(
      "Create a bar chart named 'Monthly Revenue' for dataset id 'ds-123' using x_axis 'month' and y_axis 'revenue'. Call the chart_management tool with action create."
    );
    assert.ok(response.tool_calls && response.tool_calls.length > 0, "expected the model to produce a tool call");
    const call = response.tool_calls![0]!;
    assert.equal(call.name, "chart_management");
    assert.equal(call.args.action, "create");
  }
);
