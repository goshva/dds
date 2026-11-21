/** Этап 1.4 — общие утилиты (read-only). */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const SNAPSHOT_ROOT = "data/snapshots/phase-01-4";
export const EXTRACT_ROOT = "data/extracted/phase-01-4";
export const REPORT_DIR = "reports/phase-01-4";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function nowIso(): string {
  return new Date().toISOString();
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

export function writeAtomic(path: string, content: string): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, path);
}

export function writeJsonAtomic(path: string, value: unknown): void {
  writeAtomic(path, JSON.stringify(value, null, 2));
}

export function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function csv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

export function joinReport(...parts: string[]): string {
  return join(REPORT_DIR, ...parts);
}

/** Минимальный CSV-парсер с кавычками (для чтения отчётов предыдущих этапов). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
      continue;
    }
    if (c === '"') q = true;
    else if (c === ",") {
      row.push(f);
      f = "";
    } else if (c === "\n") {
      row.push(f);
      rows.push(row);
      row = [];
      f = "";
    } else if (c !== "\r") f += c;
  }
  if (f.length || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1);
}

export function safeString(v: unknown, max = 400): string {
  return String(v ?? "").slice(0, max);
}
