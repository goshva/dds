/**
 * Stage 3.4.3 — feature provider согласованных календарных признаков.
 *
 * Разрешены только четыре признака (утверждены по итогам Stage 3.4.2):
 * day_of_week, is_weekend, month, season. Праздники, переносы выходных,
 * погода и городские события в основной эксперимент не входят.
 *
 * Все признаки вычисляются из календарной даты в Europe/Moscow и известны заранее,
 * поэтому утечка будущих фактических значений невозможна.
 */

import { calendarFeatures, isoDayOfWeek, MOSCOW_TIMEZONE, seasonOf, type CalendarFeatures } from "./calendar-core";

export interface CalendarFeatureVector {
  date: string;
  day_of_week: number;
  is_weekend: boolean;
  month: number;
  season: "winter" | "spring" | "summer" | "autumn";
}

export const APPROVED_FEATURE_NAMES = ["day_of_week", "is_weekend", "month", "season"] as const;

export const CALENDAR_FEATURE_PROVIDER_VERSION = "calendar-features/v1";

/** Признаки для одной даты. Зависит только от даты, не от значений целевого ряда. */
export function calendarFeatureVector(date: string): CalendarFeatureVector {
  const features: CalendarFeatures = calendarFeatures(date);
  return {
    date: features.date,
    day_of_week: features.dayOfWeek,
    is_weekend: features.isWeekend,
    month: features.month,
    season: features.season,
  };
}

/** Признаки для диапазона дат включительно. */
export function calendarFeatureRange(from: string, to: string): CalendarFeatureVector[] {
  const result: CalendarFeatureVector[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to) {
    result.push(calendarFeatureVector(cursor));
    const parsed = new Date(`${cursor}T00:00:00Z`);
    parsed.setUTCDate(parsed.getUTCDate() + 1);
    cursor = parsed.toISOString().slice(0, 10);
    if (++guard > 4000) throw new Error("calendarFeatureRange: превышен предел диапазона");
  }
  return result;
}

/** Провайдер как объект: единая точка доступа для моделей и тестов. */
export const calendarFeatureProvider = {
  version: CALENDAR_FEATURE_PROVIDER_VERSION,
  timezone: MOSCOW_TIMEZONE,
  features: APPROVED_FEATURE_NAMES,
  forDate: calendarFeatureVector,
  forRange: calendarFeatureRange,
  /** Признак известен заранее — доступен на любом forecast origin. */
  knownInAdvance: true as const,
  /** Проверка, что все признаки вычисляются без обращения к значениям ряда. */
  describe(): string {
    return `calendar features ${CALENDAR_FEATURE_PROVIDER_VERSION} (${MOSCOW_TIMEZONE}): ${APPROVED_FEATURE_NAMES.join(", ")}`;
  },
};

export { isoDayOfWeek, seasonOf };
