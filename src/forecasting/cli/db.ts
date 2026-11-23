#!/usr/bin/env bun
/**
 * CLI прогнозной базы (этап 1: фундамент).
 *
 *   bun src/forecasting/cli/db.ts migrate [--db <path>]
 *   bun src/forecasting/cli/db.ts info    [--db <path>]
 *   bun src/forecasting/cli/db.ts check   [--db <path>]
 *   bun src/forecasting/cli/db.ts backup  [--db <path>] --out <file>
 *   bun src/forecasting/cli/db.ts restore --from <file> [--db <path>] [--force]
 *   bun src/forecasting/cli/db.ts prune   --dir <dir> [--keep <n>]
 *
 * Коды возврата: 0 — успех, 1 — ошибка выполнения, 2 — ошибка аргументов.
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { backupDatabase, backupFileName, listBackups, pruneBackups, restoreDatabase, verifyBackup } from "../storage/sqlite/backup";
import { foreignKeyCheck, integrityCheck, openDatabase, closeDatabase } from "../storage/sqlite/connection";
import { applyMigrations, loadMigrations, pendingVersions } from "../storage/sqlite/migrations";

const DEFAULT_DB = "data/forecast/forecasting.sqlite";

interface Args {
  command: string;
  db: string;
  out?: string;
  from?: string;
  dir?: string;
  keep?: number;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: argv[0] ?? "", db: DEFAULT_DB, force: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--db": args.db = next(); break;
      case "--out": args.out = next(); break;
      case "--from": args.from = next(); break;
      case "--dir": args.dir = next(); break;
      case "--keep": args.keep = Number.parseInt(next(), 10); break;
      case "--force": args.force = true; break;
      default: throw new Error(`unknown option: ${a}`);
    }
  }
  return args;
}

function usage(): string {
  return [
    "usage: bun src/forecasting/cli/db.ts <migrate|info|check|backup|restore|prune> [options]",
    `  --db <path>     database path (default ${DEFAULT_DB})`,
    "  --out <file>    backup target (backup)",
    "  --from <file>   backup source (restore)",
    "  --dir <dir>     backup directory (prune)",
    "  --keep <n>      backups to keep (prune)",
    "  --force         overwrite the restore target",
  ].join("\n");
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`[ERROR] ${String(error)}`);
    console.error(usage());
    return 2;
  }
  if (!args.command) {
    console.error(usage());
    return 2;
  }

  const dbPath = resolve(args.db);

  switch (args.command) {
    case "migrate": {
      const db = await openDatabase(dbPath);
      try {
        const migrations = await loadMigrations();
        const pending = pendingVersions(db, migrations);
        const report = applyMigrations(db, migrations);
        const final = applyMigrations(db, migrations);
        print({ db: dbPath, pendingBefore: pending, applied: report.applied, skipped: report.skipped, secondRunApplied: final.applied, total: report.total });
        return 0;
      } finally {
        closeDatabase(db);
      }
    }
    case "info": {
      const db = await openDatabase(dbPath);
      try {
        const migrations = await loadMigrations();
        print({
          db: dbPath,
          integrity: integrityCheck(db),
          foreignKeyViolations: foreignKeyCheck(db),
          pendingMigrations: pendingVersions(db, migrations),
          tables: (db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name),
          pragmas: {
            journalMode: (db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode,
            foreignKeys: (db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys,
            busyTimeout: (db.query("PRAGMA busy_timeout").get() as { timeout: number }).timeout,
          },
        });
        return 0;
      } finally {
        closeDatabase(db);
      }
    }
    case "check": {
      const db = await openDatabase(dbPath);
      try {
        const migrations = await loadMigrations();
        const integrity = integrityCheck(db);
        const violations = foreignKeyCheck(db);
        const pending = pendingVersions(db, migrations);
        const ok = integrity === "ok" && violations.length === 0 && pending.length === 0;
        print({ db: dbPath, ok, integrity, foreignKeyViolations: violations, pendingMigrations: pending });
        return ok ? 0 : 1;
      } finally {
        closeDatabase(db);
      }
    }
    case "backup": {
      const out = args.out ? resolve(args.out) : resolve(dirname(dbPath), "backups", backupFileName(new Date().toISOString().slice(0, 10)));
      const db = await openDatabase(dbPath, { create: false });
      try {
        await mkdir(dirname(out), { recursive: true });
        const result = await backupDatabase(db, out);
        print({ ...result, backups: await listBackups(dirname(out)) });
        return 0;
      } finally {
        closeDatabase(db);
      }
    }
    case "restore": {
      if (!args.from) {
        console.error("[ERROR] --from <file> is required for restore");
        return 2;
      }
      const verification = await verifyBackup(resolve(args.from));
      const result = await restoreDatabase(resolve(args.from), dbPath, { overwrite: args.force });
      print({ verification, restore: result });
      return 0;
    }
    case "prune": {
      if (!args.dir) {
        console.error("[ERROR] --dir <dir> is required for prune");
        return 2;
      }
      const removed = await pruneBackups(resolve(args.dir), args.keep ?? 14);
      print({ removed, remaining: await listBackups(resolve(args.dir)) });
      return 0;
    }
    default:
      console.error(`[ERROR] unknown command: ${args.command}`);
      console.error(usage());
      return 2;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
