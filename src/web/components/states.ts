/** Состояния: пусто, загрузка, ошибка. */
import { escapeHtml, trusted, type TrustedHtml } from "../lib/format";

export function emptyState(props: { title?: string; detail?: string }): TrustedHtml {
  return trusted(`<div class="ds-state" data-ds-empty><div class="ds-state-icon">∅</div><div class="ds-state-title">${escapeHtml(props.title ?? "Нет данных")}</div>${props.detail ? `<div class="ds-sub">${escapeHtml(props.detail)}</div>` : ""}</div>`);
}

export function loadingState(props: { rows?: number } = {}): TrustedHtml {
  const rows = props.rows ?? 4;
  const widths = [70, 85, 65, 78];
  return trusted(`<div class="ds-state" data-ds-loading>${Array.from({ length: rows }, (_, index) => `<div class="ds-skeleton" style="width:${widths[index % 4]}%"></div>`).join("")}</div>`);
}

export function errorState(props: { title?: string; detail?: string; code?: string }): TrustedHtml {
  return trusted(`<div class="ds-state ds-state--error" data-ds-error><div class="ds-state-icon">!</div><div class="ds-state-title">${escapeHtml(props.title ?? "Ошибка загрузки")}</div>${props.detail ? `<div class="ds-sub">${escapeHtml(props.detail)}</div>` : ""}${props.code ? `<div class="ds-badge ds-badge--conflict">${escapeHtml(props.code)}</div>` : ""}</div>`);
}