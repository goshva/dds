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
    // Допустимые TrustedHtml-слоты (раздел 4 контракта): body, right, chart, legend, kpiCard, statusBadge, content, sidebar, topbar, brand, safeHref.
    const allowed = new Set(["body", "right", "chart", "legend", "kpiCard", "statusBadge", "content", "sidebar", "topbar", "brand", "safeHref"]);
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
    expect(content).toContain("{{brandName}}");
    expect(content).toContain("{{brandSub}}");
  });

  test("page-header.html: subtitle и right опциональны", () => {
    const content = byName.get("shell/page-header.html")!;
    expect(content).toContain("{{#subtitle}}");
    expect(content).toContain("{{{right}}}");
  });

  test("app-shell.html: content — TrustedHtml", () => {
    const content = byName.get("shell/app-shell.html")!;
    expect(content).toContain("{{{content}}}");
  });
});

// TPL-1.1: усиленная проверка контрактов шаблонов.
// Инварианты выведены из docs/ui/templates-contract.md; проверяются и допустимые, и недопустимые значения.
// Импорты describe/expect/test объявлены в начале файла.

const PARTIALS_DIR = "src/web/templates/partials";
const CONTRACT_DOC = "docs/ui/templates-contract.md";

/** Единственный авторитетный перечень доверенных слотов — раздел 4 контракта. */
const TRUSTED_SLOTS = ["sidebar", "topbar", "content", "brand", "safeHref", "right", "body", "chart", "legend", "kpiCard", "statusBadge"];

/** Контракт hash-ссылок: маршрут → позиции динамических сегментов и допустимые литеральные значения. */
const HASH_CONTRACT: Record<string, { arity: number; positions: Array<{ placeholder: string; values: string[] }> }> = {
  "#history/": { arity: 1, positions: [{ placeholder: "key", values: ["all", "30", "90", "180", "365"] }] },
  "#forecast-quality/": {
    arity: 2,
    positions: [
      { placeholder: "mode", values: ["replay", "shadow"] },
      { placeholder: "horizon", values: ["1", "3"] },
    ],
  },
};

interface HashCheck {
  ok: boolean;
  reason: string;
}

/** Проверка одного hash-href по контракту: маршрут, число сегментов, значения или допустимые placeholder-имена. */
function checkHashHref(href: string): HashCheck {
  if (typeof href !== "string" || href.length === 0) return { ok: false, reason: "пустая ссылка" };
  if (/[\u0000-\u001f\u007f]/.test(href)) return { ok: false, reason: "управляющие символы" };
  if (!href.startsWith("#")) return { ok: false, reason: "не hash-ссылка" };
  if (href.includes("?") || href.includes("&") || href.includes("%")) return { ok: false, reason: "query/кодирование не допускаются" };

  const route = Object.keys(HASH_CONTRACT).find((candidate) => href.startsWith(candidate));
  if (!route) return { ok: false, reason: "маршрут вне allowlist" };

  const contract = HASH_CONTRACT[route]!;
  const tail = href.slice(route.length);
  const segments = tail.split("/");
  if (segments.length !== contract.arity) return { ok: false, reason: `ожидается сегментов: ${contract.arity}, получено: ${segments.length}` };

  for (const [index, segment] of segments.entries()) {
    if (segment.length === 0) return { ok: false, reason: "пустой сегмент" };
    const position = contract.positions[index]!;
    const placeholder = /^\{\{(\w+)\}\}$/.exec(segment);
    if (placeholder) {
      if (placeholder[1] !== position.placeholder) return { ok: false, reason: `placeholder ${placeholder[1]} недопустим в позиции ${index}` };
      continue;
    }
    if (!position.values.includes(segment)) return { ok: false, reason: `значение ${segment} недопустимо в позиции ${index}` };
  }
  return { ok: true, reason: "соответствует контракту" };
}

async function listPartials(): Promise<string[]> {
  const { readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
    );
  return walk(PARTIALS_DIR)
    .map((file) => file.replace(/\\/g, "/").replace(`${PARTIALS_DIR}/`, ""))
    .sort();
}

async function readPartial(file: string): Promise<string> {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  return readFileSync(join(PARTIALS_DIR, file), "utf8");
}

