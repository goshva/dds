/** UI-3: оболочка DSS с навигацией (overview / history / quality / provenance). Данные — только через API. */
import {
  appShell,
  card,
  chartCard,
  completenessCalendar,
  dataTable,
  emptyState,
  errorState,
  formatDate,
  formatNumber,
  kpiGrid,
  lineChart,
  loadingState,
  pageHeader,
  provenanceDrawer,
  sidebar,
  statusBadge,
  topbar,
  trusted,
  type TrustedHtml,
} from "./components";
import { api, ApiClientError, type ApiResult } from "./api/client";
import { dataQualityPage } from "./pages/data-quality";
import { historyEmpty, historyPage, type CoverageDto, type HistoryDto } from "./pages/history";
import { provenancePage, type OverviewForProvenance } from "./pages/provenance";
import { forecastQualityPage, type QualityDto } from "./pages/forecast-quality";
import { forecastDiagnosticsInvalid, forecastDiagnosticsLoading, forecastDiagnosticsPage, type ForecastErrorsDto } from "./pages/forecast-diagnostics";
import { diagnosticsParams, forecastParams, PAGES, parseHash, rangeToQuery, type PageKey } from "./routing";

interface Overview extends OverviewForProvenance {
  shadow: { snapshots: number; pending: number; reconciled: number; fallbacks: number; invalids: number; candidate: string; baseline: string; horizons: number[]; available: boolean };
  replay: { snapshots: number; available: boolean };
}
interface ShadowForecasts { totals: { snapshots: number; pending: number; reconciled: number }; errorsByMode: { shadow: number; replay: number; unknown: number }; manifestStatus: string; items: Array<{ mode: string; modelId: string; horizon: number; originDate: string; targetDate: string; forecastValue: number | null; status: string }> }

const root = document.getElementById("app")!;

/** FINAL-2: индекс страницы таблицы истории (в памяти; hash-контракт не меняется). */
let historyPageIndex = 0;
let historyPageKey = "";

async function loadResult<T>(promise: Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  try {
    return await promise;
  } catch (error) {
    const clientError = error as ApiClientError;
    return { status: "error", error: { code: clientError.code ?? "UNKNOWN", message: clientError.message ?? "Неизвестная ошибка", eventId: `client-${crypto.randomUUID()}` } };
  }
}

function nav(current: PageKey): TrustedHtml {
  return sidebar({
    brandName: "DSS",
    brandSub: "прогнозирование заказов",
    sections: [{ title: "Аналитика", items: PAGES.map((page) => ({ href: `#${page.key}`, label: page.label, current: page.key === current })) }],
  });
}

function shell(content: TrustedHtml, updatedAt: string | null, sourceStatus: "OK" | "PARTIAL" | "NOT_AVAILABLE", page: PageKey): TrustedHtml {
  return appShell({
    sidebar: nav(page),
    topbar: topbar({ title: "DSS · история и аналитика", shopNo: "7745", lastUpdated: updatedAt, sourceStatus }),
    content,
  });
}

function block(result: ApiResult<unknown>, render: () => TrustedHtml): TrustedHtml {
  if (result.status === "not_available") return emptyState({ title: "Данные недоступны", detail: `причина: ${result.meta.reason ?? "UNKNOWN"}` });
  if (result.status === "error") return errorState({ title: "Ошибка источника", detail: result.error.message, code: `${result.error.code} · ${result.error.eventId.slice(0, 8)}` });
  return render();
}

