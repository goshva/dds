/**
 * Stage 3.4.8.1 — R2: межпроцессная блокировка теневого CLI.
 *
 * Схема:
 *  - захват — атомарное создание файла с флагом `wx` (fail, если файл уже существует);
 *    проверка «существует → создать» запрещена (race condition);
 *  - содержимое: pid, hostname, started_at, token, mode; персональных данных нет;
 *  - освобождение — только при совпадении token (чужой lock не удаляется);
 *  - stale recovery: только при совпадении hostname, неактивном pid и точном совпадении
 *    перечитанного содержимого; старый lock сначала атомарно переименовывается, затем удаляется,
 *    и только после этого выполняется захват (повторный захват атомарен через `wx`).
 */

import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

export const SHADOW_LOCK_NAME = ".shadow.lock";

export interface LockInfo {
  pid: number;
  hostname: string;
  started_at: string;
  token: string;
  mode: string;
}

export type LockAcquireResult =
  | { acquired: true; token: string; path: string; recovered: boolean }
  | { acquired: false; code: "LOCKED" | "STALE_AMBIGUOUS" | "CORRUPTED_LOCK"; message: string; owner: LockInfo | null };

export class ShadowLockError extends Error {}

function lockPath(dir: string): string {
  return join(dir, SHADOW_LOCK_NAME);
}

function newToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isLockInfo(value: unknown): value is LockInfo {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.pid === "number" &&
    typeof record.hostname === "string" &&
    typeof record.started_at === "string" &&
    typeof record.token === "string" &&
    typeof record.mode === "string"
  );
}

function readLock(path: string): LockInfo | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isLockInfo(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Активен ли процесс: только для того же hostname (иначе состояние непроверяемо). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

/** Захват блокировки. Возвращает результат без исключений: вызывающий решает по коду. */
export function acquireShadowLock(dir: string, mode: string, startedAt: string): LockAcquireResult {
  mkdirSync(dir, { recursive: true });
  const path = lockPath(dir);
  const token = newToken();

  const tryCreate = (): boolean => {
    try {
      const fd = openSync(path, "wx");
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, hostname: hostname(), started_at: startedAt, token, mode }));
      } finally {
        closeSync(fd);
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  };

  if (tryCreate()) return { acquired: true, token, path, recovered: false };

  // блокировка занята: анализируем владельца
  const owner = readLock(path);
  if (!owner) {
    return { acquired: false, code: "CORRUPTED_LOCK", message: "lock-файл повреждён или имеет неизвестный формат; требуется ручная диагностика", owner: null };
  }
  if (owner.hostname !== hostname()) {
    return { acquired: false, code: "STALE_AMBIGUOUS", message: `lock принадлежит другому хосту (${owner.hostname}); автоматическое удаление запрещено`, owner };
  }
  if (isProcessAlive(owner.pid)) {
    return { acquired: false, code: "LOCKED", message: `lock удерживается активным процессом pid=${owner.pid} (${owner.mode})`, owner };
  }

  // stale recovery: атомарно переименовываем старый lock и сверяем содержимое
  const quarantine = `${path}.stale.${token}`;
  try {
    renameSync(path, quarantine);
  } catch {
    return { acquired: false, code: "LOCKED", message: "не удалось атомарно забрать stale lock; повторите запуск", owner };
  }
  const quarantined = readLock(quarantine);
  const sameOwner = quarantined !== null && quarantined.token === owner.token && quarantined.pid === owner.pid;
  if (!sameOwner) {
    // содержимое изменилось между проверкой и переименованием: возвращаем как было (если путь свободен)
    try {
      renameSync(quarantine, path);
    } catch {
      // вернуть не удалось — оставляем карантин, требуется ручная диагностика
    }
    return { acquired: false, code: "STALE_AMBIGUOUS", message: "состояние stale lock изменилось при восстановлении; требуется ручная диагностика", owner: quarantined };
  }
  try {
    unlinkSync(quarantine);
  } catch {
    // карантинный файл остаётся; штатному захвату это не мешает
  }

  if (!tryCreate()) {
    return { acquired: false, code: "LOCKED", message: "lock перехвачен другим процессом во время восстановления", owner: readLock(path) };
  }
  return { acquired: true, token, path, recovered: true };
}

/** Освобождение: удаляет lock только если token совпадает (чужой lock не трогаем). */
export function releaseShadowLock(path: string, token: string): boolean {
  if (!existsSync(path)) return false;
  const owner = readLock(path);
  if (!owner || owner.token !== token) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}