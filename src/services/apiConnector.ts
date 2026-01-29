// @ts-nocheck
/**
 * API Connector Service
 * Fetches data from REST API endpoints
 */

/**
 * Execute an API request and return data in standard format
 * @param {Object} connection - Connection with config containing API settings
 * @returns {Promise<{rows: Array, fields: Array, rowCount: number}>}
 */
export async function executeApiRequest(connection) {
  const startTime = Date.now();
  
  const config = typeof connection.config === 'string' 
    ? JSON.parse(connection.config) 
    : connection.config;

  if (!config?.url) {
    throw new Error('API URL is required');
  }

  // Build request options
  const fetchOptions = {
    method: config.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(config.headers || {}),
    },
  };

  // Add authentication
  if (config.auth_type === 'api_key' && config.api_key) {
    // API key can be in header or query param
    if (config.api_key_location === 'query') {
      const url = new URL(config.url);
      url.searchParams.set(config.api_key_name || 'api_key', config.api_key);
      config.url = url.toString();
    } else {
      fetchOptions.headers[config.api_key_name || 'X-API-Key'] = config.api_key;
    }
  } else if (config.auth_type === 'bearer' && config.bearer_token) {
    fetchOptions.headers['Authorization'] = `Bearer ${config.bearer_token}`;
  } else if (config.auth_type === 'basic' && config.username && config.password) {
    const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    fetchOptions.headers['Authorization'] = `Basic ${credentials}`;
  }

  // Add request body for POST/PUT/PATCH
  if (config.body && ['POST', 'PUT', 'PATCH'].includes(fetchOptions.method)) {
    fetchOptions.body = typeof config.body === 'string' ? config.body : JSON.stringify(config.body);
  }

  try {
    const response = await fetch(config.url, fetchOptions);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    let data;

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else if (contentType.includes('text/csv')) {
      const text = await response.text();
      data = parseCSV(text);
    } else {
      // Try parsing as JSON anyway
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('Unsupported response format. Expected JSON or CSV.');
      }
    }

    // Normalize data to array
    let rows = normalizeToArray(data, config.data_path);
    
    // Extract fields from first row
    const fields = rows.length > 0 
      ? Object.keys(rows[0]).map(name => ({ name, type: 'text' }))
      : [];

    const executionTime = Date.now() - startTime;

    return {
      rows,
      fields,
      rowCount: rows.length,
      executionTime,
    };
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error(`Failed to connect to API: ${config.url}`);
    }
    throw error;
  }
}

/**
 * Normalize API response to array of objects
 * @param {any} data - API response data
 * @param {string} dataPath - Optional JSON path to extract array (e.g., "data.items")
 */
function normalizeToArray(data, dataPath) {
  // If data path specified, navigate to it
  if (dataPath) {
    const parts = dataPath.split('.');
    for (const part of parts) {
      if (data && typeof data === 'object') {
        data = data[part];
      } else {
        break;
      }
    }
  }

  // If already an array, return it
  if (Array.isArray(data)) {
    return data;
  }

  // If object with array-like structure, try to find the array
  if (data && typeof data === 'object') {
    // Common patterns: data, items, results, records
    const arrayKeys = ['data', 'items', 'results', 'records', 'rows', 'entries'];
    for (const key of arrayKeys) {
      if (Array.isArray(data[key])) {
        return data[key];
      }
    }
    // Return as single-item array
    return [data];
  }

  return [];
}

/**
 * Parse CSV text to array of objects
 */
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length === 0) return [];

  // Parse header
  const headers = parseCSVLine(lines[0]);
  
  // Parse data rows
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Parse a single CSV line handling quotes
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

/**
 * Test API connection
 */
export async function testApiConnection(connection) {
  try {
    const result = await executeApiRequest(connection);
    return {
      success: true,
      message: `Connected successfully. Found ${result.rowCount} records.`,
      sampleData: result.rows.slice(0, 5),
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
    };
  }
}
