/**
 * Общие типы строк и DTO слоя хранения прогнозной системы.
 * Типы не зависят от конкретной СУБД: реализация на SQLite — лишь одна из возможных.
 */

export type EvidenceStatus = "actual" | "derived" | "estimated" | "planned" | "assumed" | "unknown";
export type DataStatus = "full" | "partial" | "truncated" | "none" | "schema_only";
export type QualityStatus = "full" | "partial" | "truncated" | "none";
export type MetricKind = "additive" | "ratio";
export type ConfidenceStatus = "ok" | "low_confidence" | "insufficient_data";
export type RunStatus = "running" | "completed" | "failed";
export type ForecastRunStatus = "completed" | "insufficient_data" | "failed";
export type EventStatus = "planned" | "in_progress" | "done" | "not_done" | "unverified";
export type ScenarioKind = "optimistic" | "baseline" | "pessimistic" | "custom";

export interface ShopRow {
  shop_no: string;
  name?: string | null;
  city?: string | null;
  cluster_id?: string | null;
  opened_at?: string | null;
  tz?: string | null;
  created_at?: string | null;
}

export interface ExtractionRunRow {
  run_id: number;
  started_at: string;
  finished_at?: string | null;
  mode: string;
  period_from?: string | null;
  period_to?: string | null;
  shop_no?: string | null;
  tool_version?: string | null;
  manifest_path?: string | null;
  manifest_sha256?: string | null;
  rows_raw?: number | null;
  rows_loaded?: number | null;
  quality_status?: QualityStatus | null;
  status: RunStatus;
  notes?: string | null;
}

export interface NewExtractionRun {
  started_at: string;
  mode: string;
  shop_no?: string | null;
  period_from?: string | null;
  period_to?: string | null;
  tool_version?: string | null;
  manifest_path?: string | null;
  manifest_sha256?: string | null;
  status?: RunStatus;
  notes?: string | null;
}

export interface RawExtractionRow {
  raw_id: number;
  run_id: number;
  source_kind: string;
  source_ref: string;
  payload: string;
  payload_sha256: string;
  bytes: number;
  loaded_at: string;
}

export interface NewRawExtraction {
  run_id: number;
  source_kind: string;
  source_ref: string;
  payload: string;
  loaded_at: string;
}

export interface DailyMetricRow {
  metric_id?: number;
  shop_no: string;
  date: string;
  slice_id: number;
  chart_id?: number | null;
  dataset_id?: number | null;
  dimension_1?: string;
  dimension_2?: string;
  metric: string;
  metric_kind: MetricKind;
  value: number | null;
  unit?: string | null;
  evidence_status: EvidenceStatus;
  data_status: DataStatus;
  run_id?: number | null;
  source_file?: string | null;
  request_sha256?: string | null;
  transform_version: string;
  loaded_at: string;
}

export interface DailyMetricsQuery {
  shop_no: string;
  date_from?: string;
  date_to?: string;
  metric?: string;
  slice_id?: number;
  dimension_1?: string;
  dimension_2?: string;
  transform_version?: string;
  limit?: number;
}

export interface UpsertCounts {
  inserted: number;
  updated: number;
}

export interface CoverageRow {
  date: string;
  observations: number;
  metrics: number;
  data_status: DataStatus;
}

export interface FeatureRow {
  feature_id?: number;
  shop_no: string;
  date: string;
  feature: string;
  value: number | null;
  evidence_status: EvidenceStatus;
  feature_version: string;
  computed_at: string;
}

export interface DomainEventRow {
  event_id?: number;
  shop_no?: string | null;
  event_date?: string | null;
  event_type: string;
  source?: string | null;
  planned_start?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  status: EventStatus;
  evidence_status: EvidenceStatus;
  expected_effect?: string | null;
  verification_result?: string | null;
  ledger_note?: string | null;
  created_at?: string | null;
}

export interface ForecastRunRow {
  run_id: number;
  shop_no: string;
  created_at: string;
  horizon_days: number;
  model_name: string;
  model_version: string;
  target_metric: string;
  features_version?: string | null;
  input_snapshot_id?: string | null;
  status: ForecastRunStatus;
  notes?: string | null;
}

export interface NewForecastRun {
  shop_no: string;
  created_at: string;
  horizon_days: number;
  model_name: string;
  model_version: string;
  target_metric: string;
  features_version?: string | null;
  input_snapshot_id?: string | null;
  status: ForecastRunStatus;
  notes?: string | null;
}

export interface ForecastResultRow {
  result_id?: number;
  run_id: number;
  target_date: string;
  metric: string;
  p10?: number | null;
  p50?: number | null;
  p90?: number | null;
  optimistic?: number | null;
  baseline?: number | null;
  pessimistic?: number | null;
  confidence_status: ConfidenceStatus;
}

export interface ForecastEvaluationRow {
  eval_id?: number;
  run_id: number;
  target_date: string;
  metric: string;
  actual_value?: number | null;
  predicted_value?: number | null;
  absolute_error?: number | null;
  percentage_error?: number | null;
  model_version?: string | null;
  evaluated_at: string;
}

export interface ScenarioRow {
  scenario_id?: number;
  shop_no: string;
  created_at: string;
  name: string;
  kind: ScenarioKind;
  input_parameters?: string | null;
  assumptions?: string | null;
  data_status: DataStatus;
}

export interface ScenarioResultRow {
  scenario_result_id?: number;
  scenario_id: number;
  target_date: string;
  metric: string;
  value?: number | null;
  capacity_required?: number | null;
  capacity_available?: number | null;
  deficit?: number | null;
}
