// UI-3: frontend-тесты страниц истории, качества и происхождения.
import { describe, expect, test } from "bun:test";

import { buildCalendar, dataQualityPage } from "../../src/web/pages/data-quality";
import { historyPage, type CoverageDto, type HistoryDto } from "../../src/web/pages/history";
import { provenancePage, type OverviewForProvenance } from "../../src/web/pages/provenance";

const coverage: CoverageDto = {
  firstDate: "2026-11-01", lastDate: "2026-11-10", days: 9, gaps: 1, duplicateDates: 0, nullValues: 0,
  nullPolicy: "REJECTED_AS_CORRUPTED", completeness: "PARTIAL",
  missingDates: ["2026-11-05"], gapIntervals: [{ from: "2026-11-05", to: "2026-11-05", length: 1 }],
  maxGapLength: 1, fillRatio: 0.9, fillRatioFormula: "observationDays / calendarDays (дни с фактическими значениями ÷ календарные дни)",
};

function history(points: Array<{ date: string; value: number }>): HistoryDto {
  const values = points.map((point) => point.value).filter((value) => Number.isFinite(value));
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    points, from: points[0]?.date ?? null, to: points.at(-1)?.date ?? null, totalPoints: points.length, returnedPoints: points.length,
    semantics: "PROVISIONAL",
    summary: { sum, average: values.length ? sum / values.length : 0, max: values.length ? Math.max(...values) : 0, min: values.length ? Math.min(...values) : 0, calendarDays: points.length, observationDays: values.length, missingDays: points.length - values.length, complete: values.length === points.length, truncated: false, formula: "sum/avg/max/min — только по доступным фактическим значениям" },
    requested: { from: null, to: null }, available: { from: points[0]?.date ?? "", to: points.at(-1)?.date ?? "" }, rangeClamped: false,
  };
}

