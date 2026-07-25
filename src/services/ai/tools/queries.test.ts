import { test } from "node:test";
import assert from "node:assert/strict";
import { createQueryManagementTool } from "./queries.js";

const viewerUser = { id: "u1", role: "viewer" } as any;
const editorUser = { id: "u2", role: "editor" } as any;

test("query_management: create rejects a viewer", async () => {
  const tool = createQueryManagementTool(viewerUser);
  const result = JSON.parse(
    await tool.invoke({ action: "create", data: { name: "x", sql_query: "SELECT 1", connection_id: "c1" } })
  );
  assert.equal(result.success, false);
  assert.match(result.error, /role/i);
});

test("query_management: create requires name, sql_query, and connection_id", async () => {
  const tool = createQueryManagementTool(editorUser);
  const result = JSON.parse(await tool.invoke({ action: "create", data: { name: "x" } }));
  assert.equal(result.success, false);
});
