import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDatabaseOperationsTool,
  createListTablesTool,
  createSchemaExplorerTool,
} from "./introspection.js";
import { connectionRepository } from "../../../db/repositories/index.js";

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

test("database_operations: allows a read-only WITH ... SELECT CTE past the read-only gate", async () => {
  const tool = createDatabaseOperationsTool(user);
  const result = JSON.parse(
    await tool.invoke({ connectionId: "does-not-exist", sqlQuery: "WITH t AS (SELECT 1) SELECT * FROM t" })
  );
  assert.equal(result.success, false);
  // It must fail on the connection lookup, not on the read-only check.
  assert.match(result.error, /not found/i);
});

// Regression tests for the missing try/catch in these three handlers: a driver-level
// throw used to escape the tool instead of coming back as a {success:false} envelope.
// A "sqlite" connection is the fastest deterministic, offline way to make
// databaseConnector throw ("Unsupported database type: sqlite") — requireSqlConnection
// accepts sqlite, but getConnection/getTableList/getTableSchema do not implement it.
test("introspection tools return a failure envelope instead of throwing when the driver errors", async () => {
  const connection = await connectionRepository.create({
    name: "ai-tool-test-temp-sqlite",
    type: "sqlite",
    database_name: "unused.db",
  });

  try {
    const listTables = JSON.parse(await createListTablesTool(user).invoke({ connectionId: connection.id }));
    assert.equal(listTables.success, false, "list_tables should return success: false, not throw");
    assert.match(listTables.error, /unsupported database type/i);

    const schema = JSON.parse(
      await createSchemaExplorerTool(user).invoke({ connectionId: connection.id, tableName: "t" })
    );
    assert.equal(schema.success, false, "schema_explorer should return success: false, not throw");
    assert.match(schema.error, /unsupported database type/i);

    const query = JSON.parse(
      await createDatabaseOperationsTool(user).invoke({ connectionId: connection.id, sqlQuery: "SELECT 1" })
    );
    assert.equal(query.success, false, "database_operations should return success: false, not throw");
    assert.match(query.error, /unsupported database type/i);
  } finally {
    await connectionRepository.delete(connection.id);
  }
});
