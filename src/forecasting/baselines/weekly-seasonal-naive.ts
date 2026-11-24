/**
 * Baseline C — Weekly Seasonal Naive.
 *
 * Прогноз на дату d равен фактическому значению даты d − 7 дней.
 * Если значения ровно на d − 7 нет, прогноз помечается `unavailable`:
 * интерполяция и подстановка нуля запрещены.
 */

import {
  addDaysIso,
  assertNoFutureData,
  ensureFinite,
  sortedHistory,
  targetDates,
  unavailableResult,
  type BaselineModel,
  type ForecastInput,
  type ForecastPoint,
  type ForecastResult,
} from "./types";

export const SEASONAL_LAG_DAYS = 7;

export class WeeklySeasonalNaive implements BaselineModel {
  readonly name = "weekly_seasonal_naive";

  forecast(input: ForecastInput): ForecastResult {
    assertNoFutureData(input);
    const history = sortedHistory(input);
    if (!history.length) return unavailableResult(this.name, input, "нет фактической истории", 0, null);

    const byDate = new Map(history.map((point) => [point.date, point.value]));
    const points: ForecastPoint[] = targetDates(input.originDate, input.horizonDays).map((targetDate) => {
      const sourceDate = addDaysIso(targetDate, -SEASONAL_LAG_DAYS);
      if (sourceDate > input.originDate) {
        return { targetDate, value: null, status: "unavailable" as const, reason: `источник ${sourceDate} позже origin ${input.originDate}` };
      }
      const value = byDate.get(sourceDate);
      if (value === undefined) {
        return { targetDate, value: null, status: "unavailable" as const, reason: `нет фактического значения на ${sourceDate}` };
      }
      return { targetDate, value: ensureFinite(value, "weekly_seasonal_naive"), status: "ok" as const, reason: null };
    });

    const available = points.filter((point) => point.status === "ok").length;
    return {
      model: this.name,
      originDate: input.originDate,
      horizonDays: input.horizonDays,
      timezone: input.timezone,
      points,
      diagnostics: {
        historyPoints: history.length,
        lastHistoryDate: history.at(-1)!.date,
        notes: [
          `лаг сезонности: ${SEASONAL_LAG_DAYS} дней`,
          `доступно прогнозов: ${available} из ${points.length}`,
          "недоступные прогнозы не заменялись интерполяцией",
        ],
      },
    };
  }
}

export const weeklySeasonalNaive = new WeeklySeasonalNaive();
