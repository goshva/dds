// Этап 1: миграции — порядок, идемпотентность, детекция drift, ограничения схемы.
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase, tableNames } from "../../src/forecasting/storage/sqlite/connection";
import {
  appliedMigrations,
  applyMigrations,
  checksumOf,
  ensureMigrationTable,
  loadMigrations,
  pendingVersions,
  type Migration,
} from "../../src/forecasting/storage/sqlite/migrations";

const tmpDb = async () => join(await mkdtemp(join(tmpdir(), "dds-fc-mig-")), "db.sqlite");

const EXPECTED_TABLES = [
  "audit_log",
  "daily_metrics",
  "domain_events",
  "extraction_runs",
  "forecast_evaluations",
  "forecast_features",
  "forecast_results",
  "forecast_runs",
  "raw_extractions",
  "scenario_results",
  "scenarios",
  "schema_migrations",
  "shops",
];

describe("loadMigrations", () => {
  test("загружает штатную миграцию 001_init со стабильной контрольной суммой", async () => {
    const migrations = await loadMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    expect(migrations[0]!.version).toBe(1);
    expect(migrations[0]!.name).toBe("init");
    expect(migrations[0]!.checksum).toBe(checksumOf(migrations[0]!.sql));
    expect(migrations[0]!.checksum.length).toBe(64);
  });

  test("отклоняет дубли версий и некорректные имена файлов", async () => {    const db = await openDatabase(await tmpDb());
    try {
      const dir = await mkdtemp(join(tmpdir(), "dds-fc-migdir-"));
      await Bun.write(join(dir, "001_a.sql"), "SELECT 1;");
      await Bun.write(join(dir, "001_b.sql"), "SELECT 1;");
      await expect(loadMigrations(dir)).rejects.toThrow(/duplicate migration versions/);

      const dir2 = await mkdtemp(join(tmpdir(), "dds-fc-migdir2-"));
      await Bun.write(join(dir2, "init.sql"), "SELECT 1;");
      await expect(loadMigrations(dir2)).rejects.toThrow(/must look like/);
    } finally {
      closeDatabase(db);
    }
  });

  test("отклоняет не-строковый аргумент вместо падения внутри readdir", async () => {
    await expect(loadMigrations([] as unknown as string)).rejects.toThrow(/expects a directory path/);
  });
});

describe("applyMigrations", () => {
  test("применяется к чистой базе и создаёт все таблицы этапа 1", async () => {
    const path = await tmpDb();
    const db = await openDatabase(path);
    try {
      const migrations = await loadMigrations();
      expect(pendingVersions(db, migrations)).toEqual([1]);

      const report = applyMigrations(db, migrations, "2026-11-23T00:00:00.000Z");
      expect(report.applied).toEqual([1]);
      expect(report.skipped).toEqual([]);
      expect(report.total).toBe(migrations.length);

      expect(tableNames(db)).toEqual(EXPECTED_TABLES);
      const applied = appliedMigrations(db);
      expect(applied.length).toBe(1);
      expect(applied[0]!.applied_at).toBe("2026-11-23T00:00:00.000Z");
      expect(pendingVersions(db, migrations)).toEqual([]);
    } finally {
      closeDatabase(db);
    }
  });

  test("идемпотентна: повторный прогон ничего не применяет", async () => {
    const db = await openDatabase(await tmpDb());
    try {
      const migrations = await loadMigrations();
      applyMigrations(db, migrations);
      const second = applyMigrations(db, migrations);
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual([1]);
      expect(appliedMigrations(db).length).toBe(1);
    } finally {
      closeDatabase(db);
    }
  });

  test("обнаруживает изменённую уже применённую миграцию (drift)", async () => {
    const db = await openDatabase(await tmpDb());
    try {
      const migrations = await loadMigrations();
      applyMigrations(db, migrations);

      const tampered: Migration[] = [{ ...migrations[0]!, sql: `${migrations[0]!.sql}\n-- changed`, checksum: checksumOf(`${migrations[0]!.sql}\n-- changed`) }];
      expect(() => applyMigrations(db, tampered)).toThrow(/migration drift/);
    } finally {
      closeDatabase(db);
    }
  });

  test("упавшая миграция откатывается и не регистрируется", async () => {
    const db = await openDatabase(await tmpDb());
    try {
      ensureMigrationTable(db);
      const broken: Migration[] = [
        { version: 7, name: "broken", sql: "CREATE TABLE ok_table (a INTEGER); CREATE TABLE bad (;", checksum: "deadbeef" },
      ];
      expect(() => applyMigrations(db, broken)).toThrow(/migration 7 \(broken\) failed/);
      expect(tableNames(db)).not.toContain("ok_table");
      expect(appliedMigrations(db).length).toBe(0);
    } finally {
      closeDatabase(db);
    }
  });
});

