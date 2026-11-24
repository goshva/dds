/** Таблицы, календарь полноты, спарклайн. */
import { escapeHtml, trusted, type TrustedHtml } from "../lib/format";

export interface TableColumn { key: string; label: string; numeric?: boolean }
export interface DataTableProps {
  columns: TableColumn[];
  rows: Array<Record<string, unknown>>;
  emptyText?: string;
  caption?: string;
}

export function dataTable(props: DataTableProps): TrustedHtml {
  if (!props.rows.length) {
    return trusted(`<div class="ds-table-wrap"><table class="ds-table"><thead><tr>${props.columns.map((column) => `<th${column.numeric ? ' class="is-num"' : ""}>${escapeHtml(column.label)}</th>`).join("")}</tr></thead><tbody><tr><td colspan="${props.columns.length}"><div class="ds-sub">${escapeHtml(props.emptyText ?? "Нет данных")}</div></td></tr></tbody></table></div>`);
  }
  const head = props.columns.map((column) => `<th${column.numeric ? ' class="is-num"' : ""}>${escapeHtml(column.label)}</th>`).join("");
  const body = props.rows.map((row) => `<tr>${props.columns.map((column) => `<td${column.numeric ? ' class="is-num"' : ""}>${escapeHtml(row[column.key])}</td>`).join("")}</tr>`).join("");
  return trusted(`<div class="ds-table-wrap"><table class="ds-table">${props.caption ? `<caption>${escapeHtml(props.caption)}</caption>` : ""}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
}

export type CalendarDayStatus = "full" | "partial" | "missing" | "unknown";
export interface CalendarDay { date: string; status: CalendarDayStatus }

export function completenessCalendar(days: CalendarDay[]): TrustedHtml {
  return trusted(`<div class="ds-calendar" data-ds-calendar>${days
    .map((day) => `<div class="ds-calendar-day ds-calendar-day--${day.status}" title="${escapeHtml(day.date)} (${day.status})"></div>`)
    .join("")}</div>`);
}

export function sparkline(values: Array<number | null>, width = 160, height = 36): TrustedHtml {
  const nums = values.map((value) => (value !== null && Number.isFinite(value) ? value : null));
  const present = nums.filter((value): value is number => value !== null);
  if (!present.length) return trusted(`<div class="ds-sub">NOT_AVAILABLE</div>`);
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min || 1;
  const step = width / Math.max(nums.length - 1, 1);
  const points = nums
    .map((value, index) => {
      if (value === null) return null;
      const x = index * step;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");
  if (!points) return trusted(`<div class="ds-sub">NOT_AVAILABLE</div>`);
  return trusted(`<svg class="ds-sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="sparkline"><polyline fill="none" stroke="var(--ds-acc)" stroke-width="2" points="${points}"/></svg>`);
}