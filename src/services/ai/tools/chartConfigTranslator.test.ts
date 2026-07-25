import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toAppChartConfig,
  fromAppChartConfig,
  resolveChartConfigForPreview,
} from "./chartConfigTranslator.js";
import type { ChartConfig } from "./chartSchema.js";

// ---------------------------------------------------------------------------
// toAppChartConfig
// ---------------------------------------------------------------------------

test("toAppChartConfig: bar chart maps x_axis/y_axis to xColumn/yColumns", () => {
  const config: ChartConfig = { chart_type: "bar", x_axis: "month", y_axis: "revenue" };
  const { chartType, appConfig } = toAppChartConfig(config);
  assert.equal(chartType, "bar");
  assert.equal(appConfig.xColumn, "month");
  assert.deepEqual(appConfig.yColumns, ["revenue"]);
});

test("toAppChartConfig: bar chart with multiple y_axis series keeps them all in yColumns", () => {
  const config: ChartConfig = { chart_type: "bar", x_axis: "month", y_axis: ["revenue", "cost"] };
  const { appConfig } = toAppChartConfig(config);
  assert.deepEqual(appConfig.yColumns, ["revenue", "cost"]);
});

test("toAppChartConfig: title/legend/grid/colors map to the app's nested shapes", () => {
  const config: ChartConfig = {
    chart_type: "line",
    x_axis: "month",
    y_axis: "revenue",
    title: "Monthly Revenue",
    show_legend: true,
    show_grid: false,
    colors: ["#ff0000"],
  };
  const { appConfig } = toAppChartConfig(config);
  assert.deepEqual(appConfig.title, { show: true, text: "Monthly Revenue" });
  assert.deepEqual(appConfig.legend, { show: true, orient: "horizontal" });
  assert.deepEqual(appConfig.grid, { show: false, containLabel: true });
  assert.deepEqual(appConfig.colors, ["#ff0000"]);
});

test("toAppChartConfig: pie maps label_field/value_field to xColumn/yColumns[0]", () => {
  const config: ChartConfig = { chart_type: "pie", label_field: "region", value_field: "revenue" };
  const { chartType, appConfig } = toAppChartConfig(config);
  assert.equal(chartType, "pie");
  assert.equal(appConfig.xColumn, "region");
  assert.deepEqual(appConfig.yColumns, ["revenue"]);
});

test('toAppChartConfig: donut becomes the app\'s "doughnut"', () => {
  const config: ChartConfig = { chart_type: "donut", label_field: "region", value_field: "revenue" };
  const { chartType, appConfig } = toAppChartConfig(config);
  assert.equal(chartType, "doughnut");
  assert.equal(appConfig.xColumn, "region");
  assert.deepEqual(appConfig.yColumns, ["revenue"]);
});

test("toAppChartConfig: gauge maps value_field to valueColumn and passes min/max through", () => {
  const config: ChartConfig = { chart_type: "gauge", value_field: "pct", min: 10, max: 90 };
  const { chartType, appConfig } = toAppChartConfig(config);
  assert.equal(chartType, "gauge");
  assert.equal(appConfig.valueColumn, "pct");
  assert.deepEqual(appConfig.yColumns, ["pct"]);
  assert.equal(appConfig.min, 10);
  assert.equal(appConfig.max, 90);
});

test('toAppChartConfig: number becomes the app\'s "kpi" with a valueColumn', () => {
  const config: ChartConfig = { chart_type: "number", value_field: "score" };
  const { chartType, appConfig } = toAppChartConfig(config);
  assert.equal(chartType, "kpi");
  assert.equal(appConfig.valueColumn, "score");
  assert.deepEqual(appConfig.yColumns, ["score"]);
});

test("toAppChartConfig: scatter maps to a single-entry yColumns", () => {
  const config: ChartConfig = { chart_type: "scatter", x_axis: "age", y_axis: "income" };
  const { chartType, appConfig } = toAppChartConfig(config);
  assert.equal(chartType, "scatter");
  assert.equal(appConfig.xColumn, "age");
  assert.deepEqual(appConfig.yColumns, ["income"]);
});

test("toAppChartConfig: table passes columns/page_size through unchanged", () => {
  const config: ChartConfig = { chart_type: "table", columns: ["a", "b"], page_size: 25 };
  const { chartType, appConfig } = toAppChartConfig(config);
  assert.equal(chartType, "table");
  assert.deepEqual(appConfig.columns, ["a", "b"]);
  assert.equal(appConfig.page_size, 25);
});

test("toAppChartConfig: group_by/aggregation are preserved so previews stay aggregated", () => {
  const config: ChartConfig = {
    chart_type: "bar",
    x_axis: "region",
    y_axis: "revenue",
    group_by: "region",
    aggregation: "avg",
  };
  const { appConfig } = toAppChartConfig(config);
  assert.equal(appConfig.group_by, "region");
  assert.equal(appConfig.aggregation, "avg");
});

