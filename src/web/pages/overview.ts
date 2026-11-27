/** FINAL-3.3.2.1: разметка страницы Overview (вынесена из dispatch для соблюдения лимита 200 строк). */
import {
  card,
  chartCard,
  completenessCalendar,
  dataTable,
  formatDate,
  formatNumber,
  kpiGrid,
  lineChart,
  pageHeader,
  provenanceDrawer,
  statusBadge,
  trusted,
  type TrustedHtml,
} from "../components";
import type { ApiResult } from "../api/client";
import type { HistoryDto } from "./history";
import type { OverviewForProvenance } from "./provenance";

/** Представление Overview: базовые поля берутся из типа provenance-страницы, состав не дублируется. */
export interface OverviewView extends OverviewForProvenance {
  shadow: { snapshots: number; pending: number; reconciled: number; available: boolean };
  replay?: { snapshots: number };
}

interface ShadowForecasts { items: Array<{ modelId: string; horizon: number; targetDate: string; forecastValue: number | null }> }

/** Содержимое Overview: состав данных и разметка не изменены относительно прежнего main.ts. */
export function overviewPage(data: OverviewView, history: ApiResult<unknown>, forecasts: ApiResult<unknown>): TrustedHtml {
  const freshnessStatus = data.provenance.freshness === "MATCH" ? "OK" : data.provenance.freshness === "STALE" ? "PENDING" : "NOT_AVAILABLE";
  const points = history.status === "ok" ? (history as { data: HistoryDto }).data.points : [];
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
${chartCard({ title: "История фактов", hint: "линия разрывается на отсутствующих наблюдениях", chart: lineChart([{ name: "actual", className: "actual", points: points.map((point) => ({ date: point.date, value: Number.isFinite(point.value) ? point.value : null })) }]) })}
${card({ title: "Теневой режим: реальные наблюдения", subtitle: "только mode=shadow", body: dataTable({ columns: [{ key: "model", label: "Модель" }, { key: "h", label: "h", numeric: true }, { key: "target", label: "target" }, { key: "value", label: "Прогноз", numeric: true }], rows: forecasts.status === "ok" ? (forecasts as { data: ShadowForecasts }).data.items.slice(-6).map((item) => ({ model: item.modelId, h: item.horizon, target: formatDate(item.targetDate), value: item.forecastValue === null ? "[Н/Д]" : formatNumber(item.forecastValue) })) : [], emptyText: "Реальных shadow-прогнозов нет" }) })}
${card({ title: "Полнота (последние 28 дней)", body: completenessCalendar(points.slice(-28).map((point) => ({ date: point.date, status: Number.isFinite(point.value) ? "full" as const : "missing" as const }))) })}
`);
}
