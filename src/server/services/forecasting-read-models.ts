/**
 * UI-4.2.1 — read-model прогнозной аналитики.
 *
 * Тонкий слой между read-only источниками Shadow Mode и Evaluation Core UI-4.1:
 * читает существующими fail-closed функциями, вызывает `evaluate()`, формирует DTO.
 * Метрики не пересчитываются, формулы не дублируются, `monitor()` не используется.
 */

import { evaluate, type EvaluationSummary, type Metrics, type PairCounters } from "../forecast-evaluation";
import { readHistory, readManifest, readReconciliations, readSnapshots, shadowFileChecksums, SHADOW_DIR } from "../sources";
import { SourceError } from "../api";

export type EvaluationModeDto = "replay" | "shadow";
export type InterpretabilityStatus = "NOT_AVAILABLE" | "INSUFFICIENT" | "LIMITED" | "NOT_ASSESSED";

export interface ForecastProvenanceDto {
  datasetChecksums: string[];
  datasetVersionWarning: boolean;
  manifestStatus: "OK" | "NOT_AVAILABLE" | "CORRUPTED";
  manifestDatasetChecksum: string | null;
  freshness: "MATCH" | "STALE" | "NOT_CONFIRMED";
  shadowFileChecksums: Record<string, string>;
}

export interface AvailabilityDto {
  available: boolean;
  reason: string | null;
}

export interface ForecastsQualityDto {
  mode: EvaluationModeDto;
  horizon: number;
  semantics: "PROVISIONAL";
  technicalFactCutoff: string | null;
  independentMetrics: Metrics[];
  pairedComparison: EvaluationSummary["pairedComparison"];
  pairCounters: PairCounters;
  metricDiagnostics: EvaluationSummary["metricDiagnostics"];
  sampleStatus: "COMPLETE" | "PARTIAL" | "NOT_AVAILABLE";
  interpretabilityStatus: InterpretabilityStatus;
  warnings: string[];
  provenance: ForecastProvenanceDto;
  availability: AvailabilityDto;
}

export interface ForecastItemDto {
  snapshotId: string;
  mode: string;
  modelId: string;
  modelVersion: string;
  variant: string | null;
  horizon: number;
  originDate: string;
  targetDate: string;
  forecastValue: number | null;
  status: string;
  inputDataVersion: string;
  generatedAt: string;
}

export interface ForecastsListDto {
  mode: EvaluationModeDto;
  horizon: number;
  total: number;
  returned: number;
  items: ForecastItemDto[];
  provenance: ForecastProvenanceDto;
}

export interface ForecastErrorItemDto {
  source: "persisted" | "detected";
  kind: string;
  snapshotId: string | null;
  recordType: "snapshot" | "reconciliation" | "file";
  reason: string;
}

export interface ForecastErrorsDto {
  mode: EvaluationModeDto;
  total: number;
  persistedErrorsAvailable: boolean;
  items: ForecastErrorItemDto[];
}

/** Валидация обязательных query-параметров: значения по умолчанию не смешивают режимы. */
export function parseEvaluationMode(raw: string | undefined): EvaluationModeDto {
  if (raw === undefined) throw new SourceError("INVALID_QUERY", "mode is required and must be replay or shadow", 400);
  if (raw !== "replay" && raw !== "shadow") throw new SourceError("INVALID_QUERY", "mode must be replay or shadow", 400);
  return raw;
}

export function parseEvaluationHorizon(raw: string | undefined): number {
  if (raw === undefined) throw new SourceError("INVALID_QUERY", "horizon is required and must be 1 or 3", 400);
  const value = Number(raw);
  if (value !== 1 && value !== 3) throw new SourceError("INVALID_QUERY", "horizon must be 1 or 3", 400);
  return value;
}

export function parseOptionalBoolean(raw: string | undefined, field: string): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new SourceError("INVALID_QUERY", `${field} must be true or false`, 400);
}

