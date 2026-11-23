// Этап 1: подключение, PRAGMA, транзакции, проверка целостности.
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  REQUIRED_PRAGMAS,
  checkpointWal,
  closeDatabase,
  databaseInfo,
  foreignKeyCheck,
  inTransaction,
  integrityCheck,
  openDatabase,
  tableNames,
  withTransaction,
} from "../../src/forecasting/storage/sqlite/connection";

const tmpDb = async (name = "conn.sqlite") => join(await mkdtemp(join(tmpdir(), "dds-fc-conn-")), name);

describe("openDatabase", () => {
  test("создаёт файл вместе с родительскими каталогами и применяет обязательные PRAGMA", async () => {
    const path = await tmpDb("nested/dir/db.sqlite");
    const db = await openDatabase(path);
    try {
      const info = databaseInfo(db, path);
      expect(info.journalMode.toLowerCase()).toBe(REQUIRED_PRAGMAS.journalMode.toLowerCase());
      expect(info.isWal).toBe(true);
      expect(info.foreignKeys).toBe(true);
      expect(info.busyTimeoutMs).toBe(REQUIRED_PRAGMAS.busyTimeoutMs);
      expect(Number(info.tempStore)).toBe(2); // 2 — это MEMORY
      expect(info.integrity).toBe("ok");
      expect(await Bun.file(path).exists()).toBe(true);
    } finally {
      closeDatabase(db);
    }
  });

  test("учитывает заданный busy_timeout", async () => {
    const db = await openDatabase(await tmpDb(), { busyTimeoutMs: 1234 });
    try {
      expect(databaseInfo(db, ":x:").busyTimeoutMs).toBe(1234);
    } finally {
      closeDatabase(db);
    }
  });

  test(":memory: работает и сообщает, что WAL недоступен", async () => {
    const db = await openDatabase(":memory:");
    try {
      const info = databaseInfo(db, ":memory:");
      expect(info.isWal).toBe(false);
      expect(info.journalMode.toLowerCase()).toBe("memory");
      expect(info.integrity).toBe("ok");
    } finally {
      closeDatabase(db);
    }
  });

  test("соединение только для чтения отклоняет запись", async () => {
    const path = await tmpDb();
    const rw = await openDatabase(path);
    rw.exec("CREATE TABLE t (a INTEGER)");
    closeDatabase(rw);

    const ro = await openDatabase(path, { readonly: true, create: false });
    try {
      expect(() => ro.exec("INSERT INTO t (a) VALUES (1)")).toThrow();
    } finally {
      closeDatabase(ro);
    }
  });
});

describe("транзакции", () => {
  test("фиксирует при успехе и откатывает при ошибке", async () => {
    const db = await openDatabase(await tmpDb());
    try {
      db.exec("CREATE TABLE t (a INTEGER)");

      const value = withTransaction(db, () => {
        db.query("INSERT INTO t (a) VALUES (?)").run(1);
        expect(inTransaction(db)).toBe(true);
        return "done";
      });
      expect(value).toBe("done");
      expect(inTransaction(db)).toBe(false);
      expect((db.query("SELECT COUNT(*) AS c FROM t").get() as { c: number }).c).toBe(1);

      expect(() =>
        withTransaction(db, () => {
          db.query("INSERT INTO t (a) VALUES (?)").run(2);
          throw new Error("boom");
        }),
      ).toThrow("boom");
      expect((db.query("SELECT COUNT(*) AS c FROM t").get() as { c: number }).c).toBe(1);
      expect(inTransaction(db)).toBe(false);
    } finally {
      closeDatabase(db);
    }
  });

  test("вложенный withTransaction запрещён", async () => {
    const db = await openDatabase(await tmpDb());
    try {
      db.exec("BEGIN IMMEDIATE");
      expect(() => withTransaction(db, () => 1)).toThrow(/already open/);
      db.exec("ROLLBACK");
    } finally {
      closeDatabase(db);
    }
  });
});

describe("диагностика", () => {
  test("integrityCheck, foreignKeyCheck, tableNames и checkpointWal работают корректно", async () => {
    const db = await openDatabase(await tmpDb());
    try {
      db.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY)");
      db.exec("CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent (id))");
      expect(integrityCheck(db)).toBe("ok");
      expect(foreignKeyCheck(db)).toEqual([]);
      expect(tableNames(db)).toEqual(["child", "parent"]);

      db.exec("PRAGMA foreign_keys = OFF"); // имитируем «сиротскую» строку из старых данных
      db.query("INSERT INTO child (parent_id) VALUES (?)").run(999);
      db.exec("PRAGMA foreign_keys = ON");
      expect(foreignKeyCheck(db).length).toBe(1);

      const checkpoint = checkpointWal(db);
      expect(checkpoint).not.toBeNull();
    } finally {
      closeDatabase(db);
    }
  });
});
