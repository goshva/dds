// Stage 3.4.5 Calculator: unit-тесты вычислителя адаптивного baseline.
// Только искусственные небольшие наборы; canonical CSV не используется.
import { describe, expect, test } from "bun:test";

import {
  calculateAdaptiveBaseline,
  calculateForVariant,
  type AdaptiveBaselineInput,
  type HistoryObservation,
  type Variant,
} from "../../src/forecasting/analytics/adaptive-baseline";

const ORIGIN = "2026-01-05"; // понедельник
const TARGET = "2026-01-06"; // вторник

/** История: 3 понедельника по 1000, 3 вторника по 1200, 3 среды по 900, 3 воскресенья по 800. */
function history(): HistoryObservation[] {
  return [
    { date: "2025-12-15", value: 1000 }, // пн
    { date: "2025-12-22", value: 1000 }, // пн
    { date: "2025-12-29", value: 1000 }, // пн
    { date: "2025-12-16", value: 1200 }, // вт
    { date: "2025-12-23", value: 1200 }, // вт
    { date: "2025-12-30", value: 1200 }, // вт
    { date: "2025-12-17", value: 900 }, // ср
    { date: "2025-12-24", value: 900 }, // ср
    { date: "2025-12-31", value: 900 }, // ср
    { date: "2025-12-14", value: 800 }, // вс
    { date: "2025-12-21", value: 800 }, // вс
    { date: "2025-12-28", value: 800 }, // вс
  ];
}

function input(overrides: Partial<AdaptiveBaselineInput> = {}): AdaptiveBaselineInput {
  return {
    originDate: ORIGIN,
    targetDate: TARGET,
    history: history(),
    baselineForecast: 1000,
    config: { variant: "B", alpha: 1.0, limitPercent: 0.1 },
    ...overrides,
  };
}

/** Дни недели для проверки вариантов: 2026-01-05 (пн) — 2026-01-11 (вс). */
const WEEK: Array<{ date: string; weekday: number }> = [
  { date: "2026-01-06", weekday: 2 },
  { date: "2026-01-07", weekday: 3 },
  { date: "2026-01-08", weekday: 4 },
  { date: "2026-01-09", weekday: 5 },
  { date: "2026-01-10", weekday: 6 },
  { date: "2026-01-11", weekday: 7 },
];

describe("профиль: средние по дням недели и weight", () => {
  test("общее среднее и средние по дням недели считаются корректно", () => {
    const result = calculateAdaptiveBaseline(input());
    expect(result.status).toBe("OK");
    // (3×1000 + 3×1200 + 3×900 + 3×800) / 12 = 975
    expect(result.diagnostics.overallMean).toBeCloseTo(975, 9);
    // вторник: 1200; weight = 1200 − 975 = 225
    expect(result.diagnostics.weekdayMean).toBeCloseTo(1200, 9);
    expect(result.diagnostics.weight).toBeCloseTo(225, 9);
    expect(result.correction).toBeCloseTo(100, 9); // clip(225, ±100)
    expect(result.correctedForecast).toBeCloseTo(1100, 9);
  });

  test("ровно 3 наблюдения на weekday — профиль доступен", () => {
    const result = calculateAdaptiveBaseline(input());
    expect(result.diagnostics.weekdayObservations).toBe(3);
    expect(result.applied).toBe(true);
  });

  test("2 наблюдения на weekday — INSUFFICIENT_HISTORY, без подстановки нуля", () => {
    const short = history().filter((observation) => observation.date !== "2025-12-30");
    const result = calculateAdaptiveBaseline(input({ history: short }));
    expect(result.status).toBe("INSUFFICIENT_HISTORY");
    expect(result.applied).toBe(false);
    expect(result.correction).toBe(0);
    expect(result.correctedForecast).toBe(1000);
    expect(result.diagnostics.weekdayObservations).toBe(2);
  });

  test("нет наблюдений для дня недели — MISSING_WEEKDAY_HISTORY", () => {
    const subset = history().filter((observation) => observation.date !== "2025-12-16" && observation.date !== "2025-12-23" && observation.date !== "2025-12-30");
    const result = calculateAdaptiveBaseline(input({ history: subset }));
    expect(result.status).toBe("MISSING_WEEKDAY_HISTORY");
    expect(result.correction).toBe(0);
    expect(result.correctedForecast).toBe(1000);
    expect(result.diagnostics.weekdayObservations).toBe(0);
  });

  test("пустая история — INSUFFICIENT_HISTORY", () => {
    const result = calculateAdaptiveBaseline(input({ history: [] }));
    expect(result.status).toBe("INSUFFICIENT_HISTORY");
  });

  test("одинаковые значения всех дней — weight = 0", () => {
    const flat = history().map((observation) => ({ ...observation, value: 1000 }));
    const result = calculateAdaptiveBaseline(input({ history: flat }));
    expect(result.diagnostics.weight).toBeCloseTo(0, 9);
    expect(result.correction).toBeCloseTo(0, 9);
  });
});