export function parseOptionalModel(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (raw !== "rolling_7_day_mean" && raw !== "adaptive_baseline") throw new SourceError("INVALID_QUERY", "model must be rolling_7_day_mean or adaptive_baseline", 400);
  return raw;
}

/** Статус интерпретируемости не смешивается с полнотой выборки и не вводит произвольный порог. */
export function interpretabilityOf(pairedN: number): InterpretabilityStatus {
  if (pairedN === 0) return "NOT_AVAILABLE";
  if (pairedN === 1) return "INSUFFICIENT";
  return "LIMITED";
}

function provenanceOf(datasetChecksums: string[], manifest: Awaited<ReturnType<typeof readManifest>>, normalizedChecksum: string, checksums: Record<string, string>): ForecastProvenanceDto {
  const unique = [...new Set(datasetChecksums.filter((value): value is string => typeof value === "string" && value.length > 0))].sort();
  const manifestDatasetChecksum = manifest.manifest?.dataset_checksum ?? null;
  const freshness: ForecastProvenanceDto["freshness"] =
    manifest.status !== "OK" || !manifestDatasetChecksum ? "NOT_CONFIRMED" : manifestDatasetChecksum === normalizedChecksum ? "MATCH" : "STALE";
  return {
    datasetChecksums: unique,
    datasetVersionWarning: unique.length > 1,
    manifestStatus: manifest.status,
    manifestDatasetChecksum,
    freshness,
    shadowFileChecksums: checksums,
  };
}

async function loadContext(dir: string) {
  const [snapshots, reconciliations, manifest, history, checksums] = await Promise.all([
    readSnapshots(dir),
    readReconciliations(dir),
    readManifest(dir),
    readHistory(),
    shadowFileChecksums(),
  ]);
  const technicalFactCutoff = history.points.length ? history.points[history.points.length - 1]!.date : null;
  const result = evaluate(snapshots, reconciliations, { technicalFactCutoff });
  return { snapshots, reconciliations, manifest, technicalFactCutoff, normalizedChecksum: history.normalizedChecksum, checksums, result };
}

export async function forecastsQualityModel(params: { mode: EvaluationModeDto; horizon: number; paired?: boolean }, dir: string = SHADOW_DIR): Promise<ForecastsQualityDto> {
  const context = await loadContext(dir);
  const summary = context.result.summaries.find((entry) => entry.mode === params.mode && entry.horizon === params.horizon) ?? null;
  const scoped = context.snapshots.filter((snapshot) => snapshot.mode === params.mode && snapshot.horizon === params.horizon);
  const provenance = provenanceOf(scoped.map((snapshot) => snapshot.dataset_checksum), context.manifest, context.normalizedChecksum, context.checksums);

  if (!summary) {
    return {
      mode: params.mode,
      horizon: params.horizon,
      semantics: "PROVISIONAL",
      technicalFactCutoff: context.technicalFactCutoff,
      independentMetrics: [],
      pairedComparison: { available: false, pairedN: 0, maeBaseline: null, maeCandidate: null, deltaMae: null, status: "NOT_AVAILABLE" },
      pairCounters: context.result.diagnostics.counters,
      metricDiagnostics: [],
      sampleStatus: "NOT_AVAILABLE",
      interpretabilityStatus: "NOT_ASSESSED",
      warnings: provenance.datasetVersionWarning ? ["DATASET_VERSION_DIFFERS"] : [],
      provenance,
      availability: { available: false, reason: "NO_RECORDS_FOR_MODE_AND_HORIZON" },
    };
  }

  const sampleStatus = summary.independentMetrics.some((metric) => metric.sampleStatus === "PARTIAL") ? "PARTIAL" : summary.independentMetrics.length ? "COMPLETE" : "NOT_AVAILABLE";
  const pairedN = params.paired ? summary.pairedComparison.pairedN : summary.pairedComparison.pairedN;
  const warnings = [...summary.warnings.map(String)];
  if (provenance.datasetVersionWarning && !warnings.includes("DATASET_VERSION_DIFFERS")) warnings.push("DATASET_VERSION_DIFFERS");
  if (summary.pairCounters.pendingN > 0) warnings.push("PENDING_OBSERVATIONS_PRESENT");

  return {
    mode: params.mode,
    horizon: params.horizon,
    semantics: "PROVISIONAL",
    technicalFactCutoff: context.technicalFactCutoff,
    independentMetrics: summary.independentMetrics,
    pairedComparison: summary.pairedComparison,
    pairCounters: summary.pairCounters,
    metricDiagnostics: summary.metricDiagnostics,
    sampleStatus,
    interpretabilityStatus: interpretabilityOf(pairedN),
    warnings,
    provenance,
    availability: { available: true, reason: null },
  };
}

