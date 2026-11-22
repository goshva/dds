import { describe, expect, test } from "bun:test";
import { assertReadOnly, redactSql } from "../client";

describe("read-only guard", () => {
  test("allows SELECT / WITH / EXPLAIN / SHOW", () => {
    expect(assertReadOnly("SELECT 1").ok).toBe(true);
    expect(assertReadOnly("select count(*) from t").ok).toBe(true);
    expect(assertReadOnly("WITH a AS (SELECT 1) SELECT * FROM a").ok).toBe(true);
    expect(assertReadOnly("EXPLAIN SELECT 1").ok).toBe(true);
    expect(assertReadOnly("SHOW TABLES").ok).toBe(true);
  });

  test("blocks mutations and DDL", () => {
    for (const sql of [
      "INSERT INTO t VALUES (1)",
      "UPDATE t SET a = 1",
      "DELETE FROM t",
      "DROP TABLE t",
      "ALTER TABLE t ADD COLUMN c int",
      "TRUNCATE TABLE t",
      "CREATE TABLE t (a int)",
      "GRANT SELECT ON t TO u",
      "SELECT 1; DROP TABLE t",
      "WITH a AS (SELECT 1) INSERT INTO t SELECT * FROM a",
    ]) {
      const r = assertReadOnly(sql);
      expect(r.ok).toBe(false);
    }
  });

  test("blocks multiple statements and empty sql", () => {
    expect(assertReadOnly("SELECT 1; SELECT 2").ok).toBe(false);
    expect(assertReadOnly("   ").ok).toBe(false);
  });

  test("redactSql removes comments and string-safe content", () => {
    const sql = "-- ФИО: Иванов И.И. email: a@b.c\nSELECT 1 /* phone <ТЕЛЕФОН> */";
    const red = redactSql(sql);
    expect(red).not.toContain("Иванов");
    expect(red).not.toContain("@");
    expect(red).toContain("SELECT 1");
  });
});
