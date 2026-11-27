/**
 * TPL-4.1.1: fixtures страницы «Качество данных».
 *
 * Факты о статусах календаря:
 *  - компонент completenessCalendar() поддерживает четыре статуса (full, partial, missing, unknown)
 *    и каждый из них имеет собственный CSS-модификатор, кроме unknown (production-пробел, вне области этапа);
 *  - production-построитель buildCalendar() формирует только full, missing и unknown:
 *    статус partial им не выдаётся.
 * Поэтому данные разделены: календарь построителя и демонстрация всех поддерживаемых статусов компонента.
 */
import { card, completenessCalendar, trusted, type TrustedHtml } from "../../../src/web/components/index";
import type { CalendarDay } from "../../../src/web/components/data";
import { buildCalendar, dataQualityPage } from "../../../src/web/pages/data-quality";
import { referenceBanner, statesCard } from "./common";
import { historyCoverageFixture } from "./history";

/** Демонстрация всех четырёх статусов, поддерживаемых компонентом. */
function supportedStatuses(): CalendarDay[] {
  return [
    { date: "2026-06-01", status: "full" },
    { date: "2026-06-02", status: "partial" },
    { date: "2026-06-03", status: "missing" },
    { date: "2026-06-04", status: "unknown" },
  ];
}

export function qualityContent(): TrustedHtml {
  const coverage = historyCoverageFixture();
  const points = [
    { date: "2026-06-01", value: 1500 },
    { date: "2026-06-02", value: 1480 },
    { date: "2026-06-05", value: 1700 },
  ];
  const page = dataQualityPage({ coverage, points });

  const builderCalendar = card({
    title: "Календарь построителя",
    subtitle: "buildCalendar(): доступны статусы full, missing и unknown; статус partial построителем не формируется",
    body: completenessCalendar(buildCalendar({
      lastDate: coverage.lastDate,
      observationDates: new Set(points.map((point) => point.date)),
      missingDates: new Set(coverage.missingDates),
      count: 10,
    })),
  });

  const supportedCalendar = card({
    title: "Статусы, поддерживаемые компонентом",
    subtitle: "completenessCalendar(): full, partial, missing, unknown — данные переданы типизированным массивом CalendarDay",
    body: completenessCalendar(supportedStatuses()),
  });

  return trusted(`${referenceBanner()}${page}${builderCalendar}${supportedCalendar}${statesCard()}`);
}
