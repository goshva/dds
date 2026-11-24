/**
 * Stage 3.4.5 — изолированный вычислитель адаптивного baseline (не production pipeline).
 *
 * Формула (утверждена спецификацией):
 *   forecast_corrected(d) = forecast_rolling(d) + clip(alpha * weight(d), ±limit_abs)
 *   weight(d) = mean_by_weekday(history ≤ origin) − mean(history ≤ origin)
 *   limit_abs = |baseline_forecast| × limit_percent
 *
 * Модуль не запускает backtesting, не выбирает конфигурацию и не меняет rolling_7_day_mean.
 * Все функции чистые и детерминированные: нет обращений к часам, файлам, сети, БД.
 */

import { isoDayOfWeek } from "../calendar/calendar-core";

export type Variant = "A" | "B";

export type AdaptiveStatus =
  | "OK"
  | "INSUFFICIENT_HISTORY"
  | "MISSING_WEEKDAY_HISTORY"
  | "INVALID_INPUT"
  | "FUTURE_DATA_DETECTED"
  | "DUPLICATE_DATE"
  | "NON_FINITE_VALUE";

/** Дни, к которым применяется поправка в варианте A. */
export const VARIANT_A_WEEKDAYS: ReadonlySet<number> = new Set([1, 6]); // понедельник, суббота
export const DEFAULT_MIN_WEEKDAY_OBSERVATIONS = 3;

export interface HistoryObservation {
  date: string;
  value: number;
}

export interface AdaptiveBaselineConfig {
  variant: Variant;
  alpha: number;
  /** Доля от |baseline_forecast|: 0.10 = 10 %. */
  limitPercent: number;
  /** Минимум наблюдений для каждого дня недели (по умолчанию 3). */
  minWeekdayObservations?: number;
}

export interface AdaptiveBaselineInput {
  originDate: string;
  targetDate: string;
  /** Фактическая история; наблюдения с датой > originDate запрещены. */
  history: readonly HistoryObservation[];
  /** Прогноз действующего rolling_7_day_mean на targetDate. */
  baselineForecast: number;
  config: AdaptiveBaselineConfig;
}

export interface WeekdayProfile {
  weekday: number;
  observations: number;
  mean: number | null;
  available: boolean;
}

export interface AdaptiveDiagnostics {
  originDate: string;
  targetDate: string;
  weekday: number;
  variant: Variant;
  historyObservations: number;
  historyLastDate: string | null;
  overallMean: number | null;
  weekdayObservations: number;
  weekdayMean: number | null;
  weight: number | null;
  alpha: number;
  limitPercent: number;
  baselineForecast: number;
  limitAbs: number | null;
  rawCorrection: number | null;
  correction: number | null;
  correctedForecast: number | null;
  applied: boolean;
  minWeekdayObservations: number;
  message: string;
}

export interface AdaptiveBaselineResult {
  status: AdaptiveStatus;
  applied: boolean;
  correction: number | null;
  correctedForecast: number | null;
  profile: ReadonlyArray<WeekdayProfile>;
  diagnostics: AdaptiveDiagnostics;
}

