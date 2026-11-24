/** UI-3: страница «Качество данных» — полнота, пропуски, ограничения. */
import { card, completenessCalendar, dataTable, formatDate, formatNumber, kpiGrid, pageHeader, statusBadge, trusted, type CalendarDay, type TrustedHtml } from "../components";
import type { CoverageDto } from "./history";

/**
 * UI-3.1: календарная сетка строится по календарным дням, а не по числу наблюдений.
 * Отсутствующие даты (из coverage.missingDates) остаются отсутствующими наблюдениями.
 */
export function buildCalendar(input: {
  lastDate: string | null;
  observationDates: Set<string>;
  missingDates: Set<string>;
  count?: number;
}): CalendarDay[] {
  const { lastDate, observationDates, missingDates } = input;
  const count = input.count ?? 28;
  if (!lastDate) return [];
  const end = Date.parse(`${lastDate}T00:00:00Z`);
  const days: CalendarDay[] = [];
  for (let index = count - 1; index >= 0; index--) {
    const date = new Date(end - index * 86_400_000).toISOString().slice(0, 10);
    const status = missingDates.has(date) ? "missing" : observationDates.has(date) ? "full" : "unknown";
    days.push({ date, status });
  }
  return days;
}

export function dataQualityPage(input: { coverage: CoverageDto; points: Array<{ date: string; value: number }> }): TrustedHtml {
  const { coverage, points } = input;
  const status = coverage.completeness === "COMPLETE" ? "OK" : coverage.completeness === "PARTIAL" ? "PENDING" : "NOT_AVAILABLE";
  // UI-3.1: последние 28 календарных дней от последней доступной даты
  const calendar = completenessCalendar(buildCalendar({
    lastDate: coverage.lastDate,
    observationDates: new Set(points.filter((point) => Number.isFinite(point.value)).map((point) => point.date)),
    missingDates: new Set(coverage.missingDates),
    count: 28,
  }));
  const gapsTable = dataTable({
    columns: [{ key: "from", label: "Начало пропуска" }, { key: "to", label: "Конец пропуска" }, { key: "length", label: "Дней", numeric: true }],
    rows: coverage.gapIntervals.map((interval) => ({ from: formatDate(interval.from), to: formatDate(interval.to), length: interval.length })),
    emptyText: "Пропусков в календарном покрытии нет",
  });
  return trusted(`
${pageHeader({
    title: "Качество данных",
    subtitle: `Полнота исторического ряда · ${formatDate(coverage.firstDate)} — ${formatDate(coverage.lastDate)}`,
    right: statusBadge({ status, text: `полнота: ${coverage.completeness}` }),
  })}
${card({
    title: "Полнота",
    body: kpiGrid([
      { label: "Календарных дней", value: formatNumber(coverage.days + coverage.gaps), status: "OK" },
      { label: "Дней с данными", value: formatNumber(coverage.days), status: "OK" },
      { label: "Отсутствующих значений", value: formatNumber(coverage.nullValues + coverage.gaps), note: `пропусков: ${coverage.gaps}`, status: coverage.gaps ? "PENDING" : "OK" },
      { label: "Доля заполненности", value: `${(coverage.fillRatio * 100).toFixed(2)} %`, note: coverage.fillRatioFormula, status: status },
    ]),
  })}
${card({ title: "Пропуски", subtitle: `максимальная длина интервала: ${coverage.maxGapLength}`, body: gapsTable })}
${card({ title: "Календарь (последние 28 дней)", body: calendar })}
${card({
    title: "Ограничения качества",
    body: trusted(`<ul class="ds-sub">
  <li>Семантика целевой метрики — <b>PROVISIONAL</b>: правила перерасчётов и корректировок требуют подтверждения владельцем бизнес-процесса.</li>
  <li>Финансовая интерпретация показателей не подтверждена.</li>
  <li>Аномальные значения не удаляются из исторического ряда и сохраняются для последующего анализа.</li>
  <li>Данные одного магазина не являются доказательством универсальной закономерности.</li>
  <li>Плановые мероприятия не являются историческими факторами.</li>
  <li>Список аномальных дат не отображается: однозначная связь с наблюдениями не подтверждена.</li>
</ul>`),
  })}
`);
}