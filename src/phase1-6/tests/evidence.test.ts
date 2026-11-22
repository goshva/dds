import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { scanPii16 } from "../pii16";

const REPORTS = "reports/phase-01-6";
const DOCS = "docs/phase-01-6";
const DB = "data/catalog.sqlite";
const BACKUP = "backups/catalog-before-discovery.sqlite";

function readJson(p: string): any | null {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

describe("stage 1.6 evidence", () => {
  test("all 24 business decisions have status and evidence", () => {
    const d = readJson(join(REPORTS, "decision_evidence.json"));
    expect(d).not.toBeNull();
    expect(d.decisions.length).toBe(24);
    const ids = d.decisions.map((x: any) => x.id);
    for (let i = 1; i <= 24; i++) expect(ids).toContain(`BD-${String(i).padStart(3, "0")}`);
    for (const x of d.decisions) {
      expect(typeof x.status).toBe("string");
      expect((x.evidence ?? "").length).toBeGreaterThan(10);
      expect((x.closure ?? "").length).toBeGreaterThan(10);
    }
    expect(d.decisions.filter((x: any) => x.status === "CONFIRMED_BY_DATA").length).toBe(0);
  });

  test("six datasets checked and none data-verified", () => {
    const d = readJson(join(REPORTS, "dataset_checks.json"));
    expect(d.datasets.length).toBe(6);
    expect(d.datasets.map((x: any) => x.dataset_id).sort((a: number, b: number) => a - b)).toEqual([2339, 3466, 5939, 7021, 7712, 7802]);
    for (const x of d.datasets) expect(x.data_verified).toBe(false);
  });

  test("relationships have valid statuses and none VERIFIED", () => {
    const d = readJson(join(REPORTS, "relationship_checks.json"));
    expect(d.relationships.length).toBeGreaterThan(0);
    const allowed = ["VERIFIED", "PARTIAL", "INFERRED", "NOT_VERIFIED", "CONTRADICTED"];
    for (const r of d.relationships) expect(allowed).toContain(r.status);
    expect(d.relationships.some((r: any) => r.status === "VERIFIED")).toBe(false);
    expect(d.relationships.some((r: any) => r.status === "CONTRADICTED")).toBe(true);
  });

  test("model impact covers 25 tables and DDL unchanged", () => {
    const d = readJson(join(REPORTS, "model_impact.json"));
    expect(d.tables.length).toBe(25);
    expect(d.ddl_changed).toBe(false);
  });

  test("query log records attempts and failures", () => {
    const d = readJson(join(REPORTS, "query_execution_log.json"));
    expect(d.queries.length).toBeGreaterThan(0);
    for (const q of d.queries) {
      expect(q.id).toMatch(/^Q-016-\d{3}$/);
      expect(typeof q.status).toBe("string");
    }
    expect(d.summary.sql_success).toBe(0);
    expect(d.summary.sql_failed).toBeGreaterThan(0);
    expect(d.blocker).toBe("BLOCK-1");
  });

  test("13 documents exist in docs/phase-01-6", () => {
    const files = readdirSync(DOCS).filter((f) => f.endsWith(".md"));
    const required = [
      "00_scope_and_methodology.md", "01_superset_access_audit.md", "02_dataset_evidence.md", "03_mentor_data_analysis.md",
      "04_shift_data_analysis.md", "05_order_ready_analysis.md", "06_trip_and_batch_analysis.md", "07_cross_dataset_relationships.md",
      "08_business_decisions_review.md", "09_data_quality_report.md", "10_model_impact_assessment.md", "11_unresolved_questions.md",
      "12_final_recommendations.md",
    ];
    for (const r of required) expect(files).toContain(r);
  });
});

describe("stage 1.6 safety", () => {
  test("no PII in stage artifacts", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(md|json|csv|mmd|sql)$/i.test(e.name)) for (const h of scanPii16(readFileSync(p, "utf8"))) hits.push(`${p}:${h.name}`);
      }
    };
    walk(DOCS);
    walk(REPORTS);
    expect(hits).toEqual([]);
  }, 30000);

  test("catalog.sqlite readonly and unchanged", () => {
    if (!existsSync(DB)) return;
    const db = new Database(DB, { readonly: true });
    const cur = (db.query("SELECT object_type, COUNT(*) c FROM objects GROUP BY object_type").all() as any[])
      .map((r) => [String(r.object_type), Number(r.c)] as [string, number])
      .sort((a, b) => a[0].localeCompare(b[0]));
    db.close();
    if (existsSync(BACKUP)) {
      const b = new Database(BACKUP, { readonly: true });
      const bak = (b.query("SELECT object_type, COUNT(*) c FROM objects GROUP BY object_type").all() as any[])
        .map((r) => [String(r.object_type), Number(r.c)] as [string, number])
        .sort((a, b2) => a[0].localeCompare(b2[0]));
      b.close();
      expect(cur).toEqual(bak);
    }
  }, 60000);

  test("no write/migration artifacts in stage sources", () => {
    const offenders: string[] = [];
    for (const f of readdirSync("src/phase1-6").filter((x) => x.endsWith(".ts"))) {
      const text = readFileSync(join("src/phase1-6", f), "utf8");
      for (const kw of ["INSERT INTO", "DROP TABLE", "ALTER TABLE", "TRUNCATE", "CREATE TABLE"]) {
        if (text.includes(kw) && !f.includes("test")) offenders.push(`${f}: ${kw}`);
      }
    }
    // допустимо только в тестах, в guard-списке клиента и в audit.ts (подсчёт CREATE TABLE в DDL-файлах)
    const allowed = ["client.ts", "audit.ts"];
    expect(offenders.filter((o) => !allowed.some((a) => o.startsWith(a)))).toEqual([]);
  });
});
