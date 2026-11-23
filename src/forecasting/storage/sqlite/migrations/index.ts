/**
 * Последовательные миграции SQLite с проверкой контрольных сумм.
 *
 * - миграции лежат в `./sql/NNN_name.sql` и применяются в порядке имени файла;
 * - каждая миграция выполняется в собственной транзакции;
 * - `schema_migrations` хранит версию, имя, контрольную сумму и время применения;
 * - повторное применение ничего не делает (идемпотентность);
 * - если SQL уже применённой версии изменился — это жёсткая ошибка (детекция drift).
 */

import { Database } from "bun:sqlite";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
  applied_at: string;
}

export interface MigrationReport {
  applied: number[];
  skipped: number[];
  total: number;
}

const DEFAULT_SQL_DIR = join(import.meta.dir, "sql");

export function checksumOf(sql: string): string {
  return new Bun.CryptoHasher("sha256").update(sql).digest("hex");
}

/** Загружает файлы `NNN_name.sql` из каталога, сортируя по числовому префиксу. */
export async function loadMigrations(dir: string = DEFAULT_SQL_DIR): Promise<Migration[]> {
  if (typeof dir !== "string" || !dir) {
    throw new Error("loadMigrations expects a directory path; use applyMigrations(db, migrations) for pre-loaded migrations");
  }
  const entries = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const migrations: Migration[] = [];
  for (const file of entries) {
    const match = file.match(/^(\d+)[_-](.+)\.sql$/);
    if (!match) {
      throw new Error(`migration file name must look like 001_init.sql, got: ${file}`);
    }
    const sql = await readFile(join(dir, file), "utf8");
    migrations.push({
      version: Number.parseInt(match[1]!, 10),
      name: match[2]!,
      sql,
      checksum: checksumOf(sql),
    });
  }
  const versions = migrations.map((m) => m.version);
  if (new Set(versions).size !== versions.length) {
    throw new Error(`duplicate migration versions: ${versions.join(", ")}`);
  }
  return migrations.sort((a, b) => a.version - b.version);
}

export function ensureMigrationTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

export function appliedMigrations(db: Database): AppliedMigration[] {
  ensureMigrationTable(db);
  return db
    .query("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version")
    .all() as AppliedMigration[];
}

/**
 * Применяет все неприменённые миграции.
 * Бросает исключение, если контрольная сумма уже применённой миграции отличается от файла на диске.
 */
export function applyMigrations(db: Database, migrations: Migration[], now = new Date().toISOString()): MigrationReport {
  ensureMigrationTable(db);
  const applied = new Map<number, AppliedMigration>(appliedMigrations(db).map((m) => [m.version, m]));
  const report: MigrationReport = { applied: [], skipped: [], total: migrations.length };

  for (const migration of migrations) {
    const existing = applied.get(migration.version);
    if (existing) {
      if (existing.checksum !== migration.checksum) {
        throw new Error(
          `migration drift: version ${migration.version} (${migration.name}) was applied with checksum ` +
            `${existing.checksum.slice(0, 12)}… but the file now has ${migration.checksum.slice(0, 12)}…`,
        );
      }
      report.skipped.push(migration.version);
      continue;
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.query("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)").run(
        migration.version,
        migration.name,
        migration.checksum,
        now,
      );
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // сохраняем исходную ошибку
      }
      throw new Error(`migration ${migration.version} (${migration.name}) failed: ${String(error)}`);
    }
    report.applied.push(migration.version);
  }

  return report;
}

/** Удобная обёртка: загрузить с диска и применить. */
export async function migrate(db: Database, dir: string = DEFAULT_SQL_DIR): Promise<MigrationReport> {
  return applyMigrations(db, await loadMigrations(dir));
}

export function pendingVersions(db: Database, migrations: Migration[]): number[] {
  const applied = new Set(appliedMigrations(db).map((m) => m.version));
  return migrations.filter((m) => !applied.has(m.version)).map((m) => m.version);
}
