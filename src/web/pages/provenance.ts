/** UI-3: страница «Происхождение данных» — источник, slice, checksum, актуальность, семантика. */
import { card, formatDate, kpiGrid, pageHeader, provenanceDrawer, statusBadge, trusted, type TrustedHtml } from "../components";

export interface ProvenanceDto {
  normalizedChecksum: string;
  fileChecksum: string;
  manifestDatasetChecksum: string | null;
  manifestStatus: "OK" | "NOT_AVAILABLE" | "CORRUPTED";
  freshness: "MATCH" | "STALE" | "NOT_CONFIRMED";
}
export interface OverviewForProvenance {
  shopNo: string; timezone: string; metric: string; sliceId: number; semantics: string;
  history: { days: number; firstDate: string | null; lastDate: string | null; lastValue: number | null; checksum: string; fileChecksum: string; completeness: string };
  provenance: ProvenanceDto;
}

const FRESHNESS_STATUS: Record<string, "OK" | "PENDING" | "NOT_AVAILABLE" | "CONFLICT"> = {
  MATCH: "OK",
  STALE: "PENDING",
  NOT_CONFIRMED: "NOT_AVAILABLE",
};

export function provenancePage(overview: OverviewForProvenance): TrustedHtml {
  const provenance = overview.provenance;
  const manifestStatus = provenance.manifestStatus === "OK" ? "OK" : provenance.manifestStatus === "CORRUPTED" ? "CONFLICT" : "NOT_AVAILABLE";
  const warning =
    provenance.freshness === "STALE"
      ? "Данные фактов и manifest расходятся: версия фактов новее подтверждённой в manifest."
      : provenance.freshness === "NOT_CONFIRMED"
        ? "Соответствие версии фактов и manifest не подтверждено."
        : "Версия фактов соответствует manifest.";
  return trusted(`
${pageHeader({
    title: "Происхождение данных",
    subtitle: `Источник, версия и актуальность · Магазин ${overview.shopNo} · ${overview.timezone}`,
    right: trusted(`${statusBadge({ status: FRESHNESS_STATUS[provenance.freshness] ?? "NOT_AVAILABLE", text: `freshness: ${provenance.freshness}` })} ${statusBadge({ status: "PROVISIONAL" })}`),
  })}
${card({
    title: "Источник",
    body: kpiGrid([
      { label: "Метрика", value: overview.metric, note: `canonical: delivered_orders_daily`, status: "OK" },
      { label: "Slice", value: String(overview.sliceId), note: "другие slices не используются", status: "OK" },
      { label: "Период", value: `${formatDate(overview.history.firstDate)} — ${formatDate(overview.history.lastDate)}`, note: `дней: ${overview.history.days}`, status: "OK" },
      { label: "Последнее значение", value: overview.history.lastValue === null ? "[Н/Д]" : String(overview.history.lastValue), status: "OK" },
    ]),
  })}
${card({
    title: "Версия и актуальность",
    body: trusted(`${provenanceDrawer({
      source: "canonical CSV (read-only)",
      checksum: `file ${provenance.fileChecksum}`,
      version: `normalized ${provenance.normalizedChecksum}`,
      note: `manifest: ${provenance.manifestStatus} · ${provenance.manifestDatasetChecksum ?? "[Н/Д]"} · freshness: ${provenance.freshness}`,
    })}
  <div class="ds-row" style="margin-top:8px">${statusBadge({ status: FRESHNESS_STATUS[provenance.freshness] ?? "NOT_AVAILABLE", text: warning })}</div>
  <div class="ds-row" style="margin-top:6px">${statusBadge({ status: manifestStatus, text: `manifest: ${provenance.manifestStatus}` })}</div>`),
  })}
${card({
    title: "Семантика",
    body: trusted(`<div class="ds-sub"><b>Предварительная семантика (${overview.semantics}).</b> Показатель отражает исторические значения согласно текущей методике формирования данных. Правила перерасчётов и корректировок требуют подтверждения владельцем бизнес-процесса. Данные не следует трактовать как окончательно подтверждённое количество доставленных заказов.</div>`),
  })}
${card({
    title: "Ограничения источника",
    body: trusted(`<ul class="ds-sub">
  <li>Используется только canonical slice ${overview.sliceId}; значения других slices не суммируются.</li>
  <li>Внутренние пути файлов и служебные детали в интерфейс не выводятся.</li>
  <li>Отсутствующие значения не заменяются нулём и не интерполируются.</li>
  <li>При статусе <b>CORRUPTED</b> данные источника не показываются как корректные.</li>
</ul>`),
  })}
`);
}