/**
 * TPL-4.1.1: проверки генератора эталонов (без записи файлов).
 * Проверяются все семь артефактов: индекс и шесть страниц.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { PAGES } from "../../tools/reference/fixtures/common";
import { indexPageContent, pageContent } from "../../tools/reference/render-page";
import { renderDocument, renderIndexDocument } from "../../tools/reference/render-shell";

const CSS_PAGES = "../assets/reference.css";
const JS_PAGES = "../assets/reference.js";

interface Generated {
  file: string;
  html: string;
}

function renderAll(): Generated[] {
  const index = renderIndexDocument(indexPageContent(), "assets/reference.css", "assets/reference.js");
  return [
    { file: "index.html", html: index },
    ...PAGES.map((page) => ({
      file: `pages/${page.file}`,
      html: renderDocument({ title: `DSS — эталон: ${page.title}`, cssHref: CSS_PAGES, jsHref: JS_PAGES, topbarTitle: page.topbarTitle, navCurrent: page.key, content: pageContent(page.key) }),
    })),
  ];
}

const GENERATOR_SOURCES = [
  "tools/reference/generate.ts",
  "tools/reference/render-shell.ts",
  "tools/reference/render-page.ts",
  "tools/reference/fixtures/common.ts",
  "tools/reference/fixtures/overview.ts",
  "tools/reference/fixtures/history.ts",
  "tools/reference/fixtures/quality.ts",
  "tools/reference/fixtures/provenance.ts",
  "tools/reference/fixtures/forecast-quality.ts",
  "tools/reference/fixtures/forecast-diagnostics.ts",
];

const sha256 = (value: string): string => new Bun.CryptoHasher("sha256").update(value).digest("hex");

describe("TPL-4.1.1: все семь артефактов", () => {
  test("индекс и шесть страниц присутствуют в сборке", () => {
    const documents = renderAll();
    expect(documents.length).toBe(7);
    expect(documents.map((item) => item.file)).toEqual(["index.html", ...PAGES.map((page) => `pages/${page.file}`)]);
    for (const item of documents) expect(item.html.length, item.file).toBeGreaterThan(1000);
  });

  test("каждый файл существует на диске и совпадает с результатом генерации", () => {
    for (const item of renderAll()) {
      const path = `docs/ui/reference/${item.file}`;
      expect(existsSync(path), path).toBe(true);
      const onDisk = readFileSync(path, "utf8");
      expect(sha256(onDisk), `${item.file}: контрольная сумма`).toBe(sha256(item.html));
      expect(onDisk, `${item.file}: содержимое`).toBe(item.html);
    }
  });

  test("ни в одном файле нет незаменённых placeholder", () => {
    for (const item of renderAll()) expect(/\{\{[^}]+\}\}/.test(item.html), item.file).toBe(false);
  });

  test("относительные ссылки каждого файла существуют на диске", () => {
    for (const item of renderAll()) {
      const localPath = `docs/ui/reference/${item.file}`;
      for (const match of item.html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const target = match[1]!;
        if (target.startsWith("#")) continue;
        expect(/(https?:)?\/\//.test(target), `${item.file}: внешняя ссылка ${target}`).toBe(false);
        const resolved = resolve(dirname(localPath), target.split("#")[0]!);
        expect(existsSync(resolved), `${item.file} → ${target}`).toBe(true);
      }
    }
  });

  test("индекс содержит ссылки на все шесть страниц", () => {
    const index = renderAll()[0]!.html;
    for (const page of PAGES) {
      expect(index, page.file).toContain(`pages/${page.file}`);
      expect(existsSync(`docs/ui/reference/pages/${page.file}`), page.file).toBe(true);
    }
    expect(existsSync("docs/ui/reference/index.html")).toBe(true);
  });

  test("production CSS подключается относительными путями", () => {
    for (const item of renderAll()) expect(item.html, item.file).toContain("assets/reference.css");
    const css = readFileSync("docs/ui/reference/assets/reference.css", "utf8");
    for (const style of ["tokens.css", "layout.css", "components.css", "charts.css", "responsive.css"]) {
      expect(css, style).toContain(`../../../../src/web/styles/${style}`);
      expect(existsSync(`src/web/styles/${style}`), style).toBe(true);
    }
  });

  test("маркировка синтетических данных присутствует на каждой странице", () => {
    for (const item of renderAll()) expect(item.html, item.file).toContain("REFERENCE DATA — NOT PRODUCTION DATA");
  });
});

describe("TPL-4.1: использование production-компонентов", () => {
  test("разметка содержит классы production-компонентов", () => {
    const all = renderAll().map((item) => item.html).join("\n");
    for (const cls of ["ds-app", "ds-sidebar", "ds-topbar", "ds-kpi", "ds-card", "ds-table", "ds-chart", "ds-calendar", "ds-state", "ds-drawer", "ds-badge"]) {
      expect(all, cls).toContain(cls);
    }
  });

  test("оболочка собирается компонентами appShell/sidebar/topbar", () => {
    for (const item of renderAll()) {
      expect(item.html, item.file).toContain('class="ds-app"');
      expect(item.html, item.file).toContain('class="ds-sidebar"');
      expect(item.html, item.file).toContain('class="ds-topbar"');
    }
  });

  test("страницы вызывают production-функции страниц", () => {
    expect(pageContent("history")).toContain("История заказов");
    expect(pageContent("quality")).toContain("Качество данных");
    expect(pageContent("provenance")).toContain("Происхождение данных");
    expect(pageContent("forecast-quality")).toContain("Прогнозы и качество моделей");
    expect(pageContent("forecast-diagnostics")).toContain("Диагностика прогнозирования");
  });

  test("календарь качества: статус partial поддерживается компонентом и передаётся типизированно", () => {
    const quality = pageContent("quality");
    for (const status of ["full", "partial", "missing", "unknown"]) expect(quality, status).toContain(`ds-calendar-day--${status}`);
    const fixture = readFileSync("tools/reference/fixtures/quality.ts", "utf8");
    expect(fixture).toContain("CalendarDay[]");
    expect(fixture).toContain("completenessCalendar");
    // утверждение о том, что построитель формирует partial, не должно присутствовать
    expect(fixture).not.toContain("все четыре состояния: наблюдение");
    expect(fixture).toContain("статус partial построителем не формируется");
  });
});

describe("TPL-4.1: изоляция и безопасность", () => {
  test("нет внешних URL, сетевых вызовов и схем javascript:", () => {
    for (const item of renderAll()) {
      const html = item.html.replace(/<!--[\s\S]*?-->/g, "");
      expect(/(https?:)?\/\//.test(html), item.file).toBe(false);
      expect(/javascript:/i.test(html), item.file).toBe(false);
      expect(/fetch\(|XMLHttpRequest/.test(html), item.file).toBe(false);
    }
  });

  test("генератор не обращается к API, SQLite, JSONL и времени", () => {
    for (const source of GENERATOR_SOURCES) {
      const text = readFileSync(source, "utf8");
      expect(text, source).not.toContain("Math.random");
      expect(text, source).not.toContain("Date.now");
      expect(text, source).not.toContain("new Date(");
      expect(text, source).not.toContain("bun:sqlite");
      expect(text, source).not.toContain("fetch(");
      expect(text, source).not.toContain("data/shadow");
      expect(text, source).not.toContain("data/forecast");
    }
  });

  test("доверенные слоты формируются компонентами", () => {
    const diagnostics = readFileSync("tools/reference/fixtures/forecast-diagnostics.ts", "utf8");
    expect(diagnostics).not.toContain("innerHTML");
    expect(diagnostics).toContain("forecastDiagnosticsPage");
    expect(pageContent("forecast-quality")).not.toContain("<script");
  });
});

describe("TPL-4.1: семантика данных", () => {
  test("PROVISIONAL сохраняется на каждой странице", () => {
    for (const item of renderAll()) expect(item.html, item.file).toContain("PROVISIONAL");
  });

  test("отсутствующие значения показаны как [Н/Д], а не нулём", () => {
    const overview = pageContent("overview");
    expect(overview).toContain("[Н/Д]");
    expect(overview).not.toContain(">[Н/Д]<0");
  });

  test("состояния ошибки, пустоты и загрузки представлены", () => {
    const all = renderAll().map((item) => item.html).join("\n");
    for (const cls of ["ds-state--error", "data-ds-empty", "data-ds-error", "ds-skeleton"]) expect(all, cls).toContain(cls);
  });

  test("NOT_AVAILABLE не подменяется нулевым количеством диагностик", () => {
    const diagnostics = readFileSync("tools/reference/fixtures/forecast-diagnostics.ts", "utf8");
    expect(diagnostics).toContain("NO_DETECTED_DIAGNOSTICS");
    expect(diagnostics).toContain('status: "not_available"');
    expect(diagnostics).toContain("total: 0");
    expect(diagnostics).toContain("persistedErrorsAvailable: false");
  });
});

describe("TPL-4.1: детерминированность", () => {
  test("два прогона сборки дают идентичные SHA-256 всех семи файлов", () => {
    const first = renderAll().map((item) => `${item.file}:${sha256(item.html)}`);
    const second = renderAll().map((item) => `${item.file}:${sha256(item.html)}`);
    expect(second).toEqual(first);
    expect(first.length).toBe(7);
  });

  test("контрольные суммы файлов на диске совпадают с повторной генерацией", () => {
    for (const item of renderAll()) {
      const onDisk = readFileSync(`docs/ui/reference/${item.file}`, "utf8");
      expect(sha256(onDisk), item.file).toBe(sha256(item.html));
    }
  });
});
