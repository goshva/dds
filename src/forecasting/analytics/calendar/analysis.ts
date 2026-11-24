/**
 * Stage 3.4.2 — описательная статистика календарных групп.
 * Выбросы не удаляются, пропуски не заполняются, средние сопровождаются размером выборки.
 */

import { calendarFeatures, DOW_NAMES_RU, type CalendarFeatures } from "./calendar-core";

export interface Observation {
  date: string;
  value: number;
  features: CalendarFeatures;
}

export interface GroupStat {
  group: string;
  kind: string;
  n: number;
  mean: number;
  median: number;
  stdev: number;
  min: number;
  max: number;
}

export interface BaselineComparison {
  date: string;
  value: number;
  group: string;
  dayOfWeek: number;
  dayOfWeekName: string;
  comparableMean: number;
  comparableN: number;
  deviation: number;
  deviationPercent: number;
}

export interface CalendarAnalysis {
  observations: number;
  byDayOfWeek: GroupStat[];
  byMonth: GroupStat[];
  bySeason: GroupStat[];
  weekdayVsWeekend: GroupStat[];
  officialHolidays: GroupStat[];
  preHoliday: GroupStat[];
  longWeekend: GroupStat[];
  holidayComparisons: BaselineComparison[];
  preHolidayComparisons: BaselineComparison[];
  yearStability: Array<{ effect: string; year: number; n: number; mean: number; baselineMean: number; deviationPercent: number }>;
  notes: string[];
}

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

export function groupStat(group: string, kind: string, values: readonly number[]): GroupStat {  return {
    group,
    kind,
    n: values.length,
    mean: Number(mean(values).toFixed(2)),
    median: Number(median(values).toFixed(2)),
    stdev: Number(stdev(values).toFixed(2)),
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
  };
}

export function buildObservations(rows: ReadonlyArray<{ date: string; value: number }>): Observation[] {
  return rows.map((row) => ({ date: row.date, value: row.value, features: calendarFeatures(row.date) }));
}

/** Обычные дни: не праздник, не перенесённый выходной, не внутри длинного выходного, не предпраздничный. */
function isOrdinaryDay(observation: Observation): boolean {
  const { official, longWeekend } = observation.features;
  return !official.statutoryHoliday && !official.shiftedDayOff && !longWeekend.inLongWeekend && !official.preHolidayShortDay;
}

