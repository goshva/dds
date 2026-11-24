/** Публичный интерфейс модуля профилирования данных (Stage 3.1). */

export type {
  DailyObservationRow,
  DescriptiveStats,
  DimensionProfile,
  DowProfileRow,
  EventsProfile,
  ForecastReadiness,
  GapRange,
  MetricProfile,
  MetricSemantics,
  OutlierFinding,
  PeriodAssessment,
  ProfilingResult,
  RatioCheck,
  ReadinessRow,
  SemanticStatus,
  SliceOverlapRow,
  TemporalCoverageRow,
  TemporalProfile,
} from "./types";

export {
  coefficientOfVariation,
  countNegatives,
  countZeros,
  iqr,
  linearTrend,
  mad,
  mean,
  median,
  quantile,
  round,
  stdev,
  type LinearTrend,
} from "./stats";

export { detectOutliers, MAD_Z_THRESHOLD, MIN_POINTS_FOR_OUTLIERS, type OutlierApplicability, type OutlierDetectionResult } from "./outliers";

export {
  addDays,
  buildMetricProfiles,
  buildTemporalCoverage,
  calendarRange,
  dayOfWeek,
  describe,
  DOW_LABELS,
} from "./metrics-profile";

export { buildTemporalProfile, completeWeeks, dowObservationCounts, SEASONALITY_WARNING } from "./temporal-profile";

export { buildDimensionProfiles, dimensionValueCounts } from "./dimensions-profile";

export {
  assertReadOnlySql,
  openReadOnlyDatabase,
  queryAll,
  queryOne,
  readIntegrity,
  readTableCounts,
  type IntegrityReport,
  type ReadOnlyDatabase,
  type TableCounts,
} from "./read-only";

export {
  aggregateReadinessByMetric,
  assessMetricReadiness,
  CRITICAL_FILL_RATE,
  type ReadinessInput,
} from "./readiness";

export {
  CATALOG_DATASET_ID,
  CATALOG_PATH,
  loadSemanticRegistry,
  RATIO_FORMULA_MAP,
  ratioFormulaFor,
  type RatioFormula,
} from "./semantics";

export {
  DEFAULT_EXPECTED_PERIOD,
  dowCounts,
  profileShop,
  readObservations,
  type ProfileOptions,
} from "./profiler";

export {
  buildDataQualityReport,
  buildFindings,
  csvCell,
  dimensionsProfileCsv,
  metricsProfileCsv,
  outliersCsv,
  readinessCsv,
  temporalCoverageCsv,
  toCsv,
  writeReports,
  type ReportFiles,
} from "./report";