describe("Variant A: только понедельник и суббота", () => {
  test("понедельник получает поправку", () => {
    const result = calculateForVariant("A", { originDate: ORIGIN, targetDate: "2026-01-12", history: history(), baselineForecast: 1000, alpha: 1, limitPercent: 0.1 });
    expect(result.diagnostics.weekday).toBe(1);
    expect(result.applied).toBe(true);
  });

  test("суббота получает поправку", () => {
    const saturdayHistory = history().map((observation) => ({
      ...observation,
      value: observation.date === "2025-12-13" || observation.date === "2025-12-20" || observation.date === "2025-12-27" ? 1300 : observation.value,
    }));
    const result = calculateForVariant("A", {
      originDate: "2026-01-05",
      targetDate: "2026-01-10",
      history: [...saturdayHistory, { date: "2025-12-13", value: 1300 }, { date: "2025-12-20", value: 1300 }, { date: "2025-12-27", value: 1300 }],
      baselineForecast: 1000,
      alpha: 1,
      limitPercent: 0.1,
    });
    expect(result.diagnostics.weekday).toBe(6);
    expect(result.applied).toBe(true);
  });

  test("вторник–воскресенье не получают поправку", () => {
    for (const day of WEEK) {
      const result = calculateForVariant("A", { originDate: ORIGIN, targetDate: day.date, history: history(), baselineForecast: 1000, alpha: 1, limitPercent: 0.1 });
      expect(result.diagnostics.weekday).toBe(day.weekday);
      expect(result.applied, day.date).toBe(false);
      expect(result.correction, day.date).toBe(0);
      expect(result.correctedForecast, day.date).toBe(1000);
    }
  });
});

describe("Variant B: полный профиль", () => {
  test("каждый день недели использует свой weekday", () => {
    const expectations: Record<number, number | null> = {
      1: 1000, // пн
      2: 1200, // вт
      3: 900, // ср
      4: null, // чт — нет истории
      5: null, // пт
      6: null, // сб
      7: 800, // вс
    };
    for (const [weekday, expected] of Object.entries(expectations)) {
      const date = { 1: "2026-01-05", 2: "2026-01-06", 3: "2026-01-07", 4: "2026-01-08", 5: "2026-01-09", 6: "2026-01-10", 7: "2026-01-11" }[Number(weekday)]!;
      if (Number(weekday) === 1) continue; // понедельник = origin, target должен быть позже
      const result = calculateAdaptiveBaseline(input({ targetDate: date, config: { variant: "B", alpha: 1, limitPercent: 0.1 } }));
      if (expected === null) {
        expect(["MISSING_WEEKDAY_HISTORY", "INSUFFICIENT_HISTORY"]).toContain(result.status);
      } else {
        expect(result.diagnostics.weekdayMean, date).toBeCloseTo(expected, 9);
      }
    }
  });
});

