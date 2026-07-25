/**
 * Script to convert scraped ECharts options array to nested JSON
 * Run with: node scripts/convertOptionsToJson.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the allOptions.js file
const allOptionsPath = join(__dirname, '../data/allOptions.js');
const outputPath = join(__dirname, '../data/echartsOption.json');

// Extract the array from the file
const fileContent = readFileSync(allOptionsPath, 'utf8');

// Extract the array content between 'let a = [' and the closing ']'
const arrayMatch = fileContent.match(/let\s+a\s*=\s*\[([\s\S]*?)\]\s*(?:\/\/|export|$)/);
if (!arrayMatch) {
  console.error('Could not find array in allOptions.js');
  process.exit(1);
}

// Parse the array elements
const arrayContent = arrayMatch[1];
const elements = [];
const regex = /"([^"\\]*(\\.[^"\\]*)*)"/g;
let match;
while ((match = regex.exec(arrayContent)) !== null) {
  elements.push(match[1]);
}

console.log(`Found ${elements.length} elements to parse`);

// Known top-level ECharts option keys
const TOP_LEVEL_KEYS = new Set([
  'title', 'legend', 'grid', 'xAxis', 'yAxis', 'polar', 'radiusAxis',
  'angleAxis', 'radar', 'dataZoom', 'visualMap', 'tooltip', 'axisPointer',
  'toolbox', 'brush', 'geo', 'parallel', 'parallelAxis', 'singleAxis',
  'timeline', 'graphic', 'calendar', 'dataset', 'aria', 'series',
  'darkMode', 'color', 'backgroundColor', 'textStyle', 'animation',
  'animationThreshold', 'animationDuration', 'animationEasing',
  'animationDelay', 'animationDurationUpdate', 'animationEasingUpdate',
  'animationDelayUpdate', 'stateAnimation', 'blendMode', 'hoverLayerThreshold',
  'useUTC', 'options', 'media', 'matrix', 'thumbnail'
]);

/**
 * Parse value string to appropriate JS type
 */
function parseValue(valueStr) {
  if (!valueStr || valueStr === '...' || valueStr === 'undefined') return null;
  if (valueStr === 'true') return true;
  if (valueStr === 'false') return false;
  if (valueStr === 'null') return null;
  if (valueStr === '{...}') return {};

  // Handle numbers
  if (/^-?\d+(\.\d+)?$/.test(valueStr)) {
    return parseFloat(valueStr);
  }

  // Handle strings (remove quotes)
  if ((valueStr.startsWith("'") && valueStr.endsWith("'")) ||
    (valueStr.startsWith('"') && valueStr.endsWith('"'))) {
    return valueStr.slice(1, -1);
  }

  // Handle arrays like "['x', 'y']"
  if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
    try {
      const jsonStr = valueStr.replace(/'/g, '"');
      return JSON.parse(jsonStr);
    } catch {
      return valueStr;
    }
  }

  return valueStr;
}

/**
 * Check if a token starts a top-level section
 */
function isTopLevelStart(token) {
  if (!token.endsWith(': {') && !token.endsWith(': [{')) return false;
  const key = token.replace(/:\s*\[?\{$/, '').trim();
  return TOP_LEVEL_KEYS.has(key);
}

/**
 * Get the key from an object start token
 */
function getKeyFromToken(token) {
  return token.replace(/:\s*\[?\{$/, '').trim();
}

/**
 * Build nested structure with proper top-level separation
 */
function buildNestedStructure(tokens) {
  const result = {};
  let i = 0;

  // Track current context
  let currentTopLevel = null;
  let stack = [];

  function getCurrentObject() {
    if (stack.length === 0) return result;
    return stack[stack.length - 1].obj;
  }

  while (i < tokens.length) {
    const token = tokens[i];

    // Skip commas and placeholders
    if (token === ',' || token === '...') {
      i++;
      continue;
    }

    // Check for top-level object start
    if (isTopLevelStart(token)) {
      const key = getKeyFromToken(token);
      currentTopLevel = key;

      // Reset stack for new top-level
      stack = [];

      if (token.includes('[{')) {
        result[key] = [{}];
        stack.push({ obj: result[key][0], key, isArray: true });
      } else {
        result[key] = {};
        stack.push({ obj: result[key], key });
      }

      i++;
      continue;
    }

    // Check for nested object start (not top-level)
    if (token.endsWith(': {') || token.endsWith(': [{')) {
      const key = getKeyFromToken(token);
      const current = getCurrentObject();

      if (token.includes('[{')) {
        current[key] = [{}];
        stack.push({ obj: current[key][0], key, isArray: true });
      } else {
        current[key] = {};
        stack.push({ obj: current[key], key });
      }

      i++;
      continue;
    }

    // Handle "key:" followed by value
    if (token.includes(':') && !token.endsWith('{')) {
      const colonIndex = token.indexOf(':');
      const key = token.slice(0, colonIndex).trim();
      let valueStr = token.slice(colonIndex + 1).trim();

      // Get value from next token if needed
      if (!valueStr && i + 1 < tokens.length) {
        const nextToken = tokens[i + 1];
        if (nextToken !== ',' && !nextToken.includes(':') && !nextToken.endsWith('{')) {
          i++;
          valueStr = nextToken;
        }
      }

      const current = getCurrentObject();
      if (current && key) {
        current[key] = parseValue(valueStr);
      }

      i++;
      continue;
    }

    // Handle standalone key
    if (!token.includes(':') && !token.includes('{') && token.trim()) {
      const key = token.trim();
      let valueStr = null;

      // Check if next token is a value
      if (i + 1 < tokens.length) {
        const nextToken = tokens[i + 1];
        if (nextToken !== ',' && !nextToken.includes(':') && !nextToken.endsWith('{')) {
          i++;
          valueStr = nextToken;
        }
      }

      const current = getCurrentObject();
      if (current && key) {
        current[key] = parseValue(valueStr);
      }

      i++;
      continue;
    }

    i++;
  }

  return result;
}

console.log('Parsing to nested JSON structure...');
const nestedJson = buildNestedStructure(elements);

// Count properties
function countProperties(obj) {
  let count = 0;
  for (const key in obj) {
    count++;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      count += countProperties(obj[key]);
    } else if (Array.isArray(obj[key])) {
      obj[key].forEach(item => {
        if (typeof item === 'object' && item !== null) {
          count += countProperties(item);
        }
      });
    }
  }
  return count;
}

const propCount = countProperties(nestedJson);
console.log(`Generated nested JSON with ${propCount} properties`);
console.log(`Top-level keys: ${Object.keys(nestedJson).join(', ')}`);

// Write output
writeFileSync(outputPath, JSON.stringify(nestedJson, null, 2));
console.log(`✅ Nested JSON written to: ${outputPath}`);
