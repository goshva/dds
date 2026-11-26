/**
 * UI-4.1 / UI-4.1.1 — вычислительное ядро оценки прогнозов (`forecast-eval/v1`, редакция UI-4.0.2).
 *
 * Чистые детерминированные функции: без файлового ввода-вывода, обращений к SQLite, сети,
 * системного времени, переменных окружения и мутаций входных данных.
 *
 * UI-4.1.1: разделены независимая оценка и парное сравнение (C-1), проверяется горизонт (C-2),
 * контекст метрик задаётся явно (C-3), контролируется переполнение (C-4), reconciliation
 * проверяется по доступным полям (C-5), диагностика не теряет сиротские и неизвестные записи
 * (C-6, C-7, C-8), метрики защищены от смешения (C-9), конфликты pair identity выявляются (C-10).
 */

// ---------------------------------------------------------------------------
// 1. Типы
// ---------------------------------------------------------------------------

export type EvaluationMode = "replay" | "shadow";
export type ComputeStatus = "OK" | "FALLBACK" | "INVALID" | "UNKNOWN";
export type FactStatus = "PENDING" | "RECONCILED" | "MISSING_ACTUAL";
export type EvaluationEligibility = "ELIGIBLE" | "EXCLUDED";

export type EligibilityReason =
  | "PENDING"
  | "EXCLUDED_STATUS"
  | "EXCLUDED_NULL_FORECAST"
  | "MISSING_ACTUAL"
  | "UNKNOWN_SNAPSHOT"
  | "EXCLUDED_MODEL_VERSION"
  | "UNKNOWN_MODE"
  | "UNKNOWN_HORIZON"
  | "UNKNOWN_STATUS"
  | "CONFLICT_DUPLICATE"
  | "CONFLICT_ACTUAL"
  | "CONFLICT_FORECAST_VALUE"
  | "CONFLICT_RECONCILIATION"
  | "CONFLICT_PAIR_IDENTITY"
  | "UNKNOWN_DATASET_VERSION"
  | "INVALID_RECONCILIATION"
  | "SOURCE_CORRUPTED";

export type EvaluationWarning = "DATASET_VERSION_DIFFERS";
export type MetricStatus = "OK" | "NOT_AVAILABLE" | "OVERFLOW";

export type UnknownKind =
  | "UNKNOWN_MODE"
  | "UNKNOWN_MODEL"
  | "UNKNOWN_SNAPSHOT"
  | "UNKNOWN_RECONCILIATION"
  | "UNKNOWN_STATUS"
  | "UNKNOWN_HORIZON";

export interface SnapshotLike {
  snapshot_id: string;
  mode: string;
  model_id: string;
  model_version: string;
  variant?: string | null;
  horizon: number;
  origin_date: string;
  target_date: string;
  forecast_value: number | null;
  status: string;
  input_data_version: string;
  dataset_checksum?: string | null;
}

export interface ReconciliationLike {
  snapshot_id: string;
  model_id: string;
  horizon: number;
  target_date: string;
  forecast_value?: number | null;
  actual: number;
}

export interface ModelIdentity {
  modelId: string;
  modelVersion: string;
  variant: string | null;
}

export const BASELINE_IDENTITY: ModelIdentity = { modelId: "rolling_7_day_mean", modelVersion: "rolling-7-day-mean/v1", variant: null };
export const CANDIDATE_IDENTITY: ModelIdentity = { modelId: "adaptive_baseline", modelVersion: "adaptive-baseline/v1+variantB", variant: "B" };
export const SUPPORTED_HORIZONS: readonly number[] = [1, 3];

export interface EligibilityResult {
  eligibility: EvaluationEligibility;
  reason: EligibilityReason | null;
  warnings: EvaluationWarning[];
  mode: EvaluationMode | null;
  horizon: number | null;
  computeStatus: ComputeStatus;
  factStatus: FactStatus;
}

export interface MetricsContext {
  mode: EvaluationMode;
  horizon: number;
  modelId: string;
  modelVersion: string;
}

export interface MetricInput {
  mode: EvaluationMode;
  horizon: number;
  modelId: string;
  modelVersion: string;
  forecast: number;
  actual: number;
}

export interface Metrics {
  mode: EvaluationMode;
  horizon: number;
  modelId: string;
  modelVersion: string;
  n: number;
  mae: number | null;
  maeStatus: MetricStatus;
  wape: number | null;
  wapeStatus: MetricStatus;
  bias: number | null;
  biasStatus: MetricStatus;
  underN: number;
  overN: number;
  exactN: number;
  /** Наблюдения, исключённые из расчёта из-за переполнения разности (непересекающаяся категория). */
  excludedOverflowN: number;
  /** Наблюдения, затронутые переполнением накопления (метрика недостоверна, но строка в расчёте). */
  overflowAffectedN: number;
  /** Всего исключённых наблюдений (контекст + нечисловые + переполнение разности). */
  excludedN: number;
  contextMismatchN: number;
  nonFiniteN: number;
  /** C-16: полнота выборки относительно переданного набора. */
  sampleStatus: "COMPLETE" | "PARTIAL";
  semantics: "PROVISIONAL";
}

export interface MetricsResult {
  metrics: Metrics;
  /** Исключённые наблюдения: только строки, не вошедшие в расчёт (C-14). */
  excluded: Array<{ reason: "CONTEXT_MISMATCH" | "NON_FINITE" | "OVERFLOW"; detail: string }>;
  /** Агрегированные заметки о переполнении метрик (не являются исключёнными строками). */
  overflowNotes: string[];
}

