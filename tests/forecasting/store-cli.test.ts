// Этап 1: фасад хранилища и CLI базы.
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, closeDatabase } from "../../src/forecasting/storage/sqlite/connection";
import { openStore } from "../../src/forecasting/storage/sqlite/store";

const CLI = join(import.meta.dir, "..", "..", "src", "forecasting", "cli", "db.ts");
const AT = "2026-11-23T10:00:00.000Z";

const tmpDir = () => mkdtemp(join(tmpdir(), "dds-fc-cli-"));

function runCli(args: string[]) {
  const proc = Bun.spawnSync({ cmd: ["bun", CLI, ...args], cwd: join(import.meta.dir, "..", ".."), stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

describe("openStore", () => {
  test("открывает базу, применяет миграции при открытии и отдаёт все репозитории", async () => {
    const path = join(await tmpDir(), "store.sqlite");
    const store = await openStore(path);
    try {
      expect(store.migration!.applied).toEqual([1]);
      const info = store.info();
      expect(info.integrity).toBe("ok");
      expect(info.isWal).toBe(true);
      expect(info.tables).toContain("daily_metrics");
      expect(store.raw).toBeDefined();
      expect(store.metrics).toBeDefined();
      expect(store.features).toBeDefined();
      expect(store.events).toBeDefined();
      expect(store.forecast).toBeDefined();

      // репозитории из хранилища работают с уже применённой схемой
      store.db.query("INSERT INTO shops (shop_no, name, created_at) VALUES (?, ?, ?)").run("7745", "7745ДС", AT);
      const runId = store.raw.createRun({ started_at: AT, mode: "test", shop_no: "7745" });
      expect(store.raw.getRun(runId)!.mode).toBe("test");
    } finally {
      store.close();
    }
  });

  test("migrateOnOpen: false оставляет базу пустой", async () => {
    const path = join(await tmpDir(), "bare.sqlite");
    const store = await openStore(path, { migrateOnOpen: false });
    try {
      expect(store.migration).toBeUndefined();
      expect(store.info().tables).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("хранилище только для чтения не применяет миграции", async () => {
    const path = join(await tmpDir(), "ro.sqlite");
    const rw = await openDatabase(path);
    closeDatabase(rw);
    const store = await openStore(path, { readonly: true, create: false });
    try {
      expect(store.info().tables).toEqual([]);
    } finally {
      store.close();
    }
  });
});

describe("CLI базы", () => {
  test("полный цикл migrate → info → check → backup → restore", async () => {
    const dir = await tmpDir();
    const dbPath = join(dir, "forecasting.sqlite");
    const backupPath = join(dir, "backups", "backup.sqlite");

    const migrate = runCli(["migrate", "--db", dbPath]);
    expect(migrate.code).toBe(0);
    const migrateOut = JSON.parse(migrate.stdout);
    expect(migrateOut.applied).toEqual([1]);
    expect(migrateOut.secondRunApplied).toEqual([]); // идемпотентность
    expect(migrateOut.pendingBefore).toEqual([1]);

    // добавляем данные напрямую и затем снимаем копию
    const db = await openDatabase(dbPath);
    db.query("INSERT INTO shops (shop_no, name, created_at) VALUES (?, ?, ?)").run("7745", "7745ДС", AT);
    closeDatabase(db);

    const info = runCli(["info", "--db", dbPath]);
    expect(info.code).toBe(0);
    expect(JSON.parse(info.stdout).pragmas.journalMode.toLowerCase()).toBe("wal");

    const check = runCli(["check", "--db", dbPath]);
    expect(check.code).toBe(0);
    expect(JSON.parse(check.stdout).ok).toBe(true);

    const backup = runCli(["backup", "--db", dbPath, "--out", backupPath]);
    expect(backup.code).toBe(0);
    expect(JSON.parse(backup.stdout).integrity).toBe("ok");

    const restore = runCli(["restore", "--from", backupPath, "--db", dbPath, "--force"]);
    expect(restore.code).toBe(0);
    const restored = JSON.parse(restore.stdout);
    expect(restored.verification.integrity).toBe("ok");
    expect(restored.restore.replacedExisting).toBe(true);

    const after = runCli(["check", "--db", dbPath]);
    expect(after.code).toBe(0);
    expect(JSON.parse(after.stdout).ok).toBe(true);
  });

  test("ошибки аргументов и неизвестные команды дают код возврата 2", async () => {
    expect(runCli([]).code).toBe(2);
    expect(runCli(["nonsense"]).code).toBe(2);
    expect(runCli(["restore"]).code).toBe(2);
    expect(runCli(["prune"]).code).toBe(2);
    expect(runCli(["--bad-flag"]).code).toBe(2);
  });

  test("check возвращает код 1, когда схема отсутствует", async () => {
    const dir = await tmpDir();
    const result = runCli(["check", "--db", join(dir, "empty.sqlite")]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).ok).toBe(false);
  });

  test("prune оставляет заданное число копий", async () => {
    const dir = await tmpDir();
    const dbPath = join(dir, "f.sqlite");
    const backups = join(dir, "backups");
    expect(runCli(["migrate", "--db", dbPath]).code).toBe(0);
    for (const name of ["a", "b", "c"]) {
      expect(runCli(["backup", "--db", dbPath, "--out", join(backups, `forecasting-2026-11-0${name === "a" ? 1 : name === "b" ? 2 : 3}.sqlite`)]).code).toBe(0);
    }
    const prune = runCli(["prune", "--dir", backups, "--keep", "1"]);
    expect(prune.code).toBe(0);
    expect(JSON.parse(prune.stdout).removed.length).toBe(2);
    expect(JSON.parse(prune.stdout).remaining.length).toBe(1);
  });
});
