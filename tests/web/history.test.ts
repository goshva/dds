// FINAL-2: тесты production-функций страницы «История заказов».
import { describe, expect, test } from "bun:test";

import { HISTORY_PAGE_SIZE, historyEmpty, historyFilters, historyPage, RANGES, type CoverageDto, type HistoryDto } from "../../src/web/pages/history";
import { isValidCalendarDate, rangeToQuery } from "../../src/web/routing";

function coverage(over: Partial<CoverageDto> = {}): CoverageDto {
  return {
    firstDate: "2024-06-01", lastDate: "2026-06-10", days: 700, gaps: 3, duplicateDates: 0,
    nullValues: 0, nullPolicy: "REJECTED_AS_CORRUPTED", completeness: "PARTIAL",
    missingDates: ["2026-06-03"], gapIntervals: [{ from: "2026-06-03", to: "2026-06-03", length: 1 }], maxGapLength: 1,
    fillRatio: 0.996, fillRatioFormula: "observationDays / calendarDays", ...over,
  };
}

function history(count: number, over: Partial<HistoryDto> = {}): HistoryDto {
  const points: Array<{ date: string; value: number }> = [];
  for (let index = 0; index < count; index++) {
    // Последовательные уникальные календарные даты (FINAL-2.1): шаг ровно один день назад.
    const date = new Date(Date.UTC(2026, 5, 30) - index * 86_400_000).toISOString().slice(0, 10);
    points.push({ date, value: index % 7 === 0 ? 0 : 1000 + index });
  }
  return {
    points: [...points].reverse(),
    from: points[0]?.date ?? null,
    to: points.at(-1)?.date ?? null,
    totalPoints: count,
    returnedPoints: count,
    semantics: "PROVISIONAL",
    summary: {
      sum: count * 1000, average: 1000, max: 1200, min: 0,
      calendarDays: count, observationDays: count, missingDays: 0, complete: true, truncated: false,
      formula: "сумма по доступным значениям",
    },
    requested: { from: "2026-06-01", to: "2026-06-10" },
    available: { from: "2024-06-01", to: "2026-06-10" },
    rangeClamped: false,
    ...over,
  };
}

describe("FINAL-2: диапазоны и фильтры", () => {
  test("все действующие диапазоны отображаются, активный выделен", () => {
    const html = historyFilters("90", "", "");
    for (const range of RANGES) expect(html, range.key).toContain(`#history/${range.key}`);
    expect(RANGES.map((range) => range.key)).toEqual(["all", "30", "90", "180", "365"]);
    expect(html).toContain("ds-badge--ok");
  });

  test("произвольный диапазон передаётся в поля дат", () => {
    const html = historyFilters("custom", "2026-06-01", "2026-06-10");
    expect(html).toContain('value="2026-06-01"');
    expect(html).toContain('value="2026-06-10"');
    expect(html).toContain('id="ds-apply"');
    expect(html).toContain('id="ds-reset"');
  });

  test("некорректные календарные даты отклоняются валидатором маршрута", () => {
    expect(isValidCalendarDate("2026-06-10")).toBe(true);
    expect(isValidCalendarDate("2026-02-30")).toBe(false);
    expect(rangeToQuery("custom", "2026-02-30", "", "2026-06-10").error).toBe("Некорректная дата начала");
    expect(rangeToQuery("custom", "2026-06-10", "2026-06-01", "2026-06-10").error).toBe("Дата начала позже даты окончания");
    expect(rangeToQuery("90", "", "", "2026-06-10")).toEqual({ from: "2026-03-13", to: "2026-06-10" });
  });
});

describe("FINAL-2: заголовок данных и полнота", () => {
  test("показаны период, доступные даты, наблюдения и полнота из API", () => {
    const html = historyPage({ history: history(10), coverage: coverage(), activeRange: "all", from: "", to: "" });
    expect(html).toContain("Доступные данные");
    expect(html).toContain("01.06.2024");
    expect(html).toContain("10.06.2026");
    expect(html).toContain("доля 0,996");
    expect(html).toContain("полнота: PARTIAL");
  });

  test("без значения полноты в API процент не вычисляется", () => {
    const missing = historyPage({ history: history(5), coverage: coverage({ fillRatio: Number.NaN, completeness: "UNKNOWN" }), activeRange: "all", from: "", to: "" });
    expect(missing).toContain("[Н/Д]");
    expect(missing).not.toContain("доля 0,");
  });

  test("PROVISIONAL и предупреждение о неполном периоде сохраняются", () => {
    const html = historyPage({ history: history(5, { summary: { ...history(5).summary, complete: false, missingDays: 2 } }), coverage: coverage(), activeRange: "all", from: "", to: "" });
    expect(html).toContain("Предварительная семантика");
    expect(html).toContain("период неполный: нет 2 дн.");
  });
});