/** Диапазон запроса вычисляется на клиенте из уже выбранного периода; сервер фильтрует по датам. */
async function render(): Promise<void> {
  const route = parseHash(window.location.hash);
  const { page, range, from, to } = route;
  root.innerHTML = shell(loadingState({ rows: 6 }), null, "NOT_AVAILABLE", page);

  const overview = await loadResult(api.get<Overview>("/api/v1/overview"));
  const updatedAt = overview.status === "ok" ? overview.meta.generatedAt : null;
  const sourceStatus = overview.status === "ok" ? "OK" : overview.status === "not_available" ? "NOT_AVAILABLE" : "PARTIAL";

  // UI-7.0.1 (D-001): forecast-quality не использует диапазон дат — mode/horizon разбираются отдельно,
  // валидатор дат к ним не применяется.
  if (page === "forecast-quality") {
    const { mode, horizon } = forecastParams(route);
    const quality = await loadResult(api.get<QualityDto>("/api/v1/forecasts/quality", { mode, horizon }));
    const content = block(quality, () => forecastQualityPage({ data: (quality as { data: QualityDto }).data, mode, horizon }));
    root.innerHTML = shell(content, updatedAt, sourceStatus, page);
    return;
  }

  // UI-7.1.1: диагностика прогнозирования — два независимых endpoint (quality, errors).
  // errors не фильтруется по horizon (API не поддерживает); режим обязателен.
  if (page === "forecast-diagnostics") {
    const { mode, horizon, invalid } = diagnosticsParams(route);
    if (invalid) {
      root.innerHTML = shell(forecastDiagnosticsInvalid(route.range, route.from), updatedAt, "NOT_AVAILABLE", page);
      return;
    }
    root.innerHTML = shell(forecastDiagnosticsLoading(), updatedAt, sourceStatus, page);
    const [quality, errors] = await Promise.all([
      loadResult(api.get<QualityDto>("/api/v1/forecasts/quality", { mode, horizon })),
      loadResult(api.get<ForecastErrorsDto>("/api/v1/forecasts/errors", { mode })),
    ]);
    // meta.generatedAt: время формирования ответа API (не дата последнего факта). Берём из quality,
    // при его недоступности — из errors; в последнюю очередь — из overview.
    const generatedAt =
      quality.status === "ok" || quality.status === "not_available"
        ? quality.meta.generatedAt
        : errors.status === "ok" || errors.status === "not_available"
          ? errors.meta.generatedAt
          : updatedAt;
    const content = forecastDiagnosticsPage({ mode, horizon, quality, errors, generatedAt });
    root.innerHTML = shell(content, updatedAt, sourceStatus, page);
    return;
  }

  const lastDate = overview.status === "ok" ? overview.data.history.lastDate : null;
  const query = rangeToQuery(range, from, to, lastDate);
  if (query.error) {
    root.innerHTML = shell(errorState({ title: "Некорректный диапазон", detail: query.error, code: "INVALID_RANGE" }), null, "PARTIAL", page);
    return;
  }

  const [history, coverage, fullHistory, forecasts] = await Promise.all([
    loadResult(api.get<HistoryDto>("/api/v1/history", { limit: 1000, from: query.from, to: query.to })),
    loadResult(api.get<CoverageDto>("/api/v1/history/coverage")),
    loadResult(api.get<HistoryDto>("/api/v1/history", { limit: 1000 })),
    loadResult(api.get<ShadowForecasts>("/api/v1/shadow/forecasts", { limit: 20 })),
  ]);

  let content: TrustedHtml;

  if (page === "history") {
    content = block(history, () => {
      const data = (history as { data: HistoryDto }).data;
      if (!data.returnedPoints) return historyEmpty();
      const cov = coverage.status === "ok" ? (coverage as { data: CoverageDto }).data : null;
      const stateKey = `${range}|${from}|${to}`;
      if (stateKey !== historyPageKey) { historyPageKey = stateKey; historyPageIndex = 0; }
      return historyPage({ history: data, coverage: cov, activeRange: range, from, to, page: historyPageIndex });
    });
  } else if (page === "quality") {
    content = block(coverage, () => {
      const cov = (coverage as { data: CoverageDto }).data;
      // UI-3.1: календарь качества строится по полному ряду, а не по выбранному диапазону
      const points = fullHistory.status === "ok" ? (fullHistory as { data: HistoryDto }).data.points : [];
      return dataQualityPage({ coverage: cov, points });
    });
  } else if (page === "provenance") {
    content = block(overview, () => provenancePage((overview as { data: Overview }).data));
  } else {
    content = block(overview, () => {
      const data = (overview as { data: Overview }).data;
      const freshnessStatus = data.provenance.freshness === "MATCH" ? "OK" : data.provenance.freshness === "STALE" ? "PENDING" : "NOT_AVAILABLE";
      return trusted(`
${pageHeader({ title: "Обзор", subtitle: `магазин ${data.shopNo} · ${data.timezone} · метрика ${data.metric} · slice ${data.sliceId}`, right: statusBadge({ status: "PROVISIONAL" }) })}
<div class="ds-grid ds-grid--cards">
  ${card({ title: "История", body: kpiGrid([
        { label: "Дней", value: formatNumber(data.history.days), note: `${formatDate(data.history.firstDate)} — ${formatDate(data.history.lastDate)}`, status: data.history.completeness === "COMPLETE" ? "OK" : "PENDING" },
        { label: "Последний факт", value: data.history.lastValue === null ? "[Н/Д]" : formatNumber(data.history.lastValue), note: formatDate(data.history.lastDate), status: "OK" },
      ]) })}
  ${card({ title: "Теневой режим", body: kpiGrid([
        { label: "Shadow-снапшотов", value: formatNumber(data.shadow.snapshots), note: `replay отдельно: ${data.replay?.snapshots ?? "[Н/Д]"}`, status: data.shadow.available ? "OK" : "NOT_AVAILABLE" },
        { label: "Ожидают факта", value: formatNumber(data.shadow.pending), note: `сверено ${data.shadow.reconciled}`, status: "PENDING" },
      ]) })}
</div>
${card({ title: "Актуальность источника", body: trusted(`<div class="ds-row">${statusBadge({ status: freshnessStatus, text: `freshness: ${data.provenance.freshness}` })}${statusBadge({ status: data.provenance.manifestStatus === "OK" ? "OK" : "NOT_AVAILABLE", text: `manifest: ${data.provenance.manifestStatus}` })}</div>${provenanceDrawer({ source: "canonical CSV (read-only)", checksum: `file ${data.provenance.fileChecksum}`, version: `normalized ${data.provenance.normalizedChecksum}`, note: "семантика PROVISIONAL" })}`) })}
${chartCard({ title: "История фактов", hint: "линия разрывается на отсутствующих наблюдениях", chart: lineChart([{ name: "actual", className: "actual", points: history.status === "ok" ? (history as { data: HistoryDto }).data.points.map((point) => ({ date: point.date, value: Number.isFinite(point.value) ? point.value : null })) : [] }]) })}
${card({ title: "Теневой режим: реальные наблюдения", subtitle: "только mode=shadow", body: dataTable({ columns: [{ key: "model", label: "Модель" }, { key: "h", label: "h", numeric: true }, { key: "target", label: "target" }, { key: "value", label: "Прогноз", numeric: true }], rows: forecasts.status === "ok" ? (forecasts as { data: ShadowForecasts }).data.items.slice(-6).map((item) => ({ model: item.modelId, h: item.horizon, target: formatDate(item.targetDate), value: item.forecastValue === null ? "[Н/Д]" : formatNumber(item.forecastValue) })) : [], emptyText: "Реальных shadow-прогнозов нет" }) })}
${card({ title: "Полнота (последние 28 дней)", body: completenessCalendar(history.status === "ok" ? (history as { data: HistoryDto }).data.points.slice(-28).map((point) => ({ date: point.date, status: Number.isFinite(point.value) ? "full" as const : "missing" as const })) : []) })}
`);
    });
  }
  root.innerHTML = shell(content, updatedAt, sourceStatus, page);
}

function applyCustomRange(): void {
  const from = (document.getElementById("ds-from") as HTMLInputElement | null)?.value ?? "";
  const to = (document.getElementById("ds-to") as HTMLInputElement | null)?.value ?? "";
  window.location.hash = `#history/custom/${from}/${to}`;
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.id === "ds-apply") applyCustomRange();
  if (target.id === "ds-reset") window.location.hash = "#history/all";
  if (target.id === "ds-page-prev") { historyPageIndex = Math.max(0, historyPageIndex - 1); void render(); }
  if (target.id === "ds-page-next") { historyPageIndex += 1; void render(); }
});
document.querySelector("[data-ds-menu]")?.addEventListener("click", () => {
  document.querySelector("[data-ds-sidebar]")?.classList.toggle("is-open");
});
window.addEventListener("hashchange", () => void render());
void render();