// UI-7.0.1 (D-001): регрессионные тесты разделения маршрута и диапазона дат.
// Логика parseHash/forecastParams/rangeToQuery скопирована из src/web/main.ts:
// main.ts — это точка входа с побочными эффектами (document/window), прямое импортирование невозможно.
// При изменении маршрутизации в main.ts соответствующие изменения вносятся сюда.
import { describe, expect, test } from "bun:test";

const PAGES = [
  { key: "overview", label: "Обзор" },
  { key: "history", label: "История" },
  { key: "quality", label: "Качество данных" },
  { key: "provenance", label: "Происхождение" },
  { key: "forecast-quality", label: "Прогнозы и качество" },
] as const;
type PageKey = (typeof PAGES)[number]["key"];

interface Route {
  page: PageKey;
  range: string;
  from: string;
  to: string;
  isForecast: boolean;
}

function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, "");
  const [pageRaw, rangeRaw, fromRaw, toRaw] = raw.split("/");
  const page = (PAGES.find((item) => item.key === pageRaw)?.key ?? "history") as PageKey;
  const isForecast = page === "forecast-quality";
  return { page, range: rangeRaw || "all", from: fromRaw || "", to: toRaw || "", isForecast };
}

function forecastParams(route: Route): { mode: "shadow" | "replay"; horizon: 1 | 3 } {
  const mode = route.range === "replay" ? "replay" : "shadow";
  const horizon = route.from === "3" ? 3 : 1;
  return { mode, horizon };
}

const RANGES: Array<{ key: string; days: number | null }> = [
  { key: "all", days: null },
  { key: "30", days: 30 },
  { key: "90", days: 90 },
  { key: "180", days: 180 },
  { key: "365", days: 365 },
  { key: "custom", days: null },
];

function rangeToQuery(range: string, from: string, to: string, lastDate: string | null): { from?: string; to?: string; error?: string } {
  if (from || to) {
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return { error: "Некорректная дата начала" };
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { error: "Некорректная дата окончания" };
    if (from && to && from > to) return { error: "Дата начала позже даты окончания" };
    return { from: from || undefined, to: to || undefined };
  }
  const days = RANGES.find((item) => item.key === range)?.days ?? null;
  if (!days || !lastDate) return {};
  const end = Date.parse(`${lastDate}T00:00:00Z`);
  const start = new Date(end - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from: start, to: lastDate };
}

describe("UI-7.0.1 D-001: маршруты forecast-quality", () => {
  test("#forecast-quality/shadow/1 → mode=shadow, horizon=1", () => {
    const route = parseHash("#forecast-quality/shadow/1");
    expect(route.page).toBe("forecast-quality");
    expect(route.isForecast).toBe(true);
    expect(forecastParams(route)).toEqual({ mode: "shadow", horizon: 1 });
  });

  test("#forecast-quality/shadow/3 → mode=shadow, horizon=3", () => {
    const route = parseHash("#forecast-quality/shadow/3");
    expect(route.isForecast).toBe(true);
    expect(forecastParams(route)).toEqual({ mode: "shadow", horizon: 3 });
  });

  test("#forecast-quality/replay/1 → mode=replay, horizon=1", () => {
    const route = parseHash("#forecast-quality/replay/1");
    expect(forecastParams(route)).toEqual({ mode: "replay", horizon: 1 });
  });

  test("#forecast-quality/replay/3 → mode=replay, horizon=3", () => {
    const route = parseHash("#forecast-quality/replay/3");
    expect(forecastParams(route)).toEqual({ mode: "replay", horizon: 3 });
  });

  test("#forecast-quality без параметров → значения по умолчанию shadow/1 (прежнее поведение)", () => {
    const route = parseHash("#forecast-quality");
    expect(route.page).toBe("forecast-quality");
    expect(route.range).toBe("all");
    expect(forecastParams(route)).toEqual({ mode: "shadow", horizon: 1 });
  });

  test("некорректный mode или horizon → безопасные значения по умолчанию", () => {
    expect(forecastParams(parseHash("#forecast-quality/evil/9"))).toEqual({ mode: "shadow", horizon: 1 });
    expect(forecastParams(parseHash("#forecast-quality/shadow/2"))).toEqual({ mode: "shadow", horizon: 1 });
    // empty range → shadow (по умолчанию), "3" → horizon 3 (допустимо)
    expect(forecastParams(parseHash("#forecast-quality//3"))).toEqual({ mode: "shadow", horizon: 3 });
    // "9" — не 3 → horizon 1
    expect(forecastParams(parseHash("#forecast-quality/shadow/9"))).toEqual({ mode: "shadow", horizon: 1 });
  });

  test("параметры forecast-quality не попадают в валидатор дат (регрессия D-001)", () => {
    const route = parseHash("#forecast-quality/shadow/1");
    // range="shadow", from="1" — если их передать в rangeToQuery, будет ошибка.
    // Маршрутизация main.ts вызывает rangeToQuery только при isForecast=false.
    expect(route.isForecast).toBe(true);
    // Прямая проверка: то, что rangeToQuery действительно отклонил бы эти параметры,
    // подтверждает корректность разделения.
    expect(rangeToQuery(route.range, route.from, route.to, "2026-11-23").error).toBe("Некорректная дата начала");
  });
});

describe("UI-7.0.1: валидация диапазона истории сохранена", () => {
  test("корректный custom-диапазон проходит", () => {
    expect(rangeToQuery("custom", "2026-01-01", "2026-02-01", "2026-11-23")).toEqual({ from: "2026-01-01", to: "2026-02-01" });
  });

  test("некорректная дата начала отклоняется", () => {
    expect(rangeToQuery("custom", "1", "", "2026-11-23").error).toBe("Некорректная дата начала");
  });

  test("некорректная дата окончания отклоняется", () => {
    expect(rangeToQuery("custom", "2026-01-01", "abc", "2026-11-23").error).toBe("Некорректная дата окончания");
  });

  test("начало позже окончания отклоняется", () => {
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

  test("неизвестный маршрут (page) → fallback history с isForecast=false (валидация дат применяется)", () => {
    const route = parseHash("#unknown-page/2026-01-01/2026-02-01");
    expect(route.page).toBe("history");
    expect(route.isForecast).toBe(false);
    expect(rangeToQuery(route.range, route.from, route.to, "2026-11-23").error).toBeUndefined();
  });
});
