/** Карточки, KPI, статусы, провенанс. Слоты принимают только TrustedHtml. */
import { escapeHtml, formatNumber, statusClass, statusLabel, trusted, type DssStatus, type TrustedHtml } from "../lib/format";

export interface KpiCardProps { label: string; value: string; note?: string; status?: DssStatus }
export interface StatusBadgeProps { status: DssStatus; text?: string }
export interface CardProps { title?: string; subtitle?: string; right?: TrustedHtml; body: TrustedHtml }
export interface ChartCardProps { title: string; hint?: string; legend?: TrustedHtml; chart: TrustedHtml }
export interface ProvenanceDrawerProps { source: string; checksum?: string | null; version?: string | null; note?: string }

export function statusBadge(props: StatusBadgeProps): TrustedHtml {
  return trusted(`<span class="ds-badge ${statusClass(props.status)}">${escapeHtml(props.text ?? statusLabel(props.status))}</span>`);
}

export function kpiCard(props: KpiCardProps): TrustedHtml {
  return trusted(`<div class="ds-kpi" data-ds-kpi>
  <div class="ds-kpi-label">${escapeHtml(props.label)}</div>
  <div class="ds-kpi-value">${escapeHtml(props.value)}</div>
  ${props.note ? `<div class="ds-kpi-note">${escapeHtml(props.note)}</div>` : ""}
  ${props.status ? `<div style="margin-top:6px">${statusBadge({ status: props.status })}</div>` : ""}
</div>`);
}

export function card(props: CardProps): TrustedHtml {
  return trusted(`<section class="ds-card">
  ${props.title ? `<div class="ds-card-head"><h2 class="ds-card-title">${escapeHtml(props.title)}</h2>${props.right ?? ""}</div>` : ""}
  ${props.subtitle ? `<p class="ds-sub">${escapeHtml(props.subtitle)}</p>` : ""}
  ${props.body}
</section>`);
}

export function chartCard(props: ChartCardProps): TrustedHtml {
  return card({
    title: props.title,
    subtitle: props.hint,
    body: trusted(`<div class="ds-chart-block">${props.chart}</div>${props.legend ? `<div class="ds-chart-legend">${props.legend}</div>` : ""}`),
  });
}

export function provenanceDrawer(props: ProvenanceDrawerProps): TrustedHtml {
  const rows: Array<[string, string]> = [
    ["источник", props.source],
    ["checksum", props.checksum ?? "NOT_AVAILABLE"],
    ["версия", props.version ?? "NOT_AVAILABLE"],
  ];
  if (props.note) rows.push(["примечание", props.note]);
  return trusted(`<dl class="ds-drawer" data-ds-provenance>${rows.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`);
}

export function kpiGrid(items: KpiCardProps[]): TrustedHtml {
  return trusted(`<div class="ds-kpi-grid">${items.map(kpiCard).join("")}</div>`);
}

export { formatNumber };