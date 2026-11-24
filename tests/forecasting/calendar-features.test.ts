// Stage 3.4.3: тесты календарного provider и модели-кандидата.
import { describe, expect, test } from "bun:test";

import { APPROVED_FEATURE_NAMES, calendarFeatureProvider, calendarFeatureRange, calendarFeatureVector } from "../../src/forecasting/analytics/calendar/feature-provider";
import { CalendarWeekdaySeasonalMean, buildCalendarProfiles, calendarWeekdaySeasonalMean, MIN_SUPPORT } from "../../src/forecasting/baselines/calendar-weekday-seasonal-mean";
import { addDaysIso } from "../../src/forecasting/baselines/types";
import type { HistoryPoint } from "../../src/forecasting/baselines";

function input(values: number[], horizon: number, start = "2025-01-06") {
  const history: HistoryPoint[] = values.map((value, index) => ({ date: addDaysIso(start, index), value }));
  return { originDate: history.at(-1)!.date, horizonDays: horizon, history, timezone: "Europe/Moscow" };
}

describe("provider: согласованные признаки", () => {
  test("ровно четыре утверждённых признака, без праздников и переносов", () => {
    expect([...APPROVED_FEATURE_NAMES]).toEqual(["day_of_week", "is_weekend", "month", "season"]);
    expect(calendarFeatureProvider.features).toEqual(APPROVED_FEATURE_NAMES);
    expect(calendarFeatureProvider.timezone).toBe("Europe/Moscow");
    expect(calendarFeatureProvider.knownInAdvance).toBe(true);
  });

  test("вектор признаков содержит только календарные поля", () => {
    const vector = calendarFeatureVector("2025-03-31");
    expect(Object.keys(vector).sort()).toEqual(["date", "day_of_week", "is_weekend", "month", "season"].sort());
    expect(vector).toEqual({ date: "2025-03-31", day_of_week: 1, is_weekend: false, month: 3, season: "spring" });
  });

  test("независимость от timezone процесса", () => {
    const original = process.env.TZ;
    try {
      for (const zone of ["UTC", "America/New_York", "Asia/Tokyo"]) {
        process.env.TZ = zone;
        expect(calendarFeatureVector("2026-11-22")).toEqual(calendarFeatureVector("2026-11-22"));
        expect(calendarFeatureVector("2026-11-22").day_of_week, zone).toBe(7);
        expect(calendarFeatureVector("2024-02-29").month, zone).toBe(2);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  test("границы года, месяца и високосный год", () => {
    expect(calendarFeatureRange("2025-12-31", "2026-01-02").map((vector) => vector.date)).toEqual(["2025-12-31", "2026-01-01", "2026-01-02"]);
    expect(calendarFeatureVector("2025-12-31").month).toBe(12);
    expect(calendarFeatureVector("2026-01-01").month).toBe(1);
    expect(calendarFeatureVector("2024-02-29").day_of_week).toBe(4); // четверг
    expect(calendarFeatureRange("2024-02-28", "2024-03-01").length).toBe(3);
  });

  test("выходные и сезоны определяются корректно", () => {
    expect(calendarFeatureVector("2026-11-21").is_weekend).toBe(true); // суббота
    expect(calendarFeatureVector("2026-11-22").is_weekend).toBe(true); // воскресенье
    expect(calendarFeatureVector("2026-11-23").is_weekend).toBe(false); // понедельник
    expect(calendarFeatureVector("2025-12-15").season).toBe("winter");
    expect(calendarFeatureVector("2025-07-15").season).toBe("summer");
  });

  test("результат воспроизводим", () => {
    expect(JSON.stringify(calendarFeatureRange("2025-05-01", "2025-05-31"))).toBe(JSON.stringify(calendarFeatureRange("2025-05-01", "2025-05-31")));
  });
});

describe("модель calendar_weekday_seasonal_mean", () => {
  test("прогноз равен среднему истории по профилю день недели + месяц", () => {
    // понедельники марта: 1000, 1200, 1400 (origin = 2025-03-17)
    const history: HistoryPoint[] = [
      { date: "2025-03-03", value: 1000 },
      { date: "2025-03-10", value: 1200 },
      { date: "2025-03-17", value: 1400 },
    ];
    const result = calendarWeekdaySeasonalMean.forecast({ originDate: "2025-03-17", horizonDays: 7, history, timezone: "Europe/Moscow" });
    // седьмой шаг — 2025-03-24, понедельник марта: профиль weekday_month = (1000 + 1200 + 1400) / 3
    const last = result.points.at(-1)!;
    expect(last.targetDate).toBe("2025-03-24");
    expect(last.value).toBeCloseTo(1200, 9);
    expect(last.status).toBe("ok");
    // первые шаги (вторник…воскресенье) опираются на свой профиль дня недели
    expect(result.points[0]!.targetDate).toBe("2025-03-18");
  });

  test("при нехватке наблюдений в профиле прогноз недоступен, ноль не подставляется", () => {
    const result = calendarWeekdaySeasonalMean.forecast(input([100, 110], 3));
    expect(result.points.every((point) => point.status === "unavailable")).toBe(true);
    expect(result.points.every((point) => point.value === null)).toBe(true);
    expect(result.points[0]!.reason).toContain(String(MIN_SUPPORT));
  });

  test("профиль строится только по истории, доступной на origin", () => {
    // 3 понедельника марта по 1000; target через 7 дней от origin — снова понедельник
    const history: HistoryPoint[] = [
      { date: "2025-03-03", value: 1000 },
      { date: "2025-03-10", value: 1000 },
      { date: "2025-03-17", value: 1000 },
    ];
    const result = calendarWeekdaySeasonalMean.forecast({ originDate: "2025-03-17", horizonDays: 7, history, timezone: "Europe/Moscow" });
    expect(result.points.at(-1)!.value).toBeCloseTo(1000, 9);
    expect(result.diagnostics.lastHistoryDate).toBe("2025-03-17");
    // профиль строится из фактической истории: количество наблюдений соответствует переданным данным
    const profiles = buildCalendarProfiles(history);
    expect(profiles.get("1|3")!.n).toBe(3);
  });

  test("будущие наблюдения приводят к ошибке (защита от утечки)", () => {
    const history: HistoryPoint[] = [
      { date: "2025-03-03", value: 1 }, { date: "2025-03-10", value: 2 }, { date: "2025-03-17", value: 3 },
    ];
    expect(() => calendarWeekdaySeasonalMean.forecast({ originDate: "2025-03-10", horizonDays: 1, history, timezone: "Europe/Moscow" })).toThrow(/утечка/);
  });

  test("иерархия профилей: weekday_month → weekday_season → weekday", () => {
    // март: 4 понедельника по 1000; декабрь: 4 понедельника по 2000
    const history: HistoryPoint[] = [
      ...[3, 10, 17, 24].map((day) => ({ date: `2025-03-${String(day).padStart(2, "0")}`, value: 1000 })),
      ...[1, 8, 15, 22].map((day) => ({ date: `2025-12-${String(day).padStart(2, "0")}`, value: 2000 })),
    ];
    const profiles = buildCalendarProfiles(history);
    expect(profiles.get("1|3")!.mean).toBe(1000); // понедельник + март
    expect(profiles.get("1|12")!.mean).toBe(2000); // понедельник + декабрь
    expect(profiles.get("1|winter")!.n).toBe(4);
    expect(profiles.get("1")!.n).toBe(8);
  });

  test("модель совместима с контрактом baseline и детерминирована", () => {
    const model = new CalendarWeekdaySeasonalMean();
    expect(model.name).toBe("calendar_weekday_seasonal_mean");
    const first = model.forecast(input(Array.from({ length: 40 }, (_, index) => 1000 + index), 7));
    const second = model.forecast(input(Array.from({ length: 40 }, (_, index) => 1000 + index), 7));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.points.length).toBe(7);
    expect(first.diagnostics.notes.join(" ")).toContain("праздники");
  });
});