async function readFile(path: string): Promise<string> {
  const { readFileSync } = await import("node:fs");
  return readFileSync(path, "utf8");
}

/** Разметка без HTML-комментариев: правила в комментариях не считаются выражениями. */
function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

function placeholderTokens(text: string): string[] {
  return [...stripComments(text).matchAll(/\{\{\{?[#/^]?[\w.]+\}?\}\}/g)].map((match) => match[0]!);
}

function hrefsOf(text: string): string[] {
  return [...stripComments(text).matchAll(/(?<![\w-])href="([^"]*)"/g)].map((match) => match[1]!);
}

describe("TPL-1.1: проверка hash-ссылок", () => {
  test("AC-02/AC-05: валидатор принимает документированные формы", () => {
    const valid = ["#history/all", "#history/30", "#history/365", "#forecast-quality/replay/1", "#forecast-quality/shadow/3", "#history/{{key}}", "#forecast-quality/{{mode}}/{{horizon}}"];
    for (const href of valid) expect(checkHashHref(href), href).toMatchObject({ ok: true });
  });

  test("AC-05: недопустимые примеры отклоняются", () => {
    const invalid = [
      "#admin/",
      "#history/unknown",
      "#history/999",
      "#forecast-quality/production/1",
      "#forecast-quality/replay/7",
      "#history/",
      "#history/all/extra",
      "#forecast-quality/shadow",
      "#forecast-quality/shadow/1/extra",
      "#forecast-quality/replay/",
      "#history/ALL",
      "#History/all",
      "#history/all?x=1",
      "#history/%61ll",
      "#history/all\u0000",
      "javascript:alert(1)",
      "//evil.example.com",
      "https://evil.example.com",
      "",
    ];
    for (const href of invalid) {
      const result = checkHashHref(href);
      expect(result.ok, `${href} → ${result.reason}`).toBe(false);
    }
  });

  test("AC-02: фактические href в partials соответствуют контракту", async () => {
    const offenders: string[] = [];
    for (const file of await listPartials()) {
      for (const href of hrefsOf(await readPartial(file))) {
        if (href === "{{{safeHref}}}") continue;
        const result = checkHashHref(href);
        if (!result.ok) offenders.push(`${file} → ${href} (${result.reason})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("AC-02: посторонние маршруты в partials отсутствуют", async () => {
    const offenders: string[] = [];
    for (const file of await listPartials()) {
      for (const href of hrefsOf(await readPartial(file))) {
        if (href === "{{{safeHref}}}") continue;
        if (!Object.keys(HASH_CONTRACT).some((route) => href.startsWith(route))) offenders.push(`${file} → ${href}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("AC-04: значения режима и горизонта ограничены перечислениями", async () => {
    const switcher = await readPartial("pages/forecast-mode-switcher.html");
    const hrefs = hrefsOf(switcher).filter((href) => href.startsWith("#forecast-quality/"));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(HASH_CONTRACT["#forecast-quality/"]!.positions.map((position) => position.placeholder)).toEqual(["mode", "horizon"]);
    expect(switcher).toContain("{{mode}}");
    expect(switcher).toContain("{{horizon}}");
    // внутри hash-ссылок допустимы только mode и horizon; остальные плейсхолдеры (label, badgeClass) — вне сегментов
    for (const href of hrefs) {
      const tail = href.slice("#forecast-quality/".length);
      for (const segment of tail.split("/")) {
        const name = /^\{\{(\w+)\}\}$/.exec(segment)?.[1];
        if (name) expect(["mode", "horizon"], href).toContain(name);
      }
    }
  });

  test("AC-03: значения диапазона истории ограничены набором ключей", async () => {
    const filters = await readPartial("pages/history-filters.html");
    const hrefs = hrefsOf(filters).filter((href) => href.startsWith("#history/"));
    expect(hrefs).toEqual(["#history/{{key}}"]);
    expect(HASH_CONTRACT["#history/"]!.positions[0]!.values).toEqual(["all", "30", "90", "180", "365"]);
  });

  test("AC-07: dynamic-сегменты — только placeholder-имена, не произвольные значения", async () => {
    const offenders: string[] = [];
    for (const file of await listPartials()) {
      for (const href of hrefsOf(await readPartial(file))) {
        if (href === "{{{safeHref}}}") continue;
        for (const segment of href.matchAll(/(?<!\{)\{\{(\w+)\}\}(?!\})/g)) {
          if (!["key", "mode", "horizon"].includes(segment[1]!)) offenders.push(`${file} → ${segment[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("TPL-1.1: контракт таблицы", () => {
  test("AC-08: структура columns + rows + cells и порядок блоков", async () => {
    const text = stripComments(await readPartial("data/data-table.html"));
    const order = ["{{#columns}}", "{{#rows}}", "{{#cells}}"];
    let cursor = -1;
    for (const token of order) {
      const index = text.indexOf(token);
      expect(index, token).toBeGreaterThan(cursor);
      cursor = index;
    }
    expect(text.indexOf("{{/cells}}")).toBeLessThan(text.indexOf("{{/rows}}"));
    expect(text.indexOf("{{/rows}}")).toBeLessThan(text.indexOf("{{^rows}}"));
  });

  test("AC-08: пустая ветка использует columnCount, а не значения ячеек", async () => {
    const text = stripComments(await readPartial("data/data-table.html"));
    const empty = text.slice(text.indexOf("{{^rows}}"), text.indexOf("{{/rows}}", text.indexOf("{{^rows}}")));
    expect(empty).toContain("{{columnCount}}");
    expect(empty).not.toContain("{{value}}");
  });

  test("AC-08: таблица не содержит вычислений и форматирования", async () => {
    const text = stripComments(await readPartial("data/data-table.html"));
    for (const token of placeholderTokens(await readPartial("data/data-table.html"))) {
      const name = token.replace(/^\{\{\{?[#/^]?/, "").replace(/\}?\}\}$/, "");
      expect(/[()+\-*/=<>?:!&|]/.test(name), token).toBe(false);
    }
    expect(text).not.toContain("formatNumber");
    expect(text).not.toContain("escapeHtml");
    expect(text).not.toContain("toFixed");
  });

  test("AC-08: компонент dataTable готовит строки, ячейки и число колонок", async () => {
    const { dataTable } = await import("../../src/web/components/data");
    const html = dataTable({ columns: [{ key: "a", label: "A", numeric: true }, { key: "b", label: "B" }], rows: [{ a: 1, b: "x" }] });
    expect((html.match(/<td/g) ?? []).length).toBe(2);
    expect(html).toContain('class="is-num"');
    expect(html).toContain(">x<");
  });
});

describe("TPL-1.1: контракт состояния загрузки", () => {
  test("AC-09: partial получает подготовленный массив skeletons", async () => {
    const text = stripComments(await readPartial("states/loading-state.html"));
    expect(text).toContain("{{#skeletons}}");
    expect(text).toContain("{{width}}");
    expect(text).not.toContain("{{#rows}}");
    expect(text).not.toContain("rows");
  });

  test("AC-09: публичный API принимает rows, а ширины считает компонент", async () => {
    const { loadingState } = await import("../../src/web/components/states");
    const three = loadingState({ rows: 3 });
    const one = loadingState({ rows: 1 });
    const zero = loadingState({});
    expect((three.match(/ds-skeleton/g) ?? []).length).toBe(3);
    expect((one.match(/ds-skeleton/g) ?? []).length).toBe(1);
    // значений по умолчанию для rows в компоненте нет — пустой вызов даёт базовое число скелетонов
    expect((zero.match(/ds-skeleton/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(three).toContain("width:");
  });
});

describe("TPL-1.1: контракт графиков", () => {
  test("AC-10: геометрия приходит из подготовленных значений", async () => {
    const line = stripComments(await readPartial("charts/line-chart.html"));
    for (const token of ["{{#grid}}", "{{#series}}", "{{x1}}", "{{y1}}", "{{x2}}", "{{y2}}", "{{labelY}}", "{{path}}", "{{cssClass}}"]) {
      expect(line, token).toContain(token);
    }
    const bar = stripComments(await readPartial("charts/bar-chart.html"));
    for (const token of ["{{#bars}}", "{{x}}", "{{y}}", "{{barWidth}}", "{{barHeight}}"]) expect(bar, token).toContain(token);
    expect(stripComments(await readPartial("charts/sparkline.html"))).toContain("{{points}}");
  });

  test("AC-10: атрибуты геометрии не содержат числовых литералов", async () => {
    const line = stripComments(await readPartial("charts/line-chart.html"));
    for (const attribute of ["x1", "y1", "x2", "y2"]) {
      const match = new RegExp(`${attribute}="([^"]*)"`).exec(line);
      expect(match, attribute).not.toBeNull();
      expect(match![1]!, attribute).toMatch(/^\{\{[\w]+\}\}$/);
    }
    const bar = stripComments(await readPartial("charts/bar-chart.html"));
    for (const attribute of ["x", "y", "width", "height"]) {
      const match = new RegExp(`\\s${attribute}="([^"]*)"`).exec(bar);
      if (match) expect(match[1]!, attribute).toMatch(/^\{\{[\w]+\}\}$/);
    }
  });

  test("AC-10: компонент графика вычисляет путь, partial не вычисляет", async () => {
    const { lineChart } = await import("../../src/web/components/charts");
    const html = lineChart([{ name: "actual", className: "actual", points: [{ date: "2026-11-01", value: 10 }, { date: "2026-11-02", value: 20 }] }]);
    expect(html).toMatch(/d="M[-\d.]+,[-\d.]+ L[-\d.]+,[-\d.]+/);
    const partial = stripComments(await readPartial("charts/line-chart.html"));
    expect(partial).not.toMatch(/[ML]\d/);
  });
});

describe("TPL-1.1: согласованность доверенных слотов", () => {
  test("AC-11: документ, partials и тестовый перечень совпадают", async () => {
    const doc = await readFile(CONTRACT_DOC);
    const section = doc.slice(doc.indexOf("## 4."), doc.indexOf("## 5."));
    const documented = [...new Set([...section.matchAll(/`\{\{\{(\w+)\}\}\}`/g)].map((match) => match[1]!))].sort();

    const used = new Set<string>();
    for (const file of await listPartials()) {
      for (const match of stripComments(await readPartial(file)).matchAll(/\{\{\{([\w.]+)\}\}\}/g)) used.add(match[1]!);
    }
    expect(documented).toEqual([...TRUSTED_SLOTS].sort());
    expect([...used].sort()).toEqual([...TRUSTED_SLOTS].sort());
  });

  test("AC-11: доверенные слоты не встречаются с двойными скобками", async () => {
    const offenders: string[] = [];
    for (const file of await listPartials()) {
      const text = stripComments(await readPartial(file));
      for (const slot of TRUSTED_SLOTS) if (new RegExp(`(^|[^{])\\{\\{${slot}\\}\\}`).test(text)) offenders.push(`${file} → {{${slot}}}`);
    }
    expect(offenders).toEqual([]);
  });

  test("AC-11: kpi-card использует доверенный слот бейджа без пустого контейнера", async () => {
    const text = stripComments(await readPartial("cards/kpi-card.html"));
    expect(text).toContain("{{#statusBadge}}");
    expect(text).toContain("{{{statusBadge}}}");
    expect(new RegExp("(^|[^{])\\{\\{statusBadge\\}\\}").test(text)).toBe(false);
    expect((await readPartial("cards/kpi-card.html")).includes("{{#status}}")).toBe(false);
  });
});

describe("TPL-1.1: покрытие и ограничения проверок", () => {
  test("все 22 partials перечислены в таблице контракта", async () => {
    const doc = await readFile(CONTRACT_DOC);
    const files = await listPartials();
    expect(files.filter((file) => !doc.includes(`\`${file}\``))).toEqual([]);
    expect(files.length).toBe(22);
  });

  test("плейсхолдеры — camelCase, вычисления отсутствуют", async () => {
    const offenders: string[] = [];
    for (const file of await listPartials()) {
      for (const token of placeholderTokens(await readPartial(file))) {
        const match = /^\{\{(\{)?([#/^]?)([a-zA-Z0-9]+)\}?(\})?\}\}$/.exec(token);
        if (!match || !/^[a-z][a-zA-Z0-9]*$/.test(match[3]!)) offenders.push(`${file} → ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("документация фиксирует ограничение проверок без HTML-парсера", async () => {
    const doc = await readFile(CONTRACT_DOC);
    expect(doc).toContain("Ограничения автоматических проверок");
    const readme = await readFile("src/web/templates/README.md");
    expect(readme).toContain("templates-contract.md");
  });
});
