/**
 * Stage 3.4.4 — структура ошибок baseline (разделы 2–3).
 *
 * Используются сохранённые прогнозы контракта Stage 3.4.1 (step-exact, min_train 28).
 * Ошибка: error = forecast − actual. Положительная — завышение, отрицательная — занижение.
 * Никакие выбросы не удаляются, пропуски не заполняются.
 */

import { ALL_BASELINES } from "../../baselines";
import { runBacktest, type ForecastRecord } from "../backtesting/rolling-origin";
import { calendarFeatureVector } from "../calendar/feature-provider";
import { parseDate } from "../calendar/calendar-core";

export interface ErrorGroup {
  key: string;
  n: number;
  meanError: number;
  medianError: number;
  mae: number;
  stdevError: number;
  /** t-статистика среднего остатка (описательно, без p-value). */
  tStat: number;
  positive: number;
  negative: number;
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface ErrorStructure {
  horizon: number;
  model: string;
  n: number;
  byDayOfWeek: ErrorGroup[];
  byLevelDirection: ErrorGroup[];
  byQuarter: ErrorGroup[];
  byYear: ErrorGroup[];
  mode: "step-exact" | "cumulative";
  /** HAC-оценка среднего остатка по дням недели (поправка на автокорреляцию). */
  byDayOfWeekHac: Array<{ key: string; n: number; mean: number; tHac: number; ci95Low: number; ci95High: number; lag: number }>;
  /** Структура смещения по дням недели в разрезе года (повторяемость эффекта). */
  byYearDayOfWeek: Array<{ year: number; dayOfWeek: number; n: number; meanError: number; mae: number }>;
  autocorrelation: { lag1: number; lag7: number };
  notes: string[];
}

export const LEVEL_DIRECTION_THRESHOLD_PERCENT = 2;

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : 0;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((acc, value) => acc + (value - avg) ** 2, 0) / (values.length - 1));
}

/** Дисперсия среднего с поправкой Ньюи–Уэста (HAC) для зависимых наблюдений. */
export function hacVariance(errors: readonly number[], lag: number): number {
  const n = errors.length;
  if (n < 3) return 0;
  const avg = mean(errors);
  const centered = errors.map((error) => error - avg);
  let variance = centered.reduce((acc, value) => acc + value * value, 0) / n;
  for (let k = 1; k <= Math.min(lag, n - 1); k++) {
    const weight = 1 - k / (lag + 1);
    let covariance = 0;
    for (let index = k; index < n; index++) covariance += centered[index]! * centered[index - k]!;
    covariance /= n;
    variance += 2 * weight * covariance;
  }
  return Math.max(variance, 0) / n;
}

export function groupErrors(key: string, errors: readonly number[]): ErrorGroup {
  const avg = mean(errors);
  const sd = stdev(errors);
  return {
    key,
    n: errors.length,
    meanError: Number(avg.toFixed(2)),
    medianError: Number(median(errors).toFixed(2)),
    mae: Number(mean(errors.map((error) => Math.abs(error))).toFixed(2)),
    stdevError: Number(sd.toFixed(2)),
    tStat: sd === 0 || errors.length < 2 ? 0 : Number(((avg / sd) * Math.sqrt(errors.length)).toFixed(2)),
    positive: errors.filter((error) => error > 0).length,
    negative: errors.filter((error) => error < 0).length,
  };
}

/** Направление изменения уровня за 7 дней, известное на origin (только данные ≤ origin). */
export function levelDirectionAt(series: readonly SeriesPoint[], originDate: string): "up" | "down" | "flat" {
  const index = series.findIndex((point) => point.date === originDate);
  if (index < 14) return "flat";
  const recent = series.slice(index - 6, index + 1).map((point) => point.value);
  const previous = series.slice(index - 13, index - 6).map((point) => point.value);
  const recentMean = mean(recent);
  const previousMean = mean(previous);
  if (previousMean === 0) return "flat";
  const changePercent = ((recentMean - previousMean) / previousMean) * 100;
  if (Math.abs(changePercent) < LEVEL_DIRECTION_THRESHOLD_PERCENT) return "flat";
  return changePercent > 0 ? "up" : "down";
}

function autocorrelation(errors: readonly number[], lag: number): number {
  if (errors.length <= lag + 1) return 0;
  const avg = mean(errors);
  const variance = errors.reduce((acc, error) => acc + (error - avg) ** 2, 0);
  if (variance === 0) return 0;
  let covariance = 0;
  for (let index = lag; index < errors.length; index++) covariance += (errors[index]! - avg) * (errors[index - lag]! - avg);
  return Number((covariance / variance).toFixed(4));
}

/** Ошибки по горизонту для одной модели (step-exact, указанный min_train). */
export type EvaluationMode = "step-exact" | "cumulative";

export function errorStructureFor(
  records: readonly ForecastRecord[],
  model: string,
  horizon: number,
  minTrain: number,
  series: readonly SeriesPoint[],
  options: { mode?: EvaluationMode } = {},
): ErrorStructure | null {
  const mode = options.mode ?? "step-exact";
  const relevant = records
    .filter((record) => record.model === model && record.horizonDays === horizon && record.minTrainDays === minTrain && record.predicted !== null && record.actual !== null && (mode === "cumulative" || record.step === horizon))
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  if (!relevant.length) return null;

  const errors = relevant.map((record) => (record.predicted as number) - (record.actual as number));

  const byDow = new Map<number, number[]>();
  const byQuarter = new Map<string, number[]>();
  const byYear = new Map<number, number[]>();
  const byYearDow = new Map<string, number[]>();
  const byDirection = new Map<string, number[]>();

  for (const record of relevant) {
    const error = (record.predicted as number) - (record.actual as number);
    const features = calendarFeatureVector(record.targetDate);
    byDow.set(features.day_of_week, [...(byDow.get(features.day_of_week) ?? []), error]);
    const { year, month } = parseDate(record.targetDate); const quarterKey = `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
    byQuarter.set(quarterKey, [...(byQuarter.get(quarterKey) ?? []), error]);
    byYear.set(year, [...(byYear.get(year) ?? []), error]);
    const yearDowKey = `${year}|${features.day_of_week}`;
    byYearDow.set(yearDowKey, [...(byYearDow.get(yearDowKey) ?? []), error]);
    const direction = levelDirectionAt(series, record.originDate);
    byDirection.set(direction, [...(byDirection.get(direction) ?? []), error]);
  }

  const dowNames = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  const dowNamesForHac = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  const byDayOfWeekHac = [...byDow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dow, list]) => {
      const avg = mean(list);
      const variance = hacVariance(list, Math.max(1, horizon));
      const se = variance > 0 ? Math.sqrt(variance) : 0;
      return {
        key: dowNamesForHac[dow - 1]!,
        n: list.length,
        mean: Number(avg.toFixed(2)),
        tHac: se === 0 ? 0 : Number((avg / se).toFixed(2)),
        ci95Low: se === 0 ? Number(avg.toFixed(2)) : Number((avg - 1.96 * se).toFixed(2)),
        ci95High: se === 0 ? Number(avg.toFixed(2)) : Number((avg + 1.96 * se).toFixed(2)),
        lag: Math.max(1, horizon),
      };
    });

  return {
    horizon,
    model,
    mode,
    byDayOfWeekHac,
    n: errors.length,
    byDayOfWeek: [...byDow.entries()].sort((a, b) => a[0] - b[0]).map(([dow, list]) => groupErrors(dowNames[dow - 1]!, list)),
    byLevelDirection: ["up", "down", "flat"].filter((direction) => byDirection.has(direction)).map((direction) => groupErrors(direction, byDirection.get(direction)!)),
    byQuarter: [...byQuarter.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, list]) => groupErrors(key, list)),
    byYear: [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, list]) => groupErrors(String(year), list)),
    byYearDayOfWeek: [...byYearDow.entries()]
      .map(([key, list]) => {
        const [year, dow] = key.split("|").map(Number) as [number, number];
        return { year, dayOfWeek: dow, n: list.length, meanError: Number(mean(list).toFixed(2)), mae: Number(mean(list.map(Math.abs)).toFixed(2)) };
      })
      .sort((a, b) => a.year - b.year || a.dayOfWeek - b.dayOfWeek),
    autocorrelation: { lag1: autocorrelation(errors, 1), lag7: autocorrelation(errors, 7) },
    notes: [
      `шаг ровно h (step-exact), min_train = ${minTrain}`,
      "ошибка = прогноз − фактическое; положительная — завышение",
      "направление уровня определяется по данным до origin (окно 7 против предыдущих 7)",
      "t-статистика приведена описательно: без поправки на множественные сравнения",
      "выбросы не удалялись",
    ],
  };
}

/** Полная структура ошибок всех baseline по всем горизонтам. */
export function analyzeBaselineErrors(input: {
  history: ReadonlyArray<{ date: string; value: number }>;
  minTrain?: number;
  horizons?: number[];
}): { structures: ErrorStructure[]; records: ForecastRecord[] } {
  const minTrain = input.minTrain ?? 28;
  const horizons = input.horizons ?? [1, 3, 7, 14];
  const result = runBacktest({
    shopNo: "7745",
    metric: "qty_orders_delivered",
    sliceId: 20624,
    history: [...input.history],
    datasetChecksum: "diagnostics",
    horizons,
    minTrainDays: [minTrain],
    models: ALL_BASELINES,
    generatedAt: "2026-11-24T00:00:00.000Z",
  });
  const structures: ErrorStructure[] = [];
  for (const horizon of horizons) {
    for (const model of ALL_BASELINES.map((entry) => entry.name)) {
      const structure = errorStructureFor(result.records, model, horizon, minTrain, input.history);
      if (structure) structures.push(structure);
    }
  }
  return { structures, records: result.records };
}

export { mean, median, stdev };