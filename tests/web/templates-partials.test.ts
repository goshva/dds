// UI-7.0.2.1: статический аудит HTML-partials (без template engine).
// Проверяет состав, баланс блоков, баланс HTML-структуры, безопасность href и escaping.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const PARTIALS_ROOT = join(import.meta.dir, "..", "..", "src", "web", "templates", "partials");

function walk(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.name.endsWith(".html")) result.push(full);
  }
  return result.sort();
}

const files = walk(PARTIALS_ROOT);
const byName = new Map(files.map((file) => [relative(PARTIALS_ROOT, file).replaceAll("\\", "/"), readFileSync(file, "utf8")]));

const EXPECTED_FILES = [
  "cards/card.html",
  "cards/chart-card.html",
  "cards/kpi-card.html",
  "cards/kpi-grid.html",
  "cards/provenance-drawer.html",
  "cards/status-badge.html",
  "charts/bar-chart.html",
  "charts/line-chart.html",
  "charts/sparkline.html",
  "data/completeness-calendar.html",
  "data/data-table.html",
  "pages/forecast-mode-switcher.html",
  "pages/history-filters.html",
  "shell/app-shell.html",
  "shell/page-header.html",
  "shell/sidebar-brand.html",
  "shell/sidebar-nav.html",
  "shell/sidebar.html",
  "shell/topbar.html",
  "states/empty-state.html",
  "states/error-state.html",
  "states/loading-state.html",
];

describe("Состав partials", () => {
  test("ровно 22 partials", () => {
    expect(files.length).toBe(22);
  });

  test("все ожидаемые файлы присутствуют", () => {
    expect([...byName.keys()]).toEqual(EXPECTED_FILES);
  });

  test("нет пустых файлов", () => {
    for (const [name, content] of byName) {
      expect({ name, empty: content.trim().length === 0 }).toEqual({ name, empty: false });
    }
  });
});

