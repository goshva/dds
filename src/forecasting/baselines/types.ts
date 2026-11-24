/**
 * Stage 3.3.4 — контракт baseline-моделей.
 *
 * Общие правила для всех моделей:
 *  - вход содержит только ФАКТИЧЕСКИЕ наблюдения с датами <= origin;
 *  - прогноз формируется на календарные даты origin+1 … origin+horizon;
 *  - отсутствующие значения не интерполируются и не заменяются нулём:
 *    такой прогноз получает статус `unavailable` с причиной;
 *  - значения не округляются (округление — задача отображения, а не оценки);
 *  - модель не имеет доступа к будущим наблюдениям: это проверяется {@link assertNoFutureData}.
 */

export interface HistoryPoint {
  date: string;
  value: number;
}

export interface ForecastInput {
  originDate: string;
  horizonDays: number;
  /** История строго до origin включительно (порядок не важен, модель сортирует сама). */
  history: readonly HistoryPoint[];
  timezone: string;
}

export type ForecastStatus = "ok" | "unavailable";

export interface ForecastPoint {
  targetDate: string;
  value: number | null;
  status: ForecastStatus;
  reason: string | null;
}

export interface ForecastResult {
  model: string;
  originDate: string;
  horizonDays: number;
  timezone: string;
  points: ForecastPoint[];
  diagnostics: {
    historyPoints: number;
    lastHistoryDate: string | null;
    notes: string[];
  };
}

export interface BaselineModel {
  readonly name: string;
  forecast(input: ForecastInput): ForecastResult;
}

export const SUPPORTED_HORIZONS = [1, 3, 7, 14] as const;

/** Календарная дата через N дней (UTC-арифметика по ISO-дате). */
export function addDaysIso(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`addDaysIso: некорректная дата «${date}»`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Проверка отсутствия утечки: модель не должна получать наблюдения позже origin. */
export function assertNoFutureData(input: ForecastInput): void {
  for (const point of input.history) {
    if (point.date > input.originDate) {
      throw new Error(`утечка данных: наблюдение ${point.date} позже origin ${input.originDate}`);
    }
    if (!Number.isFinite(point.value)) {
      throw new Error(`некорректное значение истории ${point.date}: ${point.value}`);
    }
  }
}

export function sortedHistory(input: ForecastInput): HistoryPoint[] {
  return [...input.history].sort((a, b) => a.date.localeCompare(b.date));
}

export function targetDates(originDate: string, horizonDays: number): string[] {
  if (!Number.isInteger(horizonDays) || horizonDays <= 0) throw new Error(`некорректный горизонт: ${horizonDays}`);
  return Array.from({ length: horizonDays }, (_, index) => addDaysIso(originDate, index + 1));
}

export function ensureFinite(value: number, context: string): number {
  if (!Number.isFinite(value)) throw new Error(`${context}: получено не число (${value})`);
  return value;
}

export function unavailableResult(model: string, input: ForecastInput, reason: string, historyPoints: number, lastDate: string | null): ForecastResult {
  return {
    model,
    originDate: input.originDate,
    horizonDays: input.horizonDays,
    timezone: input.timezone,
    points: targetDates(input.originDate, input.horizonDays).map((targetDate) => ({
      targetDate,
      value: null,
      status: "unavailable" as const,
      reason,
    })),
    diagnostics: { historyPoints, lastHistoryDate: lastDate, notes: [reason] },
  };
}
