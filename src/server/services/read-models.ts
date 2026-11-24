/** UI-2: read-only read-models. Бизнес-логика прогнозирования не дублируется. */
import { resolve } from "node:path";

import { monitor, type MonitorReport } from "../../forecasting/shadow/pipeline";
import { storePaths } from "../../forecasting/shadow/store";
import { SourceError } from "../api";
import {
  readHistory,
  readManifest,
  readReconciliations,
  readShadowErrors,
  readSnapshots,
  shadowFileChecksums,
  SHADOW_DIR,
  SHOP_NO,
  SLICE_ID,
  TARGET_METRIC,
  TIMEZONE,
  type HistoryPoint,
} from "../sources";

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 120;

export function parseLimit(raw: string | undefined, fallback = DEFAULT_LIMIT): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new SourceError("INVALID_QUERY", `limit must be an integer between 1 and ${MAX_LIMIT}`, 400);
  }
  return value;
}

export function parseDate(raw: string | undefined, field: string): string | null {
  if (raw === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new SourceError("INVALID_QUERY", `${field} must be YYYY-MM-DD`, 400);
  // R4: проверка реальности календарной даты (2026-02-30 и 2026-99-99 отклоняются)
  const [year, month, day] = raw.split("-").map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new SourceError("INVALID_QUERY", `${field} is not a real calendar date`, 400);
  }
  return raw;
}

export interface HistoryModel {
  shopNo: string;
  metric: string;
  sliceId: number;
  timezone: string;
  totalPoints: number;
  returnedPoints: number;
  from: string | null;
  to: string | null;
  /** UI-3.1: границы запрошенного и фактически использованного диапазона. */
  requested: { from: string | null; to: string | null };
  available: { from: string; to: string };
  rangeClamped: boolean;
  points: HistoryPoint[];
  semantics: "PROVISIONAL";
  /** UI-3: агрегаты считаются только по доступным значениям выбранного периода. */
  summary: {
    sum: number;
    average: number;
    max: number;
    min: number;
    calendarDays: number;
    observationDays: number;
    missingDays: number;
    complete: boolean;
    /** UI-3.1: true, если ответ обрезан параметром limit (агрегаты при этом по всему диапазону). */
    truncated: boolean;
    formula: string;
  };
}

export async function historyModel(query: { from?: string; to?: string; limit?: string }): Promise<{ model: HistoryModel; checksum: string; fileChecksum: string }> {
  const from = parseDate(query.from, "from");
  const to = parseDate(query.to, "to");
  if (from && to && from > to) throw new SourceError("INVALID_QUERY", "from must not exceed to", 400);
  const limit = parseLimit(query.limit, DEFAULT_LIMIT);
  const { points, fileChecksum, normalizedChecksum } = await readHistory();
  // UI-3.1: границы доступной истории.
  // Полностью непересекающийся диапазон отклоняется; частично выходящий за границы принимается,
  // но календарные дни считаются по запросу, поэтому дни без данных попадают в missingDays.
  const availableFrom = points[0]!.date;
  const availableTo = points.at(-1)!.date;
  const requestedFrom = from ?? availableFrom;
  const requestedTo = to ?? availableTo;
  const intersects = requestedTo >= availableFrom && requestedFrom <= availableTo;
  if (!intersects) {
    throw new SourceError("RANGE_OUT_OF_BOUNDS", `range must intersect ${availableFrom}..${availableTo}`, 400);
  }
  const windowFrom = requestedFrom < availableFrom ? availableFrom : requestedFrom;
  const windowTo = requestedTo > availableTo ? availableTo : requestedTo;
  const rangeClamped = windowFrom !== requestedFrom || windowTo !== requestedTo;
  const filtered = points.filter((point) => point.date >= windowFrom && point.date <= windowTo);
  const slice = filtered.slice(-limit);
  // UI-3: агрегаты — только по доступным значениям; календарные дни считаются по диапазону,
  // а не по найденным точкам, иначе неполный период выглядел бы полным.
  // UI-3.1: агрегаты считаются по всему выбранному диапазону, а не по обрезанной limit-выборке
  const values = filtered.map((point) => point.value).filter((value) => Number.isFinite(value));
  const sum = values.reduce((acc, value) => acc + value, 0);
  const calendarDays = daysBetween(requestedFrom, requestedTo);
  const summary = {
    sum,
    average: values.length ? sum / values.length : 0,
    max: values.length ? Math.max(...values) : 0,
    min: values.length ? Math.min(...values) : 0,
    calendarDays,
    observationDays: values.length,
    missingDays: Math.max(calendarDays - values.length, 0),
    complete: calendarDays === values.length,
    truncated: slice.length < filtered.length,
    formula: "sum/avg/max/min — по доступным фактическим значениям диапазона; calendarDays — календарные дни запрошенного диапазона; missingDays = calendarDays − observationDays (включая дни за границами доступной истории)",
  };
  return {
    model: {
      shopNo: SHOP_NO,
      metric: TARGET_METRIC,
      sliceId: SLICE_ID,
      timezone: TIMEZONE,
      totalPoints: points.length,
      returnedPoints: slice.length,
      from: slice[0]?.date ?? null,
      to: slice.at(-1)?.date ?? null,
      requested: { from, to },
      available: { from: availableFrom, to: availableTo },
      rangeClamped,
      points: slice,
      semantics: "PROVISIONAL",
      summary,
    },
    checksum: normalizedChecksum,
    fileChecksum,
  };
}