test("toAppChartConfig: advanced_options are merged last, overriding generated fields", () => {
  const config: ChartConfig = {
    chart_type: "bar",
    x_axis: "month",
    y_axis: "revenue",
    advanced_options: JSON.stringify({ backgroundColor: "#000", xColumn: "overridden" }),
  };
  const { appConfig } = toAppChartConfig(config);
  assert.equal(appConfig.backgroundColor, "#000");
  assert.equal(appConfig.xColumn, "overridden");
});

test("toAppChartConfig: an explicit advancedOverrides argument wins over advanced_options", () => {
  const config: ChartConfig = {
    chart_type: "bar",
    x_axis: "month",
    y_axis: "revenue",
    advanced_options: JSON.stringify({ backgroundColor: "#000" }),
  };
  const { appConfig } = toAppChartConfig(config, { backgroundColor: "#fff" });
  assert.equal(appConfig.backgroundColor, "#fff");
});

// ---------------------------------------------------------------------------
// fromAppChartConfig
// ---------------------------------------------------------------------------

test("fromAppChartConfig: reconstructs a bar config from xColumn/yColumns", () => {
  const config = fromAppChartConfig("bar", { xColumn: "month", yColumns: ["revenue"] });
  assert.ok(config);
  assert.equal(config.chart_type, "bar");
  assert.equal((config as any).x_axis, "month");
  assert.deepEqual((config as any).y_axis, ["revenue"]);
});

test("fromAppChartConfig: applies the frontend's labelColumn/dataColumns fallback chain", () => {
  const config = fromAppChartConfig("line", { labelColumn: "month", dataColumns: ["revenue", "cost"] });
  assert.ok(config);
  assert.equal((config as any).x_axis, "month");
  assert.deepEqual((config as any).y_axis, ["revenue", "cost"]);
});

test("fromAppChartConfig: extracts a title string out of the app's title object", () => {
  const config = fromAppChartConfig("bar", {
    xColumn: "month",
    yColumns: ["revenue"],
    title: { show: true, text: "Revenue" },
  });
  assert.equal((config as any).title, "Revenue");
});

test("fromAppChartConfig: an empty title object does not produce an empty title", () => {
  const config = fromAppChartConfig("bar", {
    xColumn: "month",
    yColumns: ["revenue"],
    title: { show: true, text: "" },
  });
  assert.equal((config as any).title, undefined);
});

test("fromAppChartConfig: colorScheme is used when colors is absent", () => {
  const config = fromAppChartConfig("bar", {
    xColumn: "month",
    yColumns: ["revenue"],
    colorScheme: ["#111", "#222"],
  });
  assert.deepEqual((config as any).colors, ["#111", "#222"]);
});

test('fromAppChartConfig: reverse-maps "doughnut" to "donut"', () => {
  const config = fromAppChartConfig("doughnut", { xColumn: "region", yColumns: ["revenue"] });
  assert.ok(config);
  assert.equal(config.chart_type, "donut");
  assert.equal((config as any).label_field, "region");
  assert.equal((config as any).value_field, "revenue");
});

test('fromAppChartConfig: reverse-maps "kpi" to "number" using valueColumn', () => {
  const config = fromAppChartConfig("kpi", { valueColumn: "score" });
  assert.ok(config);
  assert.equal(config.chart_type, "number");
  assert.equal((config as any).value_field, "score");
});

test("fromAppChartConfig: gauge falls back to yColumns[0] when valueColumn is absent", () => {
  const config = fromAppChartConfig("gauge", { yColumns: ["pct"], min: 0, max: 50 });
  assert.ok(config);
  assert.equal(config.chart_type, "gauge");
  assert.equal((config as any).value_field, "pct");
  assert.equal((config as any).max, 50);
});

test("fromAppChartConfig: table derives columns from xColumn + yColumns", () => {
  const config = fromAppChartConfig("table", { xColumn: "vessel_id", yColumns: ["defect_id"] });
  assert.ok(config);
  assert.deepEqual((config as any).columns, ["vessel_id", "defect_id"]);
});

test("fromAppChartConfig: returns null for an app chart type the AI tool does not support", () => {
  assert.equal(fromAppChartConfig("radar", { xColumn: "a", yColumns: ["b"] }), null);
  assert.equal(fromAppChartConfig("rose", { xColumn: "a", yColumns: ["b"] }), null);
  assert.equal(fromAppChartConfig("funnel", { xColumn: "a", yColumns: ["b"] }), null);
  assert.equal(fromAppChartConfig("treemap", { xColumn: "a", yColumns: ["b"] }), null);
  assert.equal(fromAppChartConfig("heatmap", { xColumn: "a", yColumns: ["b"] }), null);
});

