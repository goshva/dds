/** Публичный интерфейс baseline-моделей (Stage 3.3.4). */

export type {
  BaselineModel,
  ForecastInput,
  ForecastPoint,
  ForecastResult,
  ForecastStatus,
  HistoryPoint,
} from "./types";

export { addDaysIso, assertNoFutureData, ensureFinite, sortedHistory, SUPPORTED_HORIZONS, targetDates, unavailableResult } from "./types";
export { NaiveYesterday, naiveYesterday } from "./naive-yesterday";
export { Rolling7DayMean, rolling7DayMean, REQUIRED_HISTORY_POINTS } from "./rolling-7-day-mean";
export { WeeklySeasonalNaive, weeklySeasonalNaive, SEASONAL_LAG_DAYS } from "./weekly-seasonal-naive";

import { naiveYesterday } from "./naive-yesterday";
import { rolling7DayMean } from "./rolling-7-day-mean";
import { weeklySeasonalNaive } from "./weekly-seasonal-naive";
import type { BaselineModel } from "./types";

/** Все baseline-модели этапа в фиксированном порядке. */
export const ALL_BASELINES: readonly BaselineModel[] = [naiveYesterday, rolling7DayMean, weeklySeasonalNaive];