export interface PairCounters {
  baselineIndependentN: number;
  candidateIndependentN: number;
  pairedN: number;
  excludedBaselineN: number;
  excludedCandidateN: number;
  unmatchedN: number;
  conflictN: number;
  duplicateN: number;
  unknownN: number;
  pendingN: number;
  missingActualN: number;
  unsupportedHorizonN: number;
  orphanReconciliationN: number;
  invalidReconciliationN: number;
  pairIdentityConflictN: number;
}

export interface EvaluationPair {
  pairIdentity: { mode: EvaluationMode; horizon: number; originDate: string; targetDate: string; inputDataVersion: string };
  baseline: SnapshotLike;
  candidate: SnapshotLike;
  actual: number;
  warnings: EvaluationWarning[];
}

export interface UnknownRecord {
  kind: UnknownKind;
  snapshotId: string | null;
  recordType: "snapshot" | "reconciliation";
  reason: string;
}

export interface PairIdentityConflict {
  participant: "baseline" | "candidate";
  pairIdentity: string;
  snapshotIds: string[];
}

export interface ConflictReport {
  duplicateSnapshotIds: Array<{ snapshotId: string; count: number }>;
  duplicateReconciliationIds: Array<{ snapshotId: string; count: number }>;
  orphanReconciliations: string[];
  snapshotsWithoutReconciliation: string[];
  forecastValueMismatches: string[];
  reconciliationMismatches: Array<{ snapshotId: string; field: string }>;
  actualConflicts: string[];
  pairIdentityConflicts: PairIdentityConflict[];
  invalidReconciliations: string[];
  unknownRecords: UnknownRecord[];
}

export interface EligibilityDiagnostic {
  snapshotId: string;
  mode: string | null;
  horizon: number | null;
  eligibility: EvaluationEligibility;
  reason: EligibilityReason | null;
  warnings: EvaluationWarning[];
}

export interface EvaluationSummary {
  mode: EvaluationMode;
  horizon: number;
  /** Независимая оценка модели: не ограничена наличием второго участника пары. */
  independentMetrics: Metrics[];
  /** Парное сравнение — только по общей выборке. */
  pairedComparison: { available: boolean; pairedN: number; maeBaseline: number | null; maeCandidate: number | null; deltaMae: number | null; status: MetricStatus };
  pairCounters: PairCounters;
  /** C-15: структурированная диагностика исключённых наблюдений (не только агрегаты). */
  metricDiagnostics: Array<{
    modelId: string;
    excluded: Array<{ reason: "CONTEXT_MISMATCH" | "NON_FINITE" | "OVERFLOW"; detail: string }>;
    overflowNotes: string[];
    excludedN: number;
    excludedOverflowN: number;
    overflowAffectedN: number;
    contextMismatchN: number;
    nonFiniteN: number;
    sampleStatus: "COMPLETE" | "PARTIAL";
  }>;
  eligibilityDiagnostics: EligibilityDiagnostic[];
  conflicts: ConflictReport;
  unknownRecords: UnknownRecord[];
  warnings: EvaluationWarning[];
  semantics: "PROVISIONAL";
}

export interface EvaluationResult {
  summaries: EvaluationSummary[];
  diagnostics: {
    counters: PairCounters;
    conflicts: ConflictReport;
    unknownRecords: UnknownRecord[];
  };
}

// ---------------------------------------------------------------------------
// 2. Классификация
// ---------------------------------------------------------------------------

export function isKnownMode(value: unknown): value is EvaluationMode {
  return value === "replay" || value === "shadow";
}
export function isKnownHorizon(value: unknown): value is number {
  return typeof value === "number" && SUPPORTED_HORIZONS.includes(value);
}
export function classifyComputeStatus(value: unknown): ComputeStatus {
  if (value === "OK" || value === "FALLBACK" || value === "INVALID") return value;
  return "UNKNOWN";
}
export function matchesIdentity(snapshot: SnapshotLike, identity: ModelIdentity): boolean {
  return snapshot.model_id === identity.modelId && snapshot.model_version === identity.modelVersion && (snapshot.variant ?? null) === identity.variant;
}

/** Классификация неизвестной записи снапшота (структурно корректная запись не считается повреждением). */
export function classifyUnknown(snapshot: SnapshotLike): UnknownKind | null {
  if (!isKnownMode(snapshot.mode)) return "UNKNOWN_MODE";
  if (!isKnownHorizon(snapshot.horizon)) return "UNKNOWN_HORIZON";
  if (![BASELINE_IDENTITY.modelId, CANDIDATE_IDENTITY.modelId].includes(snapshot.model_id)) return "UNKNOWN_MODEL";
  if (![BASELINE_IDENTITY.modelVersion, CANDIDATE_IDENTITY.modelVersion].includes(snapshot.model_version)) return "UNKNOWN_MODEL";
  if (classifyComputeStatus(snapshot.status) === "UNKNOWN") return "UNKNOWN_STATUS";
  return null;
}

// ---------------------------------------------------------------------------
// 3. Eligibility
// ---------------------------------------------------------------------------

export interface EligibilityOptions {
  technicalFactCutoff?: string | null;
  expectedIdentity?: ModelIdentity | null;
  duplicateSnapshotIds?: ReadonlySet<string>;
  conflictedSnapshotIds?: ReadonlySet<string>;
  /** reconciliation не согласован со snapshot (C-5). */
  mismatchedReconciliationIds?: ReadonlySet<string>;
  /** невалидная структура reconciliation (C-8). */
  invalidReconciliationIds?: ReadonlySet<string>;
  /** конфликт pair identity (C-10). */
  pairIdentityConflictIds?: ReadonlySet<string>;
}

