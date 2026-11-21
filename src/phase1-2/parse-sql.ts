/**
 * Этап 1.2 — прагматичный анализатор структуры SQL (без выполнения SQL).
 *
 * Не является полноценным SQL-парсером: извлекает структуру с учётом вложенности
 * скобок, строк, quoted identifiers, комментариев и Jinja-тегов. Спорные места
 * помечаются parse_uncertain/uncertainties для ручной проверки.
 *
 * Ничего не выполняет и не изменяет исходный SQL.
 */

export type SqlAtomType = "word" | "number" | "string" | "quoted" | "punct" | "operator";

export type SqlAtom = {
  type: SqlAtomType;
  value: string;
  upper: string;
  start: number;
  end: number;
  depth: number;
};

export type SqlSource = {
  name: string;
  schema: string | null;
  alias: string | null;
  kind: "table" | "cte" | "subquery" | "unknown";
  join_type: string | null;
  on: string | null;
  raw: string;
};

export type SqlSelectItem = {
  expression: string;
  alias: string | null;
  isComputed: boolean;
  hasAggregate: boolean;
  hasWindow: boolean;
};

export type SqlCte = {
  name: string;
  body: string;
};

export type ParsedSql = {
  cleaned: string;
  ctes: SqlCte[];
  sources: SqlSource[];
  joins: SqlSource[];
  selectItems: SqlSelectItem[];
  selectItemCount: number;
  whereClauses: string[];
  groupBy: string[];
  having: string[];
  orderBy: string[];
  limit: string | null;
  windowExpressions: string[];
  unionCount: number;
  parseUncertain: boolean;
  uncertainties: string[];
};

const CLAUSE_WORDS = new Set([
  "FROM",
  "WHERE",
  "GROUP",
  "HAVING",
  "ORDER",
  "LIMIT",
  "UNION",
  "JOIN",
  "LEFT",
  "RIGHT",
  "FULL",
  "INNER",
  "CROSS",
  "OUTER",
  "ON",
  "USING",
  "WINDOW",
  "QUALIFY",
  "OFFSET",
  "FETCH",
  "RETURNING",
]);

const AGGREGATES = new Set([
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "MEDIAN",
  "STDDEV",
  "VARIANCE",
  "ANY",
  "SOME",
  "EVERY",
  "GROUP_CONCAT",
  "STRING_AGG",
  "ARRAY_AGG",
  "UNIQEXACT",
  "UNIQEXACTIF",
  "QUANTILE",
  "TOPN",
]);

