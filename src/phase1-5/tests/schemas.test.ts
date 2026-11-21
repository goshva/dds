import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { EVENTS, EVENT_ENVELOPE_FIELDS } from "../registries";

const DOCS = "docs/phase-01-5";
const DB = "data/catalog.sqlite";
const BACKUP = "backups/catalog-before-discovery.sqlite";

describe("json schemas", () => {
  test("envelope schema declares all envelope fields", () => {
    const p = join(DOCS, "schemas", "event-envelope.schema.json");
    expect(existsSync(p)).toBe(true);
    const s = JSON.parse(readFileSync(p, "utf8"));
    expect(s.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    for (const f of EVENT_ENVELOPE_FIELDS) expect(s.properties[f]).toBeDefined();
  });

  test("key event schemas declare payload fields", () => {
    const dir = join(DOCS, "schemas", "events");
    const files = readdirSync(dir).filter((f) => f.endsWith(".schema.json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const type = f.replace(".schema.json", "");
      const e = EVENTS.find((x) => x.type === type);
      expect(e).toBeDefined();
      for (const p of e!.payload) expect(s.properties.payload.properties[p]).toBeDefined();
    }
  });
});

describe("sqlite and write boundaries", () => {
  test("catalog.sqlite readonly and unchanged", () => {
    if (!existsSync(DB)) return;
    const db = new Database(DB, { readonly: true });
    const cur = (db.query("SELECT object_type, COUNT(*) c FROM objects GROUP BY object_type").all() as any[])
      .map((r) => [String(r.object_type), Number(r.c)] as [string, number])
      .sort((a, b) => a[0].localeCompare(b[0]));
    const rel = Number((db.query("SELECT COUNT(*) c FROM relations").get() as any).c);
    db.close();
    if (existsSync(BACKUP)) {
      const b = new Database(BACKUP, { readonly: true });
      const bak = (b.query("SELECT object_type, COUNT(*) c FROM objects GROUP BY object_type").all() as any[])
        .map((r) => [String(r.object_type), Number(r.c)] as [string, number])
        .sort((a, b2) => a[0].localeCompare(b2[0]));
      const brel = Number((b.query("SELECT COUNT(*) c FROM relations").get() as any).c);
      b.close();
      expect(cur).toEqual(bak);
      expect(rel).toBe(brel);
    }
  }, 60000);

  test("write attempt on readonly connection fails", () => {
    if (!existsSync(DB)) return;
    const db = new Database(DB, { readonly: true });
    let threw = false;
    try {
      db.query("INSERT INTO objects(object_type,object_id,title,payload_json,collected_at) VALUES('__t__','1','t','{}','now')").run();
    } catch {
      threw = true;
    }
    db.close();
    expect(threw).toBe(true);
  });

  test("phase1-5 generator writes only to docs/phase-01-5", () => {
    const offenders: string[] = [];
    for (const f of readdirSync("src/phase1-5").filter((x) => x.endsWith(".ts"))) {
      const text = readFileSync(join("src/phase1-5", f), "utf8");
      for (const m of text.matchAll(/w\(\s*[`"]([^`"]+)[`"]/g)) {
        const target = join(DOCS, m[1]).replace(/\\/g, "/");
        if (!target.startsWith("docs/phase-01-5")) offenders.push(`${f}: ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
