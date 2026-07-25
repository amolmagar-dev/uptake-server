import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAdvancedOptions, buildEChartsOption } from "./chartDataBuilder.js";
import type { ChartConfig } from "./chartSchema.js";

test("parseAdvancedOptions: undefined input is ok with an empty object", () => {
  const result = parseAdvancedOptions(undefined);
  assert.deepEqual(result, { ok: true, value: {} });
});

test("parseAdvancedOptions: invalid JSON returns a structured error", () => {
  const result = parseAdvancedOptions("{not json");
  assert.equal(result.ok, false);
});

test("parseAdvancedOptions: a JSON array is rejected (must be an object)", () => {
  const result = parseAdvancedOptions("[1,2,3]");
  assert.equal(result.ok, false);
});

test("buildEChartsOption: bar chart with no group_by uses rows directly", () => {
  const config: ChartConfig = { chart_type: "bar", x_axis: "month", y_axis: "revenue" };
  const rows = [
    { month: "Jan", revenue: 100 },
    { month: "Feb", revenue: 200 },
  ];
  const option = buildEChartsOption(config, rows);
  assert.deepEqual(option.xAxis.data, ["Jan", "Feb"]);
  assert.deepEqual(option.series[0].data, [100, 200]);
  assert.equal(option.series[0].type, "bar");
});

test("buildEChartsOption: bar chart with group_by aggregates by sum", () => {
  const config: ChartConfig = {
    chart_type: "bar",
    x_axis: "region",
    y_axis: "revenue",
    group_by: "region",
    aggregation: "sum",
  };
  const rows = [
    { region: "East", revenue: 100 },
    { region: "East", revenue: 50 },
    { region: "West", revenue: 30 },
  ];
  const option = buildEChartsOption(config, rows);
  assert.deepEqual(option.xAxis.data, ["East", "West"]);
  assert.deepEqual(option.series[0].data, [150, 30]);
});

test("buildEChartsOption: area chart renders as a line series with areaStyle", () => {
  const config: ChartConfig = { chart_type: "area", x_axis: "month", y_axis: "revenue" };
  const option = buildEChartsOption(config, [{ month: "Jan", revenue: 10 }]);
  assert.equal(option.series[0].type, "line");
  assert.ok(option.series[0].areaStyle);
});

test("buildEChartsOption: pie chart groups by label_field and sums value_field", () => {
  const config: ChartConfig = { chart_type: "pie", label_field: "region", value_field: "revenue" };
  const rows = [
    { region: "East", revenue: 100 },
    { region: "East", revenue: 50 },
    { region: "West", revenue: 30 },
  ];
  const option = buildEChartsOption(config, rows);
  assert.deepEqual(option.series[0].data, [
    { name: "East", value: 150 },
    { name: "West", value: 30 },
  ]);
});

test("buildEChartsOption: scatter chart pairs x_axis/y_axis per row", () => {
  const config: ChartConfig = { chart_type: "scatter", x_axis: "age", y_axis: "income" };
  const rows = [{ age: 30, income: 50000 }];
  const option = buildEChartsOption(config, rows);
  assert.deepEqual(option.series[0].data, [[30, 50000]]);
});

test("buildEChartsOption: number chart aggregates value_field with avg", () => {
  const config: ChartConfig = { chart_type: "number", value_field: "score", aggregation: "avg" };
  const rows = [{ score: 10 }, { score: 20 }];
  const option = buildEChartsOption(config, rows);
  assert.equal(option.value, 15);
});

test("buildEChartsOption: gauge chart uses min/max defaults when not provided", () => {
  const config: ChartConfig = { chart_type: "gauge", value_field: "pct" };
  const option = buildEChartsOption(config, [{ pct: 42 }]);
  assert.equal(option.series[0].min, 0);
  assert.equal(option.series[0].max, 100);
  assert.equal(option.series[0].data[0].value, 42);
});

test("buildEChartsOption: table chart projects only the requested columns", () => {
  const config: ChartConfig = { chart_type: "table", columns: ["name"] };
  const rows = [{ name: "Ada", secret: "x" }];
  const option = buildEChartsOption(config, rows);
  assert.deepEqual(option.rows, [{ name: "Ada" }]);
});

test("buildEChartsOption: advancedOverrides are merged on top of the generated option", () => {
  const config: ChartConfig = { chart_type: "bar", x_axis: "month", y_axis: "revenue" };
  const option = buildEChartsOption(config, [{ month: "Jan", revenue: 1 }], {
    tooltip: { trigger: "axis" },
  });
  assert.deepEqual(option.tooltip, { trigger: "axis" });
});
