// Tests for the PII masking mechanism. Synthetic examples only — no real personal data.
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { redactJson, redactText } from "./redact-pii";

describe("redactText", () => {
  test("masks Cyrillic full names", () => {
    const { text, counts } = redactText("Руководитель доставки: <ФИО> (срез 20404)");
    expect(counts.person_name).toBe(1);
    expect(text).toContain("<ФИО>");
    expect(text).not.toMatch(/Иванов/);
  });

  test("masks two-word Cyrillic names", () => {
    const { text, counts } = redactText("<ФИО> ведёт смену");
    expect(counts.person_name).toBe(1);
    expect(text).not.toMatch(/Петрова/);
  });

  test("masks Latin names but keeps SQL keywords", () => {
    const latin = redactText("owner Ivan Petrov reported");
    expect(latin.counts.person_name).toBe(1);
    const sql = redactText("SELECT a FROM t GROUP BY a ORDER BY a");
    expect(sql.counts.person_name).toBe(0);
    expect(sql.text).toContain("GROUP BY");
  });

  test("masks emails and phones", () => {
    const { text, counts } = redactText("пиши на <EMAIL> или <ТЕЛЕФОН>");
    expect(counts.email).toBe(1);
    expect(counts.phone).toBe(1);
    expect(text).toContain("<EMAIL>");
    expect(text).toContain("<ТЕЛЕФОН>");
  });

  test("masks secret values but keeps the key", () => {
    const { text, counts } = redactText('session="abc123def456"; password=hunter2secret; Authorization: Bearer eyJhbGciOi');
    expect(counts.secret).toBeGreaterThanOrEqual(2);
    expect(text).toContain("session=");
    expect(text).not.toContain("abc123def456");
    expect(text).not.toContain("hunter2secret");
  });

  test("masks labelled personnel ids", () => {
    const { text, counts } = redactText('{"person_code": "1234567", "id_courier": 9876543}');
    expect(counts.person_code).toBe(2);
    expect(text).not.toContain("1234567");
    expect(text).not.toContain("9876543");
  });

  test("keeps business identifiers, metric names and darkstore names intact", () => {
    const sample = "7745ДС_Мосфильмовская74 | Доставка по слотам | share_not_in_slot_all | 2026-11-10 | dataset_id=3035";
    const { text, counts } = redactText(sample);
    expect(counts.person_name).toBe(0);
    expect(counts.phone).toBe(0);
    expect(text).toBe(sample);
  });

  test("does not touch a lone capitalised word", () => {
    const { counts } = redactText("ВкусВильчик и Ночная доставка");
    expect(counts.person_name).toBe(0);
  });
});

describe("redactJson", () => {
  test("walks nested structures and reports totals", () => {
    const input = {
      meta: { author: "<ФИО>", contact: "<EMAIL>" },
      rows: [{ courier: "<ФИО>", phone: "<ТЕЛЕФОН>" }],
      safe: { dataset_id: 3035, shopno: "7745" },
    };

    const { value, counts } = redactJson(input);

    expect(counts.person_name).toBe(2);
    expect(counts.email).toBe(1);
    expect(counts.phone).toBe(1);
    expect(JSON.stringify(value)).not.toContain("Иванов");
    expect(JSON.stringify(value)).not.toContain("Петров");
    expect(value.safe).toEqual({ dataset_id: 3035, shopno: "7745" });
  });

  test("handles arrays, numbers and nulls", () => {
    const { value } = redactJson({ a: [1, null, "<ФИО>"], b: { c: 3 } });
    expect(value.a[0]).toBe(1);
    expect(value.a[1]).toBeNull();
    expect(value.a[2]).toBe("<ФИО>");
    expect(value.b.c).toBe(3);
  });
});