// ---------------------------------------------------------------------------
// Валидация (fail-closed)
// ---------------------------------------------------------------------------

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isFiniteNumber(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

interface ValidationOutcome {
  ok: boolean;
  status: AdaptiveStatus;
  message: string;
}

function validateInput(input: AdaptiveBaselineInput): ValidationOutcome {
  const fail = (status: AdaptiveStatus, message: string): ValidationOutcome => ({ ok: false, status, message });
  const { config } = input;

  if (!isIsoDate(input.originDate)) return fail("INVALID_INPUT", "originDate должен быть корректной ISO-датой");
  if (!isIsoDate(input.targetDate)) return fail("INVALID_INPUT", "targetDate должен быть корректной ISO-датой");
  if (input.targetDate <= input.originDate) return fail("INVALID_INPUT", "targetDate должен быть позже originDate");

  if (config.variant !== "A" && config.variant !== "B") return fail("INVALID_INPUT", `неизвестный вариант: ${String(config.variant)}`);
  if (!isFiniteNumber(config.alpha) || config.alpha < 0) return fail("INVALID_INPUT", "alpha должен быть конечным и неотрицательным");
  if (!isFiniteNumber(config.limitPercent) || config.limitPercent < 0) return fail("INVALID_INPUT", "limitPercent должен быть конечным и неотрицательным");
  const minWeekday = config.minWeekdayObservations ?? DEFAULT_MIN_WEEKDAY_OBSERVATIONS;
  if (!Number.isInteger(minWeekday) || minWeekday < 1) return fail("INVALID_INPUT", "minWeekdayObservations должен быть целым ≥ 1");

  if (!isFiniteNumber(input.baselineForecast)) return fail("NON_FINITE_VALUE", "baselineForecast должен быть конечным числом");

  if (!input.history.length) return fail("INSUFFICIENT_HISTORY", "пустая история: профиль рассчитать нельзя");

  const seen = new Set<string>();
  for (const observation of input.history) {
    if (!isIsoDate(observation.date)) return fail("INVALID_INPUT", `некорректная дата истории: ${String(observation.date)}`);
    if (seen.has(observation.date)) return fail("DUPLICATE_DATE", `дубликат даты в истории: ${observation.date}`);
    seen.add(observation.date);
    if (!isFiniteNumber(observation.value)) return fail("NON_FINITE_VALUE", `неконечное значение истории: ${observation.date}`);
    if (observation.date > input.originDate) return fail("FUTURE_DATA_DETECTED", `наблюдение ${observation.date} позже origin ${input.originDate}`);
  }

  return { ok: true, status: "OK", message: "вход корректен" };
}

// ---------------------------------------------------------------------------
// Профиль
// ---------------------------------------------------------------------------

export function buildWeekdayProfile(
  history: readonly HistoryObservation[],
  originDate: string,
  minWeekdayObservations = DEFAULT_MIN_WEEKDAY_OBSERVATIONS,
): { overallMean: number | null; byWeekday: Map<number, WeekdayProfile>; lastDate: string | null } {
  const usable = history.filter((observation) => observation.date <= originDate);
  // пустая история не должна давать NaN: среднего нет
  const overallMean = usable.length
    ? usable.reduce((acc, observation) => acc + observation.value, 0) / usable.length
    : null;
  const buckets = new Map<number, number[]>();
  for (const observation of usable) {
    const weekday = isoDayOfWeek(observation.date);
    buckets.set(weekday, [...(buckets.get(weekday) ?? []), observation.value]);
  }
  const byWeekday = new Map<number, WeekdayProfile>();
  for (const [weekday, values] of buckets) {
    byWeekday.set(weekday, {
      weekday,
      observations: values.length,
      mean: values.reduce((acc, value) => acc + value, 0) / values.length,
      available: values.length >= minWeekdayObservations,
    });
  }
  const lastDate = usable.length ? [...usable].map((observation) => observation.date).sort().at(-1)! : null;
  return { overallMean, byWeekday, lastDate };
}

// ---------------------------------------------------------------------------
// Поправка
// ---------------------------------------------------------------------------

function clip(value: number, limit: number): number {
  if (limit < 0) throw new Error("clip: отрицательный предел");
  if (value > limit) return limit;
  if (value < -limit) return -limit;
  return value;
}

function buildResult(
  status: AdaptiveStatus,
  input: AdaptiveBaselineInput,
  message: string,
  extras: Partial<AdaptiveDiagnostics> = {},
  profile: ReadonlyArray<WeekdayProfile> = [],
): AdaptiveBaselineResult {
  const weekday = isIsoDate(input.targetDate) ? isoDayOfWeek(input.targetDate) : 0;
  const minWeekday = input.config?.minWeekdayObservations ?? DEFAULT_MIN_WEEKDAY_OBSERVATIONS;
  return {
    status,
    applied: extras.applied ?? false,
    correction: extras.correction ?? null,
    correctedForecast: extras.correctedForecast ?? null,
    profile,
    diagnostics: {
      originDate: input.originDate,
      targetDate: input.targetDate,
      weekday,
      variant: input.config?.variant ?? "B",
      historyObservations: input.history?.length ?? 0,
      historyLastDate: null,
      overallMean: null,
      weekdayObservations: 0,
      weekdayMean: null,
      weight: null,
      alpha: input.config?.alpha ?? 0,
      limitPercent: input.config?.limitPercent ?? 0,
      baselineForecast: input.baselineForecast,
      limitAbs: null,
      rawCorrection: null,
      correction: null,
      correctedForecast: null,
      applied: false,
      minWeekdayObservations: minWeekday,
      message,
      ...extras,
    },
  };
}

export function calculateAdaptiveBaseline(input: AdaptiveBaselineInput): AdaptiveBaselineResult {
  const validation = validateInput(input);
  if (!validation.ok) {
    return buildResult(validation.status, input, validation.message, {
      historyObservations: input.history.length,
    });
  }

  const minWeekday = input.config.minWeekdayObservations ?? DEFAULT_MIN_WEEKDAY_OBSERVATIONS;
  const weekday = isoDayOfWeek(input.targetDate);
  const { overallMean, byWeekday, lastDate } = buildWeekdayProfile(input.history, input.originDate, minWeekday);
  const profileEntries = [...byWeekday.values()].sort((a, b) => a.weekday - b.weekday);

  const variantApplies = input.config.variant === "B" || VARIANT_A_WEEKDAYS.has(weekday);
  if (!variantApplies) {
    return buildResult(
      "OK",
      input,
      `вариант A: поправка не применяется к дню недели ${weekday}`,
      {
        historyLastDate: lastDate,
        overallMean,
        weekdayObservations: byWeekday.get(weekday)?.observations ?? 0,
        weekdayMean: byWeekday.get(weekday)?.mean ?? null,
        weight: 0,
        correction: 0,
        correctedForecast: input.baselineForecast,
      },
      profileEntries,
    );
  }

  const weekdayEntry = byWeekday.get(weekday);
  if (!weekdayEntry) {
    return buildResult(
      "MISSING_WEEKDAY_HISTORY",
      input,
      `нет наблюдений для дня недели ${weekday}: поправка не применяется (weight = 0)`,
      {
        historyLastDate: lastDate,
        overallMean,
        weekdayObservations: 0,
        weight: 0,
        correction: 0,
        correctedForecast: input.baselineForecast,
      },
      profileEntries,
    );
  }
  if (weekdayEntry.observations < minWeekday) {
    return buildResult(
      "INSUFFICIENT_HISTORY",
      input,
      `для дня недели ${weekday} нужно ≥ ${minWeekday} наблюдений, есть ${weekdayEntry.observations}: поправка не применяется (weight = 0)`,
      {
        historyLastDate: lastDate,
        overallMean,
        weekdayObservations: weekdayEntry.observations,
        weekdayMean: weekdayEntry.mean,
        weight: 0,
        correction: 0,
        correctedForecast: input.baselineForecast,
      },
      profileEntries,
    );
  }

  if (overallMean === null) {
    // защита от непустой по типу, но пустой по факту истории: fail-closed без NaN
    return buildResult(
      "INSUFFICIENT_HISTORY",
      input,
      "нет фактической истории до origin: среднее рассчитать нельзя",
      {
        historyLastDate: lastDate,
        overallMean: null,
        weight: 0,
        correction: 0,
        correctedForecast: input.baselineForecast,
      },
      profileEntries,
    );
  }

  const weight = (weekdayEntry.mean as number) - overallMean;
  const limitAbs = Math.abs(input.baselineForecast) * input.config.limitPercent;
  const rawCorrection = input.config.alpha * weight;
  const correction = clip(rawCorrection, limitAbs);
  const correctedForecast = input.baselineForecast + correction;

  return {
    status: "OK",
    applied: true,
    correction,
    correctedForecast,
    profile: profileEntries,
    diagnostics: {
      originDate: input.originDate,
      targetDate: input.targetDate,
      weekday,
      variant: input.config.variant,
      historyObservations: input.history.length,
      historyLastDate: lastDate,
      overallMean,
      weekdayObservations: weekdayEntry.observations,
      weekdayMean: weekdayEntry.mean,
      weight,
      alpha: input.config.alpha,
      limitPercent: input.config.limitPercent,
      baselineForecast: input.baselineForecast,
      limitAbs,
      rawCorrection,
      correction,
      correctedForecast,
      applied: true,
      minWeekdayObservations: minWeekday,
      message: input.config.variant === "A" ? "вариант A: поправка применена" : "вариант B: поправка применена",
    },
  };
}

/** Единая точка входа по варианту: не выполняет backtesting и оценку качества. */
export function calculateForVariant(
  variant: Variant,
  input: Omit<AdaptiveBaselineInput, "config"> & { alpha: number; limitPercent: number; minWeekdayObservations?: number },
): AdaptiveBaselineResult {
  return calculateAdaptiveBaseline({
    ...input,
    config: { variant, alpha: input.alpha, limitPercent: input.limitPercent, minWeekdayObservations: input.minWeekdayObservations },
  });
}