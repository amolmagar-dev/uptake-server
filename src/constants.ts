/**
 * PostgreSQL Object Identifier (OID) to Data Type String Mapping.
 * 
 * Why this is needed:
 * The 'pg' driver returns numeric OIDs (e.g., 23) for column data types in query results.
 * The frontend expects human-readable string types (e.g., 'integer', 'varchar').
 * 
 * Where this is used:
 * Used primarily in `datasets.ts` (create, update, get-columns, refresh-columns) to mapping
 * the numeric `dataTypeID` from `executeQuery` results to string representations.
 */
export const PG_OID_MAP: Record<number, string> = {
  16: 'bool',
  17: 'bytea',
  20: 'int8',
  21: 'int2',
  23: 'int4',
  25: 'text',
  700: 'float4',
  701: 'float8',
  1043: 'varchar',
  1082: 'date',
  1083: 'time',
  1114: 'timestamp',
  1184: 'timestamptz',
  1700: 'numeric',
  2950: 'uuid',
  3802: 'jsonb',
  114: 'json'
};
  