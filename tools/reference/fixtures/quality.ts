/**
 * TPL-4.1: fixtures страницы «Качество данных».
 * Календарь показывает все четыре статуса: full, partial, missing, unknown.
 */
import { card, completenessCalendar, trusted, type TrustedHtml } from "../../../src/web/components/index";
import { buildCalendar, dataQualityPage } from "../../../src/web/pages/data-quality";
import { referenceBanner, statesCard } from "./common";
import { historyCoverageFixture } from "./history";

export function qualityContent(): TrustedHtml {
  const coverage = historyCoverageFixture();
  const points = [
    { date: "2026-06-01", value: 1500 },
    { date: "2026-06-02", value: 1480 },
    { date: "2026-06-05", value: 1700 },
  ];
  const page = dataQualityPage({ coverage, points });
  const calendar = buildCalendar({
    lastDate: coverage.lastDate,
    observationDates: new Set(points.map((point) => point.date)),
    missingDates: new Set(coverage.missingDates),
    count: 10,
  });
  const calendarCard = card({
    title: "Статусы календаря",
    subtitle: "все четыре состояния: наблюдение, частичное, пропуск, неизвестное",
    body: completenessCalendar(calendar),
  });
  return trusted(`${referenceBanner()}${page}${calendarCard}${statesCard()}`);
}
