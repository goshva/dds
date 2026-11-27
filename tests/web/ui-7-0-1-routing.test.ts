// UI-7.0.2.1 (D-004): тесты production-функций маршрутизации.
// Импортируются реальные функции из src/web/routing.ts (без копий в тестах).
//
// D-003: единое поведение неизвестного hash-маршрута → history (DEFAULT_PAGE), isForecast=false.
// D-005: валидация реальности календарной даты, а не только формата.
import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PAGE,
  forecastParams,
  isValidCalendarDate,
  PAGES,
  parseHash,
  RANGES,
  rangeToQuery,
} from "../../src/web/routing";

describe("D-003: неизвестные маршруты → history (DEFAULT_PAGE)", () => {
  test("DEFAULT_PAGE === history", () => {
    expect(DEFAULT_PAGE).toBe("history");
  });

  test("неизвестная страница → history, isForecast=false", () => {
    const route = parseHash("#unknown-page");
    expect(route.page).toBe("history");
    expect(route.isForecast).toBe(false);
  });

  test("неизвестная страница с диапазоном → history + валидация дат применяется", () => {
    const route = parseHash("#unknown-page/2026-01-01/2026-02-01");
    expect(route.page).toBe("history");
    expect(route.isForecast).toBe(false);
    expect(rangeToQuery(route.range, route.from, route.to, "2026-11-23").error).toBeUndefined();
  });

  test("пустой hash → history, range=all", () => {
    const route = parseHash("#");
    expect(route.page).toBe("history");
    expect(route.range).toBe("all");
  });

  test("голый hash без решётки → history", () => {
    expect(parseHash("history/10").page).toBe("history");
  });
});

describe("parseHash: все известные страницы", () => {
  const cases: Array<[string, string]> = [
    ["#overview", "overview"],
    ["#history", "history"],
    ["#quality", "quality"],
    ["#provenance", "provenance"],
    ["#forecast-quality", "forecast-quality"],
  ];
  for (const [hash, expected] of cases) {
    test(`${hash} → page=${expected}`, () => {
      expect<string>(parseHash(hash).page).toBe(expected);
    });
  }

  test("PAGES содержит ровно 5 страниц с ожидаемыми ключами", () => {
    expect(PAGES.map((page) => page.key)).toEqual(["overview", "history", "quality", "provenance", "forecast-quality"]);
  });
});

describe("D-003/D-001: forecast-quality", () => {
  test("#forecast-quality/shadow/1 → shadow h1", () => {
    const route = parseHash("#forecast-quality/shadow/1");
    expect(route.page).toBe("forecast-quality");
    expect(route.isForecast).toBe(true);
    expect(forecastParams(route)).toEqual({ mode: "shadow", horizon: 1 });
  });

  test("#forecast-quality/shadow/3 → shadow h3", () => {
    expect(forecastParams(parseHash("#forecast-quality/shadow/3"))).toEqual({ mode: "shadow", horizon: 3 });
  });

  test("#forecast-quality/replay/1 → replay h1", () => {
    const route = parseHash("#forecast-quality/replay/1");
    expect(route.isForecast).toBe(true);
    expect(forecastParams(route)).toEqual({ mode: "replay", horizon: 1 });
  });

  test("#forecast-quality/replay/3 → replay h3", () => {
    expect(forecastParams(parseHash("#forecast-quality/replay/3"))).toEqual({ mode: "replay", horizon: 3 });
  });

  test("deep link без параметров → shadow h1 (по умолчанию)", () => {
    const route = parseHash("#forecast-quality");
    expect(route.isForecast).toBe(true);
    expect(forecastParams(route)).toEqual({ mode: "shadow", horizon: 1 });
  });

  test("некорректные mode/horizon → безопасные значения по умолчанию", () => {
    expect(forecastParams(parseHash("#forecast-quality/evil/9"))).toEqual({ mode: "shadow", horizon: 1 });
    expect(forecastParams(parseHash("#forecast-quality/shadow/2"))).toEqual({ mode: "shadow", horizon: 1 });
    expect(forecastParams(parseHash("#forecast-quality/shadow/9"))).toEqual({ mode: "shadow", horizon: 1 });
    expect(forecastParams(parseHash("#forecast-quality//3"))).toEqual({ mode: "shadow", horizon: 3 });
  });

  test("регрессия D-001: параметры прогноза невалидны как даты", () => {
    const route = parseHash("#forecast-quality/shadow/1");
    // Подтверждаем, что без isForecast-разделения эти значения ломали rangeToQuery.
    expect(rangeToQuery(route.range, route.from, route.to, "2026-11-23").error).toBe("Некорректная дата начала");
  });
});

