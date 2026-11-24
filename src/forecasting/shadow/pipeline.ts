/**
 * Stage 3.4.8 — Shadow Mode: сопоставление прогнозов с фактом и мониторинг.
 *
 * Reconciliation только читает снапшоты и пишет отдельные записи со ссылкой на snapshot_id.
 * Прогнозы никогда не изменяются. Будущие даты и неподтверждённые факты в оценку не попадают;
 * отсутствующий факт не превращается в ноль.
 */

import {
  appendJsonl,
  isReconciliationRecord,
  isShadowErrorRecord,
  isSnapshotRecord,
  readJsonl,
  type ModelId,
  type ReconciliationRecord,
  type ShadowError,
  type ShadowSnapshot,
  type StorePaths,
} from "./store";
import type { HistoryRow } from "./runner";

export interface ReconcileSummary {
  runId: string;
  snapshots: number;
  reconciled: number;
  skipped: number;
  pendingFuture: number;
  missingActual: number;
  newRecords: number;
  errors: number;
}

function lastConfirmedDate(rows: readonly HistoryRow[]): string | null {
  return rows.length ? rows[rows.length - 1]!.date : null;
}

export async function reconcile(rows: readonly HistoryRow[], store: StorePaths, runId: string, reconciledAt: string): Promise<ReconcileSummary> {
  const snapshots = await readJsonl<ShadowSnapshot>(store.forecasts, isSnapshotRecord);
  const existing = new Set((await readJsonl<ReconciliationRecord>(store.reconciliations, isReconciliationRecord)).map((record) => record.snapshot_id));
  const actualByDate = new Map(rows.map((row) => [row.date, row.value]));
  const lastDate = lastConfirmedDate(rows);
  const summary: ReconcileSummary = { runId, snapshots: snapshots.length, reconciled: 0, skipped: 0, pendingFuture: 0, missingActual: 0, newRecords: 0, errors: 0 };

  for (const snapshot of snapshots) {
    if (snapshot.forecast_value === null) { summary.skipped++; continue; }
    if (lastDate === null || snapshot.target_date > lastDate) { summary.pendingFuture++; continue; }
    const actual = actualByDate.get(snapshot.target_date);
    if (actual === undefined) {
      summary.missingActual++;
      await appendJsonl(store.errors, {
        run_id: runId,
        mode: snapshot.mode,
        code: "MISSING_ACTUAL",
        message: `факт для ${snapshot.target_date} отсутствует в наборе`,
        origin_date: snapshot.origin_date,
        target_date: snapshot.target_date,
        model_id: snapshot.model_id,
        horizon: snapshot.horizon,
        created_at: reconciledAt,
      } satisfies ShadowError);
      summary.errors++;
      continue;
    }
    if (snapshot.target_date <= snapshot.origin_date) {
      summary.skipped++;
      continue;
    }
    summary.reconciled++;
    if (existing.has(snapshot.snapshot_id)) continue;

    const record: ReconciliationRecord = {
      snapshot_id: snapshot.snapshot_id,
      run_id: runId,
      model_id: snapshot.model_id,
      horizon: snapshot.horizon,
      target_date: snapshot.target_date,
      forecast_value: snapshot.forecast_value,
      actual,
      absolute_error: Math.abs(snapshot.forecast_value - actual),
      signed_error: snapshot.forecast_value - actual,
      reconciled_at: reconciledAt,
    };
    await appendJsonl(store.reconciliations, record);
    existing.add(snapshot.snapshot_id);
    summary.newRecords++;
  }
  return summary;
}

export interface ModelHorizonMetrics {
  model_id: ModelId;
  horizon: number;
  n: number;
  mae: number;
  wape: number;
  bias: number;
  underforecast: number;
  overforecast: number;
}

export interface MonitorReport {
  generated_at: string;
  forecasts: number;
  reconciled: number;
  pending_future: number;
  missing_actual: number;
  errors: number;
  diagnostics: number;
  status_counts: Record<string, number>;
  metrics: ModelHorizonMetrics[];
  comparison: Array<{ horizon: number; mae_baseline: number; mae_shadow: number; delta_mae: number; delta_wape: number; n_baseline: number; n_shadow: number }>;
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : 0;
}

export async function monitor(rows: readonly HistoryRow[], store: StorePaths, generatedAt: string): Promise<MonitorReport> {
  const snapshots = await readJsonl<ShadowSnapshot>(store.forecasts, isSnapshotRecord);
  const records = await readJsonl<ReconciliationRecord>(store.reconciliations, isReconciliationRecord);
  const errors = await readJsonl<ShadowError>(store.errors, isShadowErrorRecord);
  const lastDate = lastConfirmedDate(rows);

  const metrics: ModelHorizonMetrics[] = [];
  for (const modelId of ["rolling_7_day_mean", "adaptive_baseline"] as ModelId[]) {
    for (const horizon of [1, 3] as const) {
      const subset = records.filter((record) => record.model_id === modelId && record.horizon === horizon);
      if (!subset.length) continue;
      const actualAbs = subset.reduce((acc, record) => acc + Math.abs(record.actual), 0);
      metrics.push({
        model_id: modelId,
        horizon,
        n: subset.length,
        mae: mean(subset.map((record) => record.absolute_error)),
        wape: actualAbs === 0 ? 0 : (subset.reduce((acc, record) => acc + record.absolute_error, 0) / actualAbs) * 100,
        bias: mean(subset.map((record) => record.signed_error)),
        underforecast: subset.filter((record) => (record.forecast_value as number) < record.actual).length,
        overforecast: subset.filter((record) => (record.forecast_value as number) > record.actual).length,
      });
    }
  }

  const comparison = ([1, 3] as const).map((horizon) => {
    const baseline = metrics.find((entry) => entry.model_id === "rolling_7_day_mean" && entry.horizon === horizon);
    const shadow = metrics.find((entry) => entry.model_id === "adaptive_baseline" && entry.horizon === horizon);
    return {
      horizon,
      mae_baseline: baseline?.mae ?? 0,
      mae_shadow: shadow?.mae ?? 0,
      delta_mae: (baseline?.mae ?? 0) - (shadow?.mae ?? 0),
      delta_wape: (baseline?.wape ?? 0) - (shadow?.wape ?? 0),
      n_baseline: baseline?.n ?? 0,
      n_shadow: shadow?.n ?? 0,
    };
  });

  const statusCounts: Record<string, number> = {};
  for (const snapshot of snapshots) statusCounts[snapshot.status] = (statusCounts[snapshot.status] ?? 0) + 1;

  return {
    generated_at: generatedAt,
    forecasts: snapshots.length,
    reconciled: records.length,
    pending_future: snapshots.filter((snapshot) => lastDate !== null && snapshot.target_date > lastDate).length,
    missing_actual: errors.filter((error) => error.code === "MISSING_ACTUAL").length,
    errors: errors.length,
    diagnostics: errors.filter((error) => error.code === "SNAPSHOT_CONFLICT").length,
    status_counts: statusCounts,
    metrics,
    comparison,
  };
}