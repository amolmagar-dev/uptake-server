import { test } from "node:test";
import assert from "node:assert/strict";
import { buildToolsForUser } from "./tools/index.js";

test("buildToolsForUser: returns exactly the 10 expected tools, no custom_component_management", () => {
  const tools = buildToolsForUser({ id: "u1", role: "viewer" } as any);
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "chart_management",
    "connection_management",
    "dashboard_management",
    "database_operations",
    "dataset_management",
    "list_connections",
    "list_tables",
    "project_helper",
    "query_management",
    "schema_explorer",
  ]);
});
