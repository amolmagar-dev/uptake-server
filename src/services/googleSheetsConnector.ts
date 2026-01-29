// @ts-nocheck
/**
 * Google Sheets Connector Service
 * Fetches data from Google Sheets
 */

/**
 * Fetch data from a Google Sheet
 * @param {Object} connection - Connection with config containing Sheet settings
 * @returns {Promise<{rows: Array, fields: Array, rowCount: number}>}
 */
export async function fetchGoogleSheet(connection) {
  const startTime = Date.now();
  
  const config = typeof connection.config === 'string' 
    ? JSON.parse(connection.config) 
    : connection.config;

  if (!config?.spreadsheet_id) {
    throw new Error('Spreadsheet ID is required');
  }

  // Method 1: Use Google Sheets API with API key (for public sheets)
  if (config.api_key) {
    return await fetchWithSheetsApi(config, startTime);
  }

  // Method 2: Use CSV export URL (for public sheets, no API key needed)
  return await fetchAsCsv(config, startTime);
}

/**
 * Fetch using Google Sheets API v4
 */
async function fetchWithSheetsApi(config, startTime) {
  const sheetName = config.sheet_name || 'Sheet1';
  const range = config.range || `${sheetName}!A:ZZ`;
  
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheet_id}/values/${encodeURIComponent(range)}?key=${config.api_key}`;

  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 403) {
        throw new Error('Access denied. Make sure the spreadsheet is public or the API key has access.');
      }
      if (response.status === 404) {
        throw new Error('Spreadsheet not found. Check the Spreadsheet ID.');
      }
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    const values = data.values || [];

    if (values.length === 0) {
      return { rows: [], fields: [], rowCount: 0, executionTime: Date.now() - startTime };
    }

    // First row is headers
    const headers = values[0].map((h, i) => h || `Column${i + 1}`);
    const fields = headers.map(name => ({ name, type: 'text' }));

    // Convert remaining rows to objects
    const rows = values.slice(1).map(row => {
      const obj = {};
      headers.forEach((header, i) => {
        obj[header] = row[i] !== undefined ? row[i] : '';
      });
      return obj;
    });

    return {
      rows,
      fields,
      rowCount: rows.length,
      executionTime: Date.now() - startTime,
    };
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Failed to connect to Google Sheets API');
    }
    throw error;
  }
}

/**
 * Fetch sheet as CSV (works for public sheets without API key)
 */
async function fetchAsCsv(config, startTime) {
  const sheetId = config.sheet_gid || '0'; // Default to first sheet
  const url = `https://docs.google.com/spreadsheets/d/${config.spreadsheet_id}/export?format=csv&gid=${sheetId}`;

  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Spreadsheet not found. Check the Spreadsheet ID and make sure it\'s publicly accessible.');
      }
      throw new Error(`Failed to fetch spreadsheet: ${response.status}`);
    }

    const text = await response.text();
    
    // Check if we got an HTML error page instead of CSV
    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
      throw new Error('Cannot access spreadsheet. Make sure it\'s set to "Anyone with the link can view".');
    }

    const rows = parseCSV(text);
    const fields = rows.length > 0 
      ? Object.keys(rows[0]).map(name => ({ name, type: 'text' }))
      : [];

    return {
      rows,
      fields,
      rowCount: rows.length,
      executionTime: Date.now() - startTime,
    };
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Failed to connect to Google Sheets');
    }
    throw error;
  }
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
    if (!lines[i].trim()) continue;
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
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else if (char !== '\r') {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

/**
 * Test Google Sheets connection
 */
export async function testGoogleSheetsConnection(connection) {
  try {
    const result = await fetchGoogleSheet(connection);
    return {
      success: true,
      message: `Connected successfully. Found ${result.rowCount} rows with ${result.fields.length} columns.`,
      sampleData: result.rows.slice(0, 5),
      fields: result.fields,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
    };
  }
}

/**
 * Extract spreadsheet ID from URL
 */
export function extractSpreadsheetId(urlOrId) {
  // If it's already just an ID
  if (/^[a-zA-Z0-9_-]{30,50}$/.test(urlOrId)) {
    return urlOrId;
  }

  // Extract from URL
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : urlOrId;
}
