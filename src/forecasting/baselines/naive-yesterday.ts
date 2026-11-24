/**
 * Baseline A — Naive Yesterday.
 *
 * Прогноз на любую дату горизонта равен последнему известному фактическому значению
 * на момент origin: forecast(t + h) = actual(t).
 */

import {
  assertNoFutureData,
  ensureFinite,
  sortedHistory,
  targetDates,
  unavailableResult,
  type BaselineModel,
  type ForecastInput,
  type ForecastResult,
} from "./types";

export class NaiveYesterday implements BaselineModel {
  readonly name = "naive_yesterday";

  forecast(input: ForecastInput): ForecastResult {
    assertNoFutureData(input);
    const history = sortedHistory(input);
    const last = history.at(-1) ?? null;
    if (!last) return unavailableResult(this.name, input, "нет фактической истории", 0, null);

    const value = ensureFinite(last.value, "naive_yesterday");
    const notes = last.date === input.originDate ? [] : [`последнее наблюдение ${last.date} старше origin ${input.originDate}`];

    return {
      model: this.name,
      originDate: input.originDate,
      horizonDays: input.horizonDays,
      timezone: input.timezone,
      points: targetDates(input.originDate, input.horizonDays).map((targetDate) => ({
        targetDate,
        value,
        status: "ok" as const,
        reason: null,
      })),
      diagnostics: { historyPoints: history.length, lastHistoryDate: last.date, notes },
    };
  }
}

export const naiveYesterday = new NaiveYesterday();
