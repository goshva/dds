/**
 * Stage 3.3.5 — метрики качества прогнозов.
 *
 * Метрики рассчитываются ТОЛЬКО из пар (actual, forecast), сохранённых в детализации.
 * Отдельная функция {@link recomputeFromRecords} пересчитывает их независимо —
 * это исключает расхождение «посчитали одним способом, сохранили другим».
 */

export interface ErrorPair {
  actual: number;
  forecast: number;
}

export interface MetricSet {
  n: number;
  mae: number | null;
  rmse: number | null;
  /** WAPE в процентах; null, если сумма фактических значений равна нулю. */
  wape: number | null;
  wape_status: "ok" | "undefined_zero_actuals" | "no_data";
  bias: number | null;
  median_abs_error: number | null;
  max_abs_error: number | null;
  signed_error_sum: number | null;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

export function computeMetrics(pairs: readonly ErrorPair[]): MetricSet {
  const clean = pairs.filter((pair) => Number.isFinite(pair.actual) && Number.isFinite(pair.forecast));
  if (!clean.length) {
    return {
      n: 0,
      mae: null,
      rmse: null,
      wape: null,
      wape_status: "no_data",
      bias: null,
      median_abs_error: null,
      max_abs_error: null,
      signed_error_sum: null,
    };
  }

  const errors = clean.map((pair) => pair.forecast - pair.actual);
  const absErrors = errors.map(Math.abs);
  const squared = errors.map((error) => error * error);
  const actualsAbsSum = clean.reduce((acc, pair) => acc + Math.abs(pair.actual), 0);

  // Bias = mean(forecast - actual): положительное значение — систематическое завышение
  const bias = errors.reduce((acc, error) => acc + error, 0) / clean.length;
  const mae = absErrors.reduce((acc, error) => acc + error, 0) / clean.length;
  const rmse = Math.sqrt(squared.reduce((acc, value) => acc + value, 0) / clean.length);

  return {
    n: clean.length,
    mae,
    rmse,
    wape: actualsAbsSum === 0 ? null : (absErrors.reduce((acc, error) => acc + error, 0) / actualsAbsSum) * 100,
    wape_status: actualsAbsSum === 0 ? "undefined_zero_actuals" : "ok",
    bias,
    median_abs_error: median(absErrors),
    max_abs_error: absErrors.length ? Math.max(...absErrors) : null,
    signed_error_sum: errors.reduce((acc, error) => acc + error, 0),
  };
}

/** Независимый пересчёт метрик из сохранённых записей прогнозов. */
export function recomputeFromRecords(records: ReadonlyArray<{ actual: number | null; predicted: number | null }>): MetricSet {
  const pairs: ErrorPair[] = [];
  for (const record of records) {
    if (record.actual === null || record.predicted === null) continue;
    pairs.push({ actual: record.actual, forecast: record.predicted });
  }
  return computeMetrics(pairs);
}

export const METRIC_FORMULAS: Record<string, string> = {
  MAE: "mean(|actual − forecast|) — средняя абсолютная ошибка в заказах",
  RMSE: "sqrt(mean((actual − forecast)²)) — сильнее штрафует крупные ошибки",
  WAPE: "sum(|actual − forecast|) / sum(|actual|) × 100 %; undefined, если sum(|actual|) = 0",
  Bias: "mean(forecast − actual): > 0 — систематическое завышение, < 0 — занижение",
  median_abs_error: "медиана абсолютных ошибок — устойчива к единичным крупным промахам",
  max_abs_error: "максимальная абсолютная ошибка — worst case на доступной истории",
};

/** Проверка отсутствия NaN и Infinity в наборе метрик. */
export function validateMetricSet(metrics: MetricSet): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === "number" && !Number.isFinite(value)) problems.push(`метрика ${key} не конечна: ${value}`);
  }
  return problems;
}
