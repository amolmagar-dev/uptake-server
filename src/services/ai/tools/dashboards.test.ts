import { test } from "node:test";
import assert from "node:assert/strict";
import { createDashboardManagementTool } from "./dashboards.js";

const viewerUser = { id: "u1", role: "viewer" } as any;
const editorUser = { id: "u2", role: "editor" } as any;

test("dashboard_management: create rejects a viewer", async () => {
  const tool = createDashboardManagementTool(viewerUser);
  const result = JSON.parse(await tool.invoke({ action: "create", data: { name: "My Dashboard" } }));
  assert.equal(result.success, false);
  assert.match(result.error, /role/i);
});

test("dashboard_management: create requires a name", async () => {
  const tool = createDashboardManagementTool(editorUser);
  const result = JSON.parse(await tool.invoke({ action: "create", data: {} }));
  assert.equal(result.success, false);
});

test("dashboard_management: add_chart requires chartId or componentId", async () => {
  const tool = createDashboardManagementTool(editorUser);
  const result = JSON.parse(
    await tool.invoke({ action: "add_chart", dashboardId: "does-not-matter", data: {} })
  );
  assert.equal(result.success, false);
});