export function eligibility(snapshot: SnapshotLike, reconciliation: ReconciliationLike | null | undefined, options: EligibilityOptions = {}): EligibilityResult {
  const warnings: EvaluationWarning[] = [];
  const mode = isKnownMode(snapshot.mode) ? snapshot.mode : null;
  const horizon = isKnownHorizon(snapshot.horizon) ? snapshot.horizon : null;
  const computeStatus = classifyComputeStatus(snapshot.status);
  const duplicates = options.duplicateSnapshotIds ?? new Set<string>();
  const conflicts = options.conflictedSnapshotIds ?? new Set<string>();
  const mismatched = options.mismatchedReconciliationIds ?? new Set<string>();
  const invalid = options.invalidReconciliationIds ?? new Set<string>();
  const pairConflicts = options.pairIdentityConflictIds ?? new Set<string>();
  const base: EligibilityResult = { eligibility: "EXCLUDED", reason: null, warnings, mode, horizon, computeStatus, factStatus: "MISSING_ACTUAL" };

  if (duplicates.has(snapshot.snapshot_id)) return { ...base, reason: "CONFLICT_DUPLICATE" };
  if (pairConflicts.has(snapshot.snapshot_id)) return { ...base, reason: "CONFLICT_PAIR_IDENTITY" };
  if (conflicts.has(snapshot.snapshot_id)) return { ...base, reason: "CONFLICT_ACTUAL" };
  if (!mode) return { ...base, reason: "UNKNOWN_MODE" };
  if (horizon === null) return { ...base, reason: "UNKNOWN_HORIZON" };
  if (computeStatus === "UNKNOWN") return { ...base, reason: "UNKNOWN_STATUS" };
  if (computeStatus !== "OK") return { ...base, reason: "EXCLUDED_STATUS" };
  if (options.expectedIdentity && !matchesIdentity(snapshot, options.expectedIdentity)) return { ...base, reason: "EXCLUDED_MODEL_VERSION" };
  if (snapshot.forecast_value === null || !Number.isFinite(snapshot.forecast_value)) return { ...base, reason: "EXCLUDED_NULL_FORECAST" };
  if (!snapshot.dataset_checksum || typeof snapshot.dataset_checksum !== "string") return { ...base, reason: "UNKNOWN_DATASET_VERSION" };
  const cutoff = options.technicalFactCutoff ?? null;
  if (cutoff !== null && snapshot.target_date > cutoff) return { ...base, factStatus: "PENDING", reason: "PENDING" };
  if (!reconciliation) return { ...base, factStatus: "MISSING_ACTUAL", reason: "MISSING_ACTUAL" };
  if (invalid.has(snapshot.snapshot_id)) return { ...base, factStatus: "RECONCILED", reason: "INVALID_RECONCILIATION" };
  if (mismatched.has(snapshot.snapshot_id)) return { ...base, factStatus: "RECONCILED", reason: "CONFLICT_RECONCILIATION" };
  if (!Number.isFinite(reconciliation.actual)) return { ...base, factStatus: "MISSING_ACTUAL", reason: "MISSING_ACTUAL" };
  if (reconciliation.forecast_value !== undefined && reconciliation.forecast_value !== null && reconciliation.forecast_value !== snapshot.forecast_value) {
    return { ...base, factStatus: "RECONCILED", reason: "CONFLICT_FORECAST_VALUE" };
  }
  return { eligibility: "ELIGIBLE", reason: null, warnings, mode, horizon, computeStatus, factStatus: "RECONCILED" };
}

// ---------------------------------------------------------------------------
// 4. Конфликты, сироты и неизвестные записи
// ---------------------------------------------------------------------------

function countBy(ids: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}
function pairKeyOf(snapshot: SnapshotLike): string {
  return `${snapshot.mode}|${snapshot.horizon}|${snapshot.origin_date}|${snapshot.target_date}|${snapshot.input_data_version}`;
}
function isValidReconciliation(record: ReconciliationLike): boolean {
  return typeof record.snapshot_id === "string" && typeof record.model_id === "string" && isKnownHorizon(record.horizon) && typeof record.target_date === "string" && Number.isFinite(record.actual);
}

/**
 * Независимое обнаружение конфликтов: не полагается на `errors.jsonl` (C-4 контракта UI-4.0.2).
 * Диагностика сохраняет сиротские, неизвестные и невалидные записи (C-6, C-7, C-8).
 */