describe("clipping, alpha и процентный лимит", () => {
  test("поправка ниже лимита применяется целиком", () => {
    const result = calculateAdaptiveBaseline(input({ config: { variant: "B", alpha: 0.1, limitPercent: 0.1 } }));
    expect(result.diagnostics.rawCorrection).toBeCloseTo(22.5, 9);
    expect(result.correction).toBeCloseTo(22.5, 9);
  });

  test("поправка выше лимита ограничивается", () => {
    const result = calculateAdaptiveBaseline(input({ config: { variant: "B", alpha: 1, limitPercent: 0.05 } }));
    expect(result.diagnostics.limitAbs).toBeCloseTo(50, 9);
    expect(result.correction).toBeCloseTo(50, 9);
    expect(Math.abs(result.correction!)).toBeLessThanOrEqual(result.diagnostics.limitAbs!);
  });

  test("отрицательная поправка ограничивается симметрично", () => {
    const result = calculateAdaptiveBaseline(input({ config: { variant: "B", alpha: 1, limitPercent: 0.05 } }));
    const negative = result.diagnostics.rawCorrection! > 0;
    expect(negative).toBe(true);
    // второй случай: день недели ниже среднего
    const result2 = calculateAdaptiveBaseline(
      input({ targetDate: "2026-01-11", config: { variant: "B", alpha: 1, limitPercent: 0.05 } }),
    );
    expect(result2.diagnostics.weekday).toBe(7);
    expect(result2.diagnostics.weight!).toBeLessThan(0);
    expect(result2.correction!).toBeLessThan(0);
    expect(result2.correction!).toBeGreaterThanOrEqual(-result2.diagnostics.limitAbs!);
  });

  test("alpha = 0: поправка строго ноль, corrected === baseline", () => {
    const result = calculateAdaptiveBaseline(input({ config: { variant: "B", alpha: 0, limitPercent: 0.1 } }));
    expect(result.status).toBe("OK");
    expect(result.correction).toBe(0);
    expect(result.correctedForecast).toBe(result.diagnostics.baselineForecast);
  });

  test("разные alpha масштабируют поправку", () => {
    const half = calculateAdaptiveBaseline(input({ config: { variant: "B", alpha: 0.5, limitPercent: 0.1 } }));
    const full = calculateAdaptiveBaseline(input({ config: { variant: "B", alpha: 1, limitPercent: 0.1 } }));
    expect(half.diagnostics.rawCorrection).toBeCloseTo(full.diagnostics.rawCorrection! / 2, 9);
  });

  test("нулевой baseline: limit_abs = 0, поправка = 0", () => {
    const result = calculateAdaptiveBaseline(input({ baselineForecast: 0, config: { variant: "B", alpha: 1, limitPercent: 0.1 } }));
    expect(result.diagnostics.limitAbs).toBe(0);
    expect(result.correction).toBe(0);
    expect(result.correctedForecast).toBe(0);
  });

  test("некорректный отрицательный limitPercent — INVALID_INPUT", () => {
    const result = calculateAdaptiveBaseline(input({ config: { variant: "B", alpha: 1, limitPercent: -0.1 } }));
    expect(result.status).toBe("INVALID_INPUT");
    expect(result.correctedForecast).toBeNull();
  });

  test("некорректный alpha — INVALID_INPUT", () => {
    expect(calculateAdaptiveBaseline(input({ config: { variant: "B", alpha: -1, limitPercent: 0.1 } })).status).toBe("INVALID_INPUT");
    expect(calculateAdaptiveBaseline(input({ config: { variant: "B", alpha: Number.NaN, limitPercent: 0.1 } })).status).toBe("INVALID_INPUT");
    expect(calculateAdaptiveBaseline(input({ config: { variant: "B", alpha: Number.POSITIVE_INFINITY, limitPercent: 0.1 } })).status).toBe("INVALID_INPUT");
  });
});

describe("leakage prevention", () => {
  test("наблюдение после origin блокируется", () => {
    const result = calculateAdaptiveBaseline(input({ history: [...history(), { date: "2026-01-06", value: 9999 }] }));
    expect(result.status).toBe("FUTURE_DATA_DETECTED");
    expect(result.correctedForecast).toBeNull();
  });

  test("наблюдение ровно на origin допускается", () => {
    const result = calculateAdaptiveBaseline(input({ history: [...history(), { date: ORIGIN, value: 1000 }] }));
    expect(result.status).toBe("OK");
    expect(result.diagnostics.historyLastDate).toBe(ORIGIN);
  });

  test("будущие значения (большие и меньшие) не влияют на результат", () => {
    const base = calculateAdaptiveBaseline(input());
    const withFutureBig = calculateAdaptiveBaseline(input({ history: [...history(), { date: "2026-01-07", value: 99999 }] }));
    const withFutureSmall = calculateAdaptiveBaseline(input({ history: [...history(), { date: "2026-01-07", value: 1 }] }));
    expect(withFutureBig.status).toBe("FUTURE_DATA_DETECTED");
    expect(withFutureSmall.status).toBe("FUTURE_DATA_DETECTED");
    expect(base.status).toBe("OK");
  });

  test("сортировка входа не обходит проверку", () => {
    const unsorted = [...history(), { date: "2026-02-01", value: 5000 }].sort((a, b) => b.date.localeCompare(a.date));
    const result = calculateAdaptiveBaseline(input({ history: unsorted }));
    expect(result.status).toBe("FUTURE_DATA_DETECTED");
  });

  test("дубликат даты — DUPLICATE_DATE", () => {
    const result = calculateAdaptiveBaseline(input({ history: [...history(), { date: "2025-12-15", value: 1000 }] }));
    expect(result.status).toBe("DUPLICATE_DATE");
  });

  test("неконечные значения — NON_FINITE_VALUE", () => {
    const result = calculateAdaptiveBaseline(input({ history: [...history(), { date: "2025-12-18", value: Number.NaN }] }));
    expect(result.status).toBe("NON_FINITE_VALUE");
    expect(calculateAdaptiveBaseline(input({ baselineForecast: Number.POSITIVE_INFINITY })).status).toBe("NON_FINITE_VALUE");
  });

  test("target не позже origin — INVALID_INPUT", () => {
    expect(calculateAdaptiveBaseline(input({ targetDate: ORIGIN })).status).toBe("INVALID_INPUT");
    expect(calculateAdaptiveBaseline(input({ targetDate: "2026-01-01" })).status).toBe("INVALID_INPUT");
  });
});

