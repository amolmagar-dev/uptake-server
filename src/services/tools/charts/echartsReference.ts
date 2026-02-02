/**
 * ECharts Options Reference Schema for RAG
 * Compact version for AI context - contains key options and their types
 */

export interface EChartsOptionReference {
  [key: string]: {
    type: string;
    description?: string;
    properties?: Record<string, any>;
    items?: Record<string, any>;
    default?: any;
  };
}

export const echartsOptionsReference: EChartsOptionReference = {
  title: {
    type: "object",
    description: "Chart title options",
    properties: {
      show: { type: "boolean", default: true },
      text: { type: "string", description: "Main title text" },
      subtext: { type: "string", description: "Subtitle text" },
      left: { type: "string|number", default: "auto", description: "Position: left, center, right, or number" },
      top: { type: "string|number", default: "auto" },
      textStyle: { type: "object", properties: { color: "string", fontSize: "number", fontWeight: "string" } },
    },
  },
  legend: {
    type: "object",
    description: "Legend options",
    properties: {
      show: { type: "boolean", default: true },
      type: { type: "string", options: ["plain", "scroll"] },
      orient: { type: "string", options: ["horizontal", "vertical"] },
      left: { type: "string|number" },
      top: { type: "string|number" },
      data: { type: "array", description: "Legend items" },
      selected: { type: "object", description: "Selected state of legend items" },
    },
  },
  grid: {
    type: "object",
    description: "Grid layout options for cartesian charts",
    properties: {
      show: { type: "boolean", default: false },
      left: { type: "string|number", default: "10%" },
      right: { type: "string|number", default: "10%" },
      top: { type: "number", default: 60 },
      bottom: { type: "number", default: 60 },
      containLabel: { type: "boolean", default: false },
      backgroundColor: { type: "string" },
    },
  },
  xAxis: {
    type: "object|array",
    description: "X-axis options (can be array for multiple axes)",
    properties: {
      show: { type: "boolean", default: true },
      type: { type: "string", options: ["value", "category", "time", "log"], default: "category" },
      name: { type: "string", description: "Axis name" },
      data: { type: "array", description: "Category data" },
      position: { type: "string", options: ["top", "bottom"] },
      axisLine: { type: "object" },
      axisLabel: { type: "object", properties: { rotate: "number", formatter: "string|function" } },
      splitLine: { type: "object", properties: { show: "boolean" } },
    },
  },
  yAxis: {
    type: "object|array",
    description: "Y-axis options (can be array for multiple axes)",
    properties: {
      show: { type: "boolean", default: true },
      type: { type: "string", options: ["value", "category", "time", "log"], default: "value" },
      name: { type: "string" },
      min: { type: "number|string" },
      max: { type: "number|string" },
      axisLabel: { type: "object", properties: { formatter: "string|function" } },
      splitLine: { type: "object" },
    },
  },
  tooltip: {
    type: "object",
    description: "Tooltip options",
    properties: {
      show: { type: "boolean", default: true },
      trigger: { type: "string", options: ["item", "axis", "none"], default: "item" },
      axisPointer: { type: "object", properties: { type: ["line", "shadow", "cross"] } },
      formatter: { type: "string|function", description: "Tooltip content formatter" },
      backgroundColor: { type: "string" },
      borderColor: { type: "string" },
      textStyle: { type: "object" },
    },
  },
  series: {
    type: "array",
    description: "Data series array - the core visualization data",
    items: {
      type: { type: "string", required: true, options: ["line", "bar", "pie", "scatter", "effectScatter", "radar", "tree", "treemap", "sunburst", "boxplot", "candlestick", "heatmap", "map", "parallel", "lines", "graph", "sankey", "funnel", "gauge", "pictorialBar", "themeRiver", "custom"] },
      name: { type: "string" },
      data: { type: "array", description: "Data values - use $DATA for dynamic data" },
      // Line/Bar specific
      stack: { type: "string", description: "Stack name for stacked charts" },
      smooth: { type: "boolean", description: "Smooth line (line chart)" },
      areaStyle: { type: "object", description: "Fill area under line" },
      // Pie specific
      radius: { type: "string|array", description: "Pie radius, e.g. '50%' or ['40%', '70%'] for donut" },
      center: { type: "array", description: "Pie center position" },
      roseType: { type: "string", options: ["radius", "area"] },
      // Common
      itemStyle: { type: "object", properties: { color: "string|function", borderColor: "string", borderWidth: "number" } },
      label: { type: "object", properties: { show: "boolean", position: "string", formatter: "string|function" } },
      emphasis: { type: "object", description: "Highlight style on hover" },
      // Gauge specific
      min: { type: "number" },
      max: { type: "number" },
      progress: { type: "object" },
      axisLine: { type: "object" },
      pointer: { type: "object" },
      detail: { type: "object", properties: { formatter: "string|function" } },
    },
  },
  dataZoom: {
    type: "array",
    description: "Data zoom for large datasets",
    items: {
      type: { type: "string", options: ["inside", "slider"] },
      xAxisIndex: { type: "number|array" },
      yAxisIndex: { type: "number|array" },
      start: { type: "number", default: 0 },
      end: { type: "number", default: 100 },
    },
  },
  visualMap: {
    type: "object|array",
    description: "Visual mapping for color gradients",
    properties: {
      type: { type: "string", options: ["continuous", "piecewise"] },
      min: { type: "number" },
      max: { type: "number" },
      inRange: { type: "object", properties: { color: "array" } },
    },
  },
  toolbox: {
    type: "object",
    description: "Toolbox with utilities",
    properties: {
      show: { type: "boolean", default: true },
      feature: {
        type: "object",
        properties: {
          saveAsImage: { type: "object" },
          restore: { type: "object" },
          dataView: { type: "object" },
          dataZoom: { type: "object" },
          magicType: { type: "object", properties: { type: "array" } },
        },
      },
    },
  },
  color: {
    type: "array",
    description: "Global color palette",
    default: ["#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de", "#3ba272", "#fc8452", "#9a60b4", "#ea7ccc"],
  },
  backgroundColor: {
    type: "string",
    description: "Chart background color",
    default: "transparent",
  },
  animation: {
    type: "boolean",
    description: "Enable/disable animation",
    default: true,
  },
  animationDuration: {
    type: "number",
    description: "Animation duration in ms",
    default: 1000,
  },
  dataset: {
    type: "object|array",
    description: "Dataset for data management (alternative to series.data)",
    properties: {
      source: { type: "array", description: "Data array - use $DATA for dynamic data" },
      dimensions: { type: "array", description: "Dimension definitions" },
    },
  },
};