export function classifyConflicts(snapshots: readonly SnapshotLike[], reconciliations: readonly ReconciliationLike[]): ConflictReport {
  const snapshotCounts = countBy(snapshots.map((snapshot) => snapshot.snapshot_id));
  const reconciliationCounts = countBy(reconciliations.map((record) => record.snapshot_id));
  const duplicateSnapshotIds = [...snapshotCounts.entries()].filter(([, count]) => count > 1).map(([snapshotId, count]) => ({ snapshotId, count }));
  const duplicateReconciliationIds = [...reconciliationCounts.entries()].filter(([, count]) => count > 1).map(([snapshotId, count]) => ({ snapshotId, count }));

  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.snapshot_id, snapshot]));
  const reconciledIds = new Set(reconciliations.map((record) => record.snapshot_id));
  const orphanReconciliations = [...new Set(reconciliations.filter((record) => !snapshotById.has(record.snapshot_id)).map((record) => record.snapshot_id))];
  const snapshotsWithoutReconciliation = [...new Set(snapshots.filter((snapshot) => !reconciledIds.has(snapshot.snapshot_id)).map((snapshot) => snapshot.snapshot_id))];

  const forecastValueMismatches: string[] = [];
  const reconciliationMismatches: Array<{ snapshotId: string; field: string }> = [];
  const invalidReconciliations: string[] = [];
  const actualByIdentity = new Map<string, Set<number>>();

  for (const record of reconciliations) {
    const snapshot = snapshotById.get(record.snapshot_id);
    if (!snapshot) continue;
    if (!isValidReconciliation(record)) {
      invalidReconciliations.push(record.snapshot_id);
      continue;
    }
    if (record.model_id !== snapshot.model_id) reconciliationMismatches.push({ snapshotId: record.snapshot_id, field: "model_id" });
    if (record.horizon !== snapshot.horizon) reconciliationMismatches.push({ snapshotId: record.snapshot_id, field: "horizon" });
    if (record.target_date !== snapshot.target_date) reconciliationMismatches.push({ snapshotId: record.snapshot_id, field: "target_date" });
    if (record.forecast_value !== undefined && record.forecast_value !== null && record.forecast_value !== snapshot.forecast_value) {
      forecastValueMismatches.push(record.snapshot_id);
      reconciliationMismatches.push({ snapshotId: record.snapshot_id, field: "forecast_value" });
    }
    const identity = `${snapshot.mode}|${snapshot.horizon}|${snapshot.origin_date}|${snapshot.target_date}`;
    const values = actualByIdentity.get(identity) ?? new Set<number>();
    values.add(record.actual);
    actualByIdentity.set(identity, values);
  }
  const actualConflicts = [...actualByIdentity.entries()].filter(([, values]) => values.size > 1).map(([identity]) => identity);

  // C-10: несколько записей одного участника с одной pair identity (разные snapshot_id) — конфликт
  const pairIdentityConflicts: PairIdentityConflict[] = [];
  for (const identity of [BASELINE_IDENTITY, CANDIDATE_IDENTITY]) {
    const participant = identity.modelId === BASELINE_IDENTITY.modelId ? "baseline" : "candidate";
    const byPair = new Map<string, string[]>();
    for (const snapshot of snapshots) {
      if (!matchesIdentity(snapshot, identity)) continue;
      const key = pairKeyOf(snapshot);
      byPair.set(key, [...(byPair.get(key) ?? []), snapshot.snapshot_id]);
    }
    for (const [key, ids] of byPair) {
      if (ids.length > 1) pairIdentityConflicts.push({ participant, pairIdentity: key, snapshotIds: [...ids] });
    }
  }

  const unknownRecords: UnknownRecord[] = [];
  for (const snapshot of snapshots) {
    const kind = classifyUnknown(snapshot);
    if (kind) unknownRecords.push({ kind, snapshotId: snapshot.snapshot_id, recordType: "snapshot", reason: `${snapshot.mode}/${snapshot.horizon}/${snapshot.model_id}/${snapshot.model_version}/${snapshot.status}` });
  }
  for (const record of reconciliations) {
    if (!snapshotById.has(record.snapshot_id)) {
      unknownRecords.push({ kind: "UNKNOWN_SNAPSHOT", snapshotId: record.snapshot_id, recordType: "reconciliation", reason: "reconciliation без snapshot" });
      continue;
    }
    if (!isValidReconciliation(record)) {
      unknownRecords.push({ kind: "UNKNOWN_RECONCILIATION", snapshotId: record.snapshot_id, recordType: "reconciliation", reason: "невалидные обязательные поля reconciliation" });
      continue;
    }
    const snapshot = snapshotById.get(record.snapshot_id)!;
    if (!isKnownMode(snapshot.mode)) {
      unknownRecords.push({ kind: "UNKNOWN_RECONCILIATION", snapshotId: record.snapshot_id, recordType: "reconciliation", reason: "snapshot с неизвестным режимом" });
    }
  }

  return {
    duplicateSnapshotIds,
    duplicateReconciliationIds,
    orphanReconciliations,
    snapshotsWithoutReconciliation,
    forecastValueMismatches,
    reconciliationMismatches,
    actualConflicts,
    pairIdentityConflicts,
    invalidReconciliations,
    unknownRecords,
  };
}

// ---------------------------------------------------------------------------
// 5. Метрики (C-3, C-4, C-9)
// ---------------------------------------------------------------------------

function sameContext(record: MetricInput, context: MetricsContext): boolean {
  return record.mode === context.mode && record.horizon === context.horizon && record.modelId === context.modelId && record.modelVersion === context.modelVersion;
}

function emptyMetrics(context: MetricsContext): Metrics {
  return {
    mode: context.mode,
    horizon: context.horizon,
    modelId: context.modelId,
    modelVersion: context.modelVersion,
    n: 0,
    mae: null,
    maeStatus: "NOT_AVAILABLE",
    wape: null,
    wapeStatus: "NOT_AVAILABLE",
    bias: null,
    biasStatus: "NOT_AVAILABLE",
    underN: 0,
    overN: 0,
    exactN: 0,
    excludedOverflowN: 0,
    overflowAffectedN: 0,
    excludedN: 0,
    contextMismatchN: 0,
    nonFiniteN: 0,
    sampleStatus: "COMPLETE",
    semantics: "PROVISIONAL",
  };
}

/**
 * MAE / WAPE / Bias / under / over / exact строго в переданном контексте.
 * Записи другого режима, горизонта или модели не смешиваются и возвращаются в `excluded`.
 * Переполнение арифметики классифицируется как `OVERFLOW`; метрика становится `null`.
 */
