// Stage 3.3.4: baseline-модели — граничные случаи, отсутствие утечки, горизонты.
import { describe, expect, test } from "bun:test";

import { ALL_BASELINES, naiveYesterday, rolling7DayMean, weeklySeasonalNaive } from "../../src/forecasting/baselines";
import { addDaysIso, assertNoFutureData, targetDates } from "../../src/forecasting/baselines/types";
import type { HistoryPoint } from "../../src/forecasting/baselines";

/** Непрерывная история из N дней, начиная с 2026-10-01. */
function series(values: number[], start = "2026-10-01"): HistoryPoint[] {
  return values.map((value, index) => ({ date: addDaysIso(start, index), value }));
}

function input(values: number[], horizon: number, start = "2026-10-01") {
  const history = series(values, start);
  const originDate = history.at(-1)!.date;
  return { originDate, horizonDays: horizon, history, timezone: "Europe/Moscow" };
}

describe("общие правила baseline-моделей", () => {
  test("target-даты формируются календарно от origin", () => {
    expect(targetDates("2026-10-31", 3)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(targetDates("2025-12-30", 3)).toEqual(["2025-12-31", "2026-01-01", "2026-01-02"]);
    expect(() => targetDates("2026-10-01", 0)).toThrow(/горизонт/);
  });

  test("попытка передать будущие наблюдения приводит к ошибке", () => {
    const history = series([1, 2, 3]);
    expect(() => assertNoFutureData({ originDate: history[1]!.date, horizonDays: 1, history, timezone: "Europe/Moscow" })).toThrow(/утечка данных/);
  });

  test("NaN в истории отклоняется", () => {
    const history: HistoryPoint[] = [{ date: "2026-10-01", value: Number.NaN }];
    expect(() => assertNoFutureData({ originDate: "2026-10-01", horizonDays: 1, history, timezone: "Europe/Moscow" })).toThrow(/некорректное значение/);
  });

  test("три модели присутствуют в фиксированном порядке", () => {
    expect(ALL_BASELINES.map((model) => model.name)).toEqual(["naive_yesterday", "rolling_7_day_mean", "weekly_seasonal_naive"]);
  });
});

describe("naive_yesterday", () => {
  test("прогноз равен последнему фактическому значению для всех горизонтов", () => {
    const result = naiveYesterday.forecast(input([100, 110, 120], 7));
    expect(result.points.length).toBe(7);
    expect(result.points.every((point) => point.value === 120)).toBe(true);
    expect(result.diagnostics.lastHistoryDate).toBe("2026-10-03");
  });

  test("один день истории — прогноз возможен", () => {
    expect(naiveYesterday.forecast(input([42], 1)).points[0]!.value).toBe(42);
  });

  test("пустая история — прогноз недоступен без подстановки нуля", () => {
    const result = naiveYesterday.forecast({ originDate: "2026-10-01", horizonDays: 3, history: [], timezone: "Europe/Moscow" });
    expect(result.points.every((point) => point.status === "unavailable")).toBe(true);
    expect(result.points.every((point) => point.value === null)).toBe(true);
  });

  test("нулевое и отрицательное значения сохраняются как есть", () => {
    expect(naiveYesterday.forecast(input([10, 0], 1)).points[0]!.value).toBe(0);
    expect(naiveYesterday.forecast(input([10, -5], 1)).points[0]!.value).toBe(-5);
  });

  test("дробное значение не округляется", () => {
    expect(naiveYesterday.forecast(input([10, 12.5], 1)).points[0]!.value).toBe(12.5);
  });
});

describe("rolling_7_day_mean", () => {
  test("среднее последних семи фактических наблюдений", () => {
    const result = rolling7DayMean.forecast(input([10, 20, 30, 40, 50, 60, 70, 80], 3));
    // последние 7 значений: 20…80 → среднее 50
    expect(result.points.every((point) => point.value === 50)).toBe(true);
    expect(result.diagnostics.notes.join(" ")).toContain("2026-10-02");
  });

  test("ровно 7 наблюдений — прогноз возможен", () => {
    expect(rolling7DayMean.forecast(input([1, 2, 3, 4, 5, 6, 7], 1)).points[0]!.value).toBe(4);
  });

  test("меньше 7 наблюдений — прогноз недоступен", () => {
    const result = rolling7DayMean.forecast(input([1, 2, 3, 4, 5, 6], 3));
    expect(result.points.every((point) => point.status === "unavailable")).toBe(true);
    expect(result.diagnostics.notes.join(" ")).toContain("недостаточно фактической истории");
  });

  test("пропущенная дата не заполняется: используются только фактические наблюдения", () => {
    const history: HistoryPoint[] = [
      { date: "2026-10-01", value: 10 },
      { date: "2026-10-02", value: 20 },
      { date: "2026-10-04", value: 40 }, // 2026-10-03 отсутствует
      { date: "2026-10-05", value: 50 },
      { date: "2026-10-06", value: 60 },
      { date: "2026-10-07", value: 70 },
      { date: "2026-10-08", value: 80 },
    ];
    const result = rolling7DayMean.forecast({ originDate: "2026-10-08", horizonDays: 1, history, timezone: "Europe/Moscow" });
    const expected = (10 + 20 + 40 + 50 + 60 + 70 + 80) / 7;
    expect(result.points[0]!.value).toBeCloseTo(expected, 9);
  });

  test("дубликат даты не удваивает вес наблюдения (используются последние 7 записей)", () => {
    const history = [...series([10, 20, 30, 40]), { date: "2026-10-04", value: 40 }, ...series([50, 60, 70], "2026-10-05")];
    const result = rolling7DayMean.forecast({ originDate: "2026-10-07", horizonDays: 1, history, timezone: "Europe/Moscow" });
    const window = history.slice(-7).map((point) => point.value);
    expect(result.points[0]!.value).toBeCloseTo(window.reduce((acc, value) => acc + value, 0) / 7, 9);
  });

  test("нулевые значения входят в среднее (не выбрасываются)", () => {
    expect(rolling7DayMean.forecast(input([7, 0, 0, 0, 0, 0, 0], 1)).points[0]!.value).toBe(1);
  });

  test("горизонты 1, 3, 7, 14 дают одинаковое значение", () => {
    for (const horizon of [1, 3, 7, 14]) {
      const result = rolling7DayMean.forecast(input([10, 11, 12, 13, 14, 15, 16], horizon));
      expect(result.points.length).toBe(horizon);
      expect(result.points.every((point) => point.value === 13)).toBe(true);
    }
  });

  test("переход месяца и года не влияет на расчёт", () => {
    expect(rolling7DayMean.forecast(input([1, 2, 3, 4, 5, 6, 8], 1, "2025-12-28")).points[0]!.value).toBeCloseTo(29 / 7, 9);
  });
});

describe("weekly_seasonal_naive", () => {
  test("прогноз равен значению того же дня недели предыдущей недели", () => {
    const values = [100, 110, 120, 130, 140, 150, 160, 200, 210, 220];
    const result = weeklySeasonalNaive.forecast(input(values, 3));
    // история: 10-01=100, 10-02=110, 10-03=120, 10-04=130, …; origin = 2026-10-10
    // target 10-11 → источник 10-04 (130); 10-12 → 10-05 (140); 10-13 → 10-06 (150)
    expect(result.points[0]!.targetDate).toBe("2026-10-11");
    expect(result.points[0]!.value).toBe(130);
    expect(result.points[1]!.value).toBe(140);
    expect(result.points[2]!.value).toBe(150);
  });

  test("горизонт 14: шаги 1–7 доступны, 8–14 недоступны без интерполяции", () => {
    const result = weeklySeasonalNaive.forecast(input(Array.from({ length: 21 }, (_, index) => 100 + index), 14));
    const available = result.points.filter((point) => point.status === "ok");
    const unavailable = result.points.filter((point) => point.status === "unavailable");
    expect(available.length).toBe(7);
    expect(unavailable.length).toBe(7);
    expect(unavailable.every((point) => point.value === null)).toBe(true);
    expect(unavailable[0]!.reason).toContain("позже origin");
  });

  test("отсутствующее значение ровно на d − 7 делает прогноз недоступным", () => {
    const history: HistoryPoint[] = [
      { date: "2026-10-01", value: 10 },
      { date: "2026-10-02", value: 20 },
      { date: "2026-10-03", value: 30 },
      { date: "2026-10-05", value: 50 },
      { date: "2026-10-06", value: 60 },
      { date: "2026-10-07", value: 70 },
      { date: "2026-10-08", value: 80 },
    ];
    const result = weeklySeasonalNaive.forecast({ originDate: "2026-10-08", horizonDays: 1, history, timezone: "Europe/Moscow" });
    // target 2026-10-09 → источник 2026-10-02 (есть), поэтому доступно
    expect(result.points[0]!.value).toBe(20);
  });

  test("нулевое значение источника сохраняется (это факт, а не пропуск)", () => {
    // источник для target 2026-10-09 — дата 2026-10-02 со значением 0
    expect(weeklySeasonalNaive.forecast(input([5, 0, 2, 3, 4, 5, 6, 7], 1)).points[0]!.value).toBe(0);
  });

  test("горизонты 1, 3 и 7 доступны полностью", () => {
    for (const horizon of [1, 3, 7]) {
      const result = weeklySeasonalNaive.forecast(input(Array.from({ length: 30 }, (_, index) => 100 + index), horizon));
      expect(result.points.filter((point) => point.status === "ok").length).toBe(horizon);
    }
  });
});
