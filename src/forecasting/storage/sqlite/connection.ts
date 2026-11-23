/**
 * Подключение к прогнозной базе SQLite и настройка соединения.
 *
 * Правила переносимости (см. docs/forecasting/audit-report.md §4): никакой бизнес-логики в SQL,
 * даты в ISO, natural key без run_id, отсутствующие значения — NULL, а не нули.
 */

import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface OpenDatabaseOptions {
  /** открыть только для чтения (запись невозможна, миграции не применяются) */
  readonly?: boolean;
  /** создать файл, если его нет (по умолчанию true) */
  create?: boolean;
  /** таймаут ожидания блокировки в мс (по умолчанию 5000) */
  busyTimeoutMs?: number;
}

export interface DatabaseInfo {
  path: string;
  journalMode: string;
  isWal: boolean;
  synchronous: string | number;
  foreignKeys: boolean;
  busyTimeoutMs: number;
  tempStore: string | number;
  integrity: string;
  userVersion: number;
  tables: string[];
}

/** Обязательный набор PRAGMA из спецификации MVP. */
export const REQUIRED_PRAGMAS = {
  journalMode: "WAL",
  synchronous: "NORMAL",
  foreignKeys: true,
  busyTimeoutMs: 5000,
  tempStore: "MEMORY",
} as const;

function firstValue<T = unknown>(db: Database, sql: string): T | undefined {
  const row = db.query(sql).get() as Record<string, unknown> | null;
  if (!row) return undefined;
  const values = Object.values(row);
  return values[0] as T;
}

/**
 * Открывает прогнозную базу и применяет обязательные PRAGMA.
 * `:memory:` не поддерживает WAL, а соединение только для чтения не может менять `journal_mode`,
 * поэтому фактический режим всегда виден в {@link databaseInfo}.
 */
export async function openDatabase(path: string, opts: OpenDatabaseOptions = {}): Promise<Database> {
  const isMemory = path === ":memory:" || path.startsWith("file::memory:");
  const target = isMemory ? path : resolve(path);
  if (!isMemory) {
    await mkdir(dirname(target), { recursive: true });
  }

  const db = new Database(target, {
    create: opts.create ?? true,
    readonly: opts.readonly ?? false,
  });

  const busyTimeoutMs = opts.busyTimeoutMs ?? REQUIRED_PRAGMAS.busyTimeoutMs;
  db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(busyTimeoutMs))}`);
  db.exec(`PRAGMA temp_store = ${REQUIRED_PRAGMAS.tempStore}`);
  db.exec(`PRAGMA foreign_keys = ${REQUIRED_PRAGMAS.foreignKeys ? "ON" : "OFF"}`);
  if (!opts.readonly) {
    db.exec(`PRAGMA synchronous = ${REQUIRED_PRAGMAS.synchronous}`);
    // journal_mode — постоянное свойство файла, для его смены нужна запись;
    // соединение только для чтения просто сообщает режим, который уже есть у файла.
    db.exec(`PRAGMA journal_mode = ${REQUIRED_PRAGMAS.journalMode}`);
  }

  return db;
}

export function closeDatabase(db: Database): void {
  db.close(false);
}

export function inTransaction(db: Database): boolean {
  return db.inTransaction === true;
}

/** BEGIN IMMEDIATE … COMMIT / ROLLBACK. Вложенные транзакции запрещены. */
export function withTransaction<T>(db: Database, fn: () => T): T {
  if (inTransaction(db)) {
    throw new Error("withTransaction: a transaction is already open");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ошибка отката не должна скрывать исходную ошибку
    }
    throw error;
  }
}

/** `PRAGMA integrity_check` — «ok» для исправной базы. */
export function integrityCheck(db: Database): string {
  return String(firstValue(db, "PRAGMA integrity_check") ?? "unknown");
}

export function foreignKeyCheck(db: Database): string[] {
  const rows = db.query("PRAGMA foreign_key_check").all() as Array<Record<string, unknown>>;
  return rows.map((r) => JSON.stringify(r));
}

export function tableNames(db: Database): string[] {
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export function databaseInfo(db: Database, path: string): DatabaseInfo {
  const journalMode = String(firstValue(db, "PRAGMA journal_mode") ?? "unknown");
  return {
    path,
    journalMode,
    isWal: journalMode.toLowerCase() === "wal",
    synchronous: firstValue<string | number>(db, "PRAGMA synchronous") ?? "unknown",
    foreignKeys: Number(firstValue(db, "PRAGMA foreign_keys")) === 1,
    busyTimeoutMs: Number(firstValue(db, "PRAGMA busy_timeout") ?? 0),
    tempStore: firstValue<string | number>(db, "PRAGMA temp_store") ?? "unknown",
    integrity: integrityCheck(db),
    userVersion: Number(firstValue(db, "PRAGMA user_version") ?? 0),
    tables: tableNames(db),
  };
}

/** Выполняет `PRAGMA wal_checkpoint(TRUNCATE)`; возвращает строку результата или null для `:memory:`. */
export function checkpointWal(db: Database): Record<string, unknown> | null {
  try {
    return (db.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as Record<string, unknown> | null) ?? null;
  } catch {
    return null;
  }
}
