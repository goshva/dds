// Stage UI-1: тесты форматтеров и компонентов дизайн-системы DSS.
import { describe, expect, test } from "bun:test";

import {
  barChart,
  card,
  chartCard,
  completenessCalendar,
  dataTable,
  emptyState,
  errorState,
  escapeHtml,
  formatDate,
  formatNumber,
  formatPercent,
  kpiCard,
  kpiGrid,
  lineChart,
  loadingState,
  pageHeader,
  provenanceDrawer,
  sidebar,
  sparkline,
  statusBadge,
  statusClass,
  statusLabel,
  topbar,
  trusted,
  isSafeHref,
  safeHref,
  isSeriesClass,
} from "../../src/web/components";

describe("форматтеры", () => {
  test("числа и проценты, null → NOT_AVAILABLE (без нуля)", () => {
    expect(formatNumber(1234)).toBe("1\u00a0234");
    expect(formatNumber(null)).toBe("NOT_AVAILABLE");
    expect(formatNumber(Number.NaN)).toBe("NOT_AVAILABLE");
    expect(formatPercent(5.73)).toContain("5,73");
    expect(formatPercent(undefined)).toBe("NOT_AVAILABLE");
  });

  test("даты и экранирование", () => {
    expect(formatDate("2026-11-23")).toBe("23.11.2026");
    expect(formatDate(null)).toBe("NOT_AVAILABLE");
    expect(escapeHtml("<script>alert(1)</script>")).not.toContain("<script>");
  });

  test("статусы DSS", () => {
    expect(statusLabel("PROVISIONAL")).toBe("PROVISIONAL");
    expect(statusClass("PENDING")).toBe("ds-badge--pending");
    expect(statusClass("CONFLICT")).toBe("ds-badge--conflict");
    expect(statusClass("NOT_AVAILABLE")).toBe("ds-badge--na");
  });
});

describe("компоненты", () => {
  test("statusBadge содержит код статуса", () => {
    const html = statusBadge({ status: "FALLBACK" });
    expect(html).toContain("FALLBACK");
    expect(html).toContain("ds-badge--fallback");
  });

  test("kpiCard/Grid и card", () => {
    expect(kpiCard({ label: "MAE", value: "92", status: "PROVISIONAL" })).toContain("ds-kpi");
    expect(kpiGrid([{ label: "a", value: "1" }, { label: "b", value: "2" }])).toContain("ds-kpi-grid");
    expect(card({ title: "T", body: trusted("B") })).toContain("ds-card-title");
  });

  test("dataTable: данные и пустое состояние", () => {
    const withRows = dataTable({ columns: [{ key: "date", label: "Дата" }], rows: [{ date: "2026-11-01" }] });
    expect(withRows).toContain("2026-11-01");
    const empty = dataTable({ columns: [{ key: "date", label: "Дата" }], rows: [], emptyText: "нет данных" });
    expect(empty).toContain("нет данных");
    expect(empty).not.toContain("0</td>");
  });

  test("календарь полноты и провенанс", () => {
    expect(completenessCalendar([{ date: "2026-11-01", status: "full" }])).toContain("ds-calendar-day--full");
    expect(completenessCalendar([{ date: "2026-11-02", status: "missing" }])).toContain("ds-calendar-day--missing");
    expect(provenanceDrawer({ source: "canonical CSV", checksum: "abc" })).toContain("abc");
  });

  test("состояния: пусто/загрузка/ошибка", () => {
    expect(emptyState({ title: "Нет" })).toContain("ds-state");
    expect(loadingState({ rows: 3 })).toContain("ds-skeleton");
    expect(loadingState({ rows: 3 })).not.toContain("NaN");
    expect(errorState({ title: "Ошибка", code: "E1" })).toContain("E1");
  });

  test("sparkline: null → NOT_AVAILABLE, значения → svg", () => {
    expect(sparkline([null, null])).toContain("NOT_AVAILABLE");
    expect(sparkline([1, 2, 3])).toContain("<svg");
  });

  test("lineChart без данных → NOT_AVAILABLE, с данными → svg", () => {
    expect(lineChart([{ name: "a", className: "actual", points: [{ date: "2026-11-01", value: null }] }])).toContain("NOT_AVAILABLE");
    const html = lineChart([{ name: "a", className: "actual", points: [{ date: "2026-11-01", value: 10 }, { date: "2026-11-02", value: 20 }] }]);
    expect(html).toContain("<svg");
    expect(html).toContain("ds-chart-line--actual");
  });

  test("barChart и каркас", () => {
    expect(barChart([{ label: "a", value: 5 }])).toContain("ds-chart-bar");
    expect(sidebar({ brandName: "DSS", brandSub: "sub", sections: [{ title: "x", items: [{ href: "#", label: "y" }] }] })).toContain("ds-sidebar");
    expect(topbar({ title: "t", shopNo: "7745", lastUpdated: null, sourceStatus: "OK" })).toContain("NOT_AVAILABLE");
    expect(pageHeader({ title: "h" })).toContain("<h1>");
    expect(chartCard({ title: "c", chart: trusted("<svg></svg>") })).toContain("ds-chart-block");
  });
});

