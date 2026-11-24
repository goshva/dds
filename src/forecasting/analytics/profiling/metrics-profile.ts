/**
 * Профиль метрик: описательные статистики, пропуски, заполненность.
 *
 * Ключ группировки: (metric, slice_id, metric_kind). Значения NULL не смешиваются с нулями:
 * строка с NULL означает «наблюдение есть, значение неизвестно», отсутствие строки — «наблюдения нет»,
 * а ноль — «источник явно сообщил ноль».
 */

import type { DailyObservationRow, DescriptiveStats, GapRange, MetricProfile, TemporalCoverageRow } from "./types";
import { countNegatives, countZeros, coefficientOfVariation, iqr, mad, mean, median, quantile, round, stdev } from "./stats";

/** Календарь периода: все даты включительно, ISO YYYY-MM-DD. */
export function calendarRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let current = from;
  let guard = 0;
  while (current <= to) {
    dates.push(current);
    current = addDays(current, 1);
    if (++guard > 10_000) throw new Error("calendarRange: слишком длинный диапазон");
  }
  return dates;
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`addDays: некорректная дата «${date}»`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** День недели: 1 — понедельник … 7 — воскресенье. */
export function dayOfWeek(date: string): number {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`dayOfWeek: некорректная дата «${date}»`);
  const jsDay = parsed.getUTCDay(); // 0 — воскресенье
  return jsDay === 0 ? 7 : jsDay;
}

export const DOW_LABELS: Record<number, string> = {
  1: "понедельник",
  2: "вторник",
  3: "среда",
  4: "четверг",
  5: "пятница",
  6: "суббота",
  7: "воскресенье",
};

/** Описательные статистики по непустым значениям. */
export function describe(values: readonly number[], nulls = 0): DescriptiveStats {
  const clean = values.filter((value) => Number.isFinite(value));
  return {
    n: clean.length,
    nulls,
    zeros: countZeros(clean),
    negatives: countNegatives(clean),
    min: clean.length ? Math.min(...clean) : null,
    max: clean.length ? Math.max(...clean) : null,
    mean: round(mean(clean)),
    median: round(median(clean)),
    stdev: round(stdev(clean)),
    cv: round(coefficientOfVariation(clean)),
    q1: round(quantile(clean, 0.25)),
    q3: round(quantile(clean, 0.75)),
    iqr: round(iqr(clean)),
    mad: round(mad(clean)),
  };
}

function groupKey(row: DailyObservationRow): string {
  return `${row.metric}\u0001${row.slice_id}\u0001${row.metric_kind}`;
}

/** Непрерывные пропуски календарных дней внутри периода. */
function gapRanges(datesWithData: Set<string>, calendar: readonly string[]): GapRange[] {
  const ranges: GapRange[] = [];
  let start: string | null = null;
  let previous: string | null = null;
  for (const date of calendar) {
    if (datesWithData.has(date)) {
      if (start && previous) ranges.push({ from: start, to: previous, days: countDays(start, previous) });
      start = null;
      previous = null;
      continue;
    }
    if (!start) start = date;
    previous = date;
  }
  if (start && previous) ranges.push({ from: start, to: previous, days: countDays(start, previous) });
  return ranges;
}

function countDays(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Профиль каждой пары (metric, slice_id) с пропусками относительно календаря периода. */
export function buildMetricProfiles(rows: readonly DailyObservationRow[], calendar: readonly string[]): MetricProfile[] {
  const groups = new Map<string, DailyObservationRow[]>();
  for (const row of rows) {
    if (!row.date) continue; // строки без даты — не дневные наблюдения
    const key = groupKey(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const profiles: MetricProfile[] = [];
  for (const [key, group] of groups) {
    const [metric, sliceIdRaw, metricKind] = key.split("\u0001") as [string, string, string];
    const sliceId = Number(sliceIdRaw);
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const values: number[] = [];
    let nulls = 0;
    const datesWithData = new Set<string>();
    for (const row of sorted) {
      datesWithData.add(row.date);
      if (row.value === null) nulls++;
      else values.push(row.value);
    }

    const dates = [...datesWithData].sort();
    const gaps = gapRanges(datesWithData, calendar);
    const expectedDays = calendar.length;
    const missingDays = expectedDays - datesWithData.size;
    const stats = describe(values, nulls);
    const notes: string[] = [];

    if (nulls > 0) notes.push(`${nulls} наблюдений со значением NULL (не заменяются нулём)`);
    if (stats.negatives > 0) notes.push(`${stats.negatives} отрицательных значений — требуется объяснение`);
    if (stats.n === 0) notes.push("нет ни одного числового значения");
    if (stats.stdev === 0 && stats.n > 1) notes.push("ряд постоянный (стандартное отклонение = 0) — методы поиска выбросов неприменимы");
    if (missingDays > 0) notes.push(`пропущено ${missingDays} календарных дней внутри периода`);
    notes.push("суммирование по дням как бизнес-агрегат не подтверждено: семантика метрики требует согласования");

    profiles.push({
      metric,
      metric_kind: metricKind,
      slice_id: sliceId,
      unit: sorted.find((row) => row.unit)?.unit ?? null,
      observations: sorted.length,
      days_with_data: datesWithData.size,
      first_date: dates[0] ?? null,
      last_date: dates.at(-1) ?? null,
      stats,
      sum: round(values.reduce((acc, value) => acc + value, 0)),
      mean_per_day: round(stats.n ? values.reduce((acc, value) => acc + value, 0) / datesWithData.size : null),
      positive_days: values.filter((value) => value > 0).length,
      zero_days: stats.zeros,
      expected_days: expectedDays,
      missing_days: missingDays,
      fill_rate: expectedDays ? round(datesWithData.size / expectedDays) ?? 0 : 0,
      max_gap_days: gaps.reduce((max, gap) => Math.max(max, gap.days), 0),
      gap_ranges: gaps,
      additive_aggregation_confirmed: false,
      notes,
    });
  }

  return profiles.sort((a, b) => a.metric.localeCompare(b.metric) || a.slice_id - b.slice_id);
}

/** Покрытие по датам для каждой пары (slice_id, metric). */
export function buildTemporalCoverage(rows: readonly DailyObservationRow[], calendar: readonly string[]): TemporalCoverageRow[] {
  const groups = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.date) continue;
    const key = `${row.slice_id}\u0001${row.metric}`;
    const bucket = groups.get(key) ?? new Set<string>();
    bucket.add(row.date);
    groups.set(key, bucket);
  }

  const coverage: TemporalCoverageRow[] = [];
  for (const [key, dates] of groups) {
    const [sliceIdRaw, metric] = key.split("\u0001") as [string, string];
    const sorted = [...dates].sort();
    const missingDates = calendar.filter((date) => !dates.has(date));
    coverage.push({
      slice_id: Number(sliceIdRaw),
      metric,
      first_date: sorted[0] ?? null,
      last_date: sorted.at(-1) ?? null,
      days_with_data: dates.size,
      expected_days: calendar.length,
      missing_days: missingDates.length,
      missing_dates: missingDates,
    });
  }

  return coverage.sort((a, b) => a.slice_id - b.slice_id || a.metric.localeCompare(b.metric));
}
