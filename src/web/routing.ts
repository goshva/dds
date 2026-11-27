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
  { key: "forecast", label: "Прогноз" },
  { key: "forecast-quality", label: "Прогнозы и качество" },
  { key: "forecast-diagnostics", label: "Диагностика прогнозирования" },
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
  /**
   * FINAL-3.3.1.1: число сегментов hash после удаления \`#\`. Позволяет строго отклонять лишние,
   * пустые и завершающие сегменты там, где это требуется (маршрут Forecast), не меняя значения
   * \`range\`/\`from\`/\`to\` для существующих страниц.
   */
  segmentCount: number;
}

/** Разбирает hash (с `#` или без) в Route. Неизвестная страница → DEFAULT_PAGE. */
export function parseHash(hash: string): Route {
  const raw = String(hash ?? "").replace(/^#/, "");
  const parts = raw.split("/");
  const [pageRaw, rangeRaw, fromRaw, toRaw] = parts;
  const page = (PAGES.find((item) => item.key === pageRaw)?.key ?? DEFAULT_PAGE) as PageKey;
  const isForecast = page === "forecast" || page === "forecast-quality" || page === "forecast-diagnostics";
  // D-001 регрессия: для non-forecast страниц параметры range/from — это даты, isForecast=false.
  // Для forecast-diagnostics route.range трактуется как mode, route.from — как horizon.
  return { page, range: rangeRaw || "all", from: fromRaw || "", to: toRaw || "", isForecast, segmentCount: parts.length };
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

export type ForecastMode = "replay" | "shadow";
export type ForecastHorizon = 1 | 3;

export interface NormalizedForecastParams {
  mode: ForecastMode | null;
  horizon: ForecastHorizon | null;
  /** true только для канонического маршрута `#forecast/<mode>/<horizon>` с допустимыми значениями. */
  valid: boolean;
  /** Канонический адрес для нормализации некорректного маршрута (используется вызывающей стороной). */
  fallback: string;
}

const FORECAST_FALLBACK = "#forecast/replay/1";

/**
 * FINAL-3.3.1: строгий разбор `#forecast/<mode>/<horizon>`.
 *
 * Отличие от `forecastParams` и `diagnosticsParams`: неизвестные значения **не** подменяются
 * значениями по умолчанию — `mode`/`horizon` остаются `null`, а `valid = false`. Канонический
 * адрес для перезаписи URL возвращается отдельным полем `fallback`. Лишний четвёртый сегмент
 * (например, `#forecast/replay/1/extra`) делает маршрут недействительным.
 */
export function normalizeForecastParams(route: Pick<Route, "page" | "range" | "from" | "to" | "segmentCount">): NormalizedForecastParams {
  const modeRaw = route.range === "replay" || route.range === "shadow" ? route.range : null;
  const horizonRaw = route.from === "1" ? 1 : route.from === "3" ? 3 : null;
  // Ровно три сегмента: "forecast", mode, horizon. Лишние, пустые и завершающие сегменты недопустимы.
  const valid = route.page === "forecast" && route.segmentCount === 3 && route.to === "" && modeRaw !== null && horizonRaw !== null;
  // Некорректный маршрут не даёт типизированных mode/horizon: вызывающая сторона обязана
  // нормализовать URL по `fallback`, а не использовать частично разобранные значения.
  return { mode: valid ? modeRaw : null, horizon: valid ? horizonRaw : null, valid, fallback: FORECAST_FALLBACK };
}

/** Канонический hash для допустимой пары mode/horizon; при некорректных значениях — null. */
export function forecastHref(mode: ForecastMode, horizon: ForecastHorizon): string | null {
  const modeValid = mode === "replay" || mode === "shadow";
  const horizonValid = horizon === 1 || horizon === 3;
  if (!modeValid || !horizonValid) return null;
  return `#forecast/${mode}/${horizon}`;
}

/**
 * UI-7.1.1: разбор маршрута диагностики `#forecast-diagnostics/<mode>/<horizon>`.
 *
 * В отличие от `forecastParams` (безопасные значения по умолчанию), здесь различаем
 * корректный режим/горизонт и некорректные параметры, чтобы показать явную ошибку вместо
 * молчаливой подстановки. Пустые сегменты трактуются как дефолтные (shadow / 1).
 */
export interface DiagnosticsParams {
  mode: "shadow" | "replay";
  horizon: 1 | 3;
  /** true, если хотя бы один сегмент был задан некорректно. */
  invalid: boolean;
}

export function diagnosticsParams(route: Pick<Route, "range" | "from">): DiagnosticsParams {
  const modeRaw = route.range;
  const horizonRaw = route.from;
  const modeValid = modeRaw === "" || modeRaw === "all" || modeRaw === "replay" || modeRaw === "shadow";
  const horizonValid = horizonRaw === "" || horizonRaw === "1" || horizonRaw === "3";
  const mode: DiagnosticsParams["mode"] = modeRaw === "replay" ? "replay" : "shadow";
  const horizon: DiagnosticsParams["horizon"] = horizonRaw === "3" ? 3 : 1;
  return { mode, horizon, invalid: !modeValid || !horizonValid };
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