export function analyzeCalendar(observations: readonly Observation[]): CalendarAnalysis {
  const byDow = new Map<number, number[]>();
  const byMonth = new Map<number, number[]>();
  const bySeason = new Map<string, number[]>();
  for (const observation of observations) {
    byDow.set(observation.features.dayOfWeek, [...(byDow.get(observation.features.dayOfWeek) ?? []), observation.value]);
    byMonth.set(observation.features.month, [...(byMonth.get(observation.features.month) ?? []), observation.value]);
    bySeason.set(observation.features.season, [...(bySeason.get(observation.features.season) ?? []), observation.value]);
  }

  const weekendValues = observations.filter((observation) => observation.features.isWeekend).map((observation) => observation.value);
  const weekdayValues = observations.filter((observation) => !observation.features.isWeekend).map((observation) => observation.value);

  // обычные дни по дням недели — база сравнения
  const ordinaryByDow = new Map<number, number[]>();
  for (const observation of observations.filter(isOrdinaryDay)) {
    ordinaryByDow.set(observation.features.dayOfWeek, [...(ordinaryByDow.get(observation.features.dayOfWeek) ?? []), observation.value]);
  }

  const holidayObservations = observations.filter((observation) => observation.features.official.statutoryHoliday);
  const preHolidayObservations = observations.filter((observation) => observation.features.official.preHolidayShortDay);
  const longWeekendObservations = observations.filter((observation) => observation.features.longWeekend.inLongWeekend);

  const holidayComparisons: BaselineComparison[] = holidayObservations.map((observation) => {
    const comparable = ordinaryByDow.get(observation.features.dayOfWeek) ?? [];
    const comparableMean = mean(comparable);
    return {
      date: observation.date,
      value: observation.value,
      group: (observation.features.official.holidayName ?? "праздник").toLowerCase(),
      dayOfWeek: observation.features.dayOfWeek,
      dayOfWeekName: DOW_NAMES_RU[observation.features.dayOfWeek - 1]!,
      comparableMean: Number(comparableMean.toFixed(2)),
      comparableN: comparable.length,
      deviation: Number((observation.value - comparableMean).toFixed(2)),
      deviationPercent: comparableMean === 0 ? 0 : Number((((observation.value - comparableMean) / comparableMean) * 100).toFixed(2)),
    };
  });

  const preHolidayComparisons: BaselineComparison[] = preHolidayObservations.map((observation) => {
    const comparable = ordinaryByDow.get(observation.features.dayOfWeek) ?? [];
    const comparableMean = mean(comparable);
    return {
      date: observation.date,
      value: observation.value,
      group: "предпраздничный день",
      dayOfWeek: observation.features.dayOfWeek,
      dayOfWeekName: DOW_NAMES_RU[observation.features.dayOfWeek - 1]!,
      comparableMean: Number(comparableMean.toFixed(2)),
      comparableN: comparable.length,
      deviation: Number((observation.value - comparableMean).toFixed(2)),
      deviationPercent: comparableMean === 0 ? 0 : Number((((observation.value - comparableMean) / comparableMean) * 100).toFixed(2)),
    };
  });

  // стабильность эффекта по годам: отклонение праздничных дней от обычных дней того же дня недели
  const yearStability: CalendarAnalysis["yearStability"] = [];
  for (const year of [...new Set(observations.map((observation) => observation.features.year))].sort()) {
    const yearObservations = observations.filter((observation) => observation.features.year === year);
    const yearHolidays = yearObservations.filter((observation) => observation.features.official.statutoryHoliday);
    if (!yearHolidays.length) continue;
    const baseline = mean(yearObservations.filter(isOrdinaryDay).map((observation) => observation.value));
    const holidayMean = mean(yearHolidays.map((observation) => observation.value));
    yearStability.push({
      effect: "statutory_holiday_vs_ordinary",
      year,
      n: yearHolidays.length,
      mean: Number(holidayMean.toFixed(2)),
      baselineMean: Number(baseline.toFixed(2)),
      deviationPercent: baseline === 0 ? 0 : Number((((holidayMean - baseline) / baseline) * 100).toFixed(2)),
    });
  }

  return {
    observations: observations.length,
    byDayOfWeek: [...byDow.entries()].sort((a, b) => a[0] - b[0]).map(([dow, values]) => groupStat(DOW_NAMES_RU[dow - 1]!, "day_of_week", values)),
    byMonth: [...byMonth.entries()].sort((a, b) => a[0] - b[0]).map(([month, values]) => groupStat(String(month).padStart(2, "0"), "month", values)),
    bySeason: [...bySeason.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([season, values]) => groupStat(season, "season", values)),
    weekdayVsWeekend: [
      groupStat("рабочие дни", "weekday_weekend", weekdayValues),
      groupStat("выходные дни", "weekday_weekend", weekendValues),
    ],
    officialHolidays: [...new Set(holidayObservations.map((observation) => (observation.features.official.holidayName ?? "праздник").toLowerCase()))]
      .sort()
      .map((name) => groupStat(name, "statutory_holiday", holidayObservations.filter((observation) => (observation.features.official.holidayName ?? "праздник").toLowerCase() === name).map((observation) => observation.value))),
    preHoliday: [groupStat("предпраздничные дни", "pre_holiday", preHolidayObservations.map((observation) => observation.value))],
    longWeekend: [groupStat("длинные выходные", "long_weekend", longWeekendObservations.map((observation) => observation.value))],
    holidayComparisons,
    preHolidayComparisons,
    yearStability,
    notes: [
      "выбросы не удалялись; пропущенные значения не заполнялись",
      "сравнение выполняется с обычными днями того же дня недели (исключая праздники, переносы и длинные выходные)",
      "описательная статистика не доказывает причинно-следственную связь",
      "история охватывает 2 неполных года: многолетняя сезонность не подтверждается",
    ],
  };
}
