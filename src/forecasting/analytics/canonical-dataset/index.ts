/** Публичный интерфейс модуля канонического дневного набора (Stage 3.2.2–3.2.4). */

export type {
  CanonicalDailyObservation,
  CanonicalDataset,
  CrossSliceRow,
  DatasetProvenance,
  DecisionStatus,
  ReconciliationResult,
  ReconciliationRow,
  SliceCandidateStats,
  SliceSourceRow,
  SourceDecision,
  ValidationIssue,
  ValidationReport,
} from "./types";

export {
  crossSliceDailyTotals,
  loadMetricRows,
  metricPeriod,
  sliceCandidateStats,
  slicesForMetric,
} from "./source-loader";

export { rejectReasons, selectCanonicalSource, type SelectionResult } from "./selection";

export { CANONICAL_DECISION, verifyDecision, type DecisionVerification } from "./decision";

export { buildCanonicalDailyDataset, type BuildInput, type BuildResult } from "./builder";

export { validateCanonicalDataset, type ValidationOptions } from "./validation";

export { reconcileDataset, type ReconcileInput } from "./reconciliation";

export {
  canonicalCsv,
  crossSliceCsv,
  dailyReconciliationCsv,
  datasetReportMarkdown,
  datasetSummaryJson,
  decisionMarkdown,
  finalReportMarkdown,
  reconciliationMarkdown,
  reconciliationSummaryJson,
  registryMarkdown,
  registryValidation,
  semanticsFindingsMarkdown,
  sliceComparisonCsv,
  sourceIntegrityJson,
  writeStage32Artifacts,
  type IntegritySnapshot,
  type RegistryValidation,
} from "./reports";