export async function forecastsListModel(params: { mode: EvaluationModeDto; horizon: number; model?: string; limit?: number }, dir: string = SHADOW_DIR): Promise<ForecastsListDto> {
  const context = await loadContext(dir);
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 1000);
  const scoped = context.snapshots.filter((snapshot) => snapshot.mode === params.mode && snapshot.horizon === params.horizon && (!params.model || snapshot.model_id === params.model));
  const items = scoped.slice(-limit).map((snapshot) => ({
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
  return {
    mode: params.mode,
    horizon: params.horizon,
    total: scoped.length,
    returned: items.length,
    items,
    provenance: provenanceOf(scoped.map((snapshot) => snapshot.dataset_checksum), context.manifest, context.normalizedChecksum, context.checksums),
  };
}

/**
 * Диагностика ошибок. `errors.jsonl` отсутствует — это не означает отсутствие ошибок,
 * поэтому источником служит вычисленная ядром диагностика (unknown/conflicts/orphan),
 * а персистентные ошибки помечаются как недоступные.
 */
export async function forecastErrorsModel(params: { mode: EvaluationModeDto; code?: string; limit?: number }, dir: string = SHADOW_DIR): Promise<ForecastErrorsDto> {
  const context = await loadContext(dir);
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 1000);
  const scopedIds = new Set(context.snapshots.filter((snapshot) => snapshot.mode === params.mode).map((snapshot) => snapshot.snapshot_id));
  const items: ForecastErrorItemDto[] = [];
  for (const record of context.result.diagnostics.unknownRecords) {
    if (record.recordType === "snapshot" && record.snapshotId && !scopedIds.has(record.snapshotId)) continue;
    items.push({ source: "detected", kind: record.kind, snapshotId: record.snapshotId, recordType: record.recordType, reason: record.reason });
  }
  for (const conflict of context.result.diagnostics.conflicts.pairIdentityConflicts) {
    for (const snapshotId of conflict.snapshotIds) {
      if (!scopedIds.has(snapshotId)) continue;
      items.push({ source: "detected", kind: "CONFLICT_PAIR_IDENTITY", snapshotId, recordType: "snapshot", reason: `${conflict.participant}:${conflict.pairIdentity}` });
    }
  }
  for (const mismatch of context.result.diagnostics.conflicts.reconciliationMismatches) {
    if (!scopedIds.has(mismatch.snapshotId)) continue;
    items.push({ source: "detected", kind: "CONFLICT_RECONCILIATION", snapshotId: mismatch.snapshotId, recordType: "reconciliation", reason: mismatch.field });
  }
  const filtered = params.code ? items.filter((item) => item.kind === params.code) : items;
  return {
    mode: params.mode,
    total: filtered.length,
    persistedErrorsAvailable: false,
    items: filtered.slice(0, limit),
  };
}

/** Проверка целостности источника: повреждение JSONL → fail-closed (SourceError → 503). */
export function assertSourceHealthy(checksums: Record<string, string>): void {
  if (checksums.forecasts === "NOT_AVAILABLE") throw new SourceError("SOURCE_NOT_AVAILABLE", "Shadow forecasts storage is not available");
}
