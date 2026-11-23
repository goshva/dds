// Этап 1: резервное копирование, проверка копии, восстановление и хранение копий.
import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  backupDatabase,
  backupFileName,
  listBackups,
  pruneBackups,
  restoreDatabase,
  verifyBackup,
} from "../../src/forecasting/storage/sqlite/backup";
import { closeDatabase, openDatabase } from "../../src/forecasting/storage/sqlite/connection";
import { applyMigrations, loadMigrations } from "../../src/forecasting/storage/sqlite/migrations";

const AT = "2026-11-23T10:00:00.000Z";

async function makeSeededDb(marker: number) {
  const dir = await mkdtemp(join(tmpdir(), "dds-fc-backup-"));
  const path = join(dir, "forecasting.sqlite");
  const db = await openDatabase(path);
  applyMigrations(db, await loadMigrations());
  db.query("INSERT INTO shops (shop_no, name, created_at) VALUES (?, ?, ?)").run("7745", "7745ДС", AT);
  db.query(
    `INSERT INTO daily_metrics
       (shop_no, date, slice_id, dimension_1, dimension_2, metric, metric_kind, value, evidence_status, data_status, transform_version, loaded_at)
     VALUES ('7745','2026-11-01',20403,'','','qty_orders_delivered','additive',?,'actual','full','v1',?)`,
  ).run(marker, AT);
  return { dir, path, db };
}

describe("backupDatabase", () => {
  test("создаёт проверяемый снимок, не затрагивая исходную базу", async () => {
    const { dir, db } = await makeSeededDb(1452);
    try {
      const target = join(dir, "backups", backupFileName("2026-11-23"));
      const result = await backupDatabase(db, target);

      expect(result.integrity).toBe("ok");
      expect(result.bytes).toBeGreaterThan(0);
      expect(await Bun.file(target).exists()).toBe(true);

      const verification = await verifyBackup(target);
      expect(verification.integrity).toBe("ok");
      expect(verification.tables).toBeGreaterThanOrEqual(13);

      // исходная база остаётся рабочей после снятия снимка
      const value = db.query("SELECT value FROM daily_metrics").get() as { value: number };
      expect(value.value).toBe(1452);
    } finally {
      closeDatabase(db);
    }
  });

  test("отказывается перезаписывать существующий файл копии", async () => {
    const { dir, db } = await makeSeededDb(1);
    try {
      const target = join(dir, "dup.sqlite");
      await backupDatabase(db, target);
      await expect(backupDatabase(db, target)).rejects.toThrow(/already exists/);
    } finally {
      closeDatabase(db);
    }
  });

  test("отклоняет путь с кавычкой вместо построения сломанного SQL", async () => {
    const { dir, db } = await makeSeededDb(1);
    try {
      await expect(backupDatabase(db, join(dir, "we'ird.sqlite"))).rejects.toThrow(/single quote/);
    } finally {
      closeDatabase(db);
    }
  });

  test("backupFileName проверяет формат даты", () => {
    expect(backupFileName("2026-11-23")).toBe("forecasting-2026-11-23.sqlite");
    expect(() => backupFileName("23.11.2026")).toThrow(/ISO/);
  });
});

describe("restoreDatabase", () => {
  test("восстанавливает содержимое снимка и сообщает о замене", async () => {
    const { dir, path, db } = await makeSeededDb(1452);
    const backup = join(dir, "snap.sqlite");
    try {
      await backupDatabase(db, backup);
      // меняем рабочую базу уже после снятия снимка
      db.query("UPDATE daily_metrics SET value = 9999").run();
      db.query("INSERT INTO shops (shop_no, name, created_at) VALUES ('9999','temp',?)").run(AT);
      closeDatabase(db);

      const restored = await restoreDatabase(backup, path, { overwrite: true });
      expect(restored.replacedExisting).toBe(true);
      expect(restored.integrity).toBe("ok");

      const check = await openDatabase(path, { create: false });
      try {
        expect((check.query("SELECT value FROM daily_metrics").get() as { value: number }).value).toBe(1452);
        expect((check.query("SELECT COUNT(*) AS c FROM shops").get() as { c: number }).c).toBe(1);
      } finally {
        closeDatabase(check);
      }
    } finally {
      await Bun.file(path).exists().catch(() => false);
    }
  });

  test("отказывается перезаписывать без флага и отвергает отсутствующий источник", async () => {
    const { dir, path, db } = await makeSeededDb(7);
    const backup = join(dir, "snap2.sqlite");
    try {
      await backupDatabase(db, backup);
      closeDatabase(db);
      await expect(restoreDatabase(backup, path)).rejects.toThrow(/pass overwrite/);
      await expect(restoreDatabase(join(dir, "nope.sqlite"), path, { overwrite: true })).rejects.toThrow(/not found/);
      await expect(restoreDatabase(backup, backup, { overwrite: true })).rejects.toThrow(/must differ/);
    } finally {
      // соединений не осталось
    }
  });

  test("восстановленная база проходит проверки целостности и внешних ключей", async () => {
    const { dir, path, db } = await makeSeededDb(42);
    const backup = join(dir, "snap3.sqlite");
    try {
      await backupDatabase(db, backup);
      closeDatabase(db);
      await restoreDatabase(backup, path, { overwrite: true });
      const check = await openDatabase(path, { create: false });
      try {
        expect((check.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
        expect(check.query("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        closeDatabase(check);
      }
    } finally {
      // соединение уже закрыто выше
    }
  });
});

describe("хранение копий", () => {
  test("listBackups и pruneBackups оставляют N самых новых", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-fc-prune-"));
    const { db } = await makeSeededDb(1);
    try {
      for (const day of ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]) {
        await backupDatabase(db, join(dir, backupFileName(day)));
      }
      const all = await listBackups(dir);
      expect(all.length).toBe(4);
      expect(all[0]!.endsWith("forecasting-2026-11-01.sqlite")).toBe(true);

      const removed = await pruneBackups(dir, 2);
      expect(removed.length).toBe(2);
      const remaining = await listBackups(dir);
      expect(remaining.length).toBe(2);
      expect(remaining[1]!.endsWith("forecasting-2026-11-04.sqlite")).toBe(true);

      expect(await pruneBackups(dir, 5)).toEqual([]);
      expect((await readdir(dir)).length).toBe(2);
    } finally {
      closeDatabase(db);
    }
  });

  test("listBackups возвращает пустой список для отсутствующего каталога", async () => {
    expect(await listBackups(join(tmpdir(), "definitely-missing-dir-xyz"))).toEqual([]);
  });
});