test("fromAppChartConfig: returns null for an entirely unknown chart type", () => {
  assert.equal(fromAppChartConfig("sankey", { xColumn: "a", yColumns: ["b"] }), null);
});

test("fromAppChartConfig: returns null when an axis chart has no usable column mapping", () => {
  assert.equal(fromAppChartConfig("bar", {}), null);
  assert.equal(fromAppChartConfig("bar", { xColumn: "month" }), null);
  assert.equal(fromAppChartConfig("bar", { yColumns: ["revenue"] }), null);
});

test("fromAppChartConfig: returns null when gauge/number have no value column", () => {
  assert.equal(fromAppChartConfig("gauge", { xColumn: "month" }), null);
  assert.equal(fromAppChartConfig("kpi", {}), null);
});

test("fromAppChartConfig: recovers group_by/aggregation when the config carries them", () => {
  const config = fromAppChartConfig("bar", {
    xColumn: "region",
    yColumns: ["revenue"],
    group_by: "region",
    aggregation: "avg",
  });
  assert.equal((config as any).group_by, "region");
  assert.equal((config as any).aggregation, "avg");
});

// ---------------------------------------------------------------------------
// Round trips and resolveChartConfigForPreview
// ---------------------------------------------------------------------------

test("round trip: an AI bar config survives toAppChartConfig -> resolveChartConfigForPreview", () => {
  const original: ChartConfig = {
    chart_type: "bar",
    x_axis: "region",
    y_axis: ["revenue"],
    group_by: "region",
    aggregation: "sum",
    title: "By Region",
  };
  const { chartType, appConfig } = toAppChartConfig(original);
  const resolved = resolveChartConfigForPreview(chartType, JSON.stringify(appConfig));
  assert.ok(resolved);
  assert.equal(resolved.chart_type, "bar");
  assert.equal((resolved as any).x_axis, "region");
  assert.equal((resolved as any).group_by, "region");
  assert.equal((resolved as any).aggregation, "sum");
  assert.equal((resolved as any).title, "By Region");
});

test("round trip: an AI donut config survives translation in both directions", () => {
  const original: ChartConfig = { chart_type: "donut", label_field: "region", value_field: "revenue" };
  const { chartType, appConfig } = toAppChartConfig(original);
  assert.equal(chartType, "doughnut");
  const resolved = resolveChartConfigForPreview(chartType, JSON.stringify(appConfig));
  assert.ok(resolved);
  assert.equal(resolved.chart_type, "donut");
  assert.equal((resolved as any).label_field, "region");
});

test("resolveChartConfigForPreview: handles a real app-authored area chart config (no chart_type key)", () => {
  // Verbatim config body from a chart created by the app's own Chart Editor.
  const raw = JSON.stringify({
    title: { show: true, text: "" },
    xAxis: { show: true },
    yAxis: { show: true },
    legend: { show: true, orient: "horizontal", top: "bottom" },
    xColumn: "Brand",
    yColumns: ["Rating"],
    colorScheme: ["#2a2a3a", "#606070"],
    backgroundColor: "#151520",
    seriesParams: { Rating: { type: "line" } },
  });
  const resolved = resolveChartConfigForPreview("area", raw);
  assert.ok(resolved, "expected a reconstructed config, not null");
  assert.equal(resolved.chart_type, "area");
  assert.equal((resolved as any).x_axis, "Brand");
  assert.deepEqual((resolved as any).y_axis, ["Rating"]);
  assert.equal((resolved as any).show_legend, true);
});

test("resolveChartConfigForPreview: handles a real app-authored table chart config", () => {
  const raw = JSON.stringify({
    title: { show: true, text: "", left: "center", top: "bottom" },
    legend: { show: true, orient: "vertical", top: "bottom" },
    xColumn: "vessel_id",
    yColumns: ["defect_id"],
    grid: { show: false },
  });
  const resolved = resolveChartConfigForPreview("table", raw);
  assert.ok(resolved);
  assert.equal(resolved.chart_type, "table");
  assert.deepEqual((resolved as any).columns, ["vessel_id", "defect_id"]);
});

test("resolveChartConfigForPreview: returns null for malformed JSON instead of throwing", () => {
  assert.equal(resolveChartConfigForPreview("bar", "{not json"), null);
  assert.equal(resolveChartConfigForPreview("bar", "[1,2,3]"), null);
});

test("resolveChartConfigForPreview: returns null for an unsupported app chart type", () => {
  const raw = JSON.stringify({ xColumn: "a", yColumns: ["b"] });
  assert.equal(resolveChartConfigForPreview("radar", raw), null);
});

test("resolveChartConfigForPreview: accepts a config that already matches the AI schema", () => {
  const raw = JSON.stringify({ x_axis: "month", y_axis: "revenue" });
  const resolved = resolveChartConfigForPreview("bar", raw);
  assert.ok(resolved);
  assert.equal((resolved as any).x_axis, "month");
});
