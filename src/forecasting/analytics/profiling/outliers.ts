/**
 * Поиск статистических выбросов двумя независимыми методами: IQR и MAD.
 *
 * Правила:
 *  - метод применяется только при достаточном объёме и ненулевой вариативности;
 *  - границы считаются отдельно для каждой метрики и среза (никаких глобальных порогов);
 *  - выброс НЕ объявляется ошибкой данных: он лишь помечается для проверки;
 *  - значения не изменяются и не удаляются.
 */

import { median, quantile, round } from "./stats";
import type { OutlierFinding, OutlierMethod } from "./types";

export interface OutlierApplicability {
  method: OutlierMethod;
  applicable: boolean;
  reason: string;
}

export interface OutlierDetectionResult {
  findings: OutlierFinding[];
  applicability: OutlierApplicability[];
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface OutlierContext {
  metric: string;
  slice_id: number;
  /** Измерения ряда: внутри одной комбинации измерений популяции не смешиваются. */
  dimension_1?: string;
  dimension_2?: string;
}

/** Минимальный объём ряда, при котором квартильные оценки считаются осмысленными. */
export const MIN_POINTS_FOR_OUTLIERS = 8;

/** Порог модифицированного z-показателя для MAD (общепринятое значение 3.5). */
export const MAD_Z_THRESHOLD = 3.5;

export function detectOutliers(points: readonly SeriesPoint[], context: OutlierContext): OutlierDetectionResult {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const values = sorted.map((point) => point.value);
  const findings: OutlierFinding[] = [];
  const applicability: OutlierApplicability[] = [];
  const dimension1 = context.dimension_1 ?? "";
  const dimension2 = context.dimension_2 ?? "";

  // --- IQR --------------------------------------------------------------------
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const spread = q1 === null || q3 === null ? null : q3 - q1;
  if (sorted.length < MIN_POINTS_FOR_OUTLIERS) {
    applicability.push({
      method: "IQR",
      applicable: false,
      reason: `недостаточно наблюдений: ${sorted.length} < ${MIN_POINTS_FOR_OUTLIERS}`,
    });
  } else if (!spread) {
    applicability.push({ method: "IQR", applicable: false, reason: "межквартильный размах равен 0 (постоянный или почти постоянный ряд)" });
  } else {
    const lower = q1! - 1.5 * spread;
    const upper = q3! + 1.5 * spread;
    applicability.push({ method: "IQR", applicable: true, reason: `границы [${round(lower)}, ${round(upper)}], IQR = ${round(spread)}` });
    for (const point of sorted) {
      if (point.value < lower || point.value > upper) {
        findings.push({
          metric: context.metric,
          slice_id: context.slice_id,
          dimension_1: dimension1,
          dimension_2: dimension2,
          date: point.date,
          value: point.value,
          method: "IQR",
          statistic: round(spread) ?? 0,
          lower_bound: round(lower),
          upper_bound: round(upper),
          reason: point.value < lower ? "значение ниже нижней границы Q1 − 1.5·IQR" : "значение выше верхней границы Q3 + 1.5·IQR",
        });
      }
    }
  }

  // --- MAD --------------------------------------------------------------------
  const med = median(values);
  const deviation = med === null ? null : median(values.map((value) => Math.abs(value - med)));
  if (sorted.length < MIN_POINTS_FOR_OUTLIERS) {
    applicability.push({
      method: "MAD",
      applicable: false,
      reason: `недостаточно наблюдений: ${sorted.length} < ${MIN_POINTS_FOR_OUTLIERS}`,
    });
  } else if (!deviation) {
    applicability.push({ method: "MAD", applicable: false, reason: "MAD равен 0 (постоянный ряд) — модифицированный z-показатель не определён" });
  } else {
    applicability.push({
      method: "MAD",
      applicable: true,
      reason: `MAD = ${round(deviation)}, порог |z| > ${MAD_Z_THRESHOLD}`,
    });
    for (const point of sorted) {
      const z = (0.6745 * (point.value - med!)) / deviation;
      if (Math.abs(z) > MAD_Z_THRESHOLD) {
        findings.push({
          metric: context.metric,
          slice_id: context.slice_id,
          dimension_1: dimension1,
          dimension_2: dimension2,
          date: point.date,
          value: point.value,
          method: "MAD",
          statistic: round(deviation) ?? 0,
          lower_bound: null,
          upper_bound: null,
          reason: `модифицированный z-показатель ${round(z, 3)} превышает порог ${MAD_Z_THRESHOLD} (медиана ${round(med)})`,
        });
      }
    }
  }

  findings.sort((a, b) => a.date.localeCompare(b.date) || a.method.localeCompare(b.method));
  return { findings, applicability };
}
