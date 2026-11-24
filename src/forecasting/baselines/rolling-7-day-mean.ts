/**
 * Baseline B — Rolling 7-Day Mean.
 *
 * Прогноз равен среднему последних семи ДОСТУПНЫХ фактических наблюдений
 * (по фактическим датам, без интерполяции пропусков и без нулей вместо пропусков).
 * Одно значение используется для всех дней горизонта.
 *
 * Если доступно меньше семи фактических наблюдений, прогноз не формируется.
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

export const REQUIRED_HISTORY_POINTS = 7;

export class Rolling7DayMean implements BaselineModel {
  readonly name = "rolling_7_day_mean";

  forecast(input: ForecastInput): ForecastResult {
    assertNoFutureData(input);
    const history = sortedHistory(input);
    if (history.length < REQUIRED_HISTORY_POINTS) {
      return unavailableResult(
        this.name,
        input,
        `недостаточно фактической истории: ${history.length} < ${REQUIRED_HISTORY_POINTS} наблюдений`,
        history.length,
        history.at(-1)?.date ?? null,
      );
    }

    const window = history.slice(-REQUIRED_HISTORY_POINTS);
    const value = ensureFinite(
      window.reduce((acc, point) => acc + point.value, 0) / REQUIRED_HISTORY_POINTS,
      "rolling_7_day_mean",
    );
    const notes = [
      `окно: ${window[0]!.date} … ${window.at(-1)!.date}`,
      `пропуски внутри окна не заполнялись: использовано ${window.length} фактических наблюдений`,
    ];

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
      diagnostics: { historyPoints: history.length, lastHistoryDate: window.at(-1)!.date, notes },
    };
  }
}

export const rolling7DayMean = new Rolling7DayMean();
