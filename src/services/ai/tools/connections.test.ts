import { test } from "node:test";
import assert from "node:assert/strict";
import { createConnectionManagementTool } from "./connections.js";

const editorUser = { id: "u1", role: "editor" } as any;
const viewerUser = { id: "u2", role: "viewer" } as any;

test("connection_management: create rejects a viewer", async () => {
  const tool = createConnectionManagementTool(viewerUser);
  const result = JSON.parse(
    await tool.invoke({ action: "create", data: { name: "x", config: { type: "postgresql", host: "localhost" } } })
  );
  assert.equal(result.success, false);
  assert.match(result.error, /role/i);
});

test("connection_management: delete rejects an editor (admin-only)", async () => {
  const tool = createConnectionManagementTool(editorUser);
  const result = JSON.parse(await tool.invoke({ action: "delete", connectionId: "does-not-matter" }));
  assert.equal(result.success, false);
  assert.match(result.error, /role/i);
});

test("connection_management: create rejects an api config missing url", async () => {
  const adminUser = { id: "u3", role: "admin" } as any;
  const tool = createConnectionManagementTool(adminUser);
  const result = JSON.parse(
    await tool.invoke({ action: "create", data: { name: "x", config: { type: "api" } } })
  );
  assert.equal(result.success, false);
});