describe("безопасность и изоляция fixture", () => {
  test("production-модули не импортируют playground/fixtures", async () => {
    const glob = new Bun.Glob("src/web/{components,lib,app}/**/*.ts");
    const offenders: string[] = [];
    for await (const path of glob.scan(".")) {
      const text = await Bun.file(path).text();
      if (/playground|fixtures/.test(text)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  test("fixtures помечены как FIXTURE и не содержат production-путей", async () => {
    const text = await Bun.file("src/web/playground/fixtures.ts").text();
    expect(text).toContain("FIXTURE");
    expect(text).toContain("НЕ импортировать");
    expect(text).not.toContain("canonical_daily_delivered_orders");
    expect(text).not.toContain("forecasting.sqlite");
  });

  test("CSS-токены: DSS-семантика присутствует, локальных цветов в компонентах нет", async () => {
    const tokens = await Bun.file("src/web/styles/tokens.css").text();
    for (const token of ["--ds-pending", "--ds-provisional", "--ds-fallback", "--ds-conflict", "--ds-not-available"]) {
      expect(tokens, token).toContain(token);
    }
    const components = await Bun.file("src/web/styles/components.css").text();
    expect(components).toContain("var(--ds-");
  });
});
describe("UI-1.1: безопасность навигации и CSS-токены", () => {
  test("опасные схемы URL отклоняются", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isSafeHref("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeHref("file:///etc/passwd")).toBe(false);
    expect(isSafeHref("//evil.example.com/x")).toBe(false);
    expect(isSafeHref("#history")).toBe(true);
    expect(isSafeHref("./history")).toBe(true);
    expect(isSafeHref("/api/v1/health")).toBe(true);
    expect(isSafeHref("https://example.com/x")).toBe(true);
    expect(isSafeHref("")).toBe(false);
    expect(isSafeHref(null)).toBe(false);
  });

  test("safeHref подменяет опасные ссылки на #", () => {
    expect(safeHref("javascript:alert(1)")).toBe("#");
    expect(safeHref("#overview")).toBe("#overview");
  });

  test("sidebar помечает недопустимый href и не вставляет опасную схему", () => {
    const html = sidebar({ brandName: "DSS", brandSub: "s", sections: [{ title: "t", items: [{ href: "javascript:alert(1)", label: "bad" }] }] });
    expect(html).not.toContain("javascript:");
    expect(html).toContain('data-ds-unsafe-href="1"');
  });

  test("CSS-компоненты не содержат литеральных цветов (только токены)", async () => {
    for (const file of ["layout.css", "components.css", "charts.css", "responsive.css"]) {
      const css = await Bun.file(`src/web/styles/${file}`).text();
      const offenders = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [];
      expect(offenders, `${file}: ${offenders.join(", ")}`).toEqual([]);
    }
    const tokens = await Bun.file("src/web/styles/tokens.css").text();
    expect(tokens).toContain("--ds-kpi-from");
    expect(tokens).toContain("--ds-scrim-bg");
  });

  test("динамические данные экранируются, слоты помечены как TrustedHtml", async () => {
    const cards = await Bun.file("src/web/components/cards.ts").text();
    expect(cards).toContain("type TrustedHtml");
    expect(cards).toContain("trusted(");
    const injected = card({ title: "<img src=x onerror=alert(1)>", body: trusted("ok") });
    expect(injected).not.toContain("<img");
    const table = dataTable({ columns: [{ key: "v", label: "V" }], rows: [{ v: "<script>x</script>" }] });
    expect(table).not.toContain("<script>");
  });
});
describe("UI-1.2: безопасность входа SVG", () => {
  test("разрешённые классы серий отображаются корректно", () => {
    for (const [className, cssClass] of [
      ["actual", "ds-chart-line--actual"],
      ["baseline", "ds-chart-line--baseline"],
      ["candidate", "ds-chart-line--candidate"],
      ["pending", "ds-chart-line--pending"],
    ] as const) {
      const html = lineChart([{ name: "s", className, points: [{ date: "2026-11-01", value: 10 }, { date: "2026-11-02", value: 20 }] }]);
      expect(html, className).toContain(cssClass);
    }
  });

  test("произвольное значение класса не может внедрить HTML-атрибут", () => {
    const html = lineChart([{ name: "s", className: 'x" onload="alert(1)' as never, points: [{ date: "2026-11-01", value: 10 }, { date: "2026-11-02", value: 20 }] }]);
    expect(html).not.toContain("onload");
    expect(html).not.toContain('x"');
    expect(html).toContain("ds-chart-line--actual");
  });

  test('попытка внедрения "><script> не создаёт исполняемую разметку', () => {
    const injected = lineChart([
      { name: '"><script>alert(1)</script>', className: '"><script>' as never, points: [{ date: '"><script>', value: 10 }, { date: "2026-11-02", value: 20 }] },
    ]);
    expect(injected).not.toContain("<script>");
    expect(injected).not.toContain("</script>");
    const bars = barChart([{ label: '"><script>alert(1)</script>', value: 5 }]);
    expect(bars).not.toContain("<script>");
    expect(bars).toContain("&lt;script&gt;");
  });

  test("некорректные размеры SVG не попадают в viewBox", () => {
    const html = lineChart([{ name: "s", className: "actual", points: [{ date: "2026-11-01", value: 1 }, { date: "2026-11-02", value: 2 }] }], Number.NaN, -10);
    expect(html).not.toContain("NaN");
    expect(html).toContain("viewBox=\"0 0 720 260\"");
  });

  test("текущие SVG-графики продолжают работать", () => {
    expect(lineChart([{ name: "s", className: "candidate", points: [{ date: "2026-11-01", value: 5 }, { date: "2026-11-02", value: null }, { date: "2026-11-03", value: 7 }] }])).toContain("<svg");
    expect(barChart([{ label: "a", value: 3 }, { label: "b", value: null }])).toContain("ds-chart-bar");
    expect(isSeriesClass("actual")).toBe(true);
    expect(isSeriesClass("evil")).toBe(false);
  });
});