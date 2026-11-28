/** FINAL-3.3.2.1/UI-2.3: dispatch: выбор страницы, композиция оболочки, кэш страницы истории. */
import { appShell, card, errorState, loadingState, pageHeader, sidebar, statusBadge, topbar, trusted, type TrustedHtml } from "./components";
import { api } from "./api/client";
import type { ApiResult } from "./api/client";
import { block, loadResult } from "./app-result";
import { resolveClickAction, type ClickAction } from "./app-events";
import { dataQualityPage } from "./pages/data-quality";
import { historyEmpty, historyPage, type CoverageDto, type HistoryDto } from "./pages/history";
import { overviewPage, type OverviewView } from "./pages/overview";
import { provenancePage, type OverviewForProvenance } from "./pages/provenance";
import { forecastQualityPage, type QualityDto } from "./pages/forecast-quality";
import { forecastDiagnosticsInvalid, forecastDiagnosticsLoading, forecastDiagnosticsPage, type ForecastErrorsDto } from "./pages/forecast-diagnostics";
import { forecastPage, loadForecastPage } from "./pages/forecast";
import { forecastNotImplemented } from "./pages/forecast-placeholder";
export { forecastNotImplemented };
import {
  diagnosticsParams, forecastParams, normalizeForecastParams, PAGES, parseHash, rangeToQuery,
  type ForecastHorizon, type ForecastMode, type PageKey, type Route,
} from "./routing";

interface Overview extends OverviewView {
  shadow: { snapshots: number; pending: number; reconciled: number; fallbacks: number; invalids: number; candidate: string; baseline: string; horizons: number[]; available: boolean };
  replay: { snapshots: number; available: boolean };
}
interface ShadowForecasts { totals: { snapshots: number; pending: number; reconciled: number }; errorsByMode: { shadow: number; replay: number; unknown: number }; manifestStatus: string; items: Array<{ mode: string; modelId: string; horizon: number; originDate: string; targetDate: string; forecastValue: number | null; status: string }> }

/** Решение dispatch: существующая страница либо маршрут Forecast. */
export type PageDecision =
  | { kind: "forecast"; valid: boolean; mode: ForecastMode | null; horizon: ForecastHorizon | null; canonical: string }
  | { kind: "page"; page: PageKey };

/** Чистая функция выбора. Некорректные параметры Forecast не становятся валидными. */
export function resolvePage(route: Route): PageDecision {
  if (route.page === "forecast") {
    const params = normalizeForecastParams(route);
    return { kind: "forecast", valid: params.valid, mode: params.mode, horizon: params.horizon, canonical: params.fallback };
  }
  return { kind: "page", page: route.page };
}

/**
 */

function shell(content: TrustedHtml, updatedAt: string | null, sourceStatus: "OK" | "PARTIAL" | "NOT_AVAILABLE", page: PageKey): TrustedHtml {
  return appShell({
    sidebar: sidebar({
      brandName: "DSS",
      brandSub: "прогнозирование заказов",
      sections: [{ title: "Аналитика", items: PAGES.map((item) => ({ href: `#${item.key}`, label: item.label, current: item.key === page })) }],
    }),
    topbar: topbar({ title: "DSS · история и аналитика", shopNo: "7745", lastUpdated: updatedAt, sourceStatus }),
    content,
  });
}

/** FINAL-2/UI-2.3: состояние таблицы истории в памяти (hash-контракт не меняется). */
let historyPageIndex = 0;
let historyPageKey = "";
let appRoot: HTMLElement | null = null;
let historyCache: { history: HistoryDto; coverage: CoverageDto | null; range: string; from: string; to: string; sourceStatus: "OK" | "PARTIAL" | "NOT_AVAILABLE" } | null = null;

/** FIX-1: поколение рендера. Устаревший вызов не имеет права изменять DOM. */
let renderRequestSeq = 0;