export interface CoverageModel {
  firstDate: string | null;
  lastDate: string | null;
  days: number;
  gaps: number;
  duplicateDates: number;
  nullValues: number;
  nullPolicy: "REJECTED_AS_CORRUPTED";
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  /** UI-3: календарная сетка строится в read-model; отсутствующие значения не подменяются. */
  missingDates: string[];
  gapIntervals: Array<{ from: string; to: string; length: number }>;
  maxGapLength: number;
  fillRatio: number;
  fillRatioFormula: string;
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

export async function coverageModel(): Promise<CoverageModel> {
  const { points } = await readHistory();
  if (!points.length) {
    return { firstDate: null, lastDate: null, days: 0, gaps: 0, duplicateDates: 0, nullValues: 0, nullPolicy: "REJECTED_AS_CORRUPTED", completeness: "UNKNOWN", missingDates: [], gapIntervals: [], maxGapLength: 0, fillRatio: 0, fillRatioFormula: "observationDays / calendarDays" };
  }
  const first = points[0]!.date;
  const last = points.at(-1)!.date;
  const unique = new Set(points.map((point) => point.date));
  const gaps = Math.max(daysBetween(first, last) - unique.size, 0);
  // R8: nullValues — только точки, где значение не является конечным числом (отсутствие данных не превращается в 0)
  const nullValues = points.filter((point) => point.value === null || point.value === undefined || !Number.isFinite(point.value)).length;
  // UI-3: календарная сетка и интервалы пропусков (без записи в источник)
  const missingDates: string[] = [];
  for (let time = Date.parse(`${first}T00:00:00Z`); time <= Date.parse(`${last}T00:00:00Z`); time += 86_400_000) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (!unique.has(date)) missingDates.push(date);
  }
  const gapIntervals: Array<{ from: string; to: string; length: number }> = [];
  for (const date of missingDates) {
    const previous = gapIntervals.at(-1);
    const expectedNext = previous ? new Date(Date.parse(`${previous.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : null;
    if (previous && expectedNext === date) {
      previous.to = date;
      previous.length += 1;
    } else {
      gapIntervals.push({ from: date, to: date, length: 1 });
    }
  }
  const calendarDays = daysBetween(first, last);
  return {
    firstDate: first,
    lastDate: last,
    days: unique.size,
    gaps,
    duplicateDates: points.length - unique.size,
    nullValues,
    // R8: NULL/нечисловое значение в canonical CSV отклоняется как повреждение источника,
    // поэтому nullValues при нормальной работе всегда 0 — это политика, а не пропуск полноты.
    nullPolicy: "REJECTED_AS_CORRUPTED",
    completeness: gaps === 0 && nullValues === 0 ? "COMPLETE" : "PARTIAL",
    missingDates,
    gapIntervals,
    maxGapLength: gapIntervals.reduce((acc, interval) => Math.max(acc, interval.length), 0),
    fillRatio: calendarDays ? unique.size / calendarDays : 0,
    fillRatioFormula: "observationDays / calendarDays (дни с фактическими значениями ÷ календарные дни)",
  };
}

export interface ShadowModeTotals { snapshots: number; pending: number; reconciled: number; fallbacks: number; invalids: number }

export interface ShadowForecastsModel {
  /** Агрегаты только для выбранного режима (по умолчанию shadow). */
  totals: ShadowModeTotals;
  /** Раздельные агрегаты по режимам: shadow и replay никогда не суммируются. */
  modeTotals: { shadow: ShadowModeTotals; replay: ShadowModeTotals };
  errors: number;
  /** R3: ошибки классифицируются по режиму; общие ошибки не выдаются за shadow-ошибки. */
  errorsByMode: { shadow: number; replay: number; unknown: number };
  conflicts: number;
  manifestStatus: "OK" | "NOT_AVAILABLE" | "CORRUPTED";
  horizons: number[];
  models: string[];
  modes: string[];
  manifest: { version: string; datasetChecksum: string; horizons: number[] } | null;
  checksums: Record<string, string>;
  items: Array<{ snapshotId: string; mode: string; modelId: string; modelVersion: string; variant: string | null; horizon: number; originDate: string; targetDate: string; forecastValue: number | null; status: string; inputDataVersion: string; generatedAt: string }>;
}

export async function shadowForecastsModel(query: { horizon?: string; mode?: string; limit?: string }): Promise<ShadowForecastsModel> {
  const limit = parseLimit(query.limit, 60);
  const snapshots = await readSnapshots();
  const reconciliations = await readReconciliations();
  const errors = await readShadowErrors();
  const manifestResult = await readManifest();
  const checksums = await shadowFileChecksums();
  const horizon = query.horizon === undefined ? null : Number(query.horizon);
  if (horizon !== null && ![1, 3].includes(horizon)) throw new SourceError("INVALID_QUERY", "horizon must be 1 or 3", 400);
  // R3: по умолчанию только реальные shadow-наблюдения; replay — отдельное представление
  const mode = query.mode ?? "shadow";
  if (!["shadow", "replay"].includes(mode)) throw new SourceError("INVALID_QUERY", "mode must be shadow or replay", 400);
  const reconciledIds = new Set(reconciliations.map((record) => record.snapshot_id));
  const filtered = snapshots.filter((snapshot) => (horizon === null || snapshot.horizon === horizon) && snapshot.mode === mode);
  const items = filtered.slice(-limit).map((snapshot) => ({
    snapshotId: snapshot.snapshot_id,
    mode: snapshot.mode,
    modelId: snapshot.model_id,
    modelVersion: snapshot.model_version,
    variant: snapshot.variant,
    horizon: snapshot.horizon,
    originDate: snapshot.origin_date,
    targetDate: snapshot.target_date,
    forecastValue: snapshot.forecast_value,
    status: snapshot.status,
    inputDataVersion: snapshot.input_data_version,
    generatedAt: snapshot.generated_at,
  }));
  const totalsFor = (modeName: "shadow" | "replay"): ShadowModeTotals => {
    const subset = snapshots.filter((snapshot) => snapshot.mode === modeName);
    return {
      snapshots: subset.length,
      pending: subset.filter((snapshot) => !reconciledIds.has(snapshot.snapshot_id)).length,
      reconciled: subset.filter((snapshot) => reconciledIds.has(snapshot.snapshot_id)).length,
      fallbacks: subset.filter((snapshot) => snapshot.status === "FALLBACK").length,
      invalids: subset.filter((snapshot) => snapshot.status === "INVALID").length,
    };
  };
  return {
    totals: totalsFor(mode as "shadow" | "replay"),
    modeTotals: { shadow: totalsFor("shadow"), replay: totalsFor("replay") },
    errors: errors.length,
    errorsByMode: {
      shadow: errors.filter((error) => error.mode === "shadow").length,
      replay: errors.filter((error) => error.mode === "replay").length,
      unknown: errors.filter((error) => error.mode !== "shadow" && error.mode !== "replay").length,
    },
    conflicts: errors.filter((error) => error.code === "SNAPSHOT_CONFLICT").length,
    manifestStatus: manifestResult.status,
    horizons: [1, 3],
    models: ["rolling_7_day_mean", "adaptive_baseline"],
    modes: ["shadow", "replay"],
    manifest: manifestResult.manifest ? { version: manifestResult.manifest.version, datasetChecksum: manifestResult.manifest.dataset_checksum, horizons: manifestResult.manifest.horizons } : null,
    checksums,
    items,
  };
}

export interface ReconciliationModel {
  total: number;
  items: Array<{ snapshotId: string; modelId: string; horizon: number; targetDate: string; forecastValue: number | null; actual: number; absoluteError: number; signedError: number }>;
}

export async function reconciliationsModel(query: { limit?: string; horizon?: string; mode?: string }, dir?: string): Promise<ReconciliationModel & { mode: "shadow" | "replay"; unknownSnapshots: number }> {
  const limit = parseLimit(query.limit, 60);
  const horizon = query.horizon === undefined ? null : Number(query.horizon);
  if (horizon !== null && ![1, 3].includes(horizon)) throw new SourceError("INVALID_QUERY", "horizon must be 1 or 3", 400);
  const mode = query.mode ?? "shadow";
  if (!["shadow", "replay"].includes(mode)) throw new SourceError("INVALID_QUERY", "mode must be shadow or replay", 400);
  const snapshots = await readSnapshots(dir);
  const modeBySnapshot = new Map(snapshots.map((snapshot) => [snapshot.snapshot_id, snapshot.mode]));
  const records = await readReconciliations(dir);
  // R3: reconciliation без известного snapshot не классифицируется как shadow и исключается
  const knownRecords = records.filter((record) => modeBySnapshot.has(record.snapshot_id));
  const unknownSnapshots = records.length - knownRecords.length;
  const filtered = knownRecords.filter((record) => (horizon === null || record.horizon === horizon) && modeBySnapshot.get(record.snapshot_id) === mode);
  return {
    mode: mode as "shadow" | "replay",
    unknownSnapshots,
    total: filtered.length,
    items: filtered.slice(-limit).map((record) => ({
      snapshotId: record.snapshot_id,
      modelId: record.model_id,
      horizon: record.horizon,
      targetDate: record.target_date,
      forecastValue: record.forecast_value,
      actual: record.actual,
      absoluteError: record.absolute_error,
      signedError: record.signed_error,
    })),
  };
}

/** Диагностика считается существующим read-only monitor(); запись не выполняется. */
export async function monitorModel(): Promise<MonitorReport> {
  const { points } = await readHistory();
  return monitor(points, storePaths(resolve(SHADOW_DIR)), new Date().toISOString());
}

export interface OverviewModel {
  shopNo: string;
  timezone: string;
  metric: string;
  sliceId: number;
  semantics: "PROVISIONAL";
  history: { days: number; firstDate: string | null; lastDate: string | null; lastValue: number | null; checksum: string; fileChecksum: string; completeness: string };
  provenance: { normalizedChecksum: string; fileChecksum: string; manifestDatasetChecksum: string | null; manifestStatus: string; freshness: "MATCH" | "STALE" | "NOT_CONFIRMED" };
  shadow: ShadowModeTotals & { candidate: string; baseline: string; horizons: number[]; available: boolean };
  replay: ShadowModeTotals & { available: boolean };
}

export async function overviewModel(): Promise<OverviewModel> {
  const { points, fileChecksum, normalizedChecksum } = await readHistory();
  const coverage = await coverageModel();
  const snapshots = await readSnapshots();
  const reconciliations = await readReconciliations();
  const errors = await readShadowErrors();
  const reconciledIds = new Set(reconciliations.map((record) => record.snapshot_id));
  const manifestResult = await readManifest();
  const modeTotalsFor = (modeName: "shadow" | "replay"): ShadowModeTotals => {
    const subset = snapshots.filter((snapshot) => snapshot.mode === modeName);
    return {
      snapshots: subset.length,
      pending: subset.filter((snapshot) => !reconciledIds.has(snapshot.snapshot_id)).length,
      reconciled: subset.filter((snapshot) => reconciledIds.has(snapshot.snapshot_id)).length,
      fallbacks: subset.filter((snapshot) => snapshot.status === "FALLBACK").length,
      invalids: subset.filter((snapshot) => snapshot.status === "INVALID").length,
    };
  };
  const last = points.at(-1) ?? null;
  // R12: соответствие фактов и manifest не объявляется автоматически актуальным
  const freshness: "MATCH" | "STALE" | "NOT_CONFIRMED" =
    manifestResult.status !== "OK" || !manifestResult.manifest
      ? "NOT_CONFIRMED"
      : manifestResult.manifest.dataset_checksum === normalizedChecksum
        ? "MATCH"
        : "STALE";
  return {
    shopNo: SHOP_NO,
    timezone: TIMEZONE,
    metric: TARGET_METRIC,
    sliceId: SLICE_ID,
    semantics: "PROVISIONAL",
    history: {
      days: coverage.days,
      firstDate: coverage.firstDate,
      lastDate: coverage.lastDate,
      lastValue: last ? last.value : null,
      checksum: normalizedChecksum,
      fileChecksum,
      completeness: coverage.completeness,
    },
    provenance: {
      normalizedChecksum,
      fileChecksum,
      manifestDatasetChecksum: manifestResult.manifest?.dataset_checksum ?? null,
      manifestStatus: manifestResult.status,
      freshness,
    },
    shadow: { ...modeTotalsFor("shadow"), candidate: "adaptive_baseline/v1+variantB", baseline: "rolling-7-day-mean/v1", horizons: [1, 3], available: modeTotalsFor("shadow").snapshots > 0 },
    replay: { ...modeTotalsFor("replay"), available: modeTotalsFor("replay").snapshots > 0 },
  };
}