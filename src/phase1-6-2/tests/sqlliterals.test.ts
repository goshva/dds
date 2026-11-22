/**
 * Этап 1.6.2 — тесты извлечения SQL-литералов и read-only дисциплины.
 * Не обращается к сети и не пишет файлы.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractColumnLiterals } from "../sqlliterals";

const cols = ["delivery_type_group", "prop", "order_status", "pse_type", "id_service"];

describe("extractColumnLiterals", () => {
  test("IN со строковыми литералами", () => {
    const r = extractColumnLiterals("WHERE delivery_type_group IN ('Курьеры','Такси')", cols);
    expect(r).toEqual([
      { column: "delivery_type_group", value: "Курьеры", op: "IN" },
      { column: "delivery_type_group", value: "Такси", op: "IN" },
    ]);
  });

  test("NOT IN обрабатывается как IN", () => {
    const r = extractColumnLiterals("AND order_status NOT IN ('Отменён')", cols);
    expect(r).toEqual([{ column: "order_status", value: "Отменён", op: "IN" }]);
  });

  test("равенство с литералом", () => {
    const r = extractColumnLiterals("AND prop = 'date_supply'", cols);
    expect(r).toEqual([{ column: "prop", value: "date_supply", op: "=" }]);
  });

  test("подзапрос внутри IN не даёт значений", () => {
    const r = extractColumnLiterals("WHERE id_service IN (SELECT id FROM nsi.service)", cols);
    expect(r).toEqual([]);
  });

  test("Jinja-шаблоны не считаются литералами", () => {
    const r = extractColumnLiterals("WHERE id_service IN ({{ filter_values('id_service') }})", cols);
    expect(r).toEqual([]);
  });

  test("колонка вне датасета игнорируется", () => {
    const r = extractColumnLiterals("WHERE other_col = 'x'", cols);
    expect(r).toEqual([]);
  });

  test("комментарии вырезаются", () => {
    const r = extractColumnLiterals("-- prop = 'date_supply'\nSELECT 1", cols);
    expect(r).toEqual([]);
  });

  test("числовые литералы не считаются строковыми значениями", () => {
    const r = extractColumnLiterals("WHERE pse_type = '123'", cols);
    expect(r).toEqual([]);
  });

  test("слишком длинные значения отбрасываются", () => {
    const long = "x".repeat(120);
    const r = extractColumnLiterals(`WHERE pse_type = '${long}'`, cols);
    expect(r).toEqual([]);
  });

  test("префикс таблицы у колонки снимается", () => {
    const r = extractColumnLiterals("WHERE t.pse_type = 'ДаркКитчен'", cols);
    expect(r).toEqual([{ column: "pse_type", value: "ДаркКитчен", op: "=" }]);
  });
});

describe("read-only дисциплина", () => {
  const src = join(import.meta.dir, "..");

  test("bulk-клиент не содержит изменяющих HTTP-методов", () => {
    const code = readFileSync(join(src, "bulk.ts"), "utf8");
    expect(code).not.toMatch(/\bmethod:\s*["'](PUT|PATCH|DELETE)["']/i);
    // POST разрешён только для login
    const posts = [...code.matchAll(/method:\s*["']POST["']/gi)];
    expect(posts.length).toBe(1);
    expect(code).toMatch(/security\/login/);
  });

  test("sync не вызывает изменяющих эндпоинтов", () => {
    const code = readFileSync(join(src, "sync.ts"), "utf8");
    // createHash().update(...) — не SQL; SQL-ключевые слова в коде пишутся заглавными.
    expect(code).not.toMatch(/(?<!\.)\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/);
    expect(code).not.toMatch(/\/api\/v1\/[a-z_]+\/(post|put|delete)/i);
  });
});