/**
 * Get ECharts options reference as a formatted string for AI context
 */
export function getEChartsReferenceContext(): string {
  const sections = Object.entries(echartsOptionsReference).map(([key, value]) => {
    const props = value.properties 
      ? Object.entries(value.properties)
          .map(([propKey, propValue]) => {
            const propStr = typeof propValue === 'object' 
              ? `${propKey}: ${JSON.stringify(propValue)}`
              : `${propKey}: ${propValue}`;
            return `    - ${propStr}`;
          })
          .join('\n')
      : '';
    
    return `${key} (${value.type}): ${value.description || ''}\n${props}`;
  });

  return `ECharts Configuration Reference:\n${sections.join('\n\n')}`;
}

/**
 * Chart type specific templates
 */
export const chartTypeTemplates: Record<string, object> = {
  bar: {
    xAxis: { type: "category", data: "$CATEGORIES" },
    yAxis: { type: "value" },
    series: [{ type: "bar", data: "$DATA", name: "$SERIES_NAME" }],
    tooltip: { trigger: "axis" },
  },
  line: {
    xAxis: { type: "category", data: "$CATEGORIES" },
    yAxis: { type: "value" },
    series: [{ type: "line", data: "$DATA", name: "$SERIES_NAME", smooth: true }],
    tooltip: { trigger: "axis" },
  },
  pie: {
    series: [{
      type: "pie",
      radius: "50%",
      data: "$DATA",
      emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: "rgba(0, 0, 0, 0.5)" } },
    }],
    tooltip: { trigger: "item" },
  },
  donut: {
    series: [{
      type: "pie",
      radius: ["40%", "70%"],
      data: "$DATA",
      label: { show: true, position: "outside" },
    }],
    tooltip: { trigger: "item" },
  },
  area: {
    xAxis: { type: "category", data: "$CATEGORIES", boundaryGap: false },
    yAxis: { type: "value" },
    series: [{ type: "line", data: "$DATA", areaStyle: {}, smooth: true }],
    tooltip: { trigger: "axis" },
  },
  scatter: {
    xAxis: { type: "value" },
    yAxis: { type: "value" },
    series: [{ type: "scatter", data: "$DATA", symbolSize: 10 }],
    tooltip: { trigger: "item" },
  },
  gauge: {
    series: [{
      type: "gauge",
      min: 0,
      max: 100,
      data: [{ value: "$VALUE", name: "$NAME" }],
      detail: { formatter: "{value}%" },
    }],
  },
};

export default echartsOptionsReference;
