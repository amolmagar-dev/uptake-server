import type { UserProfile } from "../../../types/database.js";
import { createChartManagementTool } from "./charts.js";
import { createConnectionManagementTool, createListConnectionsTool } from "./connections.js";
import { createListTablesTool, createSchemaExplorerTool, createDatabaseOperationsTool } from "./introspection.js";
import { createDatasetManagementTool } from "./datasets.js";
import { createDashboardManagementTool } from "./dashboards.js";
import { createQueryManagementTool } from "./queries.js";
import { createProjectHelperTool } from "./helper.js";

export function buildToolsForUser(user: UserProfile) {
  return [
    createListConnectionsTool(user),
    createConnectionManagementTool(user),
    createListTablesTool(user),
    createSchemaExplorerTool(user),
    createDatabaseOperationsTool(user),
    createDatasetManagementTool(user),
    createChartManagementTool(user),
    createDashboardManagementTool(user),
    createQueryManagementTool(user),
    createProjectHelperTool(user),
  ];
}
