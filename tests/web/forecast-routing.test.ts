// FINAL-3.3.1: маршрут Forecast `#forecast/<mode>/<horizon>` и регрессия существующих маршрутов.
import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PAGE,
  PAGES,
  diagnosticsParams,
  forecastHref,
  forecastParams,
  normalizeForecastParams,
  parseHash,
  rangeToQuery,
} from "../../src/web/routing";

const VALID = [
  ["#forecast/replay/1", "replay", 1],
  ["#forecast/replay/3", "replay", 3],
  ["#forecast/shadow/1", "shadow", 1],
  ["#forecast/shadow/3", "shadow", 3],
] as const;

const INVALID = [
  "#forecast", "#forecast/replay", "#forecast/unknown/1", "#forecast/replay/2", "#forecast/shadow/4",
  "#forecast/REPLAY/1", "#forecast/Shadow/3", "#forecast/replay/1/extra", "#forecast/shadow/1/extra",
  "#forecast/<script>/1", "#forecast/replay/<script>", "#forecast//1", "#forecast/replay/",
  "#forecast/replay/1?x=1", "#forecast/replay/%31", "#forecast/replay/ 1", "", "#", "#for", "#forecast/1/1",
  // FINAL-3.3.1.1: завершающие, двойные и множественные лишние сегменты
  "#forecast/replay/1/", "#forecast/replay/1//", "#forecast/replay/1///", "#forecast/replay/1//extra",
  "#forecast/replay/1///extra", "#forecast/replay/1/extra/more", "#forecast/shadow/3/", "#forecast/shadow/3//",
] as const;

describe("FINAL-3.3.1: допустимые маршруты Forecast", () => {
  test("четыре канонические комбинации разбираются строго", () => {
    for (const [hash, mode, horizon] of VALID) {
      const route = parseHash(hash);
      expect(route.page, hash).toBe("forecast");
      expect(route.isForecast, hash).toBe(true);
      const parsed = normalizeForecastParams(route);
      expect(parsed.valid, hash).toBe(true);
      expect(parsed.mode, hash).toBe(mode);
      expect(parsed.horizon, hash).toBe(horizon);
      expect(forecastHref(mode, horizon), hash).toBe(hash);
    }
  });

  test("PAGES содержит forecast и все существующие страницы", () => {
    const keys: string[] = PAGES.map((page) => page.key);
    expect(keys).toContain("forecast");
    for (const key of ["overview", "history", "quality", "provenance", "forecast-quality", "forecast-diagnostics"]) {
      expect(keys, key).toContain(key);
    }
    expect(keys.filter((key) => key === "forecast").length).toBe(1);
  });
});

describe("FINAL-3.3.1: некорректные маршруты Forecast", () => {
  test("неизвестные значения не подменяются умолчаниями", () => {
    for (const hash of INVALID) {
      const parsed = normalizeForecastParams(parseHash(hash));
      expect(parsed.valid, hash).toBe(false);
      expect(parsed.mode, hash).toBeNull();
      expect(parsed.horizon, hash).toBeNull();
      expect(parsed.fallback, hash).toBe("#forecast/replay/1");
      expect(() => normalizeForecastParams(parseHash(hash)), hash).not.toThrow();
    }
  });


  test("forecastHref возвращает null для значений вне контракта", () => {
    const untyped = forecastHref as unknown as (mode: string, horizon: number) => string | null;
    expect(untyped("production", 1)).toBeNull();
    expect(untyped("replay", 2)).toBeNull();
    expect(untyped("", 0)).toBeNull();
    expect(untyped("shadow", 5)).toBeNull();
  });
});

describe("FINAL-3.3.1: регрессия существующих маршрутов", () => {
  test("существующие страницы и их сегменты не изменились", () => {
    expect(parseHash("#overview").page).toBe("overview");
    expect(parseHash("#history/90").range).toBe("90");
    expect(parseHash("#history/custom/2026-06-01/2026-06-10")).toMatchObject({ page: "history", range: "custom", from: "2026-06-01", to: "2026-06-10", isForecast: false });
    expect(parseHash("#quality").page).toBe("quality");
    expect(parseHash("#provenance").isForecast).toBe(false);
    expect(parseHash("#forecast-quality/replay/3")).toMatchObject({ page: "forecast-quality", isForecast: true });
    expect(parseHash("#forecast-diagnostics/shadow/1")).toMatchObject({ page: "forecast-diagnostics", isForecast: true });
  });

  test("fallback и параметры прогнозных страниц не изменились", () => {
    expect(DEFAULT_PAGE).toBe("history");
    expect(parseHash("#unknown-page").page).toBe(DEFAULT_PAGE);
    expect(parseHash("").page).toBe(DEFAULT_PAGE);
    expect(forecastParams(parseHash("#forecast-quality/replay/3"))).toEqual({ mode: "replay", horizon: 3 });
    expect(diagnosticsParams(parseHash("#forecast-diagnostics/unknown/9"))).toEqual({ mode: "shadow", horizon: 1, invalid: true });
    expect(rangeToQuery("90", "", "", "2026-06-10")).toEqual({ from: "2026-03-13", to: "2026-06-10" });
    expect(rangeToQuery("custom", "2026-02-30", "", "2026-06-10").error).toBe("Некорректная дата начала");
  });

  test("датовые маршруты History разбираются как прежде", () => {
    expect(parseHash("#history/90")).toMatchObject({ page: "history", range: "90", from: "", to: "", isForecast: false });
    expect(parseHash("#history/custom/2026-06-01/2026-06-10")).toMatchObject({ page: "history", range: "custom", from: "2026-06-01", to: "2026-06-10" });
    expect(rangeToQuery("90", "", "", "2026-11-23")).toEqual({ from: "2026-08-26", to: "2026-11-23" });
    expect(rangeToQuery("custom", "2026-06-01", "2026-06-10", "2026-11-23")).toEqual({ from: "2026-06-01", to: "2026-06-10" });
    expect(rangeToQuery("custom", "2026-06-10", "2026-06-01", "2026-11-23").error).toBe("Дата начала позже даты окончания");
    expect(parseHash("#unknown-page").page).toBe(DEFAULT_PAGE);
  });

  test("прогнозные страницы сохраняют прежний разбор режима и горизонта", () => {
    expect(parseHash("#forecast-quality/replay/3")).toMatchObject({ page: "forecast-quality", range: "replay", from: "3", isForecast: true });
    expect(forecastParams(parseHash("#forecast-quality/shadow/1"))).toEqual({ mode: "shadow", horizon: 1 });
    expect(diagnosticsParams(parseHash("#forecast-diagnostics/replay/3"))).toEqual({ mode: "replay", horizon: 3, invalid: false });
  });

  test("маршрут Forecast требует ровно три сегмента", () => {
    expect(parseHash("#forecast/replay/1").segmentCount).toBe(3);
    for (const hash of ["#forecast/replay/1/", "#forecast/replay/1//extra", "#forecast/replay/1/extra/more"]) {
      expect(normalizeForecastParams(parseHash(hash)).valid, hash).toBe(false);
    }
  });
});
