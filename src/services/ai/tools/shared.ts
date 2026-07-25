import { z } from "zod";
import type { UserProfile } from "../../../types/database.js";
import { logger } from "../../../utils/logger.js";

export function requireRole(
  user: UserProfile,
  allowedRoles: string[]
): { ok: true } | { ok: false; error: string } {
  if (!allowedRoles.includes(user.role)) {
    return {
      ok: false,
      error: `This action requires one of these roles: ${allowedRoles.join(", ")}. Your role is "${user.role}".`,
    };
  }
  return { ok: true };
}

/**
 * Keywords that make a statement write (or exfiltrate) data, even inside something that
 * starts with SELECT:
 *  - INTO           -> `SELECT * INTO new_table FROM users` (SQL Server / Postgres SELECT INTO)
 *  - OUTFILE/DUMPFILE -> `SELECT * FROM users INTO OUTFILE '/tmp/x'` (MySQL file writes)
 *  - COPY           -> Postgres `COPY ... TO/FROM` file and program I/O
 */
const WRITE_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|MERGE|REPLACE|INTO|OUTFILE|DUMPFILE|COPY)\b/i;

export function assertReadOnlyQuery(sql: string): { ok: true } | { ok: false; error: string } {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (trimmed.includes(";")) {
    return { ok: false, error: "Only a single SQL statement is allowed." };
  }
  // A leading WITH is a read-only CTE as long as the body contains no write keywords
  // (the blocklist below still rejects e.g. `WITH t AS (...) INSERT INTO ...`).
  if (!/^(select|with)\b/i.test(trimmed)) {
    return {
      ok: false,
      error:
        "database_operations only supports read-only SELECT queries (a leading WITH ... SELECT CTE is also allowed). Use dataset_management or chart_management to create or update resources.",
    };
  }
  if (WRITE_KEYWORDS.test(trimmed)) {
    return { ok: false, error: "Query contains a disallowed write keyword." };
  }
  return { ok: true };
}

/** Every tool's success/failure JSON envelope — shared so it's defined exactly once. */
export function toolOk(payload: Record<string, any>): string {
  logger.info({ payload }, "[AI Tool Success]");
  return JSON.stringify({ success: true, ...payload });
}

export function toolFail(error: string): string {
  logger.warn({ error }, "[AI Tool Failure]");
  return JSON.stringify({ success: false, error });
}

/**
 * Some models stringify a nested-object tool argument instead of emitting it as a real JSON
 * object, even though the tool's schema declares it as an object (observed live: a model sent
 * `config` as `"{\"chart_type\":\"bar\",...}"` instead of `{chart_type: "bar", ...}"`).
 *
 * The schema itself must accept both shapes, since LangChain's tool.invoke() validates
 * arguments against the Zod schema BEFORE the tool's own handler ever runs. Do NOT use
 * z.preprocess()/z.transform() for this — confirmed live that Zod's JSON Schema converter
 * (used to register the tool with a real model) throws "Transforms cannot be represented in
 * JSON Schema" for any schema containing one, which breaks tool registration entirely, not
 * just the one malformed call. A plain z.union with z.string() has no such problem (it
 * converts to a normal `anyOf`).
 *
 * Wrap the object schema in `orJsonString(...)` for the tool's Zod schema declaration, then
 * call `parseConfigInput(schema, rawValue)` at the top of the handler to normalize whichever
 * shape arrived into the validated object (or a clear error) before using it.
 */
export function orJsonString<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, z.string()]);
}

export function parseConfigInput<T>(
  schema: z.ZodType<T>,
  raw: T | string | undefined
): { ok: true; value: T | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "string") return { ok: true, value: raw };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    return { ok: false, error: `config is not valid JSON: ${err.message}` };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: `config does not match the expected shape: ${result.error.message}` };
  }
  return { ok: true, value: result.data };
}
