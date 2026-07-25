/**
 * Translation layer between the AI chart tool's own chart config vocabulary
 * (see chartSchema.ts — a discriminated union on `chart_type` using snake_case
 * field names like `x_axis` / `label_field` / `value_field`) and the config
 * format the Uptake frontend actually renders
 * (`frontend/src/types/chart-config.ts` + `frontend/src/lib/chartConfigGenerator.ts`,
 * which read camelCase `xColumn` / `yColumns` / `valueColumn`).
 *
 * The app's own convention is that `chart_type` is ALWAYS a separate top-level
 * column and never nested inside `config`, so only the config *body* is translated.
 */

import { chartConfigSchema, type ChartConfig } from "./chartSchema.js";
import { parseAdvancedOptions } from "./chartDataBuilder.js";

type AiChartType = ChartConfig["chart_type"];

/** AI tool chart_type -> the app's chart_type column value. */
const AI_TO_APP_CHART_TYPE: Record<AiChartType, string> = {
  bar: "bar",
  line: "line",
  area: "area",
  scatter: "scatter",
  pie: "pie",
  donut: "doughnut",
  table: "table",
  number: "kpi",
  gauge: "gauge",
};

/**
 * The app's chart_type column value -> the AI tool's chart_type.
 * The app supports more types than the AI tool exposes (rose, radar, funnel,
 * treemap, heatmap); those are deliberately absent and resolve to null.
 */
const APP_TO_AI_CHART_TYPE: Record<string, AiChartType> = {
  bar: "bar",
  line: "line",
  area: "area",
  scatter: "scatter",
  pie: "pie",
  doughnut: "donut",
  table: "table",
  kpi: "number",
  gauge: "gauge",
};

function asArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

/** Shared title/legend/grid/colors mapping applied to every chart type. */
function commonAppFields(config: ChartConfig): Record<string, any> {
  const out: Record<string, any> = {};
  const title = "title" in config ? config.title : undefined;
  if (title) out.title = { show: true, text: title };
  if ("show_legend" in config && config.show_legend !== undefined) {
    out.legend = { show: config.show_legend, orient: "horizontal" };
  }
  if ("show_grid" in config && config.show_grid !== undefined) {
    out.grid = { show: config.show_grid, containLabel: true };
  }
  if ("colors" in config && config.colors) out.colors = config.colors;
  return out;
}

/**
 * Aggregation intent is not expressible in the app's declarative ChartConfig, so
 * `group_by` / `aggregation` are carried through as extra snake_case keys. The app
 * renderer ignores unknown keys (`chartConfigGenerator.ts` reads a fixed field list,
 * and `ChartEditorPage` merges config with lodash `merge`), while
 * `fromAppChartConfig` can recover them so the chat-widget preview stays accurate.
 */
function aggregationPassthrough(config: ChartConfig): Record<string, any> {
  const out: Record<string, any> = {};
  if ("group_by" in config && config.group_by) out.group_by = config.group_by;
  if ("aggregation" in config && config.aggregation) out.aggregation = config.aggregation;
  return out;
}

/**
 * Translate an AI-authored ChartConfig into the app's chart_type + config pair.
 *
 * `advancedOverrides` is the already-parsed `advanced_options` object; when omitted
 * it is parsed from `config.advanced_options`. It is merged last, mirroring how
 * `buildEChartsOption` applies its own advanced-options overrides.
 */
export function toAppChartConfig(
  config: ChartConfig,
  advancedOverrides?: Record<string, any>
): { chartType: string; appConfig: Record<string, any> } {
  const chartType = AI_TO_APP_CHART_TYPE[config.chart_type];
  const base = { ...commonAppFields(config), ...aggregationPassthrough(config) };

  let specific: Record<string, any>;
  switch (config.chart_type) {
    case "bar":
    case "line":
    case "area":
      specific = { xColumn: config.x_axis, yColumns: asArray(config.y_axis) };
      break;
    case "scatter":
      specific = { xColumn: config.x_axis, yColumns: [config.y_axis] };
      break;
    case "pie":
    case "donut":
      // The app's pie/doughnut renderer reads xColumn as the slice label column
      // and yColumns[0] as the slice value column.
      specific = { xColumn: config.label_field, yColumns: [config.value_field] };
      break;
    case "gauge":
      specific = { valueColumn: config.value_field, yColumns: [config.value_field] };
      if (config.min !== undefined) specific.min = config.min;
      if (config.max !== undefined) specific.max = config.max;
      break;
    case "number":
      // Rendered by the app's KPICard, which reads valueColumn (falling back to yColumns[0]).
      specific = { valueColumn: config.value_field, yColumns: [config.value_field] };
      break;
    case "table":
      // The app renders tables with <DataTable data={data} /> and has no
      // column-selection config field, so these are passed through unchanged:
      // harmless and unused by the app, but they let the AI tool round-trip its
      // own table config back out of the DB.
      specific = { columns: config.columns };
      if (config.page_size !== undefined) specific.page_size = config.page_size;
      break;
  }

  let advancedValue: Record<string, any> = {};
  if (advancedOverrides) {
    advancedValue = advancedOverrides;
  } else {
    const parsed = parseAdvancedOptions(config.advanced_options);
    if (parsed.ok) advancedValue = parsed.value;
  }

  return { chartType, appConfig: { ...base, ...specific, ...advancedValue } };
}

