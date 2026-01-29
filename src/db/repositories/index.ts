/**
 * Database Repositories Index
 * Central export point for all repository instances
 */

export { userRepository } from "./UserRepository.js";
export type {
  CreateUserInput,
  UpdateUserInput,
  UserProfile,
} from "./UserRepository.js";

export { connectionRepository } from "./ConnectionRepository.js";
export type {
  CreateConnectionInput,
  UpdateConnectionInput,
} from "./ConnectionRepository.js";

export { chartRepository } from "./ChartRepository.js";
export type {
  CreateChartInput,
  UpdateChartInput,
} from "./ChartRepository.js";

export { dashboardRepository } from "./DashboardRepository.js";
export type {
  CreateDashboardInput,
  UpdateDashboardInput,
  AddChartInput,
  UpdateDashboardChartInput,
  DashboardWithCharts,
} from "./DashboardRepository.js";

export { datasetRepository } from "./DatasetRepository.js";
export type {
  CreateDatasetInput,
  UpdateDatasetInput,
} from "./DatasetRepository.js";

export { savedQueryRepository } from "./SavedQueryRepository.js";
export type {
  CreateSavedQueryInput,
  UpdateSavedQueryInput,
} from "./SavedQueryRepository.js";

export { customComponentRepository } from "./CustomComponentRepository.js";
export type {
  CreateCustomComponentInput,
  UpdateCustomComponentInput,
} from "./CustomComponentRepository.js";