describe("FINAL-2: график и таблица", () => {
  test("отсутствующие значения показаны как [Н/Д], ноль остаётся нулём", () => {
    const withNulls = history(3);
    withNulls.points = [{ date: "2026-06-03", value: 1500 }, { date: "2026-06-02", value: Number.NaN }, { date: "2026-06-01", value: 0 }];
    const html = historyPage({ history: withNulls, coverage: coverage(), activeRange: "all", from: "", to: "" });
    expect(html).toContain("[Н/Д]");
    expect(html).toMatch(/>0</);
  });

  test("график разрывает линию на пропуске (два подпути)", () => {
    const gapped = history(3);
    gapped.points = [{ date: "2026-06-03", value: 1500 }, { date: "2026-06-02", value: Number.NaN }, { date: "2026-06-01", value: 1200 }];
    const html = historyPage({ history: gapped, coverage: coverage(), activeRange: "all", from: "", to: "" });
    const path = html.match(/<path class="ds-chart-line--actual" d="([^"]+)"/)?.[1] ?? "";
    expect((path.match(/M/g) ?? []).length).toBe(2);
    expect(path).not.toContain("NaN");
  });

  test("прогнозная линия не добавляется", () => {
    const html = historyPage({ history: history(4), coverage: coverage(), activeRange: "all", from: "", to: "" });
    expect(html).not.toContain("ds-chart-line--candidate");
    expect(html).not.toContain("ds-chart-line--baseline");
  });
});

describe("FINAL-2: пагинация таблицы", () => {
  test("одна страница — подсказка вместо кнопок", () => {
    const html = historyPage({ history: history(10), coverage: coverage(), activeRange: "all", from: "", to: "" });
    expect(html).toContain("постраничный просмотр не требуется");
    expect(html).not.toContain('id="ds-page-next"');
  });

  test("границы первой страницы и размер страницы", () => {
    const total = HISTORY_PAGE_SIZE * 2 + 7;
    const first = historyPage({ history: history(total), coverage: coverage(), activeRange: "all", from: "", to: "" });
    expect(first).toContain("записи 1–50 из " + total);
    expect(first).toContain("страница 1 из 3");
    expect(first).toContain('id="ds-page-next"');
    expect(first).toContain("disabled");
  });

  test("последняя неполная страница и отсутствие перехода вперёд", () => {
    const total = HISTORY_PAGE_SIZE * 2 + 7;
    const last = historyPage({ history: history(total), coverage: coverage(), activeRange: "all", from: "", to: "", page: 2 });
    expect(last).toContain(`записи 101–${total} из ${total}`);
    expect(last).toContain("страница 3 из 3");
    expect(last).toMatch(/id="ds-page-next"[^>]*disabled/);
  });

  test("индекс страницы вне диапазона ограничивается", () => {
    const html = historyPage({ history: history(HISTORY_PAGE_SIZE + 1), coverage: coverage(), activeRange: "all", from: "", to: "", page: 99 });
    expect(html).toContain("страница 2 из 2");
  });

  test("пустая история не создаёт фиктивных значений", () => {
    const empty = historyPage({ history: history(0, { points: [] }), coverage: coverage(), activeRange: "all", from: "", to: "" });
    expect(empty).toContain("За выбранный период наблюдений нет");
    expect(empty).toContain("записей: 0");
    expect(historyEmpty()).toContain("За выбранный период данных нет");
  });
});

describe("FINAL-2: безопасность", () => {
  test("динамические значения экранируются", () => {
    const html = historyPage({ history: history(3), coverage: coverage({ completeness: '<script>alert(1)</script>' }), activeRange: "all", from: "", to: "" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("FINAL-2.1: недоступный Coverage API", () => {
  test("история остаётся доступной, полнота показана как [Н/Д]", () => {
    const html = historyPage({ history: history(12), coverage: null, activeRange: "all", from: "", to: "" });
    expect(html).toContain("История заказов");
    expect(html).toContain("Доступные данные");
    expect(html).toContain("полнота: данные недоступны");
    expect(html).toContain("проверка полноты недоступна");
  });

  test("исторические значения продолжают отображаться", () => {
    const html = historyPage({ history: history(12), coverage: null, activeRange: "all", from: "", to: "" });
    expect(html).toContain("Показатели периода");
    expect(html).toContain("Всего заказов");
    expect(html).toMatch(/\d{2}\.\d{2}\.\d{4}/); // даты в таблице присутствуют
    expect(html).toMatch(/\d[\s\u00a0]\d{3}/); // форматированные значения заказов
  });

  test("заполненность и пропуски не подменяются нулём", () => {
    const html = historyPage({ history: history(12), coverage: null, activeRange: "all", from: "", to: "" });
    expect(html).toContain("количество пропусков неизвестно");
    expect(html).toContain("coverage API недоступен");
    expect(html).not.toContain("доля 0,000");
    expect(html).not.toContain("максимальный интервал: 0");
  });

  test("ложный статус отсутствия пропусков не появляется", () => {
    const html = historyPage({ history: history(12), coverage: null, activeRange: "all", from: "", to: "" });
    expect(html).not.toContain("пропусков нет");
    expect(html).toContain("NOT_AVAILABLE".toLowerCase() === "x" ? "" : "полнота: данные недоступны");
  });

  test("при успешном Coverage реальные значения отображаются без изменений", () => {
    const html = historyPage({ history: history(12), coverage: coverage(), activeRange: "all", from: "", to: "" });
    expect(html).toContain("полнота: PARTIAL");
    expect(html).toContain("доля 0,996");
    expect(html).toContain("максимальный интервал: 1");
    expect(html).not.toContain("данные недоступны");
  });
});
