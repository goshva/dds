/**
 * Статистические функции профилирования.
 *
 * Все функции чистые и детерминированные: без случайности, без внешних зависимостей.
 * Пустой массив и один элемент обрабатываются явно (возвращается null там, где оценка невозможна).
 */

/** Среднее арифметическое; null для пустого массива. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Линейная интерполяция квантиля (R-7); значения не сортируются на месте. */
export function quantile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  if (p < 0 || p > 1) throw new Error(`quantile: p must be within [0, 1], got ${p}`);
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

/** Медиана; null для пустого массива. */
export function median(values: readonly number[]): number | null {
  return quantile(values, 0.5);
}

/**
 * Выборочное стандартное отклонение (делитель n−1).
 * null для пустого массива и для одного значения (оценка разброса невозможна).
 */
export function stdev(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  let sumSquares = 0;
  for (const value of values) sumSquares += (value - m) ** 2;
  return Math.sqrt(sumSquares / (values.length - 1));
}

/** Коэффициент вариации; null, если среднее равно нулю (деление невозможно) или оценка недоступна. */
export function coefficientOfVariation(values: readonly number[]): number | null {
  const m = mean(values);
  const sd = stdev(values);
  if (m === null || sd === null || m === 0) return null;
  return sd / Math.abs(m);
}

/** Межквартильный размах (Q3 − Q1); null для пустого массива. */
export function iqr(values: readonly number[]): number | null {
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  if (q1 === null || q3 === null) return null;
  return q3 - q1;
}

/** Медианное абсолютное отклонение: median(|x − median(x)|). */
export function mad(values: readonly number[]): number | null {
  const m = median(values);
  if (m === null) return null;
  return median(values.map((value) => Math.abs(value - m)));
}

export interface LinearTrend {
  slope: number;
  intercept: number;
  /** Коэффициент детерминации R²; null, если дисперсия y равна нулю. */
  r2: number | null;
}

/** Описательный линейный тренд по индексам 0..n−1 (не прогноз). */
export function linearTrend(values: readonly number[]): LinearTrend | null {
  if (values.length < 2) return null;
  const n = values.length;
  const xs = values.map((_, index) => index);
  const meanX = mean(xs)!;
  const meanY = mean(values)!;
  let covariance = 0;
  let varianceX = 0;
  for (let index = 0; index < n; index++) {
    covariance += (xs[index]! - meanX) * (values[index]! - meanY);
    varianceX += (xs[index]! - meanX) ** 2;
  }
  if (varianceX === 0) return null;
  const slope = covariance / varianceX;
  const intercept = meanY - slope * meanX;

  let residualSum = 0;
  let totalSum = 0;
  for (let index = 0; index < n; index++) {
    const predicted = intercept + slope * xs[index]!;
    residualSum += (values[index]! - predicted) ** 2;
    totalSum += (values[index]! - meanY) ** 2;
  }
  const r2 = totalSum === 0 ? null : 1 - residualSum / totalSum;
  return { slope, intercept, r2 };
}

/** Количество нулевых значений. */
export function countZeros(values: readonly number[]): number {
  return values.filter((value) => value === 0).length;
}

/** Количество отрицательных значений. */
export function countNegatives(values: readonly number[]): number {
  return values.filter((value) => value < 0).length;
}

/** Округление до заданного числа знаков — для стабильного сравнения и вывода. */
export function round(value: number | null, digits = 6): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
