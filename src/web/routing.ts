/**
 * UI-7.0.2.1 (D-004): чистые функции маршрутизации и валидации диапазона.
 *
 * Модуль не имеет побочных эффектов и не обращается к `document`/`window`:
 * единственный вход — строка hash и текущая дата данных. Это позволяет
 * тестировать production-код напрямую (без копий в тестах).
 */

/** Страницы приложения в порядке навигации. `key` — сегмент hash. */
export const PAGES = [
  { key: "overview", label: "Обзор" },
  { key: "history", label: "История" },
  { key: "quality", label: "Качество данных" },
  { key: "provenance", label: "Происхождение" },
  { key: "forecast-quality", label: "Прогнозы и качество" },
] as const;

export type PageKey = (typeof PAGES)[number]["key"];

/**
 * D-003: единое поведение неизвестного маршрута.
 * Любой неизвестный сегмент страницы → `history` (страница по умолчанию),
 * при этом `isForecast = false`, значит валидация дат применяется.
 *
 * Причина выбора: `history` — единственная страница, которая осмысленно
 * работает и без параметров, и с произвольным диапазоном; fallback на неё
 * не требует дополнительных данных и не меняет семантику прогнозных страниц.
 */
export const DEFAULT_PAGE: PageKey = "history";

export interface Route {
  page: PageKey;
  /** Ключ диапазона истории ("all"/"30"/.../"custom"). Для forecast-quality — mode. */
  range: string;
  /** Начало диапазона (YYYY-MM-DD). Для forecast-quality — horizon ("1"/"3"). */
  from: string;
  /** Конец диапазона (YYYY-MM-DD). Для forecast-quality не используется. */
  to: string;
  /** true — параметры from/to интерпретируются как mode/horizon, валидация дат неприменима. */
  isForecast: boolean;
}

/** Разбирает hash (с `#` или без) в Route. Неизвестная страница → DEFAULT_PAGE. */
export function parseHash(hash: string): Route {
  const raw = String(hash ?? "").replace(/^#/, "");
  const [pageRaw, rangeRaw, fromRaw, toRaw] = raw.split("/");
  const page = (PAGES.find((item) => item.key === pageRaw)?.key ?? DEFAULT_PAGE) as PageKey;
  const isForecast = page === "forecast-quality";
  return { page, range: rangeRaw || "all", from: fromRaw || "", to: toRaw || "", isForecast };
}

export interface ForecastParams {
  mode: "shadow" | "replay";
  horizon: 1 | 3;
}

/**
 * Параметры прогнозной страницы: mode ∈ {shadow, replay}, horizon ∈ {1, 3}.
 * Любое другое значение (включая мусор) → безопасные значения по умолчанию.
 */
export function forecastParams(route: Pick<Route, "range" | "from">): ForecastParams {
  const mode = route.range === "replay" ? "replay" : "shadow";
  const horizon = route.from === "3" ? 3 : 1;
  return { mode, horizon };
}

/** Диапазоны истории с числом дней; `custom` вычисляется из from/to. */
export const RANGES: Array<{ key: string; label: string; days: number | null }> = [
  { key: "all", label: "Весь период", days: null },
  { key: "30", label: "30 дней", days: 30 },
  { key: "90", label: "90 дней", days: 90 },
  { key: "180", label: "180 дней", days: 180 },
  { key: "365", label: "365 дней", days: 365 },
  { key: "custom", label: "Произвольный", days: null },
];

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * D-005: проверка реальности календарной даты, а не только формата.
 * Принимает строго `YYYY-MM-DD`. `2026-02-29` (не високосный),
 * `2026-13-01`, `2026-00-01`, `2026-11-31` — отклоняются.
 */
export function isValidCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  // День 0 следующего месяца = последний день текущего месяца.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

export interface RangeQuery {
  from?: string;
  to?: string;
  error?: string;
}

/**
 * Диапазон запроса: вычисляется на клиенте из уже выбранного периода;
 * сервер фильтрует по датам. Явные from/to проходят календарную проверку.
 */
export function rangeToQuery(range: string, from: string, to: string, lastDate: string | null): RangeQuery {
  if (from || to) {
    if (from && !isValidCalendarDate(from)) return { error: "Некорректная дата начала" };
    if (to && !isValidCalendarDate(to)) return { error: "Некорректная дата окончания" };
    if (from && to && from > to) return { error: "Дата начала позже даты окончания" };
    return { from: from || undefined, to: to || undefined };
  }
  const days = RANGES.find((item) => item.key === range)?.days ?? null;
  if (!days || !lastDate) return {};
  const end = Date.parse(`${lastDate}T00:00:00Z`);
  if (!Number.isFinite(end)) return {};
  const start = new Date(end - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from: start, to: lastDate };
}
