/**
 * Типы Stage 3.3.1 — расширение исторических данных.
 */

/** Описание одного интервала выгрузки (непересекающиеся интервалы). */
export interface ExtractionInterval {
  label: string;
  runDir: string;
  requestedFrom: string;
  requestedToExclusive: string;
  manifestGeneratedAt: string;
  requestSha256: string | null;
  httpStatus: number | null;
  completeness: string;
  rows: number;
  firstDate: string | null;
  lastDate: string | null;
  fileHashes: Record<string, string>;
}

/** Дневное наблюдение расширенной истории. */
export interface HistoryObservation {
  date: string;
  value: number;
  /** Интервал-источник (метка выгрузки). */
  intervalLabel: string;
  sliceId: number;
  datasetId: number | null;
  manifestSha256: string | null;
}

export interface HistoryGap {
  from: string;
  to: string;
  days: number;
}

export interface ExpandedHistory {
  shopNo: string;
  metric: string;
  sliceId: number;
  observations: HistoryObservation[];
  period: { from: string; to: string; days: number };
  expectedDays: number;
  missingDates: string[];
  gaps: HistoryGap[];
  duplicates: Array<{ date: string; values: number[]; intervals: string[] }>;
  intervals: ExtractionInterval[];
  overlapWarnings: string[];
  rejectedRows: Array<{ interval: string; date: string; reason: string }>;
  checksum: string;
}

export type ReconciliationCategory =
  | "IDENTICAL"
  | "VALUE_CHANGED"
  | "NEW"
  | "MISSING"
  | "DUPLICATE"
  | "SCHEMA_CHANGED"
  | "SOURCE_CHANGED"
  | "INCOMPLETE";

export interface HistoryReconciliationRow {
  date: string;
  previousValue: number | null;
  newValue: number | null;
  category: ReconciliationCategory;
  deviation: number | null;
  note: string;
}

export interface HistoryReconciliationResult {
  status: "IDENTICAL" | "MATCH_WITH_EXTENSIONS" | "CHANGES_DETECTED" | "INCOMPLETE" | "BLOCKED";
  comparedDates: number;
  counts: Record<ReconciliationCategory, number>;
  rows: HistoryReconciliationRow[];
  newDates: number;
  notes: string[];
}

export interface HistoryProfile {
  observations: number;
  firstDate: string;
  lastDate: string;
  calendarDays: number;
  missingDates: number;
  duplicates: number;
  nulls: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  stdev: number;
  q1: number;
  q3: number;
  iqr: number;
  mad: number;
  percentiles: { p05: number; p25: number; p50: number; p75: number; p95: number };
  zeros: number;
  negatives: number;
  outlierCountIqr: number;
  outlierCountMad: number;
  weekdayMeans: Array<{ dow: number; label: string; observations: number; mean: number; median: number }>;
  weeklyAggregates: Array<{ weekStart: string; days: number; total: number; mean: number }>;
  longestGrowthStreak: number;
  longestDeclineStreak: number;
  largestDayOverDayChange: { date: string; delta: number } | null;
}
