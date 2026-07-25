import type { UserProfile } from "../../../types/database.js";

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

const WRITE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|MERGE|REPLACE)\b/i;

export function assertReadOnlyQuery(sql: string): { ok: true } | { ok: false; error: string } {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (trimmed.includes(";")) {
    return { ok: false, error: "Only a single SQL statement is allowed." };
  }
  if (!/^select\b/i.test(trimmed)) {
    return {
      ok: false,
      error:
        "database_operations only supports read-only SELECT queries. Use dataset_management or chart_management to create or update resources.",
    };
  }
  if (WRITE_KEYWORDS.test(trimmed)) {
    return { ok: false, error: "Query contains a disallowed write keyword." };
  }
  return { ok: true };
}

/** Every tool's success/failure JSON envelope — shared so it's defined exactly once. */
export function toolOk(payload: Record<string, any>): string {
  return JSON.stringify({ success: true, ...payload });
}

export function toolFail(error: string): string {
  return JSON.stringify({ success: false, error });
}