/** Выбор и рендеринг страницы. Hash передаётся вызывающей стороной: URL здесь не изменяется. */
export async function renderApp(root: HTMLElement, hash: string, get: typeof api.get = api.get): Promise<void> {
  appRoot = root;
  const generation = ++renderRequestSeq;
  const commit = (content: TrustedHtml): void => {
    if (generation === renderRequestSeq) root.innerHTML = content;
  };

  const route = parseHash(hash);
  const { page, range, from, to } = route;
  const decision = resolvePage(route);

  // Forecast: валидный маршрут грузит два источника; вход #forecast уходит на канонический адрес.
  if (decision.kind === "forecast") {
    const { mode: forecastMode, horizon: forecastHorizon } = decision;
    if (!decision.valid || forecastMode === null || forecastHorizon === null) {
      if (route.segmentCount === 1) {
        window.location.replace("#forecast/replay/1");
        commit(shell(forecastPage({ mode: "replay", horizon: 1, snapshots: null, reconciliations: null, generatedAt: null }), null, "NOT_AVAILABLE", page));
        return;
      }
      commit(shell(forecastNotImplemented(decision), null, "NOT_AVAILABLE", page));
      return;
    }
    commit(shell(forecastPage({ mode: forecastMode, horizon: forecastHorizon, snapshots: null, reconciliations: null, generatedAt: null }), null, "NOT_AVAILABLE", page));
    await loadForecastPage({
      mode: forecastMode,
      horizon: forecastHorizon,
      commit: (content) => commit(shell(content, null, "NOT_AVAILABLE", page)),
    });
    return;
  }

  commit(shell(loadingState({ rows: 6 }), null, "NOT_AVAILABLE", page));

  const overview = await loadResult(get<Overview>("/api/v1/overview"));
  const updatedAt = overview.status === "ok" ? overview.meta.generatedAt : null;
  const sourceStatus = overview.status === "ok" ? "OK" : overview.status === "not_available" ? "NOT_AVAILABLE" : "PARTIAL";

  if (page === "forecast-quality") {
    const { mode, horizon } = forecastParams(route);
    const quality = await loadResult(get<QualityDto>("/api/v1/forecasts/quality", { mode, horizon }));
    commit(shell(block(quality, () => forecastQualityPage({ data: (quality as { data: QualityDto }).data, mode, horizon })), updatedAt, sourceStatus, page));
    return;
  }

  if (page === "forecast-diagnostics") {
    const { mode, horizon, invalid } = diagnosticsParams(route);
    if (invalid) {
      commit(shell(forecastDiagnosticsInvalid(route.range, route.from), updatedAt, "NOT_AVAILABLE", page));
      return;
    }
    commit(shell(forecastDiagnosticsLoading(), updatedAt, sourceStatus, page));
    const [quality, errors] = await Promise.all([
      loadResult(get<QualityDto>("/api/v1/forecasts/quality", { mode, horizon })),
      loadResult(get<ForecastErrorsDto>("/api/v1/forecasts/errors", { mode })),
    ]);
    const generatedAt =
      quality.status === "ok" || quality.status === "not_available"
        ? quality.meta.generatedAt
        : errors.status === "ok" || errors.status === "not_available"
          ? errors.meta.generatedAt
          : updatedAt;
    commit(shell(forecastDiagnosticsPage({ mode, horizon, quality, errors, generatedAt }), updatedAt, sourceStatus, page));
    return;
  }

  const lastDate = overview.status === "ok" ? overview.data.history.lastDate : null;
  const query = rangeToQuery(range, from, to, lastDate);
  if (query.error) {
    commit(shell(errorState({ title: "Некорректный диапазон", detail: query.error, code: "INVALID_RANGE" }), null, "PARTIAL", page));
    return;
  }

  // B1: shadow-запрос только для Overview. B3: при range === "all" полный ряд совпадает с history.
  const [history, coverage, fullHistoryResult, shadowResult] = await Promise.all([
    loadResult(get<HistoryDto>("/api/v1/history", { limit: 1000, from: query.from, to: query.to })),
    loadResult(get<CoverageDto>("/api/v1/history/coverage")),
    range === "all" ? Promise.resolve(null) : loadResult(get<HistoryDto>("/api/v1/history", { limit: 1000 })),
    page === "overview" ? loadResult(get<ShadowForecasts>("/api/v1/shadow/forecasts", { limit: 20 })) : Promise.resolve(null),
  ]);
  const fullHistory = fullHistoryResult ?? history;

  const shadowForOverview: ApiResult<ShadowForecasts> = shadowResult ?? { status: "not_available", data: null, meta: { generatedAt: "", source: "shadow_jsonl", readOnly: true, reason: "SHADOW_NOT_LOADED" } };
  let content: TrustedHtml;
  if (page === "history") {
    content = block(history, () => {
      const data = (history as { data: HistoryDto }).data;
      if (!data.returnedPoints) return historyEmpty();
      const cov = coverage.status === "ok" ? (coverage as { data: CoverageDto }).data : null;
      const stateKey = `${range}|${from}|${to}`;
      if (stateKey !== historyPageKey) { historyPageKey = stateKey; historyPageIndex = 0; }
      historyCache = { history: data, coverage: cov, range, from, to, sourceStatus };
      return historyPage({ history: data, coverage: cov, activeRange: range, from, to, page: historyPageIndex });
    });
  } else if (page === "quality") {
    content = block(coverage, () => {
      const cov = (coverage as { data: CoverageDto }).data;
      const points = fullHistory.status === "ok" ? (fullHistory as { data: HistoryDto }).data.points : [];
      return dataQualityPage({ coverage: cov, points });
    });
  } else if (page === "provenance") {
    content = block(overview, () => provenancePage((overview as { data: Overview }).data));
  } else {
    content = block(overview, () => overviewPage((overview as { data: Overview }).data, history, shadowForOverview));
  }
  commit(shell(content, updatedAt, sourceStatus, page));
}

/** Клики страницы: диапазон истории и пагинация. Возвращает true, если клик обработан. */
export function handleAppClick(target: EventTarget | null, rerender: () => void): boolean {
  const container = document.getElementById("app");
  const action: ClickAction | null = resolveClickAction(target, container);
  if (!action) return false;
  if (action === "apply-range") {
    const from = (document.getElementById("ds-from") as HTMLInputElement | null)?.value ?? "";
    const to = (document.getElementById("ds-to") as HTMLInputElement | null)?.value ?? "";
    window.location.hash = `#history/custom/${from}/${to}`;
    return true;
  }
  if (action === "reset-range") { window.location.hash = "#history/all"; return true; }
  if (action === "page-prev") { historyPageIndex = Math.max(0, historyPageIndex - 1); rerenderHistoryFromCache(rerender); return true; }
  historyPageIndex += 1;
  rerenderHistoryFromCache(rerender);
  return true;
}

/** B2: перерисовка таблицы истории из уже загруженного набора — без повторных GET-запросов. */
export function rerenderHistoryFromCache(fallback: () => void): void {
  if (!historyCache || !appRoot) { fallback(); return; }
  const { history, coverage, range, from, to, sourceStatus: cachedStatus } = historyCache;
  // B4: статус берётся из кэша: error не превращается в NOT_AVAILABLE, пустой ответ не маскируется.
  if (!history.returnedPoints) { appRoot.innerHTML = shell(historyEmpty(), null, cachedStatus, "history"); return; }
  const content = historyPage({ history, coverage, activeRange: range, from, to, page: historyPageIndex });
  appRoot.innerHTML = shell(content, null, cachedStatus, "history");
}