describe("D-005: календарная валидация дат", () => {
  test("2026-02-28 — valid", () => {
    expect(isValidCalendarDate("2026-02-28")).toBe(true);
  });

  test("2026-02-29 — invalid (2026 не високосный)", () => {
    expect(isValidCalendarDate("2026-02-29")).toBe(false);
  });

  test("2024-02-29 — valid (2024 високосный)", () => {
    expect(isValidCalendarDate("2024-02-29")).toBe(true);
  });

  test("2026-13-01 — invalid (месяц 13)", () => {
    expect(isValidCalendarDate("2026-13-01")).toBe(false);
  });

  test("2026-00-01 — invalid (месяц 0)", () => {
    expect(isValidCalendarDate("2026-00-01")).toBe(false);
  });

  test("2026-11-31 — invalid (в ноябре 30 дней)", () => {
    expect(isValidCalendarDate("2026-11-31")).toBe(false);
  });

  test("2026-12-31 — valid", () => {
    expect(isValidCalendarDate("2026-12-31")).toBe(true);
  });

  test("2026-01-00 — invalid (день 0)", () => {
    expect(isValidCalendarDate("2026-01-00")).toBe(false);
  });

  test("мусорные строки отклоняются", () => {
    expect(isValidCalendarDate("")).toBe(false);
    expect(isValidCalendarDate("abc")).toBe(false);
    expect(isValidCalendarDate("2026-1-1")).toBe(false);
    expect(isValidCalendarDate("2026/01/01")).toBe(false);
  });
});

describe("rangeToQuery: интеграция с календарной валидацией", () => {
  test("корректный custom-диапазон проходит", () => {
    expect(rangeToQuery("custom", "2026-01-01", "2026-02-01", "2026-11-23")).toEqual({ from: "2026-01-01", to: "2026-02-01" });
  });

  test("нереальная дата начала отклоняется (2026-02-29)", () => {
    expect(rangeToQuery("custom", "2026-02-29", "", "2026-11-23").error).toBe("Некорректная дата начала");
  });

  test("нереальная дата окончания отклоняется (2026-11-31)", () => {
    expect(rangeToQuery("custom", "", "2026-11-31", "2026-11-23").error).toBe("Некорректная дата окончания");
  });

  test("месяц 13 отклоняется", () => {
    expect(rangeToQuery("custom", "2026-13-01", "", "2026-11-23").error).toBe("Некорректная дата начала");
  });

  test("from > to отклоняется", () => {
    expect(rangeToQuery("custom", "2026-05-01", "2026-01-01", "2026-11-23").error).toBe("Дата начала позже даты окончания");
  });

  test("range=30 вычисляет from от lastDate", () => {
    const query = rangeToQuery("30", "", "", "2026-11-23");
    expect(query.error).toBeUndefined();
    expect(query.to).toBe("2026-11-23");
    expect(query.from).toBe("2026-10-25");
  });

  test("range=all не добавляет ограничений", () => {
    expect(rangeToQuery("all", "", "", "2026-11-23")).toEqual({});
  });

  test("lastDate=null и days=null → без ограничений", () => {
    expect(rangeToQuery("all", "", "", null)).toEqual({});
  });
});

describe("RANGES: канонический список диапазонов", () => {
  test("содержит all/30/90/180/365/custom", () => {
    expect(RANGES.map((range) => range.key)).toEqual(["all", "30", "90", "180", "365", "custom"]);
  });

  test("только числовые диапазоны несут days", () => {
    expect(RANGES.filter((range) => range.days !== null).map((range) => range.key)).toEqual(["30", "90", "180", "365"]);
  });
});
