/**
 * Этап 1.6.2 — извлечение строковых литералов из SQL-определений датасетов.
 *
 * Назначение: дать хоть какие-то значения колонок, когда SQL Lab и chart data недоступны.
 * <ФИО> НЕ фактические значения: литерал в SQL означает, что значение упоминается в определении,
 * а не что оно присутствует в данных. Классификация — SQL_DERIVED.
 *
 * Правила (сознательно консервативные):
 *  - рассматриваются только `column = 'x'`, `column IN ('a','b')`, `column NOT IN (...)`;
 *  - подзапросы, Jinja-шаблоны ({{ }}, {% %}) и числа отбрасываются;
 *  - SQL-комментарии вырезаются до разбора;
 *  - литерал принимается, только если колонка реально есть в датасете.
 */

export type ColumnLiteral = { column: string; value: string; op: "=" | "IN" };

const MAX_VALUE_LEN = 80;

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

function isUsableValue(v: string): boolean {
  if (!v || v.length >= MAX_VALUE_LEN) return false;
  if (/^\d+$/.test(v)) return false;
  if (/[{}%]/.test(v)) return false;
  return true;
}

/**
 * Возвращает литералы, привязанные к колонкам датасета.
 * @param sql SQL-определение датасета
 * @param columns имена колонок датасета (без префиксов таблиц)
 */
export function extractColumnLiterals(sql: string, columns: Iterable<string>): ColumnLiteral[] {
  const out: ColumnLiteral[] = [];
  if (!sql) return out;
  const colSet = new Set(columns);
  const clean = stripComments(sql);

  const inRe = /([A-Za-z_][\w.]*)\s*(?:not\s+in|in)\s*\(([^)]{0,2000})\)/gi;
  for (const m of clean.matchAll(inRe)) {
    const col = m[1].split(".").pop() ?? "";
    if (!colSet.has(col)) continue;
    const block = m[2];
    if (/\bselect\b/i.test(block) || block.includes("{{") || block.includes("{%")) continue;
    for (const part of block.split(",")) {
      const pm = part.trim().match(/^'([^']{1,80})'$/);
      if (!pm) continue;
      const v = pm[1].trim();
      if (!isUsableValue(v)) continue;
      out.push({ column: col, value: v, op: "IN" });
    }
  }

  const eqRe = /([A-Za-z_][\w.]*)\s*=\s*'([^']{1,80})'/g;
  for (const m of clean.matchAll(eqRe)) {
    const col = m[1].split(".").pop() ?? "";
    if (!colSet.has(col)) continue;
    const v = m[2].trim();
    if (!isUsableValue(v)) continue;
    out.push({ column: col, value: v, op: "=" });
  }

  return out;
}
