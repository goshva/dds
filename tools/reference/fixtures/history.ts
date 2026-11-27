/**
 * TPL-4.1: fixtures страницы «История» и общий ряд наблюдений.
 * Значения синтетические; отсутствующие наблюдения показаны как [Н/Д], а не нулём.
 */
import { historyPage, type CoverageDto, type HistoryDto } from "../../../src/web/pages/history";
import { trusted, type TrustedHtml } from "../../../src/web/lib/format";
import { referenceBanner, statesCard } from "./common";

const ROW_DATES = ["2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10"];
const ROW_VALUES = [1620, null, 1700, 0, 1450, null, 1600];

/** Ряд с пропусками — используется графиком обзора. */
export function overviewSeries(): Array<{ date: string; value: number | null }> {
  const dates = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07", "2026-06-08"];
  const values = [1500, 1480, null, 1620, 1700, 0, 1450, null];
  return dates.map((date, index) => ({ date, value: values[index] ?? null }));
}

export function historyFixture(): HistoryDto {
  const points = ROW_DATES.map((date, index) => ({ date, value: ROW_VALUES[index] ?? null })).filter((point): point is { date: string; value: number } => point.value !== null);
  const values = points.map((point) => point.value);
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    points: points.map((point) => ({ date: point.date, value: point.value })),
    from: ROW_DATES[0]!,
    to: ROW_DATES[ROW_DATES.length - 1]!,
    totalPoints: 900,
    returnedPoints: points.length,
    semantics: "PROVISIONAL",
    summary: {
      sum,
      average: sum / values.length,
      max: Math.max(...values),
      min: Math.min(...values),
      calendarDays: 10,
      observationDays: points.length,
      missingDays: 3,
      complete: false,
      truncated: false,
      formula: "сумма, среднее, максимум и минимум — по доступным фактическим значениям диапазона; календарные дни — по запрошенному диапазону",
    },
    requested: { from: "2026-06-01", to: "2026-06-10" },
    available: { from: "2024-06-01", to: "2026-06-18" },
    rangeClamped: false,
  };
}

export function historyCoverageFixture(): CoverageDto {
  return {
    firstDate: "2024-06-01",
    lastDate: "2026-06-18",
    days: 900,
    gaps: 7,
    duplicateDates: 0,
    nullValues: 0,
    nullPolicy: "REJECTED_AS_CORRUPTED",
    completeness: "PARTIAL",
    missingDates: ["2026-06-03", "2026-06-04", "2026-06-07"],
    gapIntervals: [{ from: "2026-06-03", to: "2026-06-04", length: 2 }, { from: "2026-06-07", to: "2026-06-07", length: 1 }],
    maxGapLength: 2,
    fillRatio: 0.992,
    fillRatioFormula: "observationDays / calendarDays",
  };
}

export function historyContent(): TrustedHtml {
  return trusted(`${referenceBanner()}${historyPage({ history: historyFixture(), coverage: historyCoverageFixture(), activeRange: "all", from: "", to: "" })}${statesCard()}`);
}

/** Второй вариант: контролируемый произвольный диапазон (синтетические даты, не пользовательский ввод). */
export function historyRangeContent(): TrustedHtml {
  return trusted(`${historyPage({ history: historyFixture(), coverage: historyCoverageFixture(), activeRange: "custom", from: "2026-06-01", to: "2026-06-10" })}`);
}
