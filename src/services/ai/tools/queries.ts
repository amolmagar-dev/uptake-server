import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { savedQueryRepository } from "../../../db/repositories/index.js";
import { requireRole, toolOk as ok, toolFail as fail } from "./shared.js";
import type { UserProfile } from "../../../types/database.js";

const queryManagementSchema = z.object({
  action: z.enum(["list", "get", "create", "update", "delete"]).describe("The action to perform"),
  queryId: z.string().optional().describe("Saved query ID, required for get/update/delete"),
  data: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      sql_query: z.string().optional(),
      connection_id: z.string().optional(),
    })
    .optional(),
});

export function createQueryManagementTool(user: UserProfile) {
  return tool(
    async (input: z.infer<typeof queryManagementSchema>) => {
      const { action, queryId, data } = input;
      try {
        switch (action) {
          case "list": {
            const queries = await savedQueryRepository.findAll();
            return ok({ action, queries: queries.map((q) => ({ id: q.id, name: q.name, connectionId: q.connection_id })) });
          }
          case "get": {
            if (!queryId) return fail("queryId is required for get");
            const query = await savedQueryRepository.findById(queryId);
            if (!query) return fail(`Saved query not found: ${queryId}`);
            return ok({ action, query: { id: query.id, name: query.name, sqlQuery: query.sql_query, connectionId: query.connection_id } });
          }
          case "create": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!data?.name || !data.sql_query || !data.connection_id) {
              return fail("name, sql_query, and connection_id are required to create a saved query");
            }
            const query = await savedQueryRepository.create({
              name: data.name,
              description: data.description,
              sql_query: data.sql_query,
              connection_id: data.connection_id,
              created_by: user.id,
            });
            return ok({ action, query: { id: query.id, name: query.name } });
          }
          case "update": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!queryId) return fail("queryId is required for update");
            const existing = await savedQueryRepository.findById(queryId);
            if (!existing) return fail(`Saved query not found: ${queryId}`);
            const updated = await savedQueryRepository.update(existing.id, {
              name: data?.name,
              description: data?.description,
              sql_query: data?.sql_query,
              connection_id: data?.connection_id,
            });
            return ok({ action, query: { id: updated.id, name: updated.name } });
          }
          case "delete": {
            const roleCheck = requireRole(user, ["admin", "editor"]);
            if (!roleCheck.ok) return fail(roleCheck.error);
            if (!queryId) return fail("queryId is required for delete");
            const existing = await savedQueryRepository.findById(queryId);
            if (!existing) return fail(`Saved query not found: ${queryId}`);
            await savedQueryRepository.delete(existing.id);
            return ok({ action, queryId: existing.id });
          }
          default:
            return fail(`Unknown action: ${action}`);
        }
      } catch (err: any) {
        return fail(err.message || "An error occurred during query management");
      }
    },
    {
      name: "query_management",
      description: "Manage saved SQL queries. Actions: list, get, create, update, delete. Requires admin or editor to create/update/delete.",
      schema: queryManagementSchema,
    }
  );
}
