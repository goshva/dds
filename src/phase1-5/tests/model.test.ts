import { describe, expect, test } from "bun:test";
import { TABLES, LIFECYCLES, LIFECYCLE_TABLES, INVARIANTS } from "../model";
import { MIGRATIONS } from "../registries";

function opts(o?: string) {
  const r = { pk: false, nn: false, uq: false, fk: null as string | null };
  if (!o) return r;
  for (const t of o.split(",").map((x) => x.trim())) {
    if (t === "pk") r.pk = true;
    else if (t === "nn") r.nn = true;
    else if (t === "uq") r.uq = true;
    else if (t.startsWith("fk:")) r.fk = t.slice(3);
  }
  return r;
}

describe("logical model", () => {
  test("25 tables with unique names and PKs", () => {
    expect(TABLES.length).toBe(25);
    expect(new Set(TABLES.map((t) => t.name)).size).toBe(25);
    for (const t of TABLES) expect(t.cols.some((c) => opts(c[2]).pk)).toBe(true);
  });

  test("FK targets exist and are type-compatible", () => {
    for (const t of TABLES) {
      for (const [name, type, o] of t.cols) {
        const fk = opts(o).fk;
        if (!fk) continue;
        const [pt, pc] = fk.split(".");
        const parent = TABLES.find((x) => x.name === pt);
        expect(parent).toBeDefined();
        const pcol = parent!.cols.find((c) => c[0] === pc);
        expect(pcol).toBeDefined();
        expect(pcol![1]).toBe(type);
      }
    }
  });

  test("lifecycle states are declared in table statuses", () => {
    for (const [name, lc] of Object.entries(LIFECYCLES)) {
      const table = TABLES.find((t) => t.name === LIFECYCLE_TABLES[name]);
      expect(table).toBeDefined();
      for (const s of lc.states) expect(table!.statuses!).toContain(s);
    }
  });

  test("migrations cover each table exactly once", () => {
    const seen = new Set<string>();
    for (const m of MIGRATIONS) for (const t of m.tables) {
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
    for (const t of TABLES) expect(seen.has(t.name)).toBe(true);
  });

  test("invariants reference existing tables", () => {
    const names = new Set(TABLES.map((t) => t.name));
    for (const i of INVARIANTS) for (const t of i.tables) expect(names.has(t)).toBe(true);
  });
});