describe("детерминизм и инварианты", () => {
  const variants: Variant[] = ["A", "B"];
  test("повторный вызов с теми же аргументами даёт идентичный результат", () => {
    for (const variant of variants) {
      const config = { variant, alpha: 1, limitPercent: 0.1 };
      const first = calculateAdaptiveBaseline(input({ config }));
      const second = calculateAdaptiveBaseline(input({ config }));
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });

  test("инварианты: corrected = baseline + correction и |correction| ≤ limit_abs", () => {
    for (const variant of variants) {
      const result = calculateAdaptiveBaseline(input({ config: { variant, alpha: 1, limitPercent: 0.01 } }));
      if (result.status !== "OK" || !result.applied) continue;
      expect(result.correctedForecast!).toBeCloseTo(result.diagnostics.baselineForecast + result.correction!, 9);
      expect(Math.abs(result.correction!)).toBeLessThanOrEqual(result.diagnostics.limitAbs! + 1e-9);
    }
  });

  test("нет округления: значения сохраняют полную точность", () => {
    const result = calculateAdaptiveBaseline(input({ config: { variant: "B", alpha: 1, limitPercent: 0.123456789 } }));
    expect(result.diagnostics.limitAbs).toBeCloseTo(123.456789, 9);
    expect(result.correction).toBeCloseTo(123.456789, 9);
  });

  test("результат не зависит от текущего времени (повтор через паузу)", async () => {
    const first = calculateAdaptiveBaseline(input());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = calculateAdaptiveBaseline(input());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
describe("корректировка: дни без поправки возвращают baseline", () => {
  const BASELINE = 1000;

  test("Variant A, вторник: прогноз равен baseline", () => {
    const r = calculateForVariant("A", { originDate: ORIGIN, targetDate: "2026-01-06", history: history(), baselineForecast: BASELINE, alpha: 1, limitPercent: 0.1 });
    expect(r.status).toBe("OK");
    expect(r.applied).toBe(false);
    expect(r.correction).toBe(0);
    expect(r.correctedForecast).toBe(BASELINE);
  });

  test("Variant A, среда: прогноз равен baseline", () => {
    const r = calculateForVariant("A", { originDate: ORIGIN, targetDate: "2026-01-07", history: history(), baselineForecast: BASELINE, alpha: 1, limitPercent: 0.1 });
    expect(r.correctedForecast).toBe(BASELINE);
  });

  test("Variant A, четверг: прогноз равен baseline", () => {
    const r = calculateForVariant("A", { originDate: ORIGIN, targetDate: "2026-01-08", history: history(), baselineForecast: BASELINE, alpha: 1, limitPercent: 0.1 });
    expect(r.correctedForecast).toBe(BASELINE);
  });

  test("Variant A, пятница: прогноз равен baseline", () => {
    const r = calculateForVariant("A", { originDate: ORIGIN, targetDate: "2026-01-09", history: history(), baselineForecast: BASELINE, alpha: 1, limitPercent: 0.1 });
    expect(r.correctedForecast).toBe(BASELINE);
  });

  test("Variant A, воскресенье: прогноз равен baseline", () => {
    const r = calculateForVariant("A", { originDate: ORIGIN, targetDate: "2026-01-11", history: history(), baselineForecast: BASELINE, alpha: 1, limitPercent: 0.1 });
    expect(r.correctedForecast).toBe(BASELINE);
  });

  test("Variant A, понедельник: поправка применяется", () => {
    const r = calculateForVariant("A", { originDate: ORIGIN, targetDate: "2026-01-12", history: history(), baselineForecast: BASELINE, alpha: 1, limitPercent: 0.1 });
    expect(r.diagnostics.weekday).toBe(1);
    expect(r.applied).toBe(true);
    expect(r.correctedForecast).not.toBe(BASELINE);
  });

  test("Variant A, суббота: поправка применяется", () => {
    const sat = [...history(), { date: "2025-12-13", value: 1300 }, { date: "2025-12-20", value: 1300 }, { date: "2025-12-27", value: 1300 }];
    const r = calculateForVariant("A", { originDate: ORIGIN, targetDate: "2026-01-10", history: sat, baselineForecast: BASELINE, alpha: 1, limitPercent: 0.1 });
    expect(r.diagnostics.weekday).toBe(6);
    expect(r.applied).toBe(true);
  });

  test("Variant B, weekday с 2 наблюдениями: нулевая поправка и прогноз = baseline", () => {
    const short = history().filter((observation) => observation.date !== "2025-12-30");
    const r = calculateAdaptiveBaseline(input({ history: short }));
    expect(r.status).toBe("INSUFFICIENT_HISTORY");
    expect(r.correction).toBe(0);
    expect(r.correctedForecast).toBe(BASELINE);
    expect(r.diagnostics.weekdayObservations).toBe(2);
  });

  test("Variant B, weekday с 1 наблюдением: нулевая поправка и прогноз = baseline", () => {
    const one = history().filter((observation) => observation.date !== "2025-12-23" && observation.date !== "2025-12-30");
    const r = calculateAdaptiveBaseline(input({ history: one }));
    expect(r.status).toBe("INSUFFICIENT_HISTORY");
    expect(r.correction).toBe(0);
    expect(r.correctedForecast).toBe(BASELINE);
    expect(r.diagnostics.weekdayObservations).toBe(1);
  });

  test("Variant B, weekday без наблюдений: нулевая поправка и прогноз = baseline", () => {
    const noTuesday = history().filter((observation) => !["2025-12-16", "2025-12-23", "2025-12-30"].includes(observation.date));
    const r = calculateAdaptiveBaseline(input({ history: noTuesday }));
    expect(r.status).toBe("MISSING_WEEKDAY_HISTORY");
    expect(r.correction).toBe(0);
    expect(r.correctedForecast).toBe(BASELINE);
    expect(r.diagnostics.weekdayObservations).toBe(0);
  });

  test("при 3 наблюдениях профиль доступен", () => {
    const r = calculateAdaptiveBaseline(input());
    expect(r.applied).toBe(true);
    expect(r.profile.find((entry) => entry.weekday === 2)?.available).toBe(true);
  });

  test("alpha = 0: прогноз равен baseline для обоих вариантов", () => {
    for (const variant of ["A", "B"] as const) {
      const r = calculateAdaptiveBaseline(input({ config: { variant, alpha: 0, limitPercent: 0.1 } }));
      expect(r.correction).toBe(0);
      expect(r.correctedForecast).toBe(BASELINE);
    }
  });

  test("профиль при пустой истории не содержит NaN/Infinity", () => {
    // публичная функция исключена из API; проверяем через публичный результат
    const r = calculateAdaptiveBaseline(input({ history: [] }));
    expect(r.status).toBe("INSUFFICIENT_HISTORY");
    expect(r.diagnostics.overallMean).toBeNull();
    expect(r.diagnostics.weight).toBeNull();
    expect(r.correction).toBeNull();
  });

  test("одинаковое множество прогнозных дат для baseline, Variant A и Variant B", () => {
    const dates = ["2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11", "2026-01-12"];
    for (const date of dates) {
      const a = calculateForVariant("A", { originDate: ORIGIN, targetDate: date, history: history(), baselineForecast: BASELINE, alpha: 1, limitPercent: 0.1 });
      const b = calculateForVariant("B", { originDate: ORIGIN, targetDate: date, history: history(), baselineForecast: BASELINE, alpha: 1, limitPercent: 0.1 });
      expect(a.diagnostics.targetDate, date).toBe(date);
      expect(b.diagnostics.targetDate, date).toBe(date);
      expect(a.correctedForecast, date).not.toBeNull();
      expect(b.correctedForecast, date).not.toBeNull();
    }
  });
});