export function computeMetrics(records: readonly MetricInput[], context: MetricsContext): MetricsResult {
  const excluded: MetricsResult["excluded"] = [];
  let contextMismatchN = 0;
  let nonFiniteN = 0;
  const errors: number[] = [];
  let differenceOverflowN = 0;

  for (const record of records) {
    if (!sameContext(record, context)) {
      contextMismatchN += 1;
      excluded.push({ reason: "CONTEXT_MISMATCH", detail: `${record.mode}/${record.horizon}/${record.modelId}/${record.modelVersion}` });
      continue;
    }
    if (!Number.isFinite(record.forecast) || !Number.isFinite(record.actual)) {
      nonFiniteN += 1;
      excluded.push({ reason: "NON_FINITE", detail: `${record.forecast}/${record.actual}` });
      continue;
    }
    const error = record.forecast - record.actual;
    if (!Number.isFinite(error)) {
      // C-11.1: переполнение уже на шаге разности — наблюдение не входит в расчёт
      differenceOverflowN += 1;
      excluded.push({ reason: "OVERFLOW", detail: "разность не конечна" });
      continue;
    }
    errors.push(error);
  }

  const n = errors.length;
  // классификация применима только к наблюдениям, вошедшим в расчёт: underN + overN + exactN === n
  const underN = errors.filter((error) => error < 0).length;
  const overN = errors.filter((error) => error > 0).length;
  const exactN = errors.filter((error) => error === 0).length;

  let absSum = 0;
  let errorSum = 0;
  let actualAbsSum = 0;
  let absOverflow = false;
  let errorOverflow = false;
  let actualOverflow = false;
  const validRecords = records.filter((record) => sameContext(record, context) && Number.isFinite(record.forecast) && Number.isFinite(record.actual) && Number.isFinite(record.forecast - record.actual));

  for (const error of errors) {
    const nextAbs = absSum + Math.abs(error);
    if (!Number.isFinite(nextAbs)) absOverflow = true;
    else absSum = nextAbs;
    const nextError = errorSum + error;
    if (!Number.isFinite(nextError)) errorOverflow = true;
    else errorSum = nextError;
  }
  for (const record of validRecords) {
    const nextActual = actualAbsSum + Math.abs(record.actual);
    if (!Number.isFinite(nextActual)) actualOverflow = true;
    else actualAbsSum = nextActual;
  }

  const maeRaw = n > 0 && !absOverflow ? absSum / n : null;
  const biasRaw = n > 0 && !errorOverflow ? errorSum / n : null;

  // C-18: финальное вычисление WAPE проверяется поэтапно — деление и умножение на 100 отдельно
  const wapeNotes: string[] = [];
  let wapeRaw: number | null = null;
  if (n > 0 && !absOverflow && !actualOverflow && actualAbsSum !== 0) {
    const ratio = absSum / actualAbsSum;
    if (!Number.isFinite(ratio)) {
      wapeNotes.push("WAPE: деление absSum / actualAbsSum не конечно");
    } else {
      const scaled = ratio * 100;
      if (!Number.isFinite(scaled)) {
        wapeNotes.push("WAPE: умножение отношения на 100 не конечно");
      } else {
        wapeRaw = scaled;
      }
    }
  }

  const mae = maeRaw !== null && Number.isFinite(maeRaw) ? maeRaw : null;
  const bias = biasRaw !== null && Number.isFinite(biasRaw) ? biasRaw : null;
  const wape = wapeRaw !== null && Number.isFinite(wapeRaw) ? wapeRaw : null;

  // C-14: непересекающиеся категории счётчиков.
  //   contextMismatchN + nonFiniteN + excludedOverflowN + n === records.length
  //   overflowAffectedN — отдельная метрика «затронуто переполнением накопления», не суммируется с excludedOverflowN
  const accumulationOverflow = absOverflow || errorOverflow || actualOverflow;
  const anyOverflow = differenceOverflowN > 0 || accumulationOverflow;
  const excludedOverflowN = differenceOverflowN;
  const overflowAffectedN = accumulationOverflow ? n : 0;
  const maeStatus: MetricStatus = mae !== null ? "OK" : anyOverflow ? "OVERFLOW" : "NOT_AVAILABLE";
  const biasStatus: MetricStatus = bias !== null ? "OK" : anyOverflow ? "OVERFLOW" : "NOT_AVAILABLE";
  // C-18: финальное переполнение WAPE не маскируется под нулевой знаменатель
  const wapeStatus: MetricStatus = wape !== null ? "OK" : wapeNotes.length > 0 ? "OVERFLOW" : actualAbsSum === 0 && !anyOverflow ? "NOT_AVAILABLE" : "OVERFLOW";

  // C-14: агрегированное сообщение о переполнении метрик не является исключённой строкой
  const overflowNotes: string[] = [];
  if (absOverflow || errorOverflow || actualOverflow) {
    overflowNotes.push(`накопление: abs=${absOverflow} error=${errorOverflow} actual=${actualOverflow}`);
  }
  // C-18: причины финального переполнения WAPE сохраняются отдельно от накоплений
  overflowNotes.push(...wapeNotes);

  return {
    metrics: {
      ...context,
      n,
      mae,
      bias,
      wape,
      maeStatus,
      biasStatus,
      wapeStatus,
      underN,
      overN,
      exactN,
      excludedOverflowN,
      overflowAffectedN,
      excludedN: excluded.length,
      contextMismatchN,
      nonFiniteN,
      sampleStatus: excluded.length > 0 ? "PARTIAL" : "COMPLETE",
      semantics: "PROVISIONAL",
    },
    excluded,
    overflowNotes,
  };
}
// ---------------------------------------------------------------------------
// 6. Парная выборка (C-2, C-5, C-10)
// ---------------------------------------------------------------------------

export interface PairBuildResult {
  pairs: EvaluationPair[];
  counters: PairCounters;
  conflicts: ConflictReport;
}

