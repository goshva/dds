/** FINAL-2: страница «История заказов». Данные — только из API; расчётов прогнозов нет. */
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
} from "../components/index";

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

/** Размер страницы таблицы наблюдений (управляется frontend; API отдаёт до 1000 записей). */
export const HISTORY_PAGE_SIZE = 50;

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

/** Полнота берётся только из coverage API. Если DTO недоступен или значения нет — [Н/Д], без расчётов. */
function coverageValue(coverage: CoverageDto | null): string {
  if (!coverage) return "[Н/Д]";
  const ratio = coverage.fillRatio;
  return typeof ratio === "number" && Number.isFinite(ratio) ? `доля ${formatNumber(ratio, 3)}` : "[Н/Д]";
}

export function historyDataHeader(input: { history: HistoryDto; coverage: CoverageDto | null; activeRange: string }): TrustedHtml {
  const { history, coverage } = input;
  const quality = !coverage ? "NOT_AVAILABLE" : coverage.completeness === "COMPLETE" ? "OK" : coverage.completeness === "PARTIAL" ? "PENDING" : "NOT_AVAILABLE";
  const unavailable = "[Н/Д]";
  return card({
    title: "Доступные данные",
    subtitle: "период, глубина истории и полнота по данным API",
    right: trusted(`${statusBadge({ status: quality as never, text: coverage ? `полнота: ${coverage.completeness}` : "полнота: данные недоступны" })}${history.rangeClamped ? ` ${statusBadge({ status: "PENDING", text: "диапазон выходит за доступные данные" })}` : ""}`),
    body: kpiGrid([
      { label: "Период запроса", value: `${formatDate(history.requested.from)} — ${formatDate(history.requested.to)}`, note: `диапазон: ${input.activeRange}`, status: "OK" },
      { label: "Первая доступная дата", value: coverage ? formatDate(coverage.firstDate) : unavailable, status: coverage ? "OK" : "NOT_AVAILABLE" },
      { label: "Последняя доступная дата", value: coverage ? formatDate(coverage.lastDate) : unavailable, status: coverage ? "OK" : "NOT_AVAILABLE" },
      { label: "Доступных наблюдений", value: coverage ? formatNumber(coverage.days) : unavailable, note: coverage ? "дни с фактическими значениями" : "coverage API недоступен", status: coverage ? "OK" : "NOT_AVAILABLE" },
      { label: "Полнота ряда", value: coverageValue(coverage), note: coverage ? coverage.fillRatioFormula || "значение предоставляется API" : "проверка полноты недоступна", status: quality as never },
      { label: "Пропуски", value: coverage ? formatNumber(coverage.gaps) : unavailable, note: coverage ? `максимальный интервал: ${formatNumber(coverage.maxGapLength)}` : "количество пропусков неизвестно", status: coverage ? (coverage.gaps ? "PENDING" : "OK") : "NOT_AVAILABLE" },
    ]),
  });
}

export function historyPage(input: { history: HistoryDto; coverage: CoverageDto | null; activeRange: string; from: string; to: string; page?: number }): TrustedHtml {
  const { history, coverage } = input;
  const summary = history.summary;
  const partial = !summary.complete;
  const chart = lineChart([
    { name: "actual", className: "actual", points: history.points.map((point) => ({ date: point.date, value: Number.isFinite(point.value) ? point.value : null })) },
  ]);

  const ordered = [...history.points].reverse();
  const total = ordered.length;
  const pageCount = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const page = Math.min(Math.max(input.page ?? 0, 0), pageCount - 1);
  const start = page * HISTORY_PAGE_SIZE;
  const pageRows = ordered.slice(start, start + HISTORY_PAGE_SIZE);
  const firstShown = total ? start + 1 : 0;
  const lastShown = start + pageRows.length;

  const table = dataTable({
    columns: [{ key: "date", label: "Дата" }, { key: "value", label: "Доставленные заказы", numeric: true }, { key: "status", label: "Статус данных" }],
    rows: pageRows.map((point) => ({
      date: formatDate(point.date),
      value: Number.isFinite(point.value) ? formatNumber(point.value) : "[Н/Д]",
      status: Number.isFinite(point.value) ? "actual" : "unknown",
    })),
    emptyText: "За выбранный период наблюдений нет",
  });

  const pagination = total > HISTORY_PAGE_SIZE
    ? trusted(`<div class="ds-row" data-ds-history-pagination>
  <button class="ds-badge ${page > 0 ? "ds-badge--provisional" : "ds-badge--na"}" id="ds-page-prev" type="button"${page > 0 ? "" : " disabled"}>Назад</button>
  <span class="ds-sub" role="status">записи ${formatNumber(firstShown)}–${formatNumber(lastShown)} из ${formatNumber(total)} · страница ${formatNumber(page + 1)} из ${formatNumber(pageCount)}</span>
  <button class="ds-badge ${page < pageCount - 1 ? "ds-badge--provisional" : "ds-badge--na"}" id="ds-page-next" type="button"${page < pageCount - 1 ? "" : " disabled"}>Вперёд</button>
</div>`)
    : trusted(`<div class="ds-sub" data-ds-history-pagination>записей: ${formatNumber(total)} · постраничный просмотр не требуется</div>`);

  return trusted(`
${pageHeader({
    title: "История заказов",
    subtitle: `Историческая динамика доставленных заказов · Магазин 7745 · ${coverage ? `${formatDate(coverage.firstDate)} — ${formatDate(coverage.lastDate)}` : "период данных неизвестен (coverage API недоступен)"}`,
    right: trusted(`${statusBadge({ status: "PROVISIONAL", text: "Предварительная семантика" })} ${statusBadge({ status: partial ? "PENDING" : "OK", text: partial ? `период неполный: нет ${summary.missingDays} дн.` : "период полный" })}`),
  })}
${historyFilters(input.activeRange, input.from, input.to)}
${historyDataHeader({ history, coverage, activeRange: input.activeRange })}
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
    hint: "единица измерения — заказы в день; линия разрывается на отсутствующих наблюдениях, прогноз не добавляется",
    legend: trusted(`<span><i class="ds-legend-dot" style="background:var(--ds-ink)"></i>факт</span><span>отсутствующие дни не соединяются линией и не заменяются нулём</span>`),
    chart,
  })}
${card({ title: "Таблица истории", subtitle: `показаны записи ${formatNumber(firstShown)}–${formatNumber(lastShown)} из ${formatNumber(total)} · размер страницы ${formatNumber(HISTORY_PAGE_SIZE)}`, body: trusted(`${pagination}${table}`) })}
${card({ title: "Формулы", body: trusted(`<div class="ds-sub">${summary.formula}. Отсутствующие значения отображаются как [Н/Д] и не превращаются в 0.${summary.truncated ? " Внимание: ответ обрезан параметром limit; агрегаты рассчитаны по всему диапазону." : ""}</div>`) })}
`);
}

export function historyEmpty(): TrustedHtml {
  return emptyState({ title: "За выбранный период данных нет", detail: "Диапазон не содержит наблюдений. Измените период или сбросьте фильтр." });
}
