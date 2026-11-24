/**
 * Загрузка исходных срезов из SQLite в режиме только чтения.
 *
 * Все запросы проверяются guard-функцией: разрешены только SELECT/WITH.
 * Никакие данные не изменяются; миграции не применяются.
 */

import type { Database } from "bun:sqlite";

import { queryAll } from "../profiling/read-only";
import type { CrossSliceRow, SliceCandidateStats, SliceSourceRow } from "./types";

const SLICE_ROWS_SQL = `SELECT date, slice_id, dimension_1, dimension_2, value,
                               dataset_id, run_id, transform_version, evidence_status, data_status
                          FROM daily_metrics
                         WHERE shop_no = ? AND metric = ?
                         ORDER BY slice_id, date, dimension_1, dimension_2`;

/** Читает все строки метрики магазина (дневные и итоговые) по всем срезам. */
export function loadMetricRows(db: Database, shopNo: string, metric: string): SliceSourceRow[] {
  return queryAll<{
    date: string;
    slice_id: number;
    dimension_1: string;
    dimension_2: string;
    value: number | null;
    dataset_id: number | null;
    run_id: number | null;
    transform_version: string;
    evidence_status: string;
    data_status: string;
  }>(db, SLICE_ROWS_SQL, [shopNo, metric]).map((row) => ({
    date: row.date,
    sliceId: row.slice_id,
    dimension1: row.dimension_1,
    dimension2: row.dimension_2,
    value: row.value,
    datasetId: row.dataset_id,
    runId: row.run_id,
    transformVersion: row.transform_version,
    evidenceStatus: row.evidence_status,
    dataStatus: row.data_status,
  }));
}

/** Список срезов, в которых присутствует метрика. */
export function slicesForMetric(rows: readonly SliceSourceRow[]): number[] {
  return [...new Set(rows.map((row) => row.sliceId))].sort((a, b) => a - b);
}

/** Статистика одного среза-кандидата. */
export function sliceCandidateStats(
  rows: readonly SliceSourceRow[],
  sliceId: number,
  expectedDays: number,
): SliceCandidateStats {
  const group = rows.filter((row) => row.sliceId === sliceId);
  const daily = group.filter((row) => row.date !== "");
  const totals = group.filter((row) => row.date === "");
  const values = daily.map((row) => row.value).filter((value): value is number => value !== null);

  const perDay = new Map<string, number>();
  for (const row of daily) perDay.set(row.date, (perDay.get(row.date) ?? 0) + 1);
  const perDayCounts = [...perDay.values()];

  const keys = new Set<string>();
  let duplicates = 0;
  for (const row of daily) {
    const key = `${row.date}\u0001${row.dimension1}\u0001${row.dimension2}`;
    if (keys.has(key)) duplicates++;
    else keys.add(key);
  }

  return {
    sliceId,
    rows: group.length,
    dailyRows: daily.length,
    totalsRows: totals.length,
    dates: perDay.size,
    rowsPerDayMin: perDayCounts.length ? Math.min(...perDayCounts) : 0,
    rowsPerDayMax: perDayCounts.length ? Math.max(...perDayCounts) : 0,
    rowsPerDayAvg: perDayCounts.length ? perDayCounts.reduce((a, b) => a + b, 0) / perDayCounts.length : 0,
    dimensionCombinations: new Set(daily.map((row) => `${row.dimension1}\u0001${row.dimension2}`)).size,
    dimension1Values: new Set(daily.map((row) => row.dimension1)).size,
    dimension2Values: new Set(daily.map((row) => row.dimension2).filter((value) => value !== "")).size,
    emptyDimension1: daily.filter((row) => row.dimension1.trim() === "").length,
    emptyDimension2: daily.filter((row) => row.dimension2.trim() === "").length,
    maskedDimension1: daily.filter((row) => row.dimension1.trim().startsWith("<")).length,
    maskedDimension2: daily.filter((row) => row.dimension2.trim().startsWith("<")).length,
    nullValues: daily.filter((row) => row.value === null).length,
    zeroValues: values.filter((value) => value === 0).length,
    negativeValues: values.filter((value) => value < 0).length,
    fractionalValues: values.filter((value) => !Number.isInteger(value)).length,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    dailyTotal: values.reduce((acc, value) => acc + value, 0),
    duplicateKeys: duplicates,
    datasetId: group.find((row) => row.datasetId !== null)?.datasetId ?? null,
    runId: group.find((row) => row.runId !== null)?.runId ?? null,
    singleRowPerDate: perDayCounts.length > 0 && perDayCounts.every((count) => count === 1),
    calendarComplete: perDay.size === expectedDays,
  };
}

/** Дневные суммы по срезам и их взаимное сравнение (без сложения срезов). */
export function crossSliceDailyTotals(
  rows: readonly SliceSourceRow[],
  slices: readonly number[],
): CrossSliceRow[] {
  const byDate = new Map<string, Map<number, number>>();
  for (const row of rows) {
    if (row.date === "" || row.value === null) continue;
    const perSlice = byDate.get(row.date) ?? new Map<number, number>();
    perSlice.set(row.sliceId, (perSlice.get(row.sliceId) ?? 0) + row.value);
    byDate.set(row.date, perSlice);
  }

  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, perSlice]) => {
      const totalsBySlice: Record<string, number> = {};
      for (const slice of slices) {
        const value = perSlice.get(slice);
        if (value !== undefined) totalsBySlice[String(slice)] = value;
      }
      const values = Object.values(totalsBySlice);
      const maxDeviation = values.length ? Math.max(...values) - Math.min(...values) : 0;
      return {
        date,
        totalsBySlice,
        allEqual: values.length === slices.length && maxDeviation === 0,
        maxDeviation,
        slicesCompared: values.length,
      };
    });
}

/** Период по дневным строкам метрики (все срезы дают один и тот же календарь). */
export function metricPeriod(rows: readonly SliceSourceRow[]): { from: string; to: string; days: number } {
  const dates = [...new Set(rows.filter((row) => row.date !== "").map((row) => row.date))].sort();
  return { from: dates[0] ?? "", to: dates.at(-1) ?? "", days: dates.length };
}