export function buildPairs(snapshots: readonly SnapshotLike[], reconciliations: readonly ReconciliationLike[], options: { technicalFactCutoff?: string | null } = {}): PairBuildResult {
  const conflicts = classifyConflicts(snapshots, reconciliations);
  const duplicateIds = new Set<string>([...conflicts.duplicateSnapshotIds.map((entry) => entry.snapshotId), ...conflicts.duplicateReconciliationIds.map((entry) => entry.snapshotId)]);
  const conflictedIds = new Set<string>(conflicts.forecastValueMismatches);
  const mismatchedIds = new Set<string>(conflicts.reconciliationMismatches.map((entry) => entry.snapshotId));
  const invalidIds = new Set<string>(conflicts.invalidReconciliations);
  const pairConflictIds = new Set<string>(conflicts.pairIdentityConflicts.flatMap((entry) => entry.snapshotIds));
  const reconciliationBySnapshot = new Map<string, ReconciliationLike>();
  for (const record of reconciliations) if (!reconciliationBySnapshot.has(record.snapshot_id)) reconciliationBySnapshot.set(record.snapshot_id, record);

  const counters: PairCounters = {
    baselineIndependentN: 0,
    candidateIndependentN: 0,
    pairedN: 0,
    excludedBaselineN: 0,
    excludedCandidateN: 0,
    unmatchedN: 0,
    conflictN: 0,
    duplicateN: duplicateIds.size,
    unknownN: conflicts.unknownRecords.length,
    pendingN: 0,
    missingActualN: 0,
    unsupportedHorizonN: snapshots.filter((snapshot) => !isKnownHorizon(snapshot.horizon)).length,
    orphanReconciliationN: conflicts.orphanReconciliations.length,
    invalidReconciliationN: conflicts.invalidReconciliations.length,
    pairIdentityConflictN: conflicts.pairIdentityConflicts.length,
  };

  const evaluate = (snapshot: SnapshotLike, identity: ModelIdentity) =>
    eligibility(snapshot, reconciliationBySnapshot.get(snapshot.snapshot_id), {
      technicalFactCutoff: options.technicalFactCutoff ?? null,
      expectedIdentity: identity,
      duplicateSnapshotIds: duplicateIds,
      conflictedSnapshotIds: conflictedIds,
      mismatchedReconciliationIds: mismatchedIds,
      invalidReconciliationIds: invalidIds,
      pairIdentityConflictIds: pairConflictIds,
    });

  const baselines = new Map<string, SnapshotLike[]>();
  const candidates = new Map<string, SnapshotLike[]>();
  for (const snapshot of snapshots) {
    const isBaseline = matchesIdentity(snapshot, BASELINE_IDENTITY);
    const isCandidate = matchesIdentity(snapshot, CANDIDATE_IDENTITY);
    if (!isBaseline && !isCandidate) {
      if (snapshot.model_id === BASELINE_IDENTITY.modelId) counters.excludedBaselineN += 1;
      else if (snapshot.model_id === CANDIDATE_IDENTITY.modelId) counters.excludedCandidateN += 1;
      continue;
    }
    const result = evaluate(snapshot, isBaseline ? BASELINE_IDENTITY : CANDIDATE_IDENTITY);
    const target = isBaseline ? baselines : candidates;
    if (isBaseline) {
      if (result.eligibility === "ELIGIBLE") counters.baselineIndependentN += 1;
      else counters.excludedBaselineN += 1;
    } else {
      if (result.eligibility === "ELIGIBLE") counters.candidateIndependentN += 1;
      else counters.excludedCandidateN += 1;
    }
    if (result.reason === "PENDING") counters.pendingN += 1;
    if (result.reason === "MISSING_ACTUAL") counters.missingActualN += 1;
    target.set(pairKeyOf(snapshot), [...(target.get(pairKeyOf(snapshot)) ?? []), snapshot]);
  }

  const pairs: EvaluationPair[] = [];
  const allKeys = new Set<string>([...baselines.keys(), ...candidates.keys()]);
  for (const key of allKeys) {
    const baselineList = baselines.get(key) ?? [];
    const candidateList = candidates.get(key) ?? [];
    if (!baselineList.length || !candidateList.length) {
      counters.unmatchedN += 1;
      continue;
    }
    if (baselineList.length > 1 || candidateList.length > 1) {
      counters.conflictN += 1;
      continue;
    }
    const baseline = baselineList[0]!;
    const candidate = candidateList[0]!;
    const baselineResult = evaluate(baseline, BASELINE_IDENTITY);
    const candidateResult = evaluate(candidate, CANDIDATE_IDENTITY);
    if (baselineResult.eligibility !== "ELIGIBLE" || candidateResult.eligibility !== "ELIGIBLE") continue;
    const baselineActual = reconciliationBySnapshot.get(baseline.snapshot_id)!.actual;
    const candidateActual = reconciliationBySnapshot.get(candidate.snapshot_id)!.actual;
    if (baselineActual !== candidateActual) {
      counters.conflictN += 1;
      continue;
    }
    const warnings: EvaluationWarning[] = [];
    if (baseline.dataset_checksum !== candidate.dataset_checksum) warnings.push("DATASET_VERSION_DIFFERS");
    pairs.push({
      pairIdentity: { mode: baseline.mode as EvaluationMode, horizon: baseline.horizon, originDate: baseline.origin_date, targetDate: baseline.target_date, inputDataVersion: baseline.input_data_version },
      baseline,
      candidate,
      actual: baselineActual,
      warnings,
    });
    counters.pairedN += 1;
  }

  counters.conflictN += conflicts.pairIdentityConflicts.length;
  return { pairs, counters, conflicts };
}

