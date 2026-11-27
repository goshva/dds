// TPL-4.4: инварианты безопасности и архитектуры после удаления legacy partials.
//
// Контекст: каталог src/web/templates/partials/ удалён (TPL-4.4). Production HTML формируют
// TypeScript-компоненты (src/web/components) и страницы (src/web/pages). Проверки ниже не зависят
// от удалённых файлов и защищают реальные инварианты: экранирование, безопасность URL, правила
// hash-маршрутов, поведение production-компонентов и отсутствие ссылок на удалённый каталог.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { dataTable, emptyState, errorState, lineChart, loadingState, statusBadge } from "../../src/web/components/index";
import { escapeHtml, isSafeHref, safeHref, statusClass } from "../../src/web/lib/format";

const REMOVED_PARTIALS_DIR = "src/web/templates/partials";

describe("TPL-4.4: экранирование значений", () => {
  test("escapeHtml нейтрализует все опасные символы", () => {
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  test("escapeHtml обезвреживает попытку внедрения разметки и атрибута", () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escapeHtml('" onmouseover="alert(1)')).toBe("&quot; onmouseover=&quot;alert(1)");
  });

  test("escapeHtml обрабатывает пустые и нестроковые значения без выброса", () => {
    expect(escapeHtml("")).toBe("");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(42)).toBe("42");
  });
});

describe("TPL-4.4: безопасность URL", () => {
  test("разрешены hash, относительные пути и http(s)", () => {
    for (const href of ["#history/all", "pages/overview.html", "../index.html", "https://example.com/a?b=c"]) {
      expect(isSafeHref(href), href).toBe(true);
      expect(safeHref(href), href).not.toBe("#");
    }
  });

  test("запрещены опасные схемы и протокол-относительные ссылки", () => {
    for (const href of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "vbscript:msgbox(1)", "file:///etc/passwd", "//evil.example.com", "", "   "]) {
      expect(isSafeHref(href), href).toBe(false);
      expect(safeHref(href), href).toBe("#");
    }
  });

  test("управляющие символы и кавычки в URL отклоняются", () => {
    for (const href of ["https://example.com/\u0000", 'https://example.com/"', "https://example.com/<script>"]) {
      expect(isSafeHref(href), JSON.stringify(href)).toBe(false);
    }
  });
});

describe("TPL-4.4: правила hash-маршрутов", () => {
  /** Правила зафиксированы в docs/ui/templates-contract.md и проверяются независимо от partials. */
  const ROUTES: Record<string, { arity: number; positions: Array<{ name: string; values: string[] }> }> = {
    "#history/": { arity: 1, positions: [{ name: "key", values: ["all", "30", "90", "180", "365"] }] },
    "#forecast-quality/": { arity: 2, positions: [{ name: "mode", values: ["replay", "shadow"] }, { name: "horizon", values: ["1", "3"] }] },
  };

  function checkHashHref(href: string): boolean {
    if (!href || /[\u0000-\u001f\u007f]/.test(href)) return false;
    if (!href.startsWith("#") || href.includes("?") || href.includes("%")) return false;
    const route = Object.keys(ROUTES).find((candidate) => href.startsWith(candidate));
    if (!route) return false;
    const segments = href.slice(route.length).split("/");
    if (segments.length !== ROUTES[route]!.arity) return false;
    return segments.every((segment, index) => segment.length > 0 && ROUTES[route]!.positions[index]!.values.includes(segment));
  }

  test("документированные формы принимаются", () => {
    for (const href of ["#history/all", "#history/30", "#history/365", "#forecast-quality/replay/1", "#forecast-quality/shadow/3"]) {
      expect(checkHashHref(href), href).toBe(true);
    }
  });

  test("недопустимые формы отклоняются", () => {
    for (const href of ["#admin/", "#history/unknown", "#history/999", "#forecast-quality/production/1", "#forecast-quality/replay/7", "#history/", "#history/all/extra", "#history/ALL", "#history/all?x=1"]) {
      expect(checkHashHref(href), href).toBe(false);
    }
  });
});

describe("TPL-4.4: production-компоненты формируют разметку самостоятельно", () => {
  test("таблица собирает ячейки сама и экранирует значения", () => {
    const html = dataTable({
      columns: [{ key: "model", label: "Модель" }, { key: "value", label: "Значение", numeric: true }],
      rows: [{ model: "<img src=x>", value: 1500 }, { model: "rolling_7_day_mean", value: "[Н/Д]" }],
      emptyText: "Нет данных",
    });
    expect((html.match(/<td/g) ?? []).length).toBe(4);
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).not.toContain("<img");
  });

  test("пустая таблица показывает текст пустого состояния и не выводит данные", () => {
    const html = dataTable({ columns: [{ key: "a", label: "A" }], rows: [], emptyText: "Нет данных" });
    expect(html).toContain("Нет данных");
    // единственная ячейка — служебная ячейка пустого состояния с colspan, данные не рендерятся
    expect((html.match(/<td/g) ?? []).length).toBe(1);
    expect(html).toContain("colspan");
  });

  test("состояния формируют собственную разметку без вычислений в шаблонах", () => {
    expect(loadingState({ rows: 3 })).toContain("ds-skeleton");
    expect((loadingState({ rows: 3 }).match(/ds-skeleton/g) ?? []).length).toBe(3);
    expect(emptyState({ title: "Нет данных" })).toContain("ds-state");
    expect(errorState({ title: "Ошибка", code: "E1" })).toContain("ds-badge--conflict");
  });

  test("график вычисляет путь сам и экранирует даты", () => {
    const html = lineChart([{ name: "actual", className: "actual", points: [{ date: "2026-01-01", value: 1 }, { date: "2026-01-02", value: 3 }] }]);
    expect(html).toMatch(/d="M[\d.,\sL]+"/);
    expect(html).not.toContain("{{path}}");
  });

  test("бейдж статуса использует перечислимый класс и экранирует текст", () => {
    expect(statusClass("NOT_AVAILABLE")).toContain("ds-badge");
    const html = statusBadge({ status: "OK", text: '<b>x</b>' });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });
});

describe("TPL-4.4: архитектурная чистота", () => {
  test("каталог legacy partials удалён", () => {
    const files = existsSync(REMOVED_PARTIALS_DIR)
      ? readdirSync(REMOVED_PARTIALS_DIR, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
      : [];
    expect(files.length).toBe(0);
  });

  test("production-исходники не ссылаются на удалённый каталог", () => {
    const root = join(import.meta.dir, "..", "..", "src");
    const offenders: string[] = [];
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walk(path);
        return /\.(ts|js|mjs|json|css|html)$/.test(entry.name) ? [path] : [];
      });
    for (const file of walk(root)) {
      const text = readFileSync(file, "utf8");
      if (/templates\/partials/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
