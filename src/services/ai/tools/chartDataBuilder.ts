import type { ChartConfig } from "./chartSchema.js";

type Row = Record<string, any>;

export function parseAdvancedOptions(
  advancedOptions?: string
): { ok: true; value: Record<string, any> } | { ok: false; error: string } {
  if (!advancedOptions) return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(advancedOptions);
  } catch (err: any) {
    return { ok: false, error: `advanced_options is not valid JSON: ${err.message}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "advanced_options must be a JSON object, not an array or primitive" };
  }
  return { ok: true, value: parsed as Record<string, any> };
}

function aggregate(values: number[], method: string): number {
  switch (method) {
    case "count":
      return values.length;
    case "avg":
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    case "min":
      return values.length ? Math.min(...values) : 0;
    case "max":
      return values.length ? Math.max(...values) : 0;
    case "sum":
    default:
      return values.reduce((a, b) => a + b, 0);
  }
}

function groupAndAggregate(
  rows: Row[],
  groupBy: string,
  valueField: string,
  method: string
): { key: string; value: number }[] {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const key = String(row[groupBy]);
    const value = Number(row[valueField]) || 0;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(value);
    } else {
      groups.set(key, [value]);
    }
  }
  return Array.from(groups.entries()).map(([key, values]) => ({ key, value: aggregate(values, method) }));
}

function buildBaseOption(config: ChartConfig, rows: Row[]): Record<string, any> {
  switch (config.chart_type) {
    case "bar":
    case "line":
    case "area": {
      const yFields = Array.isArray(config.y_axis) ? config.y_axis : [config.y_axis];
      const aggregation = config.aggregation ?? "sum";
      const categories = config.group_by
        ? groupAndAggregate(rows, config.group_by, yFields[0]!, aggregation).map((g) => g.key)
        : rows.map((r) => String(r[config.x_axis]));
      const series = yFields.map((field) => ({
        name: field,
        type: config.chart_type === "area" ? "line" : config.chart_type,
        areaStyle: config.chart_type === "area" ? {} : undefined,
        data: config.group_by
          ? groupAndAggregate(rows, config.group_by, field, aggregation).map((g) => g.value)
          : rows.map((r) => Number(r[field]) || 0),
      }));
      return {
        title: config.title ? { text: config.title } : undefined,
        legend: config.show_legend ? {} : undefined,
        grid: config.show_grid === false ? undefined : { containLabel: true },
        color: config.colors,
        xAxis: { type: "category", data: categories },
        yAxis: { type: "value" },
        series,
      };
    }
    case "pie":
    case "donut": {
      const grouped = groupAndAggregate(rows, config.label_field, config.value_field, config.aggregation ?? "sum");
      return {
        title: config.title ? { text: config.title } : undefined,
        legend: config.show_legend ? {} : undefined,
        color: config.colors,
        series: [
          {
            type: "pie",
            radius: config.chart_type === "donut" ? ["40%", "70%"] : "70%",
            data: grouped.map((g) => ({ name: g.key, value: g.value })),
          },
        ],
      };
    }
    case "scatter":
      return {
        title: config.title ? { text: config.title } : undefined,
        color: config.colors,
        xAxis: { type: "value" },
        yAxis: { type: "value" },
        series: [
          {
            type: "scatter",
            data: rows.map((r) => [Number(r[config.x_axis]) || 0, Number(r[config.y_axis]) || 0]),
          },
        ],
      };
    case "table":
      return {
        columns: config.columns,
        rows: rows.map((r) =>
          config.columns.reduce((acc, col) => ({ ...acc, [col]: r[col] }), {} as Row)
        ),
        pageSize: config.page_size ?? 10,
      };
    case "number":
      return {
        title: config.title ? { text: config.title } : undefined,
        value: aggregate(rows.map((r) => Number(r[config.value_field]) || 0), config.aggregation ?? "sum"),
      };
    case "gauge":
      return {
        series: [
          {
            type: "gauge",
            min: config.min ?? 0,
            max: config.max ?? 100,
            data: [
              {
                value: aggregate(rows.map((r) => Number(r[config.value_field]) || 0), config.aggregation ?? "sum"),
                name: config.title ?? "",
              },
            ],
          },
        ],
      };
  }
}

export function buildEChartsOption(
  config: ChartConfig,
  rows: Row[],
  advancedOverrides: Record<string, any> = {}
): Record<string, any> {
  return { ...buildBaseOption(config, rows), ...advancedOverrides };
}
