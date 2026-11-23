/**
 * Типы модуля сверки двух выгрузок Superset.
 *
 * Сравниваются нормализованные наблюдения, а не файлы целиком: время генерации, порядок строк
 * и служебные поля могут отличаться, не означая изменения данных.
 */

/** Категория расхождения (закрытый список из ТЗ). */
export type DiffCategory =
  | "IDENTICAL"
  | "VALUE_CHANGED"
  | "NEW_ROW"
  | "MISSING_ROW"
  | "SCHEMA_CHANGED"
  | "QUALITY_DEGRADED"
  | "ACCESS_CHANGED"
  | "PERIOD_MISMATCH"
  | "UNKNOWN";

/** Что именно сравнивается в расхождении. */
export type DiffScope =
  | "daily"
  | "total"
  | "metric_set"
  | "dimension"
  | "source"
  | "period"
  | "run";

export type Severity = "info" | "warning" | "error";

/** Ключ наблюдения без версии преобразования (transform_version учитывается отдельно). */
export interface ObservationKeyParts {
  shop_no: string;
  date: string;
  slice_id: number;
  dimension_1: string;
  dimension_2: string;
  metric: string;
}

export interface NormalizedObservation {
  /** Строковый ключ сравнения (для итогов за период — с префиксом TOTAL). */
  key: string;
  parts: ObservationKeyParts;
  /** true — строка «итог за период» с пустой датой; сравнивается отдельно от дневных. */
  isTotal: boolean;
  metric_kind: string;
  value: number | null;
  /** Исходное текстовое значение — для точного сравнения без потери точности. */
  value_raw: string;
  /** Исходный текст измерений (до маскирования) — нужен для оценки влияния маскирования. */
  raw_dimension_1: string;
  raw_dimension_2: string;
  dataset_id: number | null;
}

/** Снимок качества одного запроса из quality.json. */
export interface QualitySnapshot {
  slice_id: number;
  http_status: number | null;
  completeness: string;
  row_count: number | null;
  missing_metrics: string[];
  missing_dimensions: string[];
  truncated_queries: unknown[];
  duplicate_rows: number | null;
  query_count_mismatch: boolean;
  ratio_weighting: string;
}

export interface NormalizedRun {
  dir: string;
  shop_no: string;
  period: { from: string; to: string; time_range: string; weeks: number | null };
  sources: Array<{ slice_id: number; dataset_id: number | null; request_sha256: string; file: string }>;
  observations: NormalizedObservation[];
  by_key: Map<string, NormalizedObservation>;
  duplicates: Array<{ key: string; count: number }>;
  metric_set_by_slice: Map<number, string[]>;
  dimension_set_by_slice: Map<number, string[]>;
  quality_by_slice: Map<number, QualitySnapshot>;
  http_by_slice: Map<number, number | null>;
  /** Сколько строк имеют пустую дату (итоги за период). */
  total_rows: number;
  /** Сколько строк были замаскированы плейсхолдером (до применения маскирования в нормализаторе). */
  masked_rows: number;
}

export interface ObservationDiff {
  category: DiffCategory;
  scope: DiffScope;
  severity: Severity;
  slice_id: number | null;
  date: string;
  metric: string;
  dimension_1: string;
  dimension_2: string;
  old_value: number | null;
  new_value: number | null;
  abs_delta: number | null;
  rel_delta: number | null;
  detail: string;
}

export interface QualityChange {
  slice_id: number;
  field: string;
  old_value: string;
  new_value: string;
  degraded: boolean;
}

export interface SliceComparison {
  slice_id: number;
  /** дневных строк в старой выгрузке */
  old_rows: number;
  /** дневных строк в новой выгрузке */
  new_rows: number;
  identical: number;
  value_changed: number;
  /** строк, которые есть только в новой выгрузке */
  added: number;
  /** строк, которые есть только в старой выгрузке */
  missing: number;
  totals_rows_old: number;
  totals_rows_new: number;
  total_old: number | null;
  total_new: number | null;
  metric_set_changed: boolean;
}

export interface ComparisonResult {
  old_dir: string;
  new_dir: string;
  generated_at: string;
  tolerance: { abs: number; rel: number };
  period_mismatch: boolean;
  access_changed: boolean;
  scaffold_changed: boolean;
  slices: { old: number[]; new: number[]; missing_in_new: number[]; new_in_old: number[] };
  counts: {
    compared: number;
    identical: number;
    value_changed: number;
    new_rows: number;
    missing_rows: number;
    daily_identical: number;
    totals_identical: number;
    duplicates_old: number;
    duplicates_new: number;
  };
  per_slice: SliceComparison[];
  diffs: ObservationDiff[];
  quality_changes: QualityChange[];
  quality_improvements: QualityChange[];
  masking: { masked_rows_old: number; masked_rows_new: number; hidden_dimension_differences: number };
  aggregates: Array<{
    slice_id: number;
    metric: string;
    old_total: number | null;
    new_total: number | null;
    abs_delta: number | null;
    rel_delta: number | null;
    changed: boolean;
  }>;
  status: "IDENTICAL" | "MATCH_WITH_MINOR_DIFFERENCES" | "DATA_CHANGED" | "INCOMPLETE" | "BLOCKED";
  notes: string[];
}