describe("Баланс mustache-блоков", () => {
  // Все {{#name}} должны иметь парный {{/name}}.
  const BLOCK = /\{\{([#^])([\w]+)\}\}/g;
  const CLOSE = /\{\{\/([\w]+)\}\}/g;

  for (const [name, content] of byName) {
    test(`${name}: блоки сбалансированы`, () => {
      const open: Record<string, number> = {};
      let match: RegExpExecArray | null;
      BLOCK.lastIndex = 0;
      while ((match = BLOCK.exec(content))) {
        const key = match[2];
        open[key] = (open[key] ?? 0) + 1;
      }
      CLOSE.lastIndex = 0;
      while ((match = CLOSE.exec(content))) {
        const key = match[1];
        open[key] = (open[key] ?? 0) - 1;
      }
      const unbalanced = Object.entries(open).filter(([, count]) => count !== 0);
      expect({ name, unbalanced }).toEqual({ name, unbalanced: [] });
    });
  }
});

describe("Баланс HTML-структуры", () => {
  const SELF_CLOSING = new Set(["input", "br", "img", "hr", "meta", "link", "polyline", "circle", "path", "rect", "line"]);
  const VOID_INLINE_OK = new Set(["path", "circle", "rect", "line", "polyline"]);

  for (const [name, content] of byName) {
    test(`${name}: парные HTML-теги сбалансированы`, () => {
      // Учитываем только блочные/парные теги; SVG-фигуры исключены как void.
      const stack: string[] = [];
      const TAG = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g;
      let match: RegExpExecArray | null;
      TAG.lastIndex = 0;
      while ((match = TAG.exec(content))) {
        const closing = match[1] === "/";
        const tag = match[2].toLowerCase();
        const rest = match[3] ?? "";
        if (SELF_CLOSING.has(tag) && !VOID_INLINE_OK.has(tag)) continue;
        if (VOID_INLINE_OK.has(tag)) continue;
        if (rest.trimEnd().endsWith("/")) continue; // самозакрывающийся <tag .../>
        if (closing) {
          const last = stack.pop();
          if (last !== tag) throw new Error(`${name}: ожидался </${last}>, получен </${tag}>`);
        } else {
          stack.push(tag);
        }
      }
      expect({ name, unclosed: stack }).toEqual({ name, unclosed: [] });
    });
  }
});

describe("Безопасность href", () => {
  for (const [name, content] of byName) {
    test(`${name}: нет href с одинарными скобками`, () => {
      // href="{{...}}" (одинарные) означает отсутствие safeHref() — запрещено.
      const unsafe = /href="\{\{(?!\{)[\w]+/u.test(content);
      expect({ name, unsafe }).toEqual({ name, unsafe: false });
    });
  }

  test("sidebar.html использует {{{safeHref}}} и {{#unsafe}}", () => {
    const content = byName.get("shell/sidebar.html")!;
    expect(content).toContain("{{{safeHref}}}");
    expect(content).toContain("{{#unsafe}}");
    expect(content).not.toContain("{{^current}}");
  });

  test("sidebar-nav.html использует {{{safeHref}}} и {{#unsafe}}", () => {
    const content = byName.get("shell/sidebar-nav.html")!;
    expect(content).toContain("{{{safeHref}}}");
    expect(content).toContain("{{#unsafe}}");
    expect(content).not.toContain("{{^current}}");
  });
});

describe("Escaping динамических значений", () => {
  test("kpi-card.html: note экранируется (одинарные скобки)", () => {
    const content = byName.get("cards/kpi-card.html")!;
    expect(content).toContain("{{note}}");
    expect(content).not.toContain("{{{note}}}");
  });

  test("provenance-drawer.html: значения экранируются", () => {
    const content = byName.get("cards/provenance-drawer.html")!;
    for (const field of ["source", "checksum", "version", "note"]) {
      expect(content).toContain(`{{${field}}}`);
    }
  });

  test("topbar.html: title, shopNo, sourceStatus, lastUpdated экранируются", () => {
    const content = byName.get("shell/topbar.html")!;
    for (const field of ["title", "shopNo", "sourceStatus", "lastUpdated"]) {
      expect(content).toContain(`{{${field}}}`);
    }
  });

  test("TrustedHtml-слоты используют тройные скобки только для компонентов", () => {
    // Допустимые TrustedHtml-слоты: body, right, chart, legend, kpiCard, statusBadge, CONTENT, SIDEBAR, TOPBAR, BRAND, safeHref.
    const allowed = new Set(["body", "right", "chart", "legend", "kpiCard", "statusBadge", "CONTENT", "SIDEBAR", "TOPBAR", "BRAND", "safeHref"]);
    for (const [name, content] of byName) {
      const matches = content.matchAll(/\{\{\{([\w]+)\}\}\}/g);
      for (const match of matches) {
        expect({ name, slot: match[1], allowed: allowed.has(match[1]) }).toEqual({ name, slot: match[1], allowed: true });
      }
    }
  });
});

describe("Контракт kpi-grid", () => {
  test("kpi-grid.html: цикл {{#items}} внутри контейнера", () => {
    const content = byName.get("cards/kpi-grid.html")!;
    // Один открывающий и один закрывающий div вокруг цикла.
    expect(content).toMatch(/<div class="ds-kpi-grid">\s*\{\{#items\}\}\{\{\{kpiCard\}\}\}\{\{\/items\}\}\s*<\/div>/);
  });
});

describe("Контракт loading-state", () => {
  test("описывает конечную разметку со skeletons[]", () => {
    const content = byName.get("states/loading-state.html")!;
    expect(content).toContain("{{#skeletons}}");
    expect(content).toContain("{{width}}");
    expect(content).toContain("ds-skeleton");
  });
});

describe("Контракт sidebar-brand / page-header / app-shell", () => {
  test("sidebar-brand.html содержит бренд-марку", () => {
    const content = byName.get("shell/sidebar-brand.html")!;
    expect(content).toContain("ds-brand-mark");
    expect(content).toContain("{{BRANDNAME}}");
    expect(content).toContain("{{BRANDSUB}}");
  });

  test("page-header.html: subtitle и right опциональны", () => {
    const content = byName.get("shell/page-header.html")!;
    expect(content).toContain("{{#subtitle}}");
    expect(content).toContain("{{{right}}}");
  });

  test("app-shell.html: content — TrustedHtml", () => {
    const content = byName.get("shell/app-shell.html")!;
    expect(content).toContain("{{{CONTENT}}}");
  });
});
