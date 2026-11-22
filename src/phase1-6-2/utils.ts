/**
 * Этап 1.6.2 — общие утилиты (read-only, без секретов и PII в артефактах).
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { scanPii16, type PiiHit } from "../phase1-6/pii16";

export const REPORTS = "reports/phase-01-6-2";
export const DOCS = "docs/phase-01-6-2";
export const PACKAGE = "analysis_package";
export const SNAP = "data/snapshots/phase-01-6-2";
export const EVIDENCE = join(REPORTS, "evidence");

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function readJson<T = any>(path: string): T | null {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
  } catch {
    return null;
  }
}

export function writeText(path: string, content: string): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, path);
}

export function writeJson(path: string, value: unknown): void {
  writeText(path, JSON.stringify(value, null, 2));
}

export function writeJsonl(path: string, rows: unknown[]): void {
  ensureDir(dirname(path));
  writeText(path, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

export function appendJsonl(path: string, row: unknown): void {
  ensureDir(dirname(path));
  appendFileSync(path, JSON.stringify(row) + "\n", { mode: 0o600 });
}

export function readJsonl<T = any>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as T);
    } catch {
      /* пропускаем повреждённую строку, сохраняя остальные */
    }
  }
  return out;
}

export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

export function writeCsv(path: string, header: string[], rows: unknown[][]): void {
  writeText(path, [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n");
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/** ПДн-сканирование текста (общие паттерны этапа 1.6). */
export function scanPii(text: string): PiiHit[] {
  return scanPii16(text);
}

const PII_COLUMN_RE = new RegExp(
  [
    "(^|_)(fio|name|first_name|last_name|middle_name|surname|patronymic)($|_)",
    "mentor.?fio", "courier.?fio", "person.?fio", "employee.?fio",
    "phone", "tel", "mobile", "email", "mail", "address", "addr",
    "passport", "snils", "inn", "birth", "birthday", "date_birth",
    "фио", "имя", "фамил", "телефон", "почт", "адрес", "паспорт",
    "дата_рожд", "др_", "логин", "login",
  ].join("|"),
  "i",
);

/** Признак колонки, значения которой нельзя выгружать (PII). */
export function isPiiColumn(name: string): boolean {
  return PII_COLUMN_RE.test(String(name ?? ""));
}

/** Признак того, что строка содержит PII-паттерн (включая ФИО). */
export function isPiiText(s: string): boolean {
  return isPiiValue(s);
}

// ФИО сотрудников: отчество на -вич/-вна/-ична/-инична — сильный признак персонального имени.
// \b не работает для кириллицы в JS, поэтому граница — просмотр вперёд.
// Полное ФИО: фамилия + имя + отчество на -вич/-вна/-ична/-инична.
const PATRONYMIC_RE = /[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]*(?:вич|вна|ична|инична)(?![а-яё])/i;
// «Фамилия И.О.» и «Фамилия И О».
const INITIALS_RE = /[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.|[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\s+[А-ЯЁ](?![а-яё])/;

/** Признак значения, содержащего ПДн (email, телефон, ФИО, инициалы и т.п.). */
export function isPiiValue(v: unknown): boolean {
  const s = String(v ?? "");
  return scanPii(s).length > 0 || PATRONYMIC_RE.test(s) || INITIALS_RE.test(s);
}

/** Замена ПДн в строке на плейсхолдеры: артефакты не должны содержать ПДн. */
export function redactPii(s: unknown): string {
  let t = String(s ?? "");
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>");
  t = t.replace(/\+7[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/g, "<phone>");
  t = t.replace(/Bearer\s+[A-Za-z0-9._\-]{10,}/gi, "Bearer <token>");
  t = t.replace(/password\s*[:=]\s*["']?[^"'\s]{4,}/gi, "password=<redacted>");
  // ФИО: три слова с отчеством, «Фамилия И.О.» и «Фамилия И О».
  t = t.replace(/[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]*(?:вич|вна|ична|инична)(?![а-яё])/gi, "<ФИО>");
  t = t.replace(/[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\./g, "<ФИО>");
  t = t.replace(/[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\s+[А-ЯЁ](?![а-яё])/g, "<ФИО>");
  return t;
}

/** Рекурсивное редактирование ПДн в JSON-совместимой структуре. */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactPii(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v);
    return out as unknown as T;
  }
  return value;
}

/** Признак технического/служебного значения, не несущего бизнес-смысла. */
export function isTechnicalValue(v: string): boolean {
  const s = String(v ?? "").trim();
  if (!s) return true;
  if (/^(null|none|nan|undefined|\\N|N\/A|-)$/i.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  return false;
}

/** 1970-01-01 как известный маркер отсутствия даты — фиксируем, но не заменяем на NULL. */
export function isEpochSentinel(v: string): boolean {
  return /^\s*1970-01-01([ T]00:00:00)?/.test(String(v ?? ""));
}

export type ValueSource = "ACTUAL_VALUES" | "FILTER_VALUES" | "SQL_DERIVED" | "METADATA_ONLY" | "NOT_AVAILABLE";

export const RETRIEVAL = {
  SUCCESS: "SUCCESS",
  PARTIAL: "PARTIAL",
  NOT_AVAILABLE: "NOT_AVAILABLE",
} as const;

export type RetrievalStatus = (typeof RETRIEVAL)[keyof typeof RETRIEVAL];

/** Нормализация типа колонки Superset к компактному виду. */
export function normalizeType(t: unknown): string {
  const s = String(t ?? "").toUpperCase();
  if (!s) return "UNKNOWN";
  if (/INT|SERIAL|LONG/.test(s)) return "INTEGER";
  if (/NUMERIC|DECIMAL|DOUBLE|FLOAT|REAL|MONEY/.test(s)) return "NUMERIC";
  if (/TIMESTAMP|DATETIME|DATE|TIME/.test(s)) return "TEMPORAL";
  if (/BOOL/.test(s)) return "BOOLEAN";
  if (/JSON|ARRAY|MAP|STRUCT/.test(s)) return "COMPOSITE";
  if (/CHAR|TEXT|STRING|UUID|ENUM/.test(s)) return "STRING";
  return "UNKNOWN";
}

/** Разбор значения-времени без предположений о часовом поясе. */
export function asTemporal(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/.test(s)) return s;
  return null;
}

/** Уникальные значения с частотой, с ограничением. */
export function countValues(values: string[], limit: number): { all: string[]; freq: Array<{ value: string; count: number }>; truncated: boolean } {
  const freq = new Map<string, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const truncated = sorted.length > limit;
  return {
    all: sorted.slice(0, limit).map(([v]) => v),
    freq: sorted.slice(0, limit).map(([value, count]) => ({ value, count })),
    truncated,
  };
}

/** Строка evidence-ссылки на файл этапа. */
export function evidenceRef(rel: string): string {
  return join(REPORTS, "evidence", rel).replace(/\\/g, "/");
}