describe("ограничения схемы (001_init)", () => {
  const seedShop = (db: Awaited<ReturnType<typeof openDatabase>>) =>
    db.query("INSERT INTO shops (shop_no, name, created_at) VALUES (?, ?, ?)").run("7745", "7745ДС", "2026-11-23T00:00:00.000Z");

  test("внешние ключи проверяются", async () => {
    const db = await openDatabase(await tmpDb());
    try {
      applyMigrations(db, await loadMigrations());
      expect(() =>
        db
          .query(
            `INSERT INTO daily_metrics
               (shop_no, date, slice_id, dimension_1, dimension_2, metric, metric_kind, value, evidence_status, data_status, transform_version, loaded_at)
             VALUES ('9999','2026-11-01',20403,'','','qty_orders_delivered','additive',10,'actual','full','v1','2026-11-23T00:00:00.000Z')`,
          )
          .run(),
      ).toThrow(/FOREIGN KEY/);
    } finally {
      closeDatabase(db);
    }
  });

  test("CHECK-ограничения отклоняют недопустимые статусы и даты не в ISO", async () => {
    const db = await openDatabase(await tmpDb());
    try {
      applyMigrations(db, await loadMigrations());
      seedShop(db);

      const insert = (over: Partial<Record<string, string>> = {}) => {
        const row: Record<string, string> = {
          date: "2026-11-01",
          metric_kind: "additive",
          evidence_status: "actual",
          data_status: "full",
          ...over,
        };
        db.query(
          `INSERT INTO daily_metrics
             (shop_no, date, slice_id, dimension_1, dimension_2, metric, metric_kind, value, evidence_status, data_status, transform_version, loaded_at)
           VALUES ('7745', ?, 20403, '', '', 'm', ?, 1, ?, ?, 'v1', '2026-11-23T00:00:00.000Z')`,
        ).run(row.date!, row.metric_kind!, row.evidence_status!, row.data_status!);
      };

      expect(() => insert({ date: "01.11.2026" })).toThrow(/CHECK/);
      expect(() => insert({ metric_kind: "counter" })).toThrow(/CHECK/);
      expect(() => insert({ evidence_status: "guessed" })).toThrow(/CHECK/);
      expect(() => insert({ data_status: "ok" })).toThrow(/CHECK/);
    } finally {
      closeDatabase(db);
    }
  });

  test("natural key daily_metrics не содержит run_id (одно наблюдение нельзя задублировать)", async () => {
    const db = await openDatabase(await tmpDb());
    try {
      applyMigrations(db, await loadMigrations());
      seedShop(db);
      const run = db
        .query("INSERT INTO extraction_runs (started_at, mode, shop_no, status) VALUES (?, ?, ?, ?)")
        .run("2026-11-23T00:00:00.000Z", "test", "7745", "completed");

      const insert = (runId: number) =>
        db
          .query(
            `INSERT INTO daily_metrics
               (shop_no, date, slice_id, dimension_1, dimension_2, metric, metric_kind, value, evidence_status, data_status, run_id, transform_version, loaded_at)
             VALUES ('7745','2026-11-01',20403,'','','qty_orders_delivered','additive',10,'actual','full',?,'v1','2026-11-23T00:00:00.000Z')`,
          )
          .run(runId);

      insert(Number(run.lastInsertRowid));
      // другой запуск НЕ должен создавать вторую строку для того же наблюдения
      expect(() => insert(Number(run.lastInsertRowid))).toThrow(/UNIQUE/);
      expect((db.query("SELECT COUNT(*) AS c FROM daily_metrics").get() as { c: number }).c).toBe(1);
    } finally {
      closeDatabase(db);
    }
  });

  test("уникальность domain_events считает пустой planned_start значением, а не NULL", async () => {
    const db = await openDatabase(await tmpDb());
    try {
      applyMigrations(db, await loadMigrations());
      seedShop(db);
      const insert = (planned: string | null) =>
        db
          .query(
            `INSERT INTO domain_events (shop_no, event_type, planned_start, status, evidence_status)
             VALUES ('7745','rate_change',?, 'planned','planned')`,
          )
          .run(planned);

      insert(null);
      expect(() => insert(null)).toThrow(/UNIQUE/);
      insert("2026-11-25T09:00:00.000Z");
      expect(() => insert("2026-11-25T09:00:00.000Z")).toThrow(/UNIQUE/);
    } finally {
      closeDatabase(db);
    }
  });
});
