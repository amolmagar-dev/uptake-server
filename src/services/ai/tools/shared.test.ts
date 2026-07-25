import { test } from "node:test";
import assert from "node:assert/strict";
import { requireRole, assertReadOnlyQuery, toolOk, toolFail } from "./shared.js";

test("requireRole: allows a user with an allowed role", () => {
  const result = requireRole({ role: "editor" } as any, ["admin", "editor"]);
  assert.equal(result.ok, true);
});

test("requireRole: rejects a user without an allowed role", () => {
  const result = requireRole({ role: "viewer" } as any, ["admin", "editor"]);
  assert.equal(result.ok, false);
});

test("assertReadOnlyQuery: allows a plain SELECT", () => {
  assert.equal(assertReadOnlyQuery("SELECT * FROM users").ok, true);
});

test("assertReadOnlyQuery: allows SELECT of a column named like a write keyword", () => {
  assert.equal(assertReadOnlyQuery("SELECT updated_at, created_at FROM users").ok, true);
});

test("assertReadOnlyQuery: rejects a DELETE statement", () => {
  assert.equal(assertReadOnlyQuery("DELETE FROM users").ok, false);
});

test("assertReadOnlyQuery: rejects multiple statements", () => {
  assert.equal(assertReadOnlyQuery("SELECT 1; DROP TABLE users;").ok, false);
});

test("assertReadOnlyQuery: rejects a SELECT hiding a second write statement", () => {
  assert.equal(assertReadOnlyQuery("SELECT 1; UPDATE users SET role='admin'").ok, false);
});

test("toolOk: wraps a payload with success: true", () => {
  assert.deepEqual(JSON.parse(toolOk({ action: "list" })), { success: true, action: "list" });
});

test("toolFail: wraps an error message with success: false", () => {
  assert.deepEqual(JSON.parse(toolFail("nope")), { success: false, error: "nope" });
});
