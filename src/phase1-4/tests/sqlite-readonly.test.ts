import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const DB = "data/catalog.sqlite";
const BACKUP = "backups/catalog-before-discovery.sqlite";

function counts(db: Database): Array<[string, number]> {
  const rows = db.query("SELECT object_type, COUNT(*) c FROM objects GROUP BY object_type").all() as any[];
  return rows
    .map((r) => [String(r.object_type), Number(r.c)] as [string, number])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

describe("catalog.sqlite is never written", () => {
  test("readonly quick_check and counts match backup", () => {
    if (!existsSync(DB)) return; // окружение без БД — тест не применим
    const db = new Database(DB, { readonly: true });
    const quick = db.query("PRAGMA quick_check").all() as any[];
    expect(String(quick[0]?.quick_check)).toBe("ok");
    const cur = counts(db);
    db.close();
    if (existsSync(BACKUP)) {
      const b = new Database(BACKUP, { readonly: true });
      const bak = counts(b);
      b.close();
      expect(cur).toEqual(bak);
    }
  });

  test("write attempt on readonly connection fails", () => {
    if (!existsSync(DB)) return;
    const db = new Database(DB, { readonly: true });
    let threw = false;
    try {
      db.query("INSERT INTO objects(object_type,object_id,title,payload_json,collected_at) VALUES('__test__','1','t','{}','now')").run();
    } catch {
      threw = true;
    }
    db.close();
    expect(threw).toBe(true);
  });

  test("phase1-4 sources open SQLite only with readonly: true", () => {
    const dir = "src/phase1-4";
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf8");
      for (const m of text.matchAll(/new Database\s*\(/g)) {
        const window = text.slice(m.index ?? 0, (m.index ?? 0) + 160);
        if (!/readonly:\s*true/.test(window)) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});