// ---------------------------------------------------------------------------
// 7. Сводка: независимая оценка и парное сравнение (C-1, C-6, C-7)
// ---------------------------------------------------------------------------

function emptyCounters(): PairCounters {
  return {
    baselineIndependentN: 0,
    candidateIndependentN: 0,
    pairedN: 0,
    excludedBaselineN: 0,
    excludedCandidateN: 0,
    unmatchedN: 0,
    conflictN: 0,
    duplicateN: 0,
    unknownN: 0,
    pendingN: 0,
    missingActualN: 0,
    unsupportedHorizonN: 0,
    orphanReconciliationN: 0,
    invalidReconciliationN: 0,
    pairIdentityConflictN: 0,
  };
}

export interface EvaluateOptions {
  technicalFactCutoff?: string | null;
}

/**
 * Полная оценка: независимые метрики по каждой модели + парное сравнение.
 * Диагностика (сироты, неизвестные, дубли, конфликты) строится по исходным наборам целиком.
 */
export function evaluate(snapshots: readonly SnapshotLike[], reconciliations: readonly ReconciliationLike[], options: EvaluateOptions = {}): EvaluationResult {
  const globalConflicts = classifyConflicts(snapshots, reconciliations);
  const duplicateIds = new Set<string>([...globalConflicts.duplicateSnapshotIds.map((entry) => entry.snapshotId), ...globalConflicts.duplicateReconciliationIds.map((entry) => entry.snapshotId)]);
  const conflictedIds = new Set<string>(globalConflicts.forecastValueMismatches);
  const mismatchedIds = new Set<string>(globalConflicts.reconciliationMismatches.map((entry) => entry.snapshotId));
  const invalidIds = new Set<string>(globalConflicts.invalidReconciliations);
  const pairConflictIds = new Set<string>(globalConflicts.pairIdentityConflicts.flatMap((entry) => entry.snapshotIds));
  const reconciliationBySnapshot = new Map<string, ReconciliationLike>();
  for (const record of reconciliations) if (!reconciliationBySnapshot.has(record.snapshot_id)) reconciliationBySnapshot.set(record.snapshot_id, record);

  const modes = [...new Set(snapshots.map((snapshot) => snapshot.mode).filter(isKnownMode))];
  const horizons = [...new Set(snapshots.map((snapshot) => snapshot.horizon).filter(isKnownHorizon))].sort((a, b) => a - b);
  const summaries: EvaluationSummary[] = [];

  for (const mode of modes) {
    for (const horizon of horizons) {
      const scoped = snapshots.filter((snapshot) => snapshot.mode === mode && snapshot.horizon === horizon);
      const scopedIds = new Set(scoped.map((snapshot) => snapshot.snapshot_id));
      const scopedReconciliations = reconciliations.filter((record) => scopedIds.has(record.snapshot_id));
      const built = buildPairs(scoped, scopedReconciliations, options);

      const diagnostics: EligibilityDiagnostic[] = [];
      const independentMetrics: Metrics[] = [];
      const metricDiagnostics: EvaluationSummary["metricDiagnostics"] = [];
      for (const identity of [BASELINE_IDENTITY, CANDIDATE_IDENTITY]) {
        const records: MetricInput[] = [];
        for (const snapshot of scoped) {
          if (!matchesIdentity(snapshot, identity)) continue;
          const result = eligibility(snapshot, reconciliationBySnapshot.get(snapshot.snapshot_id), {
            technicalFactCutoff: options.technicalFactCutoff ?? null,
            expectedIdentity: identity,
            duplicateSnapshotIds: duplicateIds,
            conflictedSnapshotIds: conflictedIds,
            mismatchedReconciliationIds: mismatchedIds,
            invalidReconciliationIds: invalidIds,
            pairIdentityConflictIds: pairConflictIds,
          });
          diagnostics.push({ snapshotId: snapshot.snapshot_id, mode: result.mode, horizon: result.horizon, eligibility: result.eligibility, reason: result.reason, warnings: result.warnings });
          if (result.eligibility !== "ELIGIBLE") continue;
          const reconciliation = reconciliationBySnapshot.get(snapshot.snapshot_id)!;
          records.push({ mode, horizon, modelId: identity.modelId, modelVersion: identity.modelVersion, forecast: snapshot.forecast_value as number, actual: reconciliation.actual });
        }
        const context: MetricsContext = { mode, horizon, modelId: identity.modelId, modelVersion: identity.modelVersion };
        const computed = computeMetrics(records, context);
        independentMetrics.push(computed.metrics);
        // C-15: сохраняется структурированная диагностика исключённых наблюдений
        metricDiagnostics.push({
          modelId: identity.modelId,
          excluded: computed.excluded,
          overflowNotes: computed.overflowNotes,
          excludedN: computed.metrics.excludedN,
          excludedOverflowN: computed.metrics.excludedOverflowN,
          overflowAffectedN: computed.metrics.overflowAffectedN,
          contextMismatchN: computed.metrics.contextMismatchN,
          nonFiniteN: computed.metrics.nonFiniteN,
          sampleStatus: computed.metrics.sampleStatus,
        });
      }

      const pairedBaseline: MetricInput[] = [];
      const pairedCandidate: MetricInput[] = [];
      for (const pair of built.pairs) {
        pairedBaseline.push({ mode, horizon, modelId: BASELINE_IDENTITY.modelId, modelVersion: BASELINE_IDENTITY.modelVersion, forecast: pair.baseline.forecast_value as number, actual: pair.actual });
        pairedCandidate.push({ mode, horizon, modelId: CANDIDATE_IDENTITY.modelId, modelVersion: CANDIDATE_IDENTITY.modelVersion, forecast: pair.candidate.forecast_value as number, actual: pair.actual });
      }
      const pairedBaselineMetrics = computeMetrics(pairedBaseline, { mode, horizon, modelId: BASELINE_IDENTITY.modelId, modelVersion: BASELINE_IDENTITY.modelVersion }).metrics;
      const pairedCandidateMetrics = computeMetrics(pairedCandidate, { mode, horizon, modelId: CANDIDATE_IDENTITY.modelId, modelVersion: CANDIDATE_IDENTITY.modelVersion }).metrics;
      const pairedN = built.pairs.length;
      // C-12: статус сравнения определяется доступностью обеих метрик и конечностью разницы, а не только наличием пар
      const maeBaselineValue = pairedN > 0 ? pairedBaselineMetrics.mae : null;
      const maeCandidateValue = pairedN > 0 ? pairedCandidateMetrics.mae : null;
      const deltaRaw = maeBaselineValue !== null && maeCandidateValue !== null ? maeBaselineValue - maeCandidateValue : null;
      const deltaMae = deltaRaw !== null && Number.isFinite(deltaRaw) ? deltaRaw : null;
      const comparisonOverflow = pairedN > 0 && (pairedBaselineMetrics.maeStatus === "OVERFLOW" || pairedCandidateMetrics.maeStatus === "OVERFLOW" || (deltaRaw !== null && !Number.isFinite(deltaRaw)));
      const comparisonAvailable = pairedN > 0 && maeBaselineValue !== null && maeCandidateValue !== null && deltaMae !== null;
      const comparisonStatus: MetricStatus = comparisonAvailable ? "OK" : pairedN === 0 ? "NOT_AVAILABLE" : comparisonOverflow ? "OVERFLOW" : "NOT_AVAILABLE";

      summaries.push({
        mode,
        horizon,
        independentMetrics,
        metricDiagnostics,
        pairedComparison: {
          available: comparisonAvailable,
          pairedN,
          maeBaseline: maeBaselineValue,
          maeCandidate: maeCandidateValue,
          deltaMae: comparisonAvailable ? deltaMae : null,
          status: comparisonStatus,
        },
        pairCounters: built.counters,
        eligibilityDiagnostics: diagnostics,
        conflicts: built.conflicts,
        unknownRecords: built.conflicts.unknownRecords,
        warnings: [...new Set(built.pairs.flatMap((pair) => pair.warnings))],
        semantics: "PROVISIONAL",
      });
    }
  }

  const counters = summaries.reduce((acc, summary) => {
    acc.baselineIndependentN += summary.pairCounters.baselineIndependentN;
    acc.candidateIndependentN += summary.pairCounters.candidateIndependentN;
    acc.pairedN += summary.pairCounters.pairedN;
    acc.excludedBaselineN += summary.pairCounters.excludedBaselineN;
    acc.excludedCandidateN += summary.pairCounters.excludedCandidateN;
    acc.unmatchedN += summary.pairCounters.unmatchedN;
    acc.conflictN += summary.pairCounters.conflictN;
    acc.pendingN += summary.pairCounters.pendingN;
    acc.missingActualN += summary.pairCounters.missingActualN;
    return acc;
  }, emptyCounters());
  counters.duplicateN = globalConflicts.duplicateSnapshotIds.length + globalConflicts.duplicateReconciliationIds.length;
  counters.unknownN = globalConflicts.unknownRecords.length;
  counters.unsupportedHorizonN = snapshots.filter((snapshot) => !isKnownHorizon(snapshot.horizon)).length;
  counters.orphanReconciliationN = globalConflicts.orphanReconciliations.length;
  counters.invalidReconciliationN = globalConflicts.invalidReconciliations.length;
  counters.pairIdentityConflictN = globalConflicts.pairIdentityConflicts.length;

  return { summaries, diagnostics: { counters, conflicts: globalConflicts, unknownRecords: globalConflicts.unknownRecords } };
}

