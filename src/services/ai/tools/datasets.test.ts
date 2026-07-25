import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatasetManagementTool } from "./datasets.js";

const viewerUser = { id: "u1", role: "viewer" } as any;
const adminUser = { id: "u2", role: "admin" } as any;

test("dataset_management: create rejects a viewer", async () => {
  const tool = createDatasetManagementTool(viewerUser);
  const result = JSON.parse(
    await tool.invoke({
      action: "create",
      data: { name: "x", config: { dataset_type: "physical", connection_id: "c1", table_name: "t1" } },
    })
  );
  assert.equal(result.success, false);
  assert.match(result.error, /role/i);
});

test("dataset_management: create rejects a physical dataset with an unknown connection", async () => {
  const tool = createDatasetManagementTool(adminUser);
  const result = JSON.parse(
    await tool.invoke({
      action: "create",
      data: { name: "x", config: { dataset_type: "physical", connection_id: "does-not-exist", table_name: "t1" } },
    })
  );
  assert.equal(result.success, false);
  assert.match(result.error, /connection/i);
});

test("dataset_management: rejects a virtual dataset config missing sql_query", async () => {
  const tool = createDatasetManagementTool(adminUser);
  const result = JSON.parse(
    await tool.invoke({
      action: "create",
      data: { name: "x", config: { dataset_type: "virtual", connection_id: "c1" } as any },
    })
  );
  assert.equal(result.success, false);
});
