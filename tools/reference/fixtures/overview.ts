/**
 * TPL-4.1: fixtures страницы «Обзор».
 * Отдельной production-функции обзора нет — страница собирается из атомарных компонентов.
 */
import { card, chartCard, completenessCalendar, dataTable, kpiGrid, lineChart, pageHeader, provenanceDrawer, statusBadge, trusted, type TrustedHtml } from "../../../src/web/components/index";
import { formatDate, formatNumber } from "../../../src/web/lib/format";
import { SYNTHETIC_CHECKSUM, referenceBanner, statesCard } from "./common";
import { overviewSeries } from "./history";

export function overviewContent(): TrustedHtml {
  const header = pageHeader({
    title: "Обзор",
    subtitle: "магазин 7745 · Europe/Moscow · метрика delivered_orders_daily · семантика PROVISIONAL",
    right: trusted(`${statusBadge({ status: "PROVISIONAL", text: "PROVISIONAL" })} ${statusBadge({ status: "PENDING", text: "ожидают факта: 6" })}`),
  });

  const historyCard = card({
    title: "История",
    body: kpiGrid([
      { label: "Дней", value: formatNumber(900), note: "01.01.2024 — 18.06.2026", status: "OK" },
      { label: "Последний факт", value: formatNumber(1500), note: formatDate("2026-06-18"), status: "OK" },
    ]),
  });

  const shadowCard = card({
    title: "Теневой режим",
    body: kpiGrid([
      { label: "Наблюдений", value: formatNumber(40), note: "историческая диагностика отдельно: 3 500", status: "OK" },
      { label: "Ожидают факта", value: formatNumber(6), note: "сверено 34", status: "PENDING" },
    ]),
  });

  const provenanceCard = card({
    title: "Актуальность источника",
    right: trusted(`${statusBadge({ status: "OK", text: "актуальность: совпадает" })} ${statusBadge({ status: "OK", text: "манифест: OK" })}`),
    body: trusted(`${provenanceDrawer({ source: "canonical CSV (только чтение)", checksum: SYNTHETIC_CHECKSUM.file, version: SYNTHETIC_CHECKSUM.normalized, note: "семантика PROVISIONAL" })}`),
  });

  const chart = chartCard({
    title: "История фактов",
    hint: "линия разрывается на отсутствующих наблюдениях",
    legend: trusted(`<span><i class="ds-legend-dot"></i>факт</span><span>отсутствующие дни не соединяются линией и не заменяются нулём</span>`),
    chart: lineChart([{ name: "actual", className: "actual", points: overviewSeries() }], 720, 260),
  });

  const shadowTable = card({
    title: "Теневой режим: наблюдения",
    subtitle: "только теневой режим; историческая диагностика не смешивается",
    body: dataTable({
      columns: [{ key: "model", label: "Модель" }, { key: "horizon", label: "h", numeric: true }, { key: "target", label: "Целевая дата" }, { key: "value", label: "Прогноз", numeric: true }],
      rows: [
        { model: "rolling_7_day_mean", horizon: 1, target: formatDate("2026-06-17"), value: formatNumber(1480) },
        { model: "adaptive_baseline", horizon: 1, target: formatDate("2026-06-17"), value: formatNumber(1505) },
        { model: "rolling_7_day_mean", horizon: 3, target: formatDate("2026-06-19"), value: "[Н/Д]" },
      ],
      emptyText: "Реальных наблюдений теневого режима нет",
    }),
  });

  const calendar = card({
    title: "Полнота (последние 28 календарных дней)",
    body: completenessCalendar([
      { date: "2026-06-01", status: "full" }, { date: "2026-06-02", status: "full" },
      { date: "2026-06-03", status: "missing" }, { date: "2026-06-04", status: "unknown" },
      { date: "2026-06-05", status: "partial" }, { date: "2026-06-06", status: "full" },
    ]),
  });

  return trusted(`${referenceBanner()}${header}<div class="ds-grid ds-grid--cards">${historyCard}${shadowCard}</div>${provenanceCard}${chart}${shadowTable}${calendar}${statesCard()}`);
}
