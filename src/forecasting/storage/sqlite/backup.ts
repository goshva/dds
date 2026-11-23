/**
 * Резервное копирование, проверка, восстановление и хранение копий прогнозной базы SQLite.
 *
 * Копия делается через `VACUUM INTO`: получается согласованный снимок базы
 * (включая зафиксированные данные WAL) без длительной блокировки писателя.
 */

import { Database } from "bun:sqlite";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { closeDatabase, integrityCheck, openDatabase } from "./connection";

export interface BackupResult {
  path: string;
  bytes: number;
  integrity: string;
}

export interface RestoreResult {
  path: string;
  bytes: number;
  integrity: string;
  replacedExisting: boolean;
}

function sqlLiteral(value: string): string {
  if (value.includes("'")) {
    throw new Error(`path must not contain a single quote: ${value}`);
  }
  return `'${value}'`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Создаёт согласованный снимок по пути `targetPath`. Падает, если файл уже существует. */
export async function backupDatabase(db: Database, targetPath: string): Promise<BackupResult> {
  const target = resolve(targetPath);
  await mkdir(dirname(target), { recursive: true });
  if (await exists(target)) {
    throw new Error(`backup target already exists: ${target}`);
  }

  // VACUUM INTO не принимает параметры-заглушки: путь экранируется и проверяется выше.
  db.exec(`VACUUM INTO ${sqlLiteral(target)}`);

  const info = await stat(target);
  const check = await openDatabase(target, { readonly: true, create: false });
  try {
    const integrity = integrityCheck(check);
    if (integrity !== "ok") {
      throw new Error(`backup integrity check failed: ${integrity}`);
    }
    return { path: target, bytes: info.size, integrity };
  } finally {
    closeDatabase(check);
  }
}

/** Проверяет файл копии, не затрагивая рабочую базу. */
export async function verifyBackup(backupPath: string): Promise<{ path: string; bytes: number; integrity: string; tables: number }> {
  const path = resolve(backupPath);
  if (!(await exists(path))) {
    throw new Error(`backup not found: ${path}`);
  }
  const info = await stat(path);
  const db = await openDatabase(path, { readonly: true, create: false });
  try {
    const integrity = integrityCheck(db);
    const tables = db
      .query("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .get() as { c: number };
    return { path, bytes: info.size, integrity, tables: tables.c };
  } finally {
    closeDatabase(db);
  }
}

/**
 * Восстанавливает базу из `backupPath` в `targetPath`.
 * Копия сначала проверяется; служебные файлы цели `-wal`/`-shm` удаляются.
 */
export async function restoreDatabase(
  backupPath: string,
  targetPath: string,
  opts: { overwrite?: boolean } = {},
): Promise<RestoreResult> {
  const source = resolve(backupPath);
  const target = resolve(targetPath);
  if (source === target) {
    throw new Error("backup source and restore target must differ");
  }
  if (!(await exists(source))) {
    throw new Error(`backup not found: ${source}`);
  }

  const verification = await verifyBackup(source);
  if (verification.integrity !== "ok") {
    throw new Error(`refusing to restore a damaged backup: ${verification.integrity}`);
  }

  const replacedExisting = await exists(target);
  if (replacedExisting && !opts.overwrite) {
    throw new Error(`restore target exists (pass overwrite: true): ${target}`);
  }

  await mkdir(dirname(target), { recursive: true });
  if (replacedExisting) {
    await rm(target, { force: true });
  }
  for (const sidecar of [`${target}-wal`, `${target}-shm`, `${target}-journal`]) {
    await rm(sidecar, { force: true });
  }

  await copyFile(source, target);

  const info = await stat(target);
  const db = await openDatabase(target, { create: false });
  try {
    const integrity = integrityCheck(db);
    if (integrity !== "ok") {
      throw new Error(`restored database failed integrity check: ${integrity}`);
    }
    return { path: target, bytes: info.size, integrity, replacedExisting };
  } finally {
    closeDatabase(db);
  }
}

/** Список файлов копий по соглашению об имени `prefix-YYYY-MM-DD.sqlite` (сортировка по имени). */
export async function listBackups(dir: string, prefix = "forecasting"): Promise<string[]> {
  const directory = resolve(dir);
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory);
  return entries
    .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".sqlite"))
    .sort()
    .map((f) => join(directory, f));
}

/** Оставляет `keep` самых новых копий, старые удаляет. Возвращает удалённые пути. */
export async function pruneBackups(dir: string, keep: number, prefix = "forecasting"): Promise<string[]> {
  if (keep < 0) throw new Error("keep must be >= 0");
  const backups = await listBackups(dir, prefix);
  const stale = backups.slice(0, Math.max(0, backups.length - keep));
  for (const path of stale) {
    await rm(path, { force: true });
  }
  return stale;
}

/** Имя файла копии по дате: `forecasting-YYYY-MM-DD.sqlite`. */
export function backupFileName(day: string, prefix = "forecasting"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`day must be ISO YYYY-MM-DD, got: ${day}`);
  }
  return `${prefix}-${day}.sqlite`;
}