/** Совместимость с UI-4.1: сводки по режимам и горизонтам (режимы не объединяются). */
export function summariesByMode(snapshots: readonly SnapshotLike[], reconciliations: readonly ReconciliationLike[], options: EvaluateOptions = {}): EvaluationSummary[] {
  return evaluate(snapshots, reconciliations, options).summaries;
}

/** Сводка для одного режима и горизонта. */
export function buildEvaluationSummary(mode: EvaluationMode, horizon: number, snapshots: readonly SnapshotLike[], reconciliations: readonly ReconciliationLike[], options: EvaluateOptions = {}): EvaluationSummary {
  const result = evaluate(snapshots, reconciliations, options);
  const found = result.summaries.find((summary) => summary.mode === mode && summary.horizon === horizon);
  if (found) return found;
  return {
    mode,
    horizon,
    independentMetrics: [
      computeMetrics([], { mode, horizon, modelId: BASELINE_IDENTITY.modelId, modelVersion: BASELINE_IDENTITY.modelVersion }).metrics,
      computeMetrics([], { mode, horizon, modelId: CANDIDATE_IDENTITY.modelId, modelVersion: CANDIDATE_IDENTITY.modelVersion }).metrics,
    ],
    pairedComparison: { available: false, pairedN: 0, maeBaseline: null, maeCandidate: null, deltaMae: null, status: "NOT_AVAILABLE" },
    pairCounters: result.diagnostics.counters,
    metricDiagnostics: [],
    eligibilityDiagnostics: [],
    conflicts: result.diagnostics.conflicts,
    unknownRecords: result.diagnostics.unknownRecords,
    warnings: [],
    semantics: "PROVISIONAL",
  };
}
