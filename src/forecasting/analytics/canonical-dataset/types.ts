/**
 * Типы Stage 3.2.2–3.2.4: выбор канонического источника, дневной набор и сверка.
 */

/** Одна дневная запись канонического ряда. */
export interface CanonicalDailyObservation {
  date: string;
  shopNo: string;
  /** Исходное имя метрики не переименовывается: бизнес-имя задаётся на уровне слоя. */
  metric: string;
  /** Бизнес-имя показателя в аналитическом слое. */
  businessName: string;
  value: number;
  sourceSliceId: number;
  sourceDatasetId: number | null;
  sourceRunId: string | null;
  qualityStatus: "full" | "conditional" | "blocked";
}

/** Провенанс набора: как и откуда получены значения. */
export interface DatasetProvenance {
  sourceFile: string;
  extractionRunIds: number[];
  extractionRunNotes: string[];
  transformVersions: string[];
  sourceSliceId: number;
  sourceDatasetId: number | null;
  evidenceStatuses: string[];
  dataStatuses: string[];
  generatedAt: string;
  /** Контрольная сумма содержимого набора (детерминированная). */
  checksum: string | null;
}

export interface CanonicalDataset {
  shopNo: string;
  metric: string;
  businessName: string;
  sourceSliceId: number;
  period: { from: string; to: string; days: number };
  observations: CanonicalDailyObservation[];
  provenance: DatasetProvenance;
  totalDelivered: number;
  excludedTotalsRows: number;
}

/** Строка исходного среза, прочитанная из SQLite (read-only). */
export interface SliceSourceRow {
  date: string;
  sliceId: number;
  dimension1: string;
  dimension2: string;
  value: number | null;
  datasetId: number | null;
  runId: number | null;
  transformVersion: string;
  evidenceStatus: string;
  dataStatus: string;
}

/** Статистика среза-кандидата (Stage 3.2.2). */
export interface SliceCandidateStats {
  sliceId: number;
  rows: number;
  dailyRows: number;
  totalsRows: number;
  dates: number;
  rowsPerDayMin: number;
  rowsPerDayMax: number;
  rowsPerDayAvg: number;
  dimensionCombinations: number;
  dimension1Values: number;
  dimension2Values: number;
  emptyDimension1: number;
  emptyDimension2: number;
  maskedDimension1: number;
  maskedDimension2: number;
  nullValues: number;
  zeroValues: number;
  negativeValues: number;
  fractionalValues: number;
  min: number | null;
  max: number | null;
  dailyTotal: number;
  duplicateKeys: number;
  datasetId: number | null;
  runId: number | null;
  /** Одна строка на дату — прямое представление магазина без агрегации измерений. */
  singleRowPerDate: boolean;
  calendarComplete: boolean;
}

/** Построчная межсрезовая сверка дневных итогов. */
export interface CrossSliceRow {
  date: string;
  totalsBySlice: Record<string, number>;
  allEqual: boolean;
  maxDeviation: number;
  slicesCompared: number;
}

export type DecisionStatus = "CONFIRMED" | "CONDITIONAL" | "BLOCKED";

/** Зафиксированное решение о каноническом источнике. */
export interface SourceDecision {
  sliceId: number | null;
  status: DecisionStatus;
  decidedAt: string;
  decidedBy: string;
  reasons: string[];
  evidence: string[];
  alternatives: Array<{ sliceId: number; role: string; note: string }>;
  rejected: Array<{ sliceId: number; reason: string }>;
  note: string | null;
}

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
  checks: Array<{ code: string; passed: boolean; detail: string }>;
}

/** Результат сверки канонического набора с исходным срезом (Stage 3.2.4). */
export interface ReconciliationRow {
  date: string;
  sourceDailyTotal: number | null;
  sourceRows: number;
  canonicalValue: number | null;
  deviation: number | null;
  equal: boolean;
  crossSliceTotals: Record<string, number>;
  crossSliceEqual: boolean;
}

export interface ReconciliationResult {
  status: "PASS" | "CONDITIONAL" | "BLOCKED";
  counts: {
    sourceRowsForMetric: number;
    sourceDailyRows: number;
    sourceTotalsRows: number;
    canonicalRows: number;
    dates: number;
    excludedTotals: number;
    rejectedRows: number;
    conflicts: number;
  };
  period: { from: string; to: string; days: number; expectedFrom: string | null; expectedTo: string | null; matches: boolean };
  totals: { sourceTotal: number; canonicalTotal: number; equal: boolean; expectedTotal: number | null; matchesExpected: boolean | null };
  rows: ReconciliationRow[];
  crossSliceMismatches: number;
  determinism: { runs: number; identical: boolean; checksum: string };
  issues: ValidationIssue[];
  checks: Array<{ code: string; passed: boolean; detail: string }>;
}
