/**
 * Временная структура ряда: дни недели, описательный тренд, сравнение начала и конца периода.
 *
 * Важно: 41 день — это менее шести полных недель. Результаты здесь носят описательный характер
 * и НЕ являются доказательством недельной или иной сезонности.
 */

import { DOW_LABELS, dayOfWeek } from "./metrics-profile";
import { linearTrend, mean, median, round, stdev } from "./stats";
import type { DailyObservationRow, DowProfileRow, TemporalProfile } from "./types";

export const SEASONALITY_WARNING =
  "41 день (менее 6 полных недель) не позволяет подтвердить недельную или годовую сезонность: различия средних по дням недели — наблюдаемая закономерность, а не подтверждённый факт.";

function dowRows(points: Array<{ date: string; value: number }>): DowProfileRow[] {
  const byDow = new Map<number, number[]>();
  for (const point of points) {
    const dow = dayOfWeek(point.date);
    const bucket = byDow.get(dow) ?? [];
    bucket.push(point.value);
    byDow.set(dow, bucket);
  }
  return [...byDow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dow, values]) => ({
      dow,
      label: DOW_LABELS[dow] ?? String(dow),
      observations: values.length,
      mean: round(mean(values)),
      median: round(median(values)),
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      stdev: round(stdev(values)),
    }));
}

/** Число полных недель (понедельник–воскресенье), полностью покрытых точками ряда. */
export function completeWeeks(points: ReadonlyArray<{ date: string; value: number }>): number {
  if (!points.length) return 0;
  const dates = new Set(points.map((point) => point.date));
  const sorted = [...dates].sort();
  const first = new Date(`${sorted[0]}T00:00:00Z`);
  const last = new Date(`${sorted.at(-1)}T00:00:00Z`);
  let weeks = 0;
  // идём по неделям от понедельника первой даты
  const cursor = new Date(first);
  const offsetToMonday = (cursor.getUTCDay() + 6) % 7;
  cursor.setUTCDate(cursor.getUTCDate() - offsetToMonday);
  while (true) {
    const weekEnd = new Date(cursor);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    if (weekEnd > last) break;
    let full = true;
    for (let index = 0; index < 7; index++) {
      const day = new Date(cursor);
      day.setUTCDate(day.getUTCDate() + index);
      if (!dates.has(day.toISOString().slice(0, 10))) {
        full = false;
        break;
      }
    }
    if (full) weeks++;
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

/** Вход временного профиля: по одному значению на дату (значения уже сведены по измерениям). */
export interface TemporalSeriesInput {
  metric: string;
  slice_id: number;
  points: Array<{ date: string; value: number }>;
  /** Как строки разных измерений сведены к значению дня. */
  aggregation: "sum_by_dimensions" | "mean_by_dimensions";
  aggregation_note: string;
}

/** Описательный временной профиль одной пары (metric, slice_id). */
export function buildTemporalProfile(input: TemporalSeriesInput): TemporalProfile {
  const points = [...input.points].sort((a, b) => a.date.localeCompare(b.date));
  const values = points.map((point) => point.value);
  const trend = linearTrend(values);
  const firstWeek = points.slice(0, 7).map((point) => point.value);
  const lastWeek = points.slice(-7).map((point) => point.value);

  return {
    metric: input.metric,
    slice_id: input.slice_id,
    aggregation: input.aggregation,
    aggregation_note: input.aggregation_note,
    points_used: points.length,
    first_value: points[0]?.value ?? null,
    last_value: points.at(-1)?.value ?? null,
    first_week_mean: round(mean(firstWeek)),
    last_week_mean: round(mean(lastWeek)),
    trend_slope_per_day: round(trend?.slope ?? null),
    trend_r2: round(trend?.r2 ?? null),
    trend_note: trend ? "описательный линейный тренд; не является прогнозом и не подтверждает устойчивость" : "тренд не оценивается: менее двух точек",
    dow: dowRows(points),
  };
}

/** Матрица «день недели → количество наблюдений» по всем метрикам (проверка сбалансированности календаря). */
export function dowObservationCounts(rows: readonly DailyObservationRow[]): DowProfileRow[] {
  const dates = [...new Set(rows.filter((row) => row.date).map((row) => row.date))].sort();
  const byDow = new Map<number, number>();
  for (const date of dates) {
    const dow = dayOfWeek(date);
    byDow.set(dow, (byDow.get(dow) ?? 0) + 1);
  }
  return [...byDow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dow, count]) => ({
      dow,
      label: DOW_LABELS[dow] ?? String(dow),
      observations: count,
      mean: null,
      median: null,
      min: null,
      max: null,
      stdev: null,
    }));
}
