/** Публичный интерфейс Shadow Mode (Stage 3.4.8) — изолированный контур. */

export {
  appendSnapshot,
  appendJsonl,
  inputDataVersion,
  MODEL_VERSIONS,
  readJsonl,
  sha256,
  snapshotId,
  storePaths,
  writeManifest,
  ShadowConflictError,
  type AppendResult,
  type ModelId,
  type ReconciliationRecord,
  type ShadowError,
  type ShadowManifest,
  type ShadowMode,
  type ShadowSnapshot,
  type SnapshotStatus,
  type StorePaths,
} from "./store";

export { runShadowMode, SHADOW_ALPHA, SHADOW_HORIZONS, SHADOW_LIMIT_PERCENT, SHADOW_MIN_TRAIN, type HistoryRow, type RunOptions, type RunSummary } from "./runner";

export { monitor, reconcile, type ModelHorizonMetrics, type MonitorReport, type ReconcileSummary } from "./pipeline";