import { describe, expect, test } from "bun:test";
import { GRAIN_OVERRIDES, priority, safeDatasetMetadata, scanPii } from "../lib";

describe("redaction and PII", () => {
  test("safeDatasetMetadata excludes owners/changed_by/contacts", () => {
    const raw = {
      id: 1,
      table_name: "t",
      sql: "select 1",
      owners: [{ first_name: "Ivan", last_name: "Petrov", email: "ivan@example.com" }],
      changed_by: { first_name: "Ivan" },
      columns: [{ column_name: "phone", type: "STRING", description: null }],
      metrics: [],
    };
    const meta = safeDatasetMetadata(raw);
    const text = JSON.stringify(meta);
    expect(text.includes("owners")).toBe(false);
    expect(text.includes("changed_by")).toBe(false);
    expect(text.includes("example.com")).toBe(false);
    expect(meta.columns[0].column_name).toBe("phone");
  });

  test("scanPii detects phone/email and passes clean text", () => {
    expect(scanPii("contact +7 (999) 123-45-67").some((h) => h.name === "phone")).toBe(true);
    expect(scanPii("mail: user@example.com").some((h) => h.name === "email")).toBe(true);
    expect(scanPii("только имена полей: phone, inn, name_courier").length).toBe(0);
  });
});

describe("scoring and grain", () => {
  test("priority ranges", () => {
    expect(priority(85)).toBe("P0");
    expect(priority(55)).toBe("P1");
    expect(priority(10)).toBe("P2");
    expect(priority(0)).toBe("OUT_OF_SCOPE");
  });

  test("grain overrides cover 12 approved datasets", () => {
    expect(Object.keys(GRAIN_OVERRIDES).length).toBe(12);
  });
});
