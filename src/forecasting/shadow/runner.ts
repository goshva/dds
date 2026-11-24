/**
 * Stage 3.4.8 — Shadow Mode: генерация снапшотов (replay и shadow).
 *
 * replay — историческое воспроизведение: origins по истории, target имеет факт;
 * shadow — прогноз на будущие даты от последней доступной даты, факта пока нет.
 *
 * Baseline (rolling_7_day_mean) и Variant B считаются независимо: ошибка Variant B
 * не влияет на baseline, baseline не заменяется значением Variant B.
 */

import { calculateForVariant } from "../analytics/adaptive-baseline/calculator";
import {
  appendSnapshot,
  inputDataVersion,
  MODEL_VERSIONS,
  snapshotId,
  type ModelId,
  type ShadowMode,
  type ShadowSnapshot,
  type SnapshotStatus,
  type StorePaths,
} from "./store";

export const SHADOW_HORIZONS = [1, 3] as const;
export const SHADOW_MIN_TRAIN = 28;
export const SHADOW_ALPHA = 1.0;
export const SHADOW_LIMIT_PERCENT = 0.1;

export interface HistoryRow {
  date: string;
  value: number;
}

function rolling7(history: readonly HistoryRow[]): number {
  const window = history.slice(-7);
  return window.reduce((acc, row) => acc + row.value, 0) / window.length;
}

export interface RunOptions {
  mode: ShadowMode;
  runId: string;
  datasetChecksum: string;
  generatedAt: string;
  store: StorePaths;
  /** Для replay — сколько последних origin обрабатывать (по умолчанию все). */
  limit?: number;
  /** Для replay: исключить эти даты из origins (например, чтобы не дублировать shadow). */
  fromDate?: string;
}

export interface RunSummary {
  mode: ShadowMode;
  runId: string;
  forecasts: number;
  written: number;
  noop: number;
  conflicts: number;
  fallbacks: number;
  invalids: number;
  pendingActual: number;
  errors: Array<{ code: string; message: string }>;
}

function buildSnapshot(input: {
  mode: ShadowMode;
  runId: string;
  datasetChecksum: string;
  generatedAt: string;
  modelId: ModelId;
  horizon: 1 | 3;
  originDate: string;
  targetDate: string;
  history: readonly HistoryRow[];
  forecastValue: number | null;
  status: SnapshotStatus;
  fallbackReason: string | null;
}): ShadowSnapshot {
  const modelVersion = MODEL_VERSIONS[input.modelId];
  const dataVersion = inputDataVersion(input.history);
  return {
    snapshot_id: snapshotId({
      modelId: input.modelId,
      modelVersion,
      horizon: input.horizon,
      originDate: input.originDate,
      targetDate: input.targetDate,
      inputDataVersion: dataVersion,
    }),
    run_id: input.runId,
    mode: input.mode,
    model_id: input.modelId,
    model_version: modelVersion,
    variant: input.modelId === "adaptive_baseline" ? "B" : null,
    horizon: input.horizon,
    origin_date: input.originDate,
    target_date: input.targetDate,
    forecast_value: input.forecastValue,
    status: input.status,
    fallback_reason: input.fallbackReason,
    input_data_version: dataVersion,
    dataset_checksum: input.datasetChecksum,
    generated_at: input.generatedAt,
  };
}

function originIndices(rows: readonly HistoryRow[], mode: ShadowMode, limit?: number): number[] {
  const result: number[] = [];
  if (mode === "shadow") {
    // прогноз от последней доступной даты: target ещё не подтверждён
    const last = rows.length - 1;
    if (last >= SHADOW_MIN_TRAIN - 1) result.push(last);
    return result;
  }
  for (let index = SHADOW_MIN_TRAIN - 1; index < rows.length; index++) {
    // target для каждого горизонта должен существовать в истории (иначе это не replay)
    if (index + Math.max(...SHADOW_HORIZONS) >= rows.length) continue;
    result.push(index);
  }
  return limit ? result.slice(-limit) : result;
}

export async function runShadowMode(rows: readonly HistoryRow[], options: RunOptions): Promise<RunSummary> {
  const summary: RunSummary = { mode: options.mode, runId: options.runId, forecasts: 0, written: 0, noop: 0, conflicts: 0, fallbacks: 0, invalids: 0, pendingActual: 0, errors: [] };
  const indices = originIndices(rows, options.mode, options.limit);

  for (const index of indices) {
    const origin = rows[index]!;
    const history = rows.slice(0, index + 1);
    const baseline = rolling7(history);
    for (const horizon of SHADOW_HORIZONS) {
      const targetIndex = index + horizon;
      const target = rows[targetIndex];
      const targetDate = target?.date ?? addDays(origin.date, horizon);

      // fail-closed: неконечный baseline не сохраняется как прогноз
      if (!Number.isFinite(baseline)) {
        summary.invalids++;
        summary.errors.push({ code: "NON_FINITE_BASELINE", message: `baseline для ${origin.date} не конечен` });
        continue;
      }

      const baselineSnapshot = buildSnapshot({
        mode: options.mode,
        runId: options.runId,
        datasetChecksum: options.datasetChecksum,
        generatedAt: options.generatedAt,
        modelId: "rolling_7_day_mean",
        horizon,
        originDate: origin.date,
        targetDate,
        history,
        forecastValue: baseline,
        status: "OK",
        fallbackReason: null,
      });
      const baselineAppend = await appendSnapshot(options.store, baselineSnapshot);
      summary.forecasts++;
      if (baselineAppend.conflict) { summary.conflicts++; summary.errors.push({ code: "SNAPSHOT_CONFLICT", message: baselineAppend.reason }); }
      else if (baselineAppend.written) summary.written++;
      else summary.noop++;

      const variantB = calculateForVariant("B", {
        originDate: origin.date,
        targetDate,
        history,
        baselineForecast: baseline,
        alpha: SHADOW_ALPHA,
        limitPercent: SHADOW_LIMIT_PERCENT,
      });

      const status: SnapshotStatus = variantB.status === "OK" && variantB.applied ? "OK" : variantB.status === "INVALID_INPUT" || variantB.status === "FUTURE_DATA_DETECTED" || variantB.status === "DUPLICATE_DATE" || variantB.status === "NON_FINITE_VALUE" ? "INVALID" : "FALLBACK";
      const shadowSnapshot = buildSnapshot({
        mode: options.mode,
        runId: options.runId,
        datasetChecksum: options.datasetChecksum,
        generatedAt: options.generatedAt,
        modelId: "adaptive_baseline",
        horizon,
        originDate: origin.date,
        targetDate,
        history,
        forecastValue: variantB.correctedForecast,
        status,
        fallbackReason: status === "OK" ? null : variantB.diagnostics.message,
      });
      const shadowAppend = await appendSnapshot(options.store, shadowSnapshot);
      summary.forecasts++;
      if (shadowAppend.conflict) { summary.conflicts++; summary.errors.push({ code: "SNAPSHOT_CONFLICT", message: shadowAppend.reason }); }
      else if (shadowAppend.written) summary.written++;
      else summary.noop++;
      if (status === "FALLBACK") summary.fallbacks++;
      if (status === "INVALID") summary.invalids++;

      if (options.mode === "shadow") summary.pendingActual++;
    }
  }
  return summary;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}