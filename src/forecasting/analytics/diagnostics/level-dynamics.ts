/**
 * Stage 3.4.4 — исследование динамики уровня спроса.
 *
 * Только чтение канонического ряда. Все величины описывают ряд, а не прогноз:
 * задача — понять, насколько уровень устойчив и как быстро меняется,
 * прежде чем проектировать адаптивную поправку.
 */

export interface RollingLevel {
  date: string;
  window: number;
  mean: number;
  stdev: number;
  cv: number;
  min: number;
  max: number;
}

export interface LevelChange {
  date: string;
  window: number;
  delta: number;
  deltaPercent: number;
  direction: "up" | "down" | "flat";
}

export interface LocalTrend {
  endDate: string;
  window: number;
  slope: number;
  /** Изменение уровня за окно в единицах заказов и в процентах от среднего окна. */
  slopeTotal: number;
  slopePercent: number;
  r2: number;
}

export interface LevelDynamics {
  observations: number;
  period: { from: string; to: string };
  overall: { mean: number; median: number; stdev: number; cv: number; min: number; max: number };
  windows: number[];
  rolling: RollingLevel[];
  changes: LevelChange[];
  trends: LocalTrend[];
  stability: Array<{ window: number; meanOfWindowMeans: number; stdevOfWindowMeans: number; cv: number; worstChangePercent: number }>;
  regimeSummary: { up: number; down: number; flat: number; flatThresholdPercent: number };
  notes: string[];
}

export const LEVEL_WINDOWS = [7, 14, 28] as const;
export const FLAT_THRESHOLD_PERCENT = 2;

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

/** МНК-наклон и коэффициент детерминации для локального тренда. */
export function linearTrend(values: readonly number[]): { slope: number; r2: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, r2: 0 };
  const xs = values.map((_, index) => index);
  const xMean = mean(xs);
  const yMean = mean(values);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let index = 0; index < n; index++) {
    const dx = xs[index]! - xMean;
    const dy = values[index]! - yMean;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const r2 = syy === 0 || sxx === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, r2 };
}

export function rollingLevel(rows: ReadonlyArray<{ date: string; value: number }>, window: number): RollingLevel[] {
  const result: RollingLevel[] = [];
  for (let index = window - 1; index < rows.length; index++) {
    const slice = rows.slice(index - window + 1, index + 1).map((row) => row.value);
    const avg = mean(slice);
    const sd = stdev(slice);
    result.push({
      date: rows[index]!.date,
      window,
      mean: Number(avg.toFixed(2)),
      stdev: Number(sd.toFixed(2)),
      cv: avg === 0 ? 0 : Number((sd / avg).toFixed(4)),
      min: Math.min(...slice),
      max: Math.max(...slice),
    });
  }
  return result;
}

export function levelChanges(rolling: readonly RollingLevel[], window: number): LevelChange[] {
  const series = rolling.filter((entry) => entry.window === window);
  const changes: LevelChange[] = [];
  for (let index = 1; index < series.length; index++) {
    const previous = series[index - 1]!;
    const current = series[index]!;
    const delta = current.mean - previous.mean;
    const deltaPercent = previous.mean === 0 ? 0 : (delta / previous.mean) * 100;
    changes.push({
      date: current.date,
      window,
      delta: Number(delta.toFixed(2)),
      deltaPercent: Number(deltaPercent.toFixed(2)),
      direction: Math.abs(deltaPercent) < FLAT_THRESHOLD_PERCENT ? "flat" : delta > 0 ? "up" : "down",
    });
  }
  return changes;
}

export function localTrends(rows: ReadonlyArray<{ date: string; value: number }>, window: number): LocalTrend[] {
  const trends: LocalTrend[] = [];
  for (let index = window - 1; index < rows.length; index++) {
    const slice = rows.slice(index - window + 1, index + 1).map((row) => row.value);
    const { slope, r2 } = linearTrend(slice);
    const avg = mean(slice);
    const slopeTotal = slope * (window - 1);
    trends.push({
      endDate: rows[index]!.date,
      window,
      slope: Number(slope.toFixed(4)),
      slopeTotal: Number(slopeTotal.toFixed(2)),
      slopePercent: avg === 0 ? 0 : Number(((slopeTotal / avg) * 100).toFixed(2)),
      r2: Number(r2.toFixed(4)),
    });
  }
  return trends;
}

export function analyzeLevelDynamics(rows: ReadonlyArray<{ date: string; value: number }>): LevelDynamics {
  const values = rows.map((row) => row.value);
  const rolling: RollingLevel[] = [];
  const changes: LevelChange[] = [];
  const trends: LocalTrend[] = [];
  const stability: LevelDynamics["stability"] = [];

  for (const window of LEVEL_WINDOWS) {
    const windowRolling = rollingLevel(rows, window);
    const windowChanges = levelChanges(windowRolling, window);
    const windowTrends = localTrends(rows, window);
    rolling.push(...windowRolling);
    changes.push(...windowChanges);
    trends.push(...windowTrends);

    const windowMeans = windowRolling.map((entry) => entry.mean);
    const worstChange = windowChanges.reduce((acc, entry) => Math.max(acc, Math.abs(entry.deltaPercent)), 0);
    stability.push({
      window,
      meanOfWindowMeans: Number(mean(windowMeans).toFixed(2)),
      stdevOfWindowMeans: Number(stdev(windowMeans).toFixed(2)),
      cv: mean(windowMeans) === 0 ? 0 : Number((stdev(windowMeans) / mean(windowMeans)).toFixed(4)),
      worstChangePercent: Number(worstChange.toFixed(2)),
    });
  }

  const regimes = { up: 0, down: 0, flat: 0, flatThresholdPercent: FLAT_THRESHOLD_PERCENT };
  for (const change of changes) {
    if (change.direction === "up") regimes.up++;
    else if (change.direction === "down") regimes.down++;
    else regimes.flat++;
  }

  return {
    observations: rows.length,
    period: { from: rows[0]?.date ?? "", to: rows.at(-1)?.date ?? "" },
    overall: {
      mean: Number(mean(values).toFixed(2)),
      median: Number(median(values).toFixed(2)),
      stdev: Number(stdev(values).toFixed(2)),
      cv: mean(values) === 0 ? 0 : Number((stdev(values) / mean(values)).toFixed(4)),
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
    },
    windows: [...LEVEL_WINDOWS],
    rolling,
    changes,
    trends,
    stability,
    regimeSummary: regimes,
    notes: [
      "окна: 7, 14, 28 дней; скользящие средние и МНК-тренды",
      "порог «плоского» изменения среднего: 2% за день",
      "выбросы не удалялись, пропуски не заполнялись",
      "анализ описывает ряд; причинность не устанавливается",
    ],
  };
}

/** Последние срезы по окнам — для краткой сводки и отчёта. */
export function latestLevelSnapshot(dynamics: LevelDynamics): Array<{ window: number; lastMean: number; lastTrendPercent: number; lastR2: number; lastChangePercent: number }> {
  return dynamics.windows.map((window) => {
    const lastRolling = dynamics.rolling.filter((entry) => entry.window === window).at(-1);
    const lastTrend = dynamics.trends.filter((entry) => entry.window === window).at(-1);
    const lastChange = dynamics.changes.filter((entry) => entry.window === window).at(-1);
    return {
      window,
      lastMean: lastRolling?.mean ?? 0,
      lastTrendPercent: lastTrend?.slopePercent ?? 0,
      lastR2: lastTrend?.r2 ?? 0,
      lastChangePercent: lastChange?.deltaPercent ?? 0,
    };
  });
}