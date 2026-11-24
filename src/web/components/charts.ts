/** SVG-графики LineChart и BarChart (без библиотек). */
import { escapeHtml, trusted, type TrustedHtml } from "../lib/format";

export interface SeriesPoint { date: string; value: number | null }

/** Разрешённые классы серий: произвольные значения в SVG-атрибуты не попадают. */
export type SeriesClass = "actual" | "baseline" | "candidate" | "pending";

/** Строгое соответствие разрешённых значений и CSS-классов. */
const SERIES_CLASS: Record<SeriesClass, string> = {
  actual: "ds-chart-line--actual",
  baseline: "ds-chart-line--baseline",
  candidate: "ds-chart-line--candidate",
  pending: "ds-chart-line--pending",
};

export function isSeriesClass(value: unknown): value is SeriesClass {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SERIES_CLASS, value);
}

/** Возвращает только известный CSS-класс; неизвестное значение не интерполируется. */
function seriesCssClass(value: unknown): string {
  return isSeriesClass(value) ? SERIES_CLASS[value] : SERIES_CLASS.actual;
}

/** Безопасные размеры: конечные положительные числа, иначе значения по умолчанию. */
function safeSize(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

export interface Series { name: string; className: SeriesClass; points: SeriesPoint[] }

export function lineChart(series: Series[], width = 720, height = 260): TrustedHtml {
  const all = series.flatMap((entry) => entry.points.map((point) => point.value)).filter((value): value is number => value !== null && Number.isFinite(value));
  if (!all.length) return trusted(`<div class="ds-sub">NOT_AVAILABLE</div>`);
  width = safeSize(width, 720);
  height = safeSize(height, 260);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const pad = { left: 42, right: 12, top: 12, bottom: 24 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const count = Math.max(...series.map((entry) => entry.points.length), 1);
  const x = (index: number) => pad.left + (index / Math.max(count - 1, 1)) * innerW;
  const y = (value: number) => pad.top + innerH - ((value - min) / span) * innerH;
  const paths = series
    .map((entry) => {
      let segment = "";
      let started = false;
      entry.points.forEach((point, index) => {
        if (point.value === null || !Number.isFinite(point.value)) { started = false; return; }
        const command = started ? "L" : "M";
        segment += `${command}${x(index).toFixed(1)},${y(point.value).toFixed(1)} `;
        started = true;
      });
      return segment ? `<path class="${seriesCssClass(entry.className)}" d="${segment.trim()}"/>` : "";
    })
    .join("");
  const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const gy = pad.top + innerH * ratio;
    const label = (max - span * ratio).toFixed(0);
    return `<line class="ds-chart-grid" x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}"/><text class="ds-chart-axis" x="4" y="${gy + 3}">${label}</text>`;
  }).join("");
  const first = series[0]?.points[0]?.date ?? "";
  const last = series[0]?.points.at(-1)?.date ?? "";
  return trusted(`<div class="ds-chart-wrap"><svg class="ds-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="line chart"><title>${escapeHtml(first)} — ${escapeHtml(last)}</title>${grid}${paths}</svg></div>`);
}

export function barChart(values: Array<{ label: string; value: number | null }>, width = 720, height = 200): TrustedHtml {
  const present = values.map((entry) => entry.value).filter((value): value is number => value !== null && Number.isFinite(value));
  if (!present.length) return trusted(`<div class="ds-sub">NOT_AVAILABLE</div>`);
  width = safeSize(width, 720);
  height = safeSize(height, 200);
  const max = Math.max(...present, 1);
  const barWidth = Math.max(4, (width - 20) / Math.max(values.length, 1) - 6);
  const bars = values.map((entry, index) => {
    if (entry.value === null || !Number.isFinite(entry.value)) return "";
    const barHeight = (entry.value / max) * (height - 28);
    const x = 10 + index * (barWidth + 6);
    return `<rect class="ds-chart-bar" x="${x}" y="${height - 20 - barHeight}" width="${barWidth}" height="${barHeight}" rx="2"><title>${escapeHtml(entry.label)}: ${entry.value}</title></rect>`;
  }).join("");
  return trusted(`<div class="ds-chart-wrap"><svg class="ds-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="bar chart">${bars}</svg></div>`);
}