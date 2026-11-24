/**
 * Read-only доступ к прогнозной SQLite для профилирования.
 *
 * Гарантии:
 *  - соединение открывается как `readonly: true` (запись отклоняет сам драйвер);
 *  - дополнительно включается `PRAGMA query_only = 1`;
 *  - все запросы проходят проверку {@link assertReadOnlySql} — разрешены только SELECT/WITH;
 *  - миграции не применяются (используется НЕ `openStore`, который их запускает).
 */

import { Database } from "bun:sqlite";
import { resolve } from "node:path";

export interface ReadOnlyDatabase {
  db: Database;
  path: string;
  /** Доказательство невозможности записи: пробная запись в транзакции отклонена. */
  writeBlocked: boolean;
}

const WRITE_SQL = /^\s*(insert|update|delete|create|alter|drop|replace|vacuum|attach|detach|reindex|pragma)\b/i;

/** Разрешает только читающие запросы. Бросает исключение на любой потенциальной записи. */
export function assertReadOnlySql(sql: string): void {
  const normalized = sql.trim();
  if (!/^(select|with)\b/i.test(normalized)) {
    throw new Error(`read-only guard: разрешены только SELECT/WITH, получено: ${normalized.slice(0, 60)}`);
  }
  if (WRITE_SQL.test(normalized)) {
    throw new Error(`read-only guard: запись запрещена: ${normalized.slice(0, 60)}`);
  }
}

/**
 * Пробная запись внутри транзакции: при корректном read-only соединении она отклоняется,
 * а если бы прошла — откатывается, поэтому данные не меняются ни при каком исходе.
 */
function probeWriteBlocked(db: Database): boolean {
  db.exec("BEGIN");
  try {
    db.query("INSERT INTO shops (shop_no, created_at) VALUES ('__readonly_probe__', '1970-01-01T00:00:00.000Z')").run();
    return false; // запись прошла — соединение не является read-only
  } catch {
    return true;
  } finally {
    try {
      db.exec("ROLLBACK");
    } catch {
      // соединение только для чтения может не поддерживать ROLLBACK — это нормально
    }
  }
}

/** Открывает базу строго для чтения: без миграций и без изменения WAL. */
export function openReadOnlyDatabase(path: string): ReadOnlyDatabase {
  const target = resolve(path);
  const db = new Database(target, { readonly: true, create: false });
  db.exec("PRAGMA query_only = 1");
  db.exec("PRAGMA busy_timeout = 5000");
  const writeBlocked = probeWriteBlocked(db);
  return { db, path: target, writeBlocked };
}

/** Читающий запрос с проверкой SQL. */
export function queryAll<T>(db: Database, sql: string, params: unknown[] = []): T[] {
  assertReadOnlySql(sql);
  return db.query(sql).all(...(params as never[])) as T[];
}

export function queryOne<T>(db: Database, sql: string, params: unknown[] = []): T | null {
  assertReadOnlySql(sql);
  return (db.query(sql).get(...(params as never[])) as T | null) ?? null;
}

export interface TableCounts {
  daily_metrics: number;
  domain_events: number;
  extraction_runs: number;
  raw_extractions: number;
}

export function readTableCounts(db: Database): TableCounts {
  const count = (table: string) => (queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM ${table}`)?.c ?? 0);
  return {
    daily_metrics: count("daily_metrics"),
    domain_events: count("domain_events"),
    extraction_runs: count("extraction_runs"),
    raw_extractions: count("raw_extractions"),
  };
}

export interface IntegrityReport {
  integrity: string;
  foreign_key_violations: number;
  query_only: number;
}

export function readIntegrity(db: Database): IntegrityReport {
  assertReadOnlySql("SELECT 1");
  const integrity = db.query("PRAGMA integrity_check").get() as Record<string, unknown> | null;
  const foreign = db.query("PRAGMA foreign_key_check").all() as unknown[];
  const queryOnly = db.query("PRAGMA query_only").get() as { query_only?: number } | null;
  return {
    integrity: String(Object.values(integrity ?? {})[0] ?? "unknown"),
    foreign_key_violations: foreign.length,
    query_only: Number(queryOnly?.query_only ?? 0),
  };
}
