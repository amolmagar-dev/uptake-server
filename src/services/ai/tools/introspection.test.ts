import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabaseOperationsTool } from "./introspection.js";

const user = { id: "u1", role: "viewer" } as any;

test("database_operations: rejects a non-SELECT statement before touching a connection", async () => {
  const tool = createDatabaseOperationsTool(user);
  const result = JSON.parse(
    await tool.invoke({ connectionId: "does-not-exist", sqlQuery: "DELETE FROM users" })
  );
  assert.equal(result.success, false);
  assert.match(result.error, /read-only|SELECT/i);
});

test("database_operations: reports an unknown connection", async () => {
  const tool = createDatabaseOperationsTool(user);
  const result = JSON.parse(
    await tool.invoke({ connectionId: "does-not-exist", sqlQuery: "SELECT 1" })
  );
  assert.equal(result.success, false);
  assert.match(result.error, /not found/i);
});
