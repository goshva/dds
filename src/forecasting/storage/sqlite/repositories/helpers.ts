/** Вспомогательные функции репозиториев SQLite. */

import type { Database } from "bun:sqlite";

/** sha256 от payload — используется для дедупликации в raw_extractions. */
export function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/** Выполняет `fn` внутри транзакции, если транзакция ещё не открыта (репозитории компонуются). */
export function inTransactionOrNew<T>(db: Database, fn: () => T): T {
  if (db.inTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // сохраняем исходную ошибку
    }
    throw error;
  }
}

export function lastInsertId(info: { lastInsertRowid: number | bigint }): number {
  return Number(info.lastInsertRowid);
}

/** Собирает фрагменты `SET a = ?, b = ?` по белому списку полей; лишние ключи игнорируются. */
export function buildUpdate(
  patch: Record<string, unknown>,
  allowed: readonly string[],
): { sql: string; values: unknown[] } | null {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const key of allowed) {
    if (!(key in patch)) continue;
    assignments.push(`${key} = ?`);
    values.push(patch[key] ?? null);
  }
  if (!assignments.length) return null;
  return { sql: assignments.join(", "), values };
}
