/** UI-3: страница «История заказов». Данные — только из API; расчётов прогнозов нет. */
import {
  card,
  chartCard,
  dataTable,
  emptyState,
  formatDate,
  formatNumber,
  kpiGrid,
  lineChart,
  pageHeader,
  statusBadge,
  trusted,
  type TrustedHtml,
} from "../components";

export interface HistoryPointDto { date: string; value: number }
export interface HistoryDto {
  points: HistoryPointDto[];
  from: string | null;
  to: string | null;
  totalPoints: number;
  returnedPoints: number;
  semantics: "PROVISIONAL";
  summary: { sum: number; average: number; max: number; min: number; calendarDays: number; observationDays: number; missingDays: number; complete: boolean; truncated: boolean; formula: string };
  requested: { from: string | null; to: string | null };
  available: { from: string; to: string };
  rangeClamped: boolean;
}
export interface CoverageDto {
  firstDate: string | null; lastDate: string | null; days: number; gaps: number; duplicateDates: number;
  nullValues: number; nullPolicy: string; completeness: string;
  missingDates: string[]; gapIntervals: Array<{ from: string; to: string; length: number }>; maxGapLength: number;
  fillRatio: number; fillRatioFormula: string;
}

export const RANGES: Array<{ key: string; label: string; days: number | null }> = [
  { key: "all", label: "Весь период", days: null },
  { key: "30", label: "30 дней", days: 30 },
  { key: "90", label: "90 дней", days: 90 },
  { key: "180", label: "180 дней", days: 180 },
  { key: "365", label: "365 дней", days: 365 },
];

export function historyFilters(active: string, from: string, to: string): TrustedHtml {
  const buttons = RANGES.map((range) =>
    `<a class="ds-badge ${range.key === active ? "ds-badge--ok" : "ds-badge--na"}" href="#history/${range.key}">${range.label}</a>`,
  ).join(" ");
  return trusted(`<div class="ds-row" data-ds-history-filters>
  ${buttons}
  <span class="ds-sub">произвольный диапазон:</span>
  <input type="date" id="ds-from" value="${from}" aria-label="Дата начала" />
  <input type="date" id="ds-to" value="${to}" aria-label="Дата окончания" />
  <button class="ds-badge ds-badge--provisional" id="ds-apply" type="button">Применить</button>
  <button class="ds-badge ds-badge--na" id="ds-reset" type="button">Сбросить</button>
  <span class="ds-sub" id="ds-range-error" role="status"></span>
</div>`);
}

export function historyPage(input: { history: HistoryDto; coverage: CoverageDto; activeRange: string; from: string; to: string }): TrustedHtml {
  const { history, coverage } = input;
  const summary = history.summary;
  const partial = !summary.complete;
  const chart = lineChart([
    { name: "actual", className: "actual", points: history.points.map((point) => ({ date: point.date, value: Number.isFinite(point.value) ? point.value : null })) },
  ]);
  const table = dataTable({
    columns: [{ key: "date", label: "Дата" }, { key: "value", label: "Доставленные заказы", numeric: true }, { key: "status", label: "Статус данных" }],
    rows: history.points.slice(-60).reverse().map((point) => ({
      date: formatDate(point.date),
      value: Number.isFinite(point.value) ? formatNumber(point.value) : "[Н/Д]",
      status: Number.isFinite(point.value) ? "actual" : "unknown",
    })),
    emptyText: "За выбранный период наблюдений нет",
  });
  return trusted(`
${pageHeader({
    title: "История заказов",
    subtitle: `Историческая динамика доставленных заказов · Магазин 7745 · ${formatDate(coverage.firstDate)} — ${formatDate(coverage.lastDate)}`,
    right: trusted(`${statusBadge({ status: "PROVISIONAL", text: "Предварительная семантика" })} ${statusBadge({ status: partial ? "PENDING" : "OK", text: partial ? `период неполный: нет ${summary.missingDays} дн.` : "период полный" })}${input.history.rangeClamped ? ` ${statusBadge({ status: "PENDING", text: `диапазон выходит за доступные данные (${formatDate(input.history.available.from)} — ${formatDate(input.history.available.to)})` })}` : ""}`),
  })}
${historyFilters(input.activeRange, input.from, input.to)}
${card({
    title: "Показатели периода",
    subtitle: "рассчитаны только по доступным фактическим значениям",
    body: kpiGrid([
      { label: "Всего заказов", value: formatNumber(summary.sum), note: `наблюдений: ${summary.observationDays}`, status: "OK" },
      { label: "Среднее в день", value: formatNumber(summary.average, 1), note: "по доступным дням, не по календарю", status: partial ? "PENDING" : "OK" },
      { label: "Максимум", value: formatNumber(summary.max), status: "OK" },
      { label: "Минимум", value: formatNumber(summary.min), status: "OK" },
      { label: "Календарных дней", value: formatNumber(summary.calendarDays), note: input.history.rangeClamped ? "по запрошенному диапазону" : "по диапазону данных", status: "OK" },
      { label: "Дней с данными", value: formatNumber(summary.observationDays), note: `отсутствует: ${summary.missingDays}`, status: summary.missingDays ? "PENDING" : "OK" },
    ]),
  })}
${chartCard({
    title: "Динамика доставленных заказов",
    hint: "единица измерения — заказы в день; линия разрывается на отсутствующих наблюдениях",
    legend: trusted(`<span><i class="ds-legend-dot" style="background:var(--ds-ink)"></i>факт</span><span>отсутствующие дни не соединяются линией и не заменяются нулём</span>`),
    chart,
  })}
${card({ title: "Таблица истории", subtitle: `показаны последние ${Math.min(60, history.points.length)} из ${history.returnedPoints} дней периода`, body: table })}
${card({ title: "Формулы", body: trusted(`<div class="ds-sub">${summary.formula}. Отсутствующие значения отображаются как [Н/Д] и не превращаются в 0.${summary.truncated ? " Внимание: таблица обрезана параметром limit; агрегаты рассчитаны по всему диапазону." : ""}</div>`) })}
`);
}

export function historyEmpty(): TrustedHtml {
  return emptyState({ title: "За выбранный период данных нет", detail: "Диапазон не содержит наблюдений. Измените период или сбросьте фильтр." });
}