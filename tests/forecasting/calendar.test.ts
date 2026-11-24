// Stage 3.4.2: тесты календарного ядра, московского времени, праздников и защиты от утечки.
import { describe, expect, test } from "bun:test";

import {
  addDays,
  calendarFeatures,
  daysInMonth,
  isLeapYear,
  isoDayOfWeek,
  longWeekendAt,
  moscowDateOf,
  nearestHoliday,
  officialDayStatus,
  STATUTORY_HOLIDAYS,
  MOSCOW_TIMEZONE,
} from "../../src/forecasting/analytics/calendar/calendar-core";
import { analyzeCalendar, buildObservations } from "../../src/forecasting/analytics/calendar/analysis";
import { FEATURE_CATALOG } from "../../src/forecasting/analytics/calendar/catalog";

describe("московское календарное время", () => {
  test("дата определяется по Europe/Moscow независимо от timezone процесса", () => {
    // 2026-01-01T22:30:00Z = 2026-01-02 01:30 по Москве
    expect(moscowDateOf("2026-01-01T22:30:00.000Z")).toBe("2026-01-02");
    expect(moscowDateOf("2026-01-01T20:59:00.000Z")).toBe("2026-01-01");
    expect(MOSCOW_TIMEZONE).toBe("Europe/Moscow");
  });

  test("результат не зависит от переменной окружения TZ процесса", () => {
    const original = process.env.TZ;
    try {
      for (const zone of ["UTC", "America/New_York", "Asia/Tokyo", "Europe/Moscow"]) {
        process.env.TZ = zone;
        expect(moscowDateOf("2026-06-15T21:30:00.000Z"), zone).toBe("2026-06-16");
        expect(isoDayOfWeek("2026-06-15"), zone).toBe(1);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  test("дни недели, переходы месяца и года, високосный год", () => {
    expect(isoDayOfWeek("2026-11-23")).toBe(1); // понедельник
    expect(isoDayOfWeek("2026-11-22")).toBe(7); // воскресенье
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(isLeapYear(2024)).toBe(true);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
  });
});

describe("праздники и производственный календарь", () => {
  test("нерабочие праздничные дни по ст. 112 ТК РФ распознаются", () => {
    expect(STATUTORY_HOLIDAYS.length).toBe(14);
    for (const date of ["2025-01-01", "2025-01-07", "2025-02-23", "2025-03-08", "2025-05-01", "2025-05-09", "2025-06-12", "2025-11-04"]) {
      expect(officialDayStatus(date).statutoryHoliday, date).toBe(true);
      expect(officialDayStatus(date).officialDayOff, date).toBe(true);
    }
    expect(officialDayStatus("2025-06-13").statutoryHoliday).toBe(false);
  });

  test("границы новогодних каникул", () => {
    expect(officialDayStatus("2024-12-31").statutoryHoliday).toBe(false);
    expect(officialDayStatus("2025-01-08").statutoryHoliday).toBe(true);
    expect(officialDayStatus("2025-01-09").statutoryHoliday).toBe(false);
  });

  test("переносы выходных: проверенный 2025 год и непроверенные годы", () => {
    const shifted = officialDayStatus("2025-05-02"); // перенос с 2025-01-04
    expect(shifted.shiftedDayOff).toBe(true);
    expect(shifted.shiftVerification).toBe("PARTIALLY_VERIFIED");
    expect(shifted.shiftSource).toContain("1335");

    const workingSaturday = officialDayStatus("2025-01-04"); // выходной перенесён на 2 мая → рабочий день
    expect(workingSaturday.workingSaturday).toBe(true);

    expect(officialDayStatus("2024-05-02").verification).toBe("UNVERIFIED");
    expect(officialDayStatus("2026-11-23").verification).toBe("UNVERIFIED");
  });

  test("длинные выходные определяются последовательностью нерабочих дней", () => {
    const may = longWeekendAt("2025-05-09");
    expect(may.inLongWeekend).toBe(true);
    expect(may.length).toBeGreaterThanOrEqual(3);
    expect(may.start).toBe("2025-05-08");
    const ordinary = longWeekendAt("2025-06-18");
    expect(ordinary.inLongWeekend).toBe(false);
  });

  test("близость праздника считается в обе стороны", () => {
    // 2025-05-11: позади 9 мая (2 дня), впереди 12 июня (32 дня → вне окна)
    const proximity = nearestHoliday("2025-05-11");
    expect(proximity.daysAfter).toBe(2);
    expect(proximity.daysTo).toBeNull();
    // 2025-06-10: впереди 12 июня (2 дня), позади 9 мая (32 дня → вне окна)
    const forward = nearestHoliday("2025-06-10");
    expect(forward.daysTo).toBe(2);
    expect(forward.name).toBe("День России");
    expect(forward.daysAfter).toBeNull();
  });
});

describe("календарные признаки дня", () => {
  test("базовые признаки рассчитываются корректно", () => {
    const features = calendarFeatures("2025-03-31");
    expect(features.dayOfWeek).toBe(1);
    expect(features.isWeekend).toBe(false);
    expect(features.month).toBe(3);
    expect(features.quarter).toBe(1);
    expect(features.isMonthEnd).toBe(true);
    expect(features.isQuarterEnd).toBe(true);
    expect(features.daysInMonth).toBe(31);
    expect(features.season).toBe("spring");
    expect(features.official.preHolidayShortDay).toBe(false);
  });

  test("предпраздничный сокращённый день 2025 распознаётся", () => {
    expect(calendarFeatures("2025-04-30").official.preHolidayShortDay).toBe(true);
  });
});

describe("исследовательская статистика", () => {
  const rows = [
    { date: "2025-01-01", value: 100 }, // праздник (среда)
    { date: "2025-01-08", value: 200 }, // праздник (среда)
    { date: "2025-01-15", value: 1000 }, // обычная среда
    { date: "2025-01-22", value: 1200 }, // обычная среда
    { date: "2025-01-04", value: 300 }, // суббота, выходной перенесён → рабочий день
    { date: "2025-01-11", value: 900 }, // обычная суббота
  ];

  test("группы считаются с размером выборки и без удаления выбросов", () => {
    const analysis = analyzeCalendar(buildObservations(rows));
    expect(analysis.observations).toBe(6);
    const wednesday = analysis.byDayOfWeek.find((row) => row.group === "среда")!;
    expect(wednesday.n).toBe(4);
    expect(wednesday.mean).toBe(625); // (100 + 200 + 1000 + 1200) / 4
    // 2025-01-01 и 2025-01-08 — праздник; 2025-01-04 входит в новогодние каникулы (1–6 января)
    expect(analysis.officialHolidays.length).toBeGreaterThan(0);
    expect(analysis.officialHolidays.reduce((acc, row) => acc + row.n, 0)).toBe(3);
  });

  test("сравнение праздника выполняется с обычными днями того же дня недели", () => {
    const analysis = analyzeCalendar(buildObservations(rows));
    const holidayWednesday = analysis.holidayComparisons.find((row) => row.date === "2025-01-01")!;
    expect(holidayWednesday.dayOfWeek).toBe(3);
    expect(holidayWednesday.comparableN).toBe(2); // обычные среды: 1000 и 1200
    expect(holidayWednesday.comparableMean).toBe(1100);
    expect(holidayWednesday.deviation).toBe(-1000);
    // база сравнения никогда не включает праздничные дни
    const base = analysis.holidayComparisons.map((row) => row.comparableMean);
    expect(base.every((value) => value === 1100 || value === 900)).toBe(true);
  });

  test("статистика воспроизводима", () => {
    const first = analyzeCalendar(buildObservations(rows));
    const second = analyzeCalendar(buildObservations(rows));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("защита от утечки будущих данных", () => {
  test("погодные и событийные признаки заблокированы", () => {
    const blocked = FEATURE_CATALOG.filter((feature) => feature.status === "BLOCKED").map((feature) => feature.feature_name);
    expect(blocked.some((name) => name.includes("temperature"))).toBe(true);
    expect(blocked.some((name) => name.includes("city_event"))).toBe(true);
    for (const feature of FEATURE_CATALOG.filter((entry) => entry.status === "BLOCKED")) {
      expect(feature.known_in_advance).toBe(false);
      expect(feature.allowed_horizon).toEqual([]);
      expect(feature.leakage_risk).toBe("high");
    }
  });

  test("базовые календарные признаки известны заранее и не имеют риска утечки", () => {
    for (const feature of FEATURE_CATALOG.filter((entry) => entry.status === "CANDIDATE")) {
      expect(feature.known_in_advance, feature.feature_name).toBe(true);
      expect(feature.leakage_risk, feature.feature_name).toBe("none");
    }
  });

  test("календарные признаки не зависят от фактических значений целевого ряда", () => {
    const first = calendarFeatures("2025-05-09");
    const second = calendarFeatures("2025-05-09");
    expect(first).toEqual(second);
    // признак строится только из даты: значение метрики в функцию не передаётся
    expect(Object.keys(first)).not.toContain("value");
  });
});
