import { test } from "node:test";
import assert from "node:assert/strict";
import { createProjectHelperTool } from "./helper.js";

const user = { id: "u1", role: "viewer" } as any;

test("project_helper: search requires a query", async () => {
  const tool = createProjectHelperTool(user);
  const result = JSON.parse(await tool.invoke({ action: "search" }));
  assert.equal(result.success, false);
});
