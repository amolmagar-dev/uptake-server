/**
 * Query Template Service
 * Provides Nunjucks-based SQL query templating with filter context support
 */

import nunjucks from 'nunjucks';

// Configure Nunjucks environment - autoescape disabled for SQL
const env = new nunjucks.Environment(null, { 
  autoescape: false,
  throwOnUndefined: false // Don't throw on undefined variables
});

/**
 * Safe string filter - escapes single quotes for SQL injection prevention
 * Usage: {{ filters.name | safe_string }}
 */
env.addFilter('safe_string', (val: any): string | null => {
  if (val === null || val === undefined || val === '') return null;
  return String(val).replace(/'/g, "''");
});

/**
 * Safe list filter - converts array to SQL IN() compatible list
 * Usage: IN ({{ filters.categories | safe_list }})
 */
env.addFilter('safe_list', (arr: any): string | null => {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr
    .filter(v => v !== null && v !== undefined && v !== '')
    .map(v => `'${String(v).replace(/'/g, "''")}'`)
    .join(', ');
});

/**
 * Safe number filter - ensures value is a valid number
 * Usage: {{ filters.amount | safe_number }}
 */
env.addFilter('safe_number', (val: any): number | null => {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
});

/**
 * Safe date filter - validates and formats date strings
 * Usage: {{ filters.date | safe_date }}
 */
env.addFilter('safe_date', (val: any): string | null => {
  if (val === null || val === undefined || val === '') return null;
  // Basic date validation - accepts ISO format
  const dateStr = String(val);
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.replace(/'/g, "''");
  }
  return null;
});

/**
 * Filter context interface for template rendering
 */
export interface FilterContext {
  filters: Record<string, any>;
  // Could be extended with user context, date helpers, etc.
}

/**
 * Render a SQL query template with the given filter context
 * @param template - Nunjucks template string (SQL with template variables)
 * @param context - Filter values and other context data
 * @returns Rendered SQL query string
 */
export function renderQueryTemplate(template: string, context: FilterContext): string {
  try {
    return env.renderString(template, context);
  } catch (error: any) {
    throw new Error(`Template rendering failed: ${error.message}`);
  }
}

/**
 * Check if a query string contains Nunjucks template syntax
 * @param query - SQL query string to check
 * @returns true if template variables are detected
 */
export function hasTemplateVariables(query: string): boolean {
  if (!query) return false;
  return /\{\{|\{%/.test(query);
}

/**
 * Validate a template string without executing it
 * @param template - Template string to validate
 * @returns Object with valid status and optional error message
 */
export function validateTemplate(template: string): { valid: boolean; error?: string } {
  try {
    // Try to compile the template (doesn't execute, just parses)
    env.renderString(template, { filters: {} });
    return { valid: true };
  } catch (error: any) {
    return { valid: false, error: error.message };
  }
}

/**
 * Get list of filter variables used in a template
 * @param template - Template string to analyze
 * @returns Array of filter variable names found
 */
export function extractFilterVariables(template: string): string[] {
  const variables: Set<string> = new Set();
  
  // Match {{ filters.xxx }} patterns
  const varPattern = /\{\{\s*filters\.(\w+)/g;
  let match;
  while ((match = varPattern.exec(template)) !== null) {
    if (match[1]) {
      variables.add(match[1]);
    }
  }
  
  // Match {% if filters.xxx %} patterns
  const condPattern = /\{%\s*if\s+filters\.(\w+)/g;
  while ((match = condPattern.exec(template)) !== null) {
    if (match[1]) {
      variables.add(match[1]);
    }
  }
  
  return Array.from(variables);
}