/** Удаляет комментарии и Jinja-теги, сохраняя длину строки (для номеров строк). */
export function stripNoise(sql: string): string {
  const chars = sql.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < chars.length; k++) {
      if (chars[k] !== "\n" && chars[k] !== "\r") chars[k] = " ";
    }
  };

  // Первый проход: Jinja-теги (в т.ч. внутри SQL-строк) — иначе replace("'", "''") ломает разбор строк.
  for (let i = 0; i < chars.length - 1; i++) {
    const pair = chars[i] + chars[i + 1];
    if (pair === "{{") {
      let j = i + 2;
      while (j < chars.length - 1 && !(chars[j] === "}" && chars[j + 1] === "}")) j++;
      j = Math.min(chars.length, j + 2);
      blank(i, j);
      i = j - 1;
      continue;
    }
    if (pair === "{%") {
      let j = i + 2;
      while (j < chars.length - 1 && !(chars[j] === "%" && chars[j + 1] === "}")) j++;
      j = Math.min(chars.length, j + 2);
      blank(i, j);
      i = j - 1;
      continue;
    }
  }

  // Второй проход: комментарии и строки.
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (ch === "-" && next === "-") {
      let j = i;
      while (j < chars.length && chars[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === "/" && next === "*") {
      let j = i + 2;
      while (j < chars.length - 1 && !(chars[j] === "*" && chars[j + 1] === "/")) j++;
      j = Math.min(chars.length, j + 2);
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < chars.length) {
        if (chars[j] === "'" && chars[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (chars[j] === "'") {
          j++;
          break;
        }
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return chars.join("");
}

export function tokenize(cleaned: string): SqlAtom[] {
  const atoms: SqlAtom[] = [];
  let i = 0;
  let depth = 0;
  const n = cleaned.length;
  const push = (type: SqlAtomType, value: string, start: number, end: number, d: number) => {
    atoms.push({ type, value, upper: value.toUpperCase(), start, end, depth: d });
  };
  while (i < n) {
    const ch = cleaned[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "'") {
      const start = i;
      i++;
      while (i < n) {
        if (cleaned[i] === "'" && cleaned[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (cleaned[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      push("string", cleaned.slice(start, i), start, i, depth);
      continue;
    }
    if (ch === '"' || ch === "`") {
      const quote = ch;
      const start = i;
      i++;
      while (i < n) {
        if (cleaned[i] === quote && cleaned[i + 1] === quote) {
          i += 2;
          continue;
        }
        if (cleaned[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      push("quoted", cleaned.slice(start, i), start, i, depth);
      continue;
    }
    if (ch === "(") {
      push("punct", ch, i, i + 1, depth);
      depth++;
      i++;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      push("punct", ch, i, i + 1, depth);
      i++;
      continue;
    }
    if (ch === "," || ch === "." || ch === ";") {
      push("punct", ch, i, i + 1, depth);
      i++;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < n && /[0-9.eE]/.test(cleaned[i])) i++;
      push("number", cleaned.slice(start, i), start, i, depth);
      continue;
    }
    if (/[A-Za-z_$\u0400-\u04FF]/.test(ch)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_$\u0400-\u04FF]/.test(cleaned[i])) i++;
      push("word", cleaned.slice(start, i), start, i, depth);
      continue;
    }
    const two = cleaned.slice(i, i + 2);
    if (["::", "<=", ">=", "<>", "!=", "||", "->", "#>"].includes(two)) {
      push("operator", two, i, i + 2, depth);
      i += 2;
      continue;
    }
    push("operator", ch, i, i + 1, depth);
    i++;
  }
  return atoms;
}

function matchingParen(atoms: SqlAtom[], openIndex: number): number {
  let depth = atoms[openIndex].depth;
  for (let i = openIndex + 1; i < atoms.length; i++) {
    if (atoms[i].type === "punct" && atoms[i].value === "(") depth++;
    if (atoms[i].type === "punct" && atoms[i].value === ")") {
      if (depth === atoms[openIndex].depth) return i;
      depth--;
    }
  }
  return -1;
}

function splitTopLevel(atoms: SqlAtom[], from: number, to: number, delimiter = ","): SqlAtom[][] {
  const parts: SqlAtom[][] = [];
  let current: SqlAtom[] = [];
  for (let i = from; i < to; i++) {
    const a = atoms[i];
    if (a.type === "punct" && a.value === delimiter && a.depth === atoms[from]?.depth) {
      parts.push(current);
      current = [];
      continue;
    }
    current.push(a);
  }
  if (current.length) parts.push(current);
  return parts;
}

function atomsText(atoms: SqlAtom[], from = 0, to = atoms.length): string {
  return atoms
    .slice(from, to)
    .map((a) => a.value)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSql(sql: string): ParsedSql {
  const cleaned = stripNoise(sql);
  const atoms = tokenize(cleaned);
  const uncertainties: string[] = [];

  // --- CTE ---
  const ctes: SqlCte[] = [];
  const withIdx = atoms.findIndex((a) => a.upper === "WITH" && a.depth === 0);
  if (withIdx >= 0) {
    let i = withIdx + 1;
    if (atoms[i]?.upper === "RECURSIVE") i++;
    for (; i < atoms.length; i++) {
      const nameAtom = atoms[i];
      if (nameAtom.depth !== 0) continue;
      if (nameAtom.upper === "SELECT" || nameAtom.upper === "INSERT") break;
      if (nameAtom.type !== "word" && nameAtom.type !== "quoted") continue;
      if (atoms[i + 1]?.upper !== "AS") continue;
      const open = i + 2;
      if (atoms[open]?.value !== "(") continue;
      const close = matchingParen(atoms, open);
      if (close < 0) {
        uncertainties.push(`unbalanced CTE parentheses near ${nameAtom.value}`);
        break;
      }
      ctes.push({ name: nameAtom.value.replace(/"/g, ""), body: cleaned.slice(atoms[open].end, atoms[close].start) });
      i = close;
      if (atoms[i + 1]?.value === ",") {
        i++;
        continue;
      }
      break;
    }
  }

  // --- UNION ---
  let unionCount = 0;
  for (let i = 0; i < atoms.length; i++) {
    if (atoms[i].depth === 0 && atoms[i].upper === "UNION") unionCount++;
  }

  // --- SELECT items (все SELECT на depth 0; обычно один, при UNION — несколько) ---
  const selectItems: SqlSelectItem[] = [];
  for (let i = 0; i < atoms.length; i++) {
    if (atoms[i].depth !== 0 || atoms[i].upper !== "SELECT") continue;
    const start = i + 1;
    let end = atoms.length;
    for (let j = start; j < atoms.length; j++) {
      if (
        atoms[j].depth === 0 &&
        ["FROM", "UNION", "WHERE", "GROUP", "ORDER", "LIMIT", "HAVING"].includes(atoms[j].upper)
      ) {
        end = j;
        break;
      }
    }
    const parts = splitTopLevel(atoms, start, end, ",");
    for (const part of parts) {
      if (!part.length) continue;
      let alias: string | null = null;
      let exprAtoms = part;
      const asIdx = part.findIndex((a) => a.upper === "AS" && a.depth === part[0].depth);
      if (asIdx >= 0 && part[asIdx + 1]) {
        alias = part[asIdx + 1].value.replace(/"/g, "");
        exprAtoms = part.slice(0, asIdx);
      } else if (part.length >= 2) {
        const last = part[part.length - 1];
        const prev = part[part.length - 2];
        if (
          (last.type === "word" || last.type === "quoted") &&
          !CLAUSE_WORDS.has(last.upper) &&
          (prev.type === "punct" || prev.type === "word" || prev.type === "quoted" || prev.type === "operator")
        ) {
          alias = last.value.replace(/"/g, "");
          exprAtoms = part.slice(0, -1);
        }
      }
      const expression = atomsText(exprAtoms);
      const upperExpr = expression.toUpperCase();
      selectItems.push({
        expression,
        alias,
        isComputed: /[()+\-*/]|\bCASE\b|\bCAST\b|\bCOALESCE\b|\bIF\b|\bNULLIF\b/.test(expression),
        hasAggregate: [...AGGREGATES].some((fn) => new RegExp(`(^|[^A-Z0-9_])${fn}\\s*\\(`).test(upperExpr)),
        hasWindow: /OVER\s*\(/.test(upperExpr),
      });
    }
  }

  // --- Sources (FROM/JOIN на любом уровне) ---
  const sources: SqlSource[] = [];
  const joins: SqlSource[] = [];
  const parseSourceAt = (idx: number, joinType: string | null): { source: SqlSource; next: number } | null => {
    let i = idx;
    const startIdx = i;
    const depth = atoms[i]?.depth ?? 0;
    let kind: SqlSource["kind"] = "unknown";
    let name = "";
    let schema: string | null = null;
    let rawEnd = i;
    if (atoms[i]?.value === "(") {
      const close = matchingParen(atoms, i);
      if (close < 0) return null;
      kind = "subquery";
      name = "(subquery)";
      rawEnd = close;
      i = close + 1;
    } else {
      const first = atoms[i];
      if (!first || (first.type !== "word" && first.type !== "quoted")) return null;
      name = first.value.replace(/"/g, "");
      kind = "table";
      i++;
      if (atoms[i]?.value === "." && (atoms[i + 1]?.type === "word" || atoms[i + 1]?.type === "quoted")) {
        schema = name;
        name = atoms[i + 1].value.replace(/"/g, "");
        i += 2;
      }
    }
    let alias: string | null = null;
    if (atoms[i]?.upper === "AS") i++;
    if (atoms[i] && (atoms[i].type === "word" || atoms[i].type === "quoted") && !CLAUSE_WORDS.has(atoms[i].upper)) {
      alias = atoms[i].value.replace(/"/g, "");
      i++;
    }
    let on: string | null = null;
    if (atoms[i]?.upper === "ON" || atoms[i]?.upper === "USING") {
      const onStart = i;
      let j = i + 1;
      while (j < atoms.length) {
        if (atoms[j].depth === depth && CLAUSE_WORDS.has(atoms[j].upper)) break;
        j++;
      }
      on = atomsText(atoms, onStart, j);
      i = j;
    }
    rawEnd = Math.max(rawEnd, i - 1);
    const source: SqlSource = {
      name,
      schema,
      alias,
      kind,
      join_type: joinType,
      on,
      raw: atomsText(atoms, startIdx, rawEnd + 1),
    };
    return { source, next: i };
  };

  let cursor = 0;
  while (cursor < atoms.length) {
    const a = atoms[cursor];
    if (a.upper === "FROM" && a.type === "word") {
      const depth = a.depth;
      let i = cursor + 1;
      while (i < atoms.length) {
        if (atoms[i].depth === depth && CLAUSE_WORDS.has(atoms[i].upper) && atoms[i].upper !== "JOIN") {
          if (atoms[i].upper === "FROM" || atoms[i].upper === "WHERE" || atoms[i].upper === "GROUP" || atoms[i].upper === "ORDER" || atoms[i].upper === "HAVING" || atoms[i].upper === "LIMIT" || atoms[i].upper === "UNION" || atoms[i].upper === "ON") break;
        }
        if (atoms[i].depth === depth && atoms[i].upper === "JOIN") break;
        const parsed = parseSourceAt(i, null);
        if (!parsed) {
          i++;
          continue;
        }
        sources.push(parsed.source);
        i = parsed.next;
        if (atoms[i]?.value === "," && atoms[i].depth === depth) {
          i++;
          continue;
        }
        break;
      }
      cursor = Math.max(cursor + 1, i);
      continue;
    }
    if (a.upper === "JOIN" && a.type === "word") {
      // определить тип JOIN по предыдущим токенам
      let joinType = "JOIN";
      const prev = atoms[cursor - 1]?.upper;
      const prev2 = atoms[cursor - 2]?.upper;
      if (prev === "OUTER" && (prev2 === "LEFT" || prev2 === "RIGHT" || prev2 === "FULL")) joinType = `${prev2} OUTER JOIN`;
      else if (prev === "LEFT" || prev === "RIGHT" || prev === "FULL" || prev === "INNER" || prev === "CROSS") joinType = `${prev} JOIN`;
      const parsed = parseSourceAt(cursor + 1, joinType);
      if (parsed) {
        sources.push(parsed.source);
        joins.push(parsed.source);
        cursor = parsed.next;
        continue;
      }
    }
    cursor++;
  }

  // --- Clauses (depth 0) ---
  const collectClause = (keyword: string, nextKeywords: string[]): string[] => {
    const result: string[] = [];
    for (let i = 0; i < atoms.length; i++) {
      if (atoms[i].depth !== 0 || atoms[i].upper !== keyword) continue;
      const start = i + 1;
      let end = atoms.length;
      for (let j = start; j < atoms.length; j++) {
        if (atoms[j].depth === 0 && nextKeywords.includes(atoms[j].upper)) {
          end = j;
          break;
        }
      }
      const text = atomsText(atoms, start, end);
      if (text) result.push(text);
      i = end;
    }
    return result;
  };

  const whereClauses = collectClause("WHERE", ["GROUP", "HAVING", "ORDER", "LIMIT", "UNION", "WINDOW", "QUALIFY"]);
  const groupBy = collectClause("GROUP", ["HAVING", "ORDER", "LIMIT", "UNION", "WINDOW", "QUALIFY"]);
  const having = collectClause("HAVING", ["ORDER", "LIMIT", "UNION", "WINDOW", "QUALIFY"]);
  const orderBy = collectClause("ORDER", ["LIMIT", "UNION", "WINDOW", "QUALIFY"]);
  const limitIdx = atoms.findIndex((a) => a.depth === 0 && a.upper === "LIMIT");
  const limit = limitIdx >= 0 ? atomsText(atoms, limitIdx + 1, atoms.length) : null;

  // --- Window functions ---
  const windowExpressions: string[] = [];
  for (let i = 0; i < atoms.length; i++) {
    if (atoms[i].upper === "OVER" && atoms[i + 1]?.value === "(") {
      const close = matchingParen(atoms, i + 1);
      if (close > 0) windowExpressions.push(atomsText(atoms, i, close + 1));
    }
  }

  // --- Uncertainties ---
  let balance = 0;
  for (const a of atoms) {
    if (a.value === "(") balance++;
    if (a.value === ")") balance--;
  }
  if (balance !== 0) uncertainties.push(`unbalanced parentheses: ${balance}`);
  if (!atoms.some((a) => a.upper === "SELECT")) uncertainties.push("no SELECT found");
  if (selectItems.length === 0) uncertainties.push("no select items parsed");

  return {
    cleaned,
    ctes,
    sources,
    joins,
    selectItems,
    selectItemCount: selectItems.length,
    whereClauses,
    groupBy,
    having,
    orderBy,
    limit,
    windowExpressions,
    unionCount,
    parseUncertain: uncertainties.length > 0,
    uncertainties,
  };
}

/** Классификация поля как ключа/времени/PII (эвристика, требует подтверждения). */
export function classifyFieldName(name: string): {
  isKeyCandidate: boolean;
  keyEntity: string | null;
  isTimeCandidate: boolean;
  isPiiCandidate: boolean;
} {
  const n = name.toLowerCase();
  const keyPatterns: Array<[RegExp, string]> = [
    [/^id_order$|^order_id$/, "order"],
    [/^id_general$|^id_delivery_job$|^id_parcel$/, "order_delivery"],
    [/^id_courier$|^courier_id$|^courier$/, "courier"],
    [/^id_tt$|^shopno$|^id_shop$/, "shop"],
    [/^id_pool$|^id_pool_calc$/, "pool"],
    [/^id_route$|^parcel_id$/, "route"],
    [/^id_group$|^cluster_id$/, "cluster"],
    [/^zone$|^inactivity_zone$|^prev_inactivity_zone$/, "zone"],
    [/^id_service$|^id_service_type$/, "service"],
  ];
  let keyEntity: string | null = null;
  let isKeyCandidate = false;
  for (const [re, entity] of keyPatterns) {
    if (re.test(n)) {
      isKeyCandidate = true;
      keyEntity = entity;
      break;
    }
  }
  const isTimeCandidate = /(^date|_date$|_date_|^dt$|_dt$|dttm|_time$|^time_|_time_|minute|timestamp|_day$|^d$|^dey$|week_no|_week|date_)/.test(n);
  const isPiiCandidate = /^(inn|инн|phone|телефон|fio|фио|name_courier|курьер|email|passport|snils|birth)$/.test(n);
  return { isKeyCandidate, keyEntity, isTimeCandidate, isPiiCandidate };
}

// =====================================================================================
// Этап 1.4: расширение парсера (аддитивно, обратная совместимость parseSql сохранена).
// =====================================================================================

export type SqlAggregate = { fn: string; expression: string; offset: number; line: number };
export type SqlCast = { expression: string; type: string; offset: number; line: number };
export type SqlDateTimeExpr = { fn: string; expression: string; offset: number; line: number };
export type ParseStatus = "PARSED" | "PARTIAL" | "UNRESOLVED" | "UNSUPPORTED_SYNTAX" | "ERROR";

export type ParsedSqlExtended = ParsedSql & {
  nested_select_count: number;
  aggregates: SqlAggregate[];
  case_count: number;
  casts: SqlCast[];
  date_time_expressions: SqlDateTimeExpr[];
  jinja_params: string[];
  dialect: "CLICKHOUSE" | "POSTGRES" | "UNKNOWN";
  dialect_evidence: string[];
  parse_status: ParseStatus;
  issues: string[];
  construct_lines: Record<string, number[]>;
};

const EXT_AGGREGATES = [
  "COUNT", "SUM", "AVG", "MIN", "MAX", "MEDIAN", "STDDEV", "VARIANCE", "ANY", "EVERY",
  "GROUP_CONCAT", "STRING_AGG", "ARRAY_AGG", "UNIQEXACT", "UNIQEXACTIF", "QUANTILEEXACT",
  "TOPN", "COUNTIF", "SUMIF", "AVGIF", "MODE",
];

const EXT_DATETIME_FNS = [
  "DATE_TRUNC", "EXTRACT", "DATEDIFF", "DATEADD", "TODATE", "TODATETIME", "FORMATDATETIME",
  "AGE", "NOW", "TODAY", "EPOCH", "TOSTARTOFDAY", "TOSTARTOFMONTH",
];

const UNSUPPORTED_CONSTRUCTS = ["PIVOT", "UNPIVOT", "LATERAL", "MATCH_RECOGNIZE", "CONNECT", "MODEL"];

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

function captureBalanced(text: string, openIdx: number): { body: string; end: number } {
  let depth = 0;
  let inStr = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "'" && text[i + 1] === "'") {
        i++;
        continue;
      }
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return { body: text.slice(openIdx + 1, i), end: i };
    }
  }
  return { body: text.slice(openIdx + 1), end: text.length - 1 };
}

function collectFnCalls(text: string, fns: string[]): Array<{ fn: string; expression: string; offset: number; line: number }> {
  const out: Array<{ fn: string; expression: string; offset: number; line: number }> = [];
  for (const fn of fns) {
    const re = new RegExp(`\\b${fn}\\s*\\(`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const open = text.indexOf("(", m.index);
      if (open < 0) continue;
      const { body } = captureBalanced(text, open);
      out.push({ fn, expression: body.trim().slice(0, 300), offset: m.index, line: lineAt(text, m.index) });
    }
  }
  return out;
}

function detectDialect(cleaned: string): { dialect: "CLICKHOUSE" | "POSTGRES" | "UNKNOWN"; evidence: string[] } {
  const ch: string[] = [];
  const pg: string[] = [];
  const chPatterns: Array<[RegExp, string]> = [
    [/\bdictGet(OrNull)?\s*\(/i, "dictGetOrNull"],
    [/\buniqExact(If)?\s*\(/i, "uniqExact"],
    [/\bquantileExact\s*\(/i, "quantileExact"],
    [/\bcountIf\s*\(/i, "countIf"],
    [/\bmultiIf\s*\(/i, "multiIf"],
    [/\btoDate\s*\(/i, "toDate"],
    [/\bformatDateTime\s*\(/i, "formatDateTime"],
    [/\bassumeNotNull\s*\(/i, "assumeNotNull"],
  ];
  const pgPatterns: Array<[RegExp, string]> = [
    [/::\s*[a-zA-Z_]+/i, "postgres cast ::"],
    [/\bEXTRACT\s*\(\s*EPOCH/i, "EXTRACT(EPOCH"],
    [/~\*/i, "postgres regex ~*"],
    [/\bdate_trunc\s*\(/i, "date_trunc"],
    [/\bnow\(\)\s*-\s*interval/i, "now() - interval"],
    [/\bjsonb?\b/i, "json/jsonb"],
  ];
  for (const [re, label] of chPatterns) if (re.test(cleaned)) ch.push(label);
  for (const [re, label] of pgPatterns) if (re.test(cleaned)) pg.push(label);
  if (ch.length && pg.length) {
    return ch.length >= pg.length ? { dialect: "CLICKHOUSE", evidence: [...ch, ...pg] } : { dialect: "POSTGRES", evidence: [...pg, ...ch] };
  }
  if (ch.length) return { dialect: "CLICKHOUSE", evidence: ch };
  if (pg.length) return { dialect: "POSTGRES", evidence: pg };
  return { dialect: "UNKNOWN", evidence: [] };
}

function extractJinjaParams(sql: string): string[] {
  const params = new Set<string>();
  const kw = new Set(["if", "elif", "else", "endif", "for", "endfor", "in", "and", "or", "not", "none", "is", "true", "false", "set", "string", "replace", "join", "loop", "last"]);
  for (const m of sql.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)/g)) params.add(m[1]);
  for (const m of sql.matchAll(/\{%\s*(?:if|elif|for)\s+([^%]+)%\}/g)) {
    for (const id of m[1].matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      if (!kw.has(id[0].toLowerCase())) params.add(id[0]);
    }
  }
  for (const m of sql.matchAll(/filter_values\s*\(\s*'([^']+)'/g)) params.add(m[1]);
  return [...params];
}

/** Расширенный разбор SQL: базовый parseSql + aggregates/CASE/CAST/date-time/Jinja/dialect/positions/status. */
export function parseSqlExtended(sql: string): ParsedSqlExtended {
  const base = parseSql(sql);
  const cleaned = base.cleaned;
  const atoms = tokenize(cleaned);
  const issues: string[] = [...base.uncertainties];

  const nestedSelectCount = atoms.filter((a) => a.upper === "SELECT" && a.depth > 0).length;
  const caseCount = atoms.filter((a) => a.upper === "CASE").length;

  const aggregates: SqlAggregate[] = collectFnCalls(cleaned, EXT_AGGREGATES).map((x) => ({ ...x }));
  const dateTimeExpressions: SqlDateTimeExpr[] = collectFnCalls(cleaned, EXT_DATETIME_FNS).map((x) => ({ ...x }));

  const casts: SqlCast[] = [];
  for (const m of cleaned.matchAll(/::\s*([A-Za-z_][A-Za-z0-9_ ()]*)/g)) {
    casts.push({ expression: "", type: m[1].trim().slice(0, 80), offset: m.index ?? 0, line: lineAt(cleaned, m.index ?? 0) });
  }
  for (const m of cleaned.matchAll(/\bCAST\s*\(/gi)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const { body } = captureBalanced(cleaned, open);
    const asMatch = body.match(/\bAS\s+([A-Za-z_][A-Za-z0-9_ ()]*)$/i);
    casts.push({ expression: body.replace(/\bAS\s+[^]*$/i, "").trim().slice(0, 200), type: (asMatch?.[1] ?? "").trim().slice(0, 80), offset: m.index ?? 0, line: lineAt(cleaned, m.index ?? 0) });
  }

  const constructLines: Record<string, number[]> = {};
  const pushLine = (key: string, line: number) => {
    if (!constructLines[key]) constructLines[key] = [];
    if (!constructLines[key].includes(line)) constructLines[key].push(line);
  };
  for (const a of atoms) {
    if (a.type !== "word") continue;
    if (a.upper === "SELECT") pushLine("select", lineAt(cleaned, a.start));
    if (a.upper === "FROM") pushLine("from", lineAt(cleaned, a.start));
    if (a.upper === "JOIN") pushLine("join", lineAt(cleaned, a.start));
    if (a.upper === "WHERE") pushLine("where", lineAt(cleaned, a.start));
    if (a.upper === "GROUP") pushLine("group_by", lineAt(cleaned, a.start));
    if (a.upper === "HAVING") pushLine("having", lineAt(cleaned, a.start));
    if (a.upper === "ORDER") pushLine("order_by", lineAt(cleaned, a.start));
    if (a.upper === "LIMIT") pushLine("limit", lineAt(cleaned, a.start));
    if (a.upper === "UNION") pushLine("union", lineAt(cleaned, a.start));
    if (a.upper === "OVER") pushLine("window", lineAt(cleaned, a.start));
    if (a.upper === "WITH") pushLine("with", lineAt(cleaned, a.start));
  }

  const upper = cleaned.toUpperCase();
  for (const c of UNSUPPORTED_CONSTRUCTS) {
    if (new RegExp(`\\b${c}\\b`).test(upper)) issues.push(`possibly unsupported construct: ${c}`);
  }

  const { dialect, evidence } = detectDialect(cleaned);
  let parseStatus: ParseStatus = "PARSED";
  if (base.selectItemCount === 0 && base.parseUncertain) parseStatus = "UNRESOLVED";
  else if (issues.some((i) => i.startsWith("possibly unsupported"))) parseStatus = "UNSUPPORTED_SYNTAX";
  else if (base.parseUncertain) parseStatus = "PARTIAL";

  return {
    ...base,
    nested_select_count: nestedSelectCount,
    aggregates,
    case_count: caseCount,
    casts,
    date_time_expressions: dateTimeExpressions,
    jinja_params: extractJinjaParams(sql),
    dialect,
    dialect_evidence: evidence,
    parse_status: parseStatus,
    issues,
    construct_lines: constructLines,
  };
}
