import { test } from "node:test";
import assert from "node:assert/strict";
import { chartConfigSchema } from "./chartSchema.js";

test("accepts a valid bar config", () => {
  const result = chartConfigSchema.safeParse({
    chart_type: "bar",
    x_axis: "month",
    y_axis: "revenue",
    aggregation: "sum",
  });
  assert.equal(result.success, true);
});

test("rejects a bar config missing x_axis", () => {
  const result = chartConfigSchema.safeParse({
    chart_type: "bar",
    y_axis: "revenue",
  });
  assert.equal(result.success, false);
});

test("accepts a valid pie config with label_field/value_field", () => {
  const result = chartConfigSchema.safeParse({
    chart_type: "pie",
    label_field: "region",
    value_field: "revenue",
  });
  assert.equal(result.success, true);
});

test("rejects a pie config using x_axis/y_axis instead of label_field/value_field", () => {
  const result = chartConfigSchema.safeParse({
    chart_type: "pie",
    x_axis: "region",
    y_axis: "revenue",
  });
  assert.equal(result.success, false);
});

test("accepts a valid gauge config", () => {
  const result = chartConfigSchema.safeParse({
    chart_type: "gauge",
    value_field: "completion_pct",
    min: 0,
    max: 100,
  });
  assert.equal(result.success, true);
});

test("accepts a valid table config", () => {
  const result = chartConfigSchema.safeParse({
    chart_type: "table",
    columns: ["name", "revenue"],
  });
  assert.equal(result.success, true);
});

test("rejects an unknown chart_type", () => {
  const result = chartConfigSchema.safeParse({
    chart_type: "waterfall",
    value_field: "x",
  });
  assert.equal(result.success, false);
});

test("accepts advanced_options as a JSON string on any branch", () => {
  const result = chartConfigSchema.safeParse({
    chart_type: "bar",
    x_axis: "month",
    y_axis: "revenue",
    advanced_options: '{"tooltip":{"trigger":"axis"}}',
  });
  assert.equal(result.success, true);
});
