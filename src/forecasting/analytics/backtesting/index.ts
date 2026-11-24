/** Публичный интерфейс модуля backtesting (Stage 3.3.5). */

export {
  METRIC_FORMULAS,
  computeMetrics,
  recomputeFromRecords,
  validateMetricSet,
  type ErrorPair,
  type MetricSet,
} from "./metrics";

export {
  DEFAULT_HORIZONS,
  DEFAULT_MIN_TRAIN,
  runBacktest,
  verifyMetricsAgainstRecords,
  type BacktestOptions,
  type BacktestResult,
  type Coverage,
  type ForecastRecord,
  type LeakageCheck,
  type ModelHorizonMetrics,
} from "./rolling-origin";

export {
  backtestingMarkdown,
  baselineModelsMarkdown,
  dataCoverageCsv,
  foldSummaryCsv,
  forecastDetailsCsv,
  leakageCheckJson,
  modelComparisonCsv,
  reproducibilityJson,
  writeBacktestArtifacts,
} from "./reports";
