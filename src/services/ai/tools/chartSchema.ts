import { z } from "zod";

const aggregationSchema = z.enum(["sum", "count", "avg", "min", "max"]);

const advancedOptionsField = z
  .string()
  .optional()
  .describe(
    "Raw JSON string of additional ECharts options to merge on top of the generated chart (only for options not covered by the fields above)."
  );

function axisChartSchema(chartType: "bar" | "line" | "area") {
  return z.object({
    chart_type: z.literal(chartType),
    x_axis: z.string().describe("Column name for the X axis / categories"),
    y_axis: z
      .union([z.string(), z.array(z.string())])
      .describe("Column name (or names, for multiple series) for the Y axis"),
    group_by: z.string().optional().describe("Column to group rows by before aggregating y_axis"),
    aggregation: aggregationSchema
      .optional()
      .describe("How to aggregate y_axis values within each group (default: sum)"),
    colors: z.array(z.string()).optional().describe("Custom hex colors for the series"),
    show_legend: z.boolean().optional().describe("Whether to show the legend"),
    show_grid: z.boolean().optional().describe("Whether to show grid lines"),
    title: z.string().optional().describe("Chart title"),
    advanced_options: advancedOptionsField,
  });
}

function pieChartSchema(chartType: "pie" | "donut") {
  return z.object({
    chart_type: z.literal(chartType),
    label_field: z.string().describe("Column whose values become slice labels"),
    value_field: z.string().describe("Column whose values become slice sizes"),
    aggregation: aggregationSchema
      .optional()
      .describe("How to aggregate value_field within each label_field group (default: sum)"),
    colors: z.array(z.string()).optional().describe("Custom hex colors for the slices"),
    show_legend: z.boolean().optional().describe("Whether to show the legend"),
    title: z.string().optional().describe("Chart title"),
    advanced_options: advancedOptionsField,
  });
}

const scatterSchema = z.object({
  chart_type: z.literal("scatter"),
  x_axis: z.string().describe("Numeric column for the X axis"),
  y_axis: z.string().describe("Numeric column for the Y axis"),
  colors: z.array(z.string()).optional().describe("Custom hex colors for the points"),
  title: z.string().optional().describe("Chart title"),
  advanced_options: advancedOptionsField,
});

const tableSchema = z.object({
  chart_type: z.literal("table"),
  columns: z.array(z.string()).describe("Column names to display, in order"),
  page_size: z.number().int().positive().optional().describe("Rows per page (default: 10)"),
  advanced_options: advancedOptionsField,
});

const numberSchema = z.object({
  chart_type: z.literal("number"),
  value_field: z.string().describe("Column to aggregate into a single KPI value"),
  aggregation: aggregationSchema.optional().describe("How to aggregate value_field (default: sum)"),
  title: z.string().optional().describe("Chart title"),
  advanced_options: advancedOptionsField,
});

const gaugeSchema = z.object({
  chart_type: z.literal("gauge"),
  value_field: z.string().describe("Column to aggregate into the gauge value"),
  aggregation: aggregationSchema.optional().describe("How to aggregate value_field (default: sum)"),
  min: z.number().optional().describe("Gauge minimum (default: 0)"),
  max: z.number().optional().describe("Gauge maximum (default: 100)"),
  title: z.string().optional().describe("Chart title"),
  advanced_options: advancedOptionsField,
});

export const chartConfigSchema = z.discriminatedUnion("chart_type", [
  axisChartSchema("bar"),
  axisChartSchema("line"),
  axisChartSchema("area"),
  pieChartSchema("pie"),
  pieChartSchema("donut"),
  scatterSchema,
  tableSchema,
  numberSchema,
  gaugeSchema,
]);

export type ChartConfig = z.infer<typeof chartConfigSchema>;
