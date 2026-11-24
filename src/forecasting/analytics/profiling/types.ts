/**
 * Типы результатов профилирования данных (Stage 3.1).
 *
 * Все структуры — сериализуемые и детерминированные: порядок элементов фиксируется сортировкой,
 * время формирования передаётся извне (никаких Date.now внутри вычислений).
 */

/** Строка дневного наблюдения, прочитанная из daily_metrics (read-only). */
export interface DailyObservationRow {
  date: string;
  slice_id: number;
  metric: string;
  metric_kind: string;
  dimension_1: string;
  dimension_2: string;
  value: number | null;
  unit: string | null;
  evidence_status: string;
  data_status: string;
  transform_version: string;
}

export interface DescriptiveStats {
  n: number;
  nulls: number;
  zeros: number;
  negatives: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  stdev: number | null;
  cv: number | null;
  q1: number | null;
  q3: number | null;
  iqr: number | null;
  mad: number | null;
}

export interface GapRange {
  from: string;
  to: string;
  days: number;
}

export interface MetricProfile {
  metric: string;
  metric_kind: string;
  slice_id: number;
  unit: string | null;
  observations: number;
  days_with_data: number;
  first_date: string | null;
  last_date: string | null;
  stats: DescriptiveStats;
  /** Сумма значений — только как описательная характеристика, не как бизнес-агрегат. */
  sum: number | null;
  mean_per_day: number | null;
  positive_days: number;
  zero_days: number;
  expected_days: number;
  missing_days: number;
  /** Доля дней с наблюдением относительно календаря периода (0..1). */
  fill_rate: number;
  max_gap_days: number;
  gap_ranges: GapRange[];
  /** Подтверждена ли корректность суммирования по дням (по умолчанию — нет). */
  additive_aggregation_confirmed: boolean;
  notes: string[];
}

export interface TemporalCoverageRow {
  slice_id: number;
  metric: string;
  first_date: string | null;
  last_date: string | null;
  days_with_data: number;
  expected_days: number;
  missing_days: number;
  missing_dates: string[];
}

export type OutlierMethod = "IQR" | "MAD";

export interface OutlierFinding {
  metric: string;
  slice_id: number;
  /** Измерения: ряд строится внутри одной комбинации измерений, популяции не смешиваются. */
  dimension_1: string;
  dimension_2: string;
  date: string;
  value: number;
  method: OutlierMethod;
  /** Статистика метода: границы для IQR, MAD и масштаб для MAD. */
  statistic: number;
  lower_bound: number | null;
  upper_bound: number | null;
  reason: string;
}

export interface DowProfileRow {
  dow: number;
  label: string;
  observations: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  stdev: number | null;
}

export interface TemporalProfile {
  metric: string;
  slice_id: number;
  /** Как значения строк сводились к одному значению дня (документируется явно). */
  aggregation: "sum_by_dimensions" | "mean_by_dimensions";
  aggregation_note: string;
  points_used: number;
  first_value: number | null;
  last_value: number | null;
  first_week_mean: number | null;
  last_week_mean: number | null;
  /** Описательный линейный тренд: наклон на день и коэффициент детерминации. */
  trend_slope_per_day: number | null;
  trend_r2: number | null;
  trend_note: string;
  dow: DowProfileRow[];
}

export interface DimensionValueCount {
  value: string;
  rows: number;
}

export interface DimensionProfile {
  field: "dimension_1" | "dimension_2";
  total_rows: number;
  unique_values: number;
  empty_values: number;
  top_values: DimensionValueCount[];
  values_per_date_min: number;
  values_per_date_max: number;
  /** Специальные значения: TOTAL-подобные и плейсхолдеры маскирования. */
  special_values: DimensionValueCount[];
  cardinality: "low" | "medium" | "high";
  masking_placeholder_values: number;
  notes: string[];
}

export interface SliceOverlapRow {
  metric: string;
  slices: number[];
  shared_dates: number;
  values_equal_on_shared_dates: boolean;
  /** Установлена ли независимость срезов. Без доказательств — unknown. */
  independence: "unknown" | "same_population" | "different_population";
  notes: string[];
}

export interface PeriodAssessment {
  from: string;
  to: string;
  days: number;
  missing_calendar_days: string[];
  complete_weeks: number;
  simple_baseline_possible: boolean;
  dow_features_possible: boolean;
  weekly_profile_reliability: "low" | "medium" | "high";
  backtesting_folds: Array<{ horizon_days: number; min_train_days: number; folds: number }>;
  recommended_horizons: number[];
  forbidden_claims: string[];
}

export type SemanticStatus = "known" | "partial" | "unknown";
export type ForecastReadiness = "READY" | "CONDITIONAL" | "BLOCKED";

export interface MetricSemantics {
  metric: string;
  verbose_name: string | null;
  expression: string | null;
  aggregation: string | null;
  source: string;
  status: SemanticStatus;
}

export interface ReadinessRow {
  metric: string;
  metric_kind: string;
  slices: number[];
  observations: number;
  coverage: number;
  missing: number;
  nulls: number;
  zeros: number;
  outliers: number;
  semantic_status: SemanticStatus;
  forecast_readiness: ForecastReadiness;
  reasons: string[];
  required_actions: string[];
}

export interface EventsProfile {
  total: number;
  by_status: Record<string, number>;
  by_evidence_status: Record<string, number>;
  /** Календарное распределение плановых мероприятий (не факты). */
  planned_notes: Array<{ ledger_note: string; status: string; evidence_status: string }>;
  note: string;
}

export interface ProfilingResult {
  shop_no: string;
  generated_at: string;
  period: {
    from: string;
    to: string;
    days: number;
    missing_calendar_days: string[];
    matches_expected_period: boolean;
    expected_period: { from: string; to: string };
  };
  source_counts: {
    daily_metrics: number;
    domain_events: number;
    extraction_runs: number;
    raw_extractions: number;
  };
  slices: number[];
  status_counts: {
    data_status: Record<string, number>;
    evidence_status: Record<string, number>;
    transform_version: Record<string, number>;
  };
  duplicates: {
    /** Количество лишних строк сверх natural key (0 — дублей нет). */
    count: number;
    examples: string[];
  };
  metric_profiles: MetricProfile[];
  temporal_coverage: TemporalCoverageRow[];
  temporal_profiles: TemporalProfile[];
  outliers: OutlierFinding[];
  dimensions: DimensionProfile[];
  slice_overlap: SliceOverlapRow[];
  ratio_checks: RatioCheck[];
  period_assessment: PeriodAssessment;
  semantics: MetricSemantics[];
  readiness: ReadinessRow[];
  events: EventsProfile;
  limitations: string[];
  /** Признак того, что запись в БД в ходе профилирования не выполнялась. */
  read_only: { readonly_connection: boolean; query_only: number; write_attempt_blocked: boolean };
}

/** Проверка восстановления отношения sum(числитель)/sum(знаменатель) по формуле из каталога. */
export interface RatioCheck {
  metric: string;
  slice_id: number;
  numerator_metric: string | null;
  denominator_metric: string | null;
  dates_checked: number;
  max_abs_deviation: number | null;
  mean_abs_deviation: number | null;
  exact_matches: number;
  /** Совпадения с учётом допуска округления долей. */
  matches_within_rounding: number;
  rounding_tolerance: number;
  formula_source: string | null;
  note: string;
}
