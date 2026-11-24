/**
 * Stage 3.4.3 — модель-кандидат на календарных признаках.
 *
 * Правило: для целевой даты берётся среднее ФАКТИЧЕСКИХ значений истории с совпадающими
 * календарными признаками, доступных на origin. Иерархия профилей:
 *   1) день недели + месяц;
 *   2) день недели + сезон;
 *   3) день недели.
 * Если ни в одном профиле нет минимум MIN_SUPPORT наблюдений, прогноз помечается
 * `unavailable` — интерполяция и подстановка нуля запрещены.
 *
 * Модель не обращается к значениям позже origin и не использует праздники/переносы.
 */

import { calendarFeatureVector, type CalendarFeatureVector } from "../analytics/calendar/feature-provider";
import {
  assertNoFutureData,
  ensureFinite,
  sortedHistory,
  targetDates,
  unavailableResult,
  type BaselineModel,
  type ForecastInput,
  type ForecastPoint,
  type ForecastResult,
  type HistoryPoint,
} from "./types";

export type ProfileLevel = "weekday_month" | "weekday_season" | "weekday";

export interface CalendarProfile {
  key: string;
  level: ProfileLevel;
  dow: number;
  month: number | null;
  season: string | null;
  n: number;
  mean: number;
}

export const MIN_SUPPORT = 3;

export const CALENDAR_MODEL_NAME = "calendar_weekday_seasonal_mean";

function profileKey(level: ProfileLevel, features: CalendarFeatureVector): string {
  if (level === "weekday_month") return `${features.day_of_week}|${features.month}`;
  if (level === "weekday_season") return `${features.day_of_week}|${features.season}`;
  return `${features.day_of_week}`;
}

/** Профиль строится только по истории, доступной на origin. */
export function buildCalendarProfiles(history: readonly HistoryPoint[]): Map<string, CalendarProfile> {
  const buckets = new Map<string, { level: ProfileLevel; features: CalendarFeatureVector; values: number[] }>();
  for (const point of history) {
    const features = calendarFeatureVector(point.date);
    for (const level of ["weekday_month", "weekday_season", "weekday"] as ProfileLevel[]) {
      const key = profileKey(level, features);
      const bucket = buckets.get(key) ?? { level, features, values: [] };
      bucket.values.push(point.value);
      buckets.set(key, bucket);
    }
  }

  const profiles = new Map<string, CalendarProfile>();
  for (const [key, bucket] of buckets) {
    profiles.set(key, {
      key,
      level: bucket.level,
      dow: bucket.features.day_of_week,
      month: bucket.level === "weekday_month" ? bucket.features.month : null,
      season: bucket.level === "weekday_season" ? bucket.features.season : null,
      n: bucket.values.length,
      mean: bucket.values.reduce((acc, value) => acc + value, 0) / bucket.values.length,
    });
  }
  return profiles;
}

export class CalendarWeekdaySeasonalMean implements BaselineModel {
  readonly name = CALENDAR_MODEL_NAME;

  forecast(input: ForecastInput): ForecastResult {
    assertNoFutureData(input);
    const history = sortedHistory(input);
    if (!history.length) return unavailableResult(this.name, input, "нет фактической истории", 0, null);

    const profiles = buildCalendarProfiles(history);
    const points: ForecastPoint[] = targetDates(input.originDate, input.horizonDays).map((targetDate) => {
      const features = calendarFeatureVector(targetDate);
      for (const level of ["weekday_month", "weekday_season", "weekday"] as ProfileLevel[]) {
        const profile = profiles.get(profileKey(level, features));
        if (profile && profile.n >= MIN_SUPPORT) {
          return {
            targetDate,
            value: ensureFinite(profile.mean, this.name),
            status: "ok" as const,
            reason: null,
          };
        }
      }
      return {
        targetDate,
        value: null,
        status: "unavailable" as const,
        reason: `профиль дня недели ${features.day_of_week} не имеет ${MIN_SUPPORT} наблюдений на origin`,
      };
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
          `профилей построено: ${profiles.size}`,
          `минимальная поддержка профиля: ${MIN_SUPPORT} наблюдений`,
          `доступно прогнозов: ${available} из ${points.length}`,
          "праздники, переносы и внешние факторы не используются",
        ],
      },
    };
  }
}

export const calendarWeekdaySeasonalMean = new CalendarWeekdaySeasonalMean();