/** Pull a plain title string out of the app's `title` field, which may be a string or an object. */
function titleTextFrom(appConfig: Record<string, any>): string | undefined {
  const title = appConfig.title;
  if (typeof title === "string") return title || undefined;
  if (title && typeof title === "object" && typeof title.text === "string") return title.text || undefined;
  return undefined;
}

function booleanFrom(...candidates: unknown[]): boolean | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "boolean") return candidate;
  }
  return undefined;
}

/**
 * Best-effort reverse translation: given an app-authored chart's `chart_type`
 * column and its parsed `config` JSON (which has no `chart_type` key and uses
 * `xColumn`/`yColumns`/etc.), reconstruct a ChartConfig so `buildEChartsOption`
 * can still compute a chat-widget preview.
 *
 * Returns null when the chart type is outside the 9 the AI tool supports, or when
 * the essential column mappings are missing — callers should degrade gracefully
 * rather than guess.
 */
export function fromAppChartConfig(chartType: string, appConfig: Record<string, any>): ChartConfig | null {
  const aiChartType = APP_TO_AI_CHART_TYPE[String(chartType).toLowerCase()];
  if (!aiChartType) return null;
  if (!appConfig || typeof appConfig !== "object") return null;

  // Same fallback chain the frontend's own generateEChartsOption() applies.
  const xColumn: unknown = appConfig.xColumn ?? appConfig.labelColumn;
  const rawYColumns: unknown = appConfig.yColumns ?? appConfig.dataColumns;
  const yColumns = Array.isArray(rawYColumns) ? rawYColumns.filter((c): c is string => typeof c === "string" && !!c) : [];
  const valueColumn: unknown = appConfig.valueColumn ?? yColumns[0];

  const title = titleTextFrom(appConfig);
  const colors = Array.isArray(appConfig.colors)
    ? appConfig.colors
    : Array.isArray(appConfig.colorScheme)
    ? appConfig.colorScheme
    : undefined;
  const showLegend = booleanFrom(appConfig.legend?.show, appConfig.showLegend);
  const showGrid = booleanFrom(appConfig.grid?.show, appConfig.showGrid);
  const groupBy = typeof appConfig.group_by === "string" ? appConfig.group_by : undefined;
  const aggregation = typeof appConfig.aggregation === "string" ? appConfig.aggregation : undefined;

  const candidate: Record<string, any> = { chart_type: aiChartType };
  if (title !== undefined) candidate.title = title;
  if (colors !== undefined) candidate.colors = colors;

  switch (aiChartType) {
    case "bar":
    case "line":
    case "area": {
      if (typeof xColumn !== "string" || !xColumn || yColumns.length === 0) return null;
      candidate.x_axis = xColumn;
      candidate.y_axis = yColumns;
      if (showLegend !== undefined) candidate.show_legend = showLegend;
      if (showGrid !== undefined) candidate.show_grid = showGrid;
      if (groupBy !== undefined) candidate.group_by = groupBy;
      if (aggregation !== undefined) candidate.aggregation = aggregation;
      break;
    }
    case "scatter": {
      if (typeof xColumn !== "string" || !xColumn || yColumns.length === 0) return null;
      candidate.x_axis = xColumn;
      candidate.y_axis = yColumns[0];
      break;
    }
    case "pie":
    case "donut": {
      if (typeof xColumn !== "string" || !xColumn || yColumns.length === 0) return null;
      candidate.label_field = xColumn;
      candidate.value_field = yColumns[0];
      if (showLegend !== undefined) candidate.show_legend = showLegend;
      if (aggregation !== undefined) candidate.aggregation = aggregation;
      break;
    }
    case "gauge": {
      if (typeof valueColumn !== "string" || !valueColumn) return null;
      candidate.value_field = valueColumn;
      if (typeof appConfig.min === "number") candidate.min = appConfig.min;
      if (typeof appConfig.max === "number") candidate.max = appConfig.max;
      if (aggregation !== undefined) candidate.aggregation = aggregation;
      break;
    }
    case "number": {
      if (typeof valueColumn !== "string" || !valueColumn) return null;
      candidate.value_field = valueColumn;
      if (aggregation !== undefined) candidate.aggregation = aggregation;
      break;
    }
    case "table": {
      // The app has no table column-selection field, so fall back to whatever
      // column mapping the config does carry.
      const explicit = Array.isArray(appConfig.columns)
        ? appConfig.columns.filter((c: unknown): c is string => typeof c === "string" && !!c)
        : [];
      const derived = [typeof xColumn === "string" && xColumn ? xColumn : undefined, ...yColumns].filter(
        (c): c is string => !!c
      );
      const columns = Array.from(new Set(explicit.length > 0 ? explicit : derived));
      if (columns.length === 0) return null;
      candidate.columns = columns;
      if (typeof appConfig.page_size === "number") candidate.page_size = appConfig.page_size;
      break;
    }
  }

  const parsed = chartConfigSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Resolve a stored chart row into a ChartConfig usable by `buildEChartsOption`.
 *
 * Charts in this database come from two places: the app's own Chart Editor (app
 * format) and this AI tool (also app format, since FIX 1). Either way the config
 * body may or may not happen to satisfy the AI schema directly, so try that first
 * and fall back to reverse translation. Returns null when no preview can be built.
 */
export function resolveChartConfigForPreview(chartType: string, rawConfig: string): ChartConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const direct = chartConfigSchema.safeParse({ ...(parsed as Record<string, any>), chart_type: chartType });
  if (direct.success) return direct.data;

  return fromAppChartConfig(chartType, parsed as Record<string, any>);
}