describe("UI-3: страница истории", () => {
  test("KPI, график и таблица рендерятся", () => {
    const html = historyPage({ history: history([{ date: "2026-11-01", value: 1500 }, { date: "2026-11-02", value: 1545 }]), coverage, activeRange: "all", from: "", to: "" });
    expect(html).toContain("История заказов");
    expect(html).toContain("Всего заказов");
    expect(html).toContain("3\u00a0045");
    expect(html).toContain("ds-chart");
    expect(html).toContain("Таблица истории");
    expect(html).toContain("Предварительная семантика");
  });

  test("нулевое значение показывается как 0, отсутствующее — как [Н/Д]", () => {
    const withZero = historyPage({ history: history([{ date: "2026-11-01", value: 0 }]), coverage, activeRange: "all", from: "", to: "" });
    expect(withZero).toContain(">0<");
    const withMissing = historyPage({ history: history([{ date: "2026-11-01", value: Number.NaN }]), coverage, activeRange: "all", from: "", to: "" });
    expect(withMissing).toContain("[Н/Д]");
    // отсутствующее значение не выводится как числовая ячейка 0
    expect(withMissing).not.toContain(`<td class="is-num">0</td>`);
  });

  test("график разрывает линию на отсутствующем наблюдении (два сегмента)", () => {
    const html = historyPage({
      history: history([{ date: "2026-11-01", value: 100 }, { date: "2026-11-02", value: Number.NaN }, { date: "2026-11-03", value: 200 }]),
      coverage, activeRange: "all", from: "", to: "",
    });
    // разрыв линии = два подпути (M ... M) внутри одного path
    const path = html.match(/<path class="ds-chart-line--actual" d="([^"]+)"/)?.[1] ?? "";
    expect((path.match(/M/g) ?? []).length).toBe(2);
    expect(path).not.toContain("NaN");
  });

  test("значения из источника экранируются (нет XSS)", () => {
    const html = historyPage({
      history: history([{ date: "2026-11-01", value: 1500 }]),
      coverage: { ...coverage, missingDates: ['<script>alert(1)</script>'] },
      activeRange: '<img src=x onerror=alert(1)>', from: "", to: "",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
  });
});

describe("UI-3: страница качества данных", () => {
  test("полнота, пропуски и ограничения отображаются", () => {
    const html = dataQualityPage({ coverage, points: [{ date: "2026-11-01", value: 1500 }, { date: "2026-11-02", value: Number.NaN }] });
    expect(html).toContain("Качество данных");
    expect(html).toContain("90.00 %");
    expect(html).toContain("05.11.2026");
    expect(html).toContain("PROVISIONAL");
    expect(html).toContain("не удаляются");
  });

  test("пустые интервалы пропусков дают понятное сообщение, а не нулевые строки", () => {
    const html = dataQualityPage({ coverage: { ...coverage, gapIntervals: [], gaps: 0, fillRatio: 1 }, points: [] });
    expect(html).toContain("Пропусков в календарном покрытии нет");
    expect(html).toContain("100.00 %");
  });
});

describe("UI-3: страница происхождения", () => {
  const overview: OverviewForProvenance = {
    shopNo: "7745", timezone: "Europe/Moscow", metric: "qty_orders_delivered", sliceId: 20624, semantics: "PROVISIONAL",
    history: { days: 906, firstDate: "2024-06-01", lastDate: "2026-11-23", lastValue: 1545, checksum: "normalized", fileChecksum: "file", completeness: "COMPLETE" },
    provenance: { normalizedChecksum: "normalized", fileChecksum: "file", manifestDatasetChecksum: "manifest", manifestStatus: "OK", freshness: "MATCH" },
  };

  test("источник, slice и checksum отображаются", () => {
    const html = provenancePage(overview);
    expect(html).toContain("Происхождение данных");
    expect(html).toContain("20624");
    expect(html).toContain("file");
    expect(html).toContain("normalized");
    expect(html).toContain("MATCH");
  });

  test("STALE и NOT_CONFIRMED дают предупреждение", () => {
    const stale = provenancePage({ ...overview, provenance: { ...overview.provenance, freshness: "STALE" } });
    expect(stale).toContain("расходятся");
    const unconfirmed = provenancePage({ ...overview, provenance: { ...overview.provenance, freshness: "NOT_CONFIRMED" } });
    expect(unconfirmed).toContain("не подтверждено");
  });

  test("CORRUPTED manifest не показывается как корректный", () => {
    const corrupted = provenancePage({ ...overview, provenance: { ...overview.provenance, manifestStatus: "CORRUPTED" } });
    expect(corrupted).toContain("CORRUPTED");
    // статус CORRUPTED отображается как конфликтный, а не как нейтральное отсутствие
    expect(corrupted).toContain("ds-badge--conflict");
  });
});

describe("UI-3.1: календарная сетка качества", () => {
  test("сетка строится по календарным дням и использует missingDates", () => {
    const days = buildCalendar({
      lastDate: "2026-11-10",
      observationDates: new Set(["2026-11-08", "2026-11-09", "2026-11-10"]),
      missingDates: new Set(["2026-11-01", "2026-11-05", "2026-11-10"]),
      count: 10,
    });
    expect(days.length).toBe(10);
    expect(days[0]!.date).toBe("2026-11-01");
    expect(days.at(-1)!.date).toBe("2026-11-10");
    // отсутствующее наблюдение имеет приоритет над наблюдением (10-е число в missingDates)
    expect(days[0]!.status).toBe("missing");
    expect(days[4]!.status).toBe("missing");
    expect(days[9]!.status).toBe("missing");
    expect(days[7]!.status).toBe("full");
    // дни без наблюдений и без отметки о пропуске — unknown, а не нулевые значения
    expect(days[1]!.status).toBe("unknown");
  });

  test("при отсутствии последней даты сетка пустая", () => {
    expect(buildCalendar({ lastDate: null, observationDates: new Set(), missingDates: new Set() })).toEqual([]);
  });
});