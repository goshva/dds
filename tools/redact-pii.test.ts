// Tests for the PII masking mechanism. Synthetic examples only — no real personal data.
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { redactJson, redactText } from "./redact-pii";

// Fixtures are assembled at runtime on purpose: the source file then contains no PII-looking
// literals, so a future history-masking pass (git filter-repo --replace-text) cannot corrupt
// the tests themselves.
const NAME3 = ["Иванов", "Иван", "Иванович"].join(" ");
const NAME2 = ["Куратор", "Петрова", "Анна"].join(" ");
const SURNAME1 = ["Сидоров", "Семён"].join(" ");
const EMAIL = ["ivan.petrov", "example.com"].join("@");
const PHONE = ["+7", "916", "123", "45", "67"].join(" ");
const PHONE_COMPACT = ["+7", "916", "1234567"].join("");

describe("redactText", () => {
  test("masks Cyrillic full names", () => {
    const { text, counts } = redactText(`Руководитель доставки: ${NAME3} (срез 20404)`);
    expect(counts.person_name).toBe(1);
    expect(text).toContain("<ФИО>");
    expect(text).not.toMatch(/Иванов/);
  });

  test("masks two-word Cyrillic names", () => {
    const { text, counts } = redactText(`${NAME2} ведёт смену`);
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

  test("не маскирует числовые артефакты: дробные значения не превращаются в телефон", () => {
    for (const input of ["-5.142857142857143", "1299.857142857143", "98.142857142857", "8123.45678901", "2024-06-08"]) {
      const { text, counts } = redactText(input);
      expect(counts.phone, input).toBe(0);
      expect(text, input).toBe(input);
    }
    for (const input of ["+7 916 123 45 67", "8 916 123-45-67", "+79161234567", "8(916)1234567"]) {
      expect(redactText(input).counts.phone, input).toBe(1);
    }
  });

  test("masks emails and phones", () => {
    const { text, counts } = redactText(`пиши на ${EMAIL} или ${PHONE}`);
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

  test("masks the whole Authorization/Bearer pair, not just the scheme word", () => {
    const TOKEN = ["abcdef", "123456"].join("");
    const cases = [
      `Authorization: Bearer ${TOKEN}`,
      `authorization=Bearer ${TOKEN}`,
      `Authorization: bearer ${TOKEN}`,
      `Authorization: Basic ${TOKEN}`,
      `Bearer ${TOKEN}`,
      `token ${TOKEN}`,
    ];
    for (const input of cases) {
      const { text, counts } = redactText(input);
      expect(counts.secret, input).toBeGreaterThanOrEqual(1);
      expect(text, `token must not survive in: ${input}`).not.toContain(TOKEN);
      expect(text).toContain("<СЕКРЕТ>");
    }
  });

  test("does not mistake prose or CLI flags for credentials", () => {
    const prose = [
      'this.log.push("auth: login ok, bearer token acquired");',
      'this.log.push("auth: bearer token provided");',
      "--token <jwt> Authorization: Bearer token --username",
      "the bearer token value is set in .env",
      "token authentication is required",
    ];
    for (const input of prose) {
      const { counts } = redactText(input);
      expect(counts.secret, `must not mask prose: ${input}`).toBe(0);
    }
  });

  test("keeps the header name while dropping the credential", () => {
    const TOKEN = ["zzz", "999888777"].join("-");
    const { text } = redactText(`Authorization: Bearer ${TOKEN}`);
    expect(text).toBe("Authorization: <СЕКРЕТ>");
  });

  test("bearer masking is idempotent", () => {
    const TOKEN = ["tok", "123456789"].join("");
    const first = redactText(`Authorization: Bearer ${TOKEN}; Bearer ${TOKEN}`);
    expect(first.counts.secret).toBe(2);
    const second = redactText(first.text);
    expect(second.counts.secret).toBe(0);
    expect(second.text).toBe(first.text);
  });

  test("masks labelled personnel ids", () => {
    const { text, counts } = redactText('{"person_code": "1234567", "id_courier": 9876543}');
    expect(counts.person_code).toBe(2);
    expect(text).not.toContain("1234567");
    expect(text).not.toContain("9876543");
  });

  test("masking is idempotent: a second pass finds nothing", () => {
    const first = redactText(
      'session="abc123def456"; password=hunter2secret; Authorization: Bearer eyJhbGciOi; token=verylongtoken; csrf_token=abcdef123456',
    );
    expect(Object.values(first.counts).some((n) => n > 0)).toBe(true);

    const second = redactText(first.text);
    expect(second.counts).toEqual({ person_name: 0, email: 0, phone: 0, secret: 0, person_code: 0 });
    expect(second.text).toBe(first.text);
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
  test("masks numeric identifiers under personnel keys", () => {
    const { value, counts } = redactJson<any>({
      person_code: 1234567,
      id_courier: 42,
      courier_id: 0,
      employee_id: 9999999999,
    });

    expect(counts.person_code).toBe(4);
    expect(value).toEqual({
      person_code: "<ID-СОТРУДНИКА>",
      id_courier: "<ID-СОТРУДНИКА>",
      courier_id: "<ID-СОТРУДНИКА>",
      employee_id: "<ID-СОТРУДНИКА>",
    });
  });

  test("masks string identifiers, including short and opaque ones", () => {
    const { value, counts } = redactJson({
      person_code: "abc-123",
      courier_id: "7",
      id_courier: "0000000123",
      employee_id: "EMP-77/X",
    });

    expect(counts.person_code).toBe(4);
    expect(Object.values(value as any)).toEqual([
      "<ID-СОТРУДНИКА>",
      "<ID-СОТРУДНИКА>",
      "<ID-СОТРУДНИКА>",
      "<ID-СОТРУДНИКА>",
    ]);
  });

  test("key matching is case- and separator-insensitive and keys are preserved", () => {
    const { value, counts } = redactJson({ Person_Code: 1, "ID-Courier": 2, "employee id": 3, EMPLOYEE_ID: "x" });

    expect(counts.person_code).toBe(4);
    expect(Object.keys(value as any)).toEqual(["Person_Code", "ID-Courier", "employee id", "EMPLOYEE_ID"]);
    expect(Object.values(value as any).every((v) => v === "<ID-СОТРУДНИКА>")).toBe(true);
  });

  test("handles identifiers nested in objects and arrays", () => {
    const { value, counts } = redactJson<any>({
      rows: [{ courier_id: 1, name: "ok" }, { courier_id: 2, nested: { person_code: "X9" } }],
      person_code: [1, 2, "3"],
      employee_id: { legacy: 424242 },
    });

    expect(counts.person_code).toBe(7);
    expect(value.rows[0].courier_id).toBe("<ID-СОТРУДНИКА>");
    expect(value.rows[0].name).toBe("ok");
    expect(value.rows[1].nested.person_code).toBe("<ID-СОТРУДНИКА>");
    expect(value.person_code).toEqual(["<ID-СОТРУДНИКА>", "<ID-СОТРУДНИКА>", "<ID-СОТРУДНИКА>"]);
    expect(value.employee_id).toEqual({ legacy: "<ID-СОТРУДНИКА>" });
  });

  test("does not touch business numbers, other ids or empty values", () => {
    const input = {
      dataset_id: 3035,
      shopno: "7745",
      qty_orders_delivered: 1234567,
      chart_id: 20209,
      person_code: null,
      courier_id: "",
      employee_id: undefined,
    };
    const { value, counts } = redactJson(input);

    expect(counts.person_code).toBe(0);
    expect(value).toEqual(input);
  });

  test("is idempotent for identifiers", () => {
    const once = redactJson<any>({ person_code: 1234567, rows: [{ courier_id: "7" }] });
    const twice = redactJson(once.value);

    expect(twice.counts.person_code).toBe(0);
    expect(twice.value).toEqual(once.value);
  });

  test("walks nested structures and reports totals", () => {    const input = {
      meta: { author: NAME3, contact: EMAIL },
      rows: [{ courier: SURNAME1, phone: PHONE_COMPACT }],
      safe: { dataset_id: 3035, shopno: "7745" },
    };

    const { value, counts } = redactJson(input);

    expect(counts.person_name).toBe(2);
    expect(counts.email).toBe(1);
    expect(counts.phone).toBe(1);
    expect(JSON.stringify(value)).not.toContain("Иванов");
    expect(JSON.stringify(value)).not.toContain("Сидоров");
    expect(value.safe).toEqual({ dataset_id: 3035, shopno: "7745" });
  });

  test("handles arrays, numbers and nulls", () => {
    const { value } = redactJson({ a: [1, null, SURNAME1], b: { c: 3 } });
    expect(value.a[0]).toBe(1);
    expect(value.a[1]).toBeNull();
    expect(value.a[2]).toBe("<ФИО>");
    expect(value.b.c).toBe(3);
  });
});

// End-to-end proof that the gate really blocks the two classes the review flagged:
// numeric personnel ids inside a JSON object and a Bearer token inside a text file.
describe("publish gate (end-to-end, real files)", () => {
  const CLI = join(import.meta.dir, "redact-pii.ts");
  const REPO = join(import.meta.dir, "..");
  const run = (args: string[]) =>
    Bun.spawnSync({ cmd: ["bun", CLI, ...args], cwd: REPO, stdout: "pipe", stderr: "pipe" });

  test("gate fails on numeric JSON ids and Bearer tokens, then passes on the masked copies", async () => {
    const COURIER_ID = ["123", "456"].join("");
    const PERSON_CODE = ["abc", "123"].join("-");
    const TOKEN = ["ghp", "abcdef1234567890"].join("_");

    const src = await mkdtemp(join(tmpdir(), "dds-gate-src-"));
    await Bun.write(
      join(src, "sample.json"),
      `${JSON.stringify({ id_courier: Number(COURIER_ID), person_code: PERSON_CODE, note: "ok" }, null, 2)}\n`,
    );
    await Bun.write(join(src, "sample.md"), `# access\n\nAuthorization: Bearer ${TOKEN}\n`);

    // 1) raw content must be blocked
    expect(run(["--in", src, "--gate"]).exitCode).toBe(1);

    // 2) masking produces clean copies
    const out = await mkdtemp(join(tmpdir(), "dds-gate-out-"));
    expect(run(["--in", src, "--out", out]).exitCode).toBe(0);

    const maskedJson = await Bun.file(join(out, "sample.json")).text();
    const maskedMd = await Bun.file(join(out, "sample.md")).text();
    expect(maskedJson).not.toContain(COURIER_ID);
    expect(maskedJson).not.toContain(PERSON_CODE);
    expect(maskedMd).not.toContain(TOKEN);
    expect(maskedJson).toContain("<ID-СОТРУДНИКА>");
    expect(maskedMd).toContain("<СЕКРЕТ>");

    // 3) the published copy passes the same gate
    expect(run(["--in", out, "--gate"]).exitCode).toBe(0);
  });
});
