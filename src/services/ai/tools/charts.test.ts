import { test } from "node:test";
import assert from "node:assert/strict";
import { createChartManagementTool } from "./charts.js";
import { getOpenRouterModel } from "../../../config/openrouter.js";
import { chartRepository, datasetRepository, connectionRepository } from "../../../db/repositories/index.js";

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

test("chart_management: get_data resolves a chart whose stored config has no chart_type key (app-authored chart)", async () => {
  // Regression test: get_data used to run chartConfigSchema.parse() straight over the
  // stored config, which fails for every chart created by the app's own Chart Editor
  // (its config uses xColumn/yColumns and has no chart_type key). The tool must now
  // reconstruct the config and get as far as fetching data.
  //
  // The seeded dataset uses a deliberately unsupported source_type so the run stops at
  // the data-fetch step with a deterministic, offline error — which only happens if
  // config resolution succeeded first.
  const connection = await connectionRepository.create({
    name: "ai-tool-test-temp-connection",
    type: "postgresql",
    host: "127.0.0.1",
    database_name: "unused",
  });
  const dataset = await datasetRepository.create({
    name: "ai-tool-test-temp-dataset",
    source_type: "unsupported-for-test",
    dataset_type: "physical",
    connection_id: connection.id,
    table_name: "unused",
  });
  const chart = await chartRepository.create({
    name: "ai-tool-test-temp-chart",
    chart_type: "area",
    // Verbatim app-authored config shape: camelCase columns, no chart_type key.
    config: JSON.stringify({
      title: { show: true, text: "" },
      xAxis: { show: true },
      yAxis: { show: true },
      legend: { show: true, orient: "horizontal", top: "bottom" },
      xColumn: "Brand",
      yColumns: ["Rating"],
      colorScheme: ["#2a2a3a", "#606070"],
    }),
    dataset_id: dataset.id,
  });

  try {
    const tool = createChartManagementTool(adminUser);
    // Must resolve (not reject) — the tool always returns a JSON envelope.
    const raw = await tool.invoke({ action: "get_data", chartId: chart.id });
    const result = JSON.parse(raw);

    assert.equal(result.success, false);
    assert.match(
      result.error,
      /unsupported source type/i,
      `expected to fail at the data-fetch step, not at config validation (got: ${result.error})`
    );
    // Guard against regressing to a Zod union/validation failure on the stored config.
    assert.doesNotMatch(result.error, /chart_type|invalid_union|discriminator/i);
  } finally {
    await chartRepository.delete(chart.id);
    await datasetRepository.delete(dataset.id);
    await connectionRepository.delete(connection.id);
  }
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
