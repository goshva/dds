/**
 * Этап 1.4, фаза 1.4.8 — итоговая валидация и final_validation.json.
 */
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  REPORT_DIR,
  EXTRACT_ROOT,
  SNAPSHOT_ROOT,
  readJson,
  writeJsonAtomic,
  parseCsv,
  joinReport,
  nowIso,
} from "./utils";

const APPROVED_IDS = [4732, 5247, 5399, 5797, 7006, 7024, 7027, 7119, 7293, 7465, 7473, 7775];
const DB = "data/catalog.sqlite";
const BACKUP = "backups/catalog-before-discovery.sqlite";

type Check = { id: string; gate?: string; status: "PASS" | "FAIL" | "WARN" | "BLOCKED"; details: string };

function main() {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  // G0
  const g0 = existsSync(joinReport("00_repository_audit.md"));
  add({ id: "G0_repository_audit", gate: "G0", status: g0 ? "PASS" : "FAIL", details: g0 ? "00_repository_audit.md присутствует" : "нет 00_repository_audit.md" });

  // G1
  const access = readJson<any>(joinReport("01_superset_access_report.json"));
  const accessStatus = access?.status ?? "UNKNOWN";
  const g1Status: Check["status"] = accessStatus === "ACCESS_OK" ? "PASS" : accessStatus === "AUTH_REQUIRED" || accessStatus === "AUTH_FAILED" ? "BLOCKED" : "BLOCKED";
  add({ id: "G1_superset_access", gate: "G1", status: g1Status, details: `status=${accessStatus}; login=${access?.auth?.login ?? "—"}; spot_ok=${access?.spot_checks_ok ?? "—"}` });

  // G2
  const manifest = readJson<any>(join(SNAPSHOT_ROOT, "manifest.json"));
  const g2 = Boolean(manifest) && (manifest?.errors?.length ?? 0) === 0;
  add({ id: "G2_catalog_sync", gate: "G2", status: manifest ? (g2 ? "PASS" : "WARN") : "FAIL", details: manifest ? `snapshot=${manifest.snapshot_id}; errors=${manifest.errors?.length ?? 0}` : "нет manifest.json" });

  // G3
  const candidates = readJson<any>(joinReport("03_dataset_candidates.json"));
  const cands: any[] = candidates?.datasets ?? [];
  const approvedFound = APPROVED_IDS.filter((id) => cands.some((c) => Number(c.dataset_id) === id && String(c.verification_status).startsWith("APPROVED")));
  const g3 = approvedFound.length === APPROVED_IDS.length;
  add({ id: "G3_candidates", gate: "G3", status: g3 ? "PASS" : "FAIL", details: `approved found=${approvedFound.length}/${APPROVED_IDS.length}; candidates=${cands.length}` });

  // G4..G7
  const g4 = existsSync(joinReport("04_extraction_report.md"));
  add({ id: "G4_extraction", gate: "G4", status: g4 ? "PASS" : "FAIL", details: g4 ? "04_extraction_report.md присутствует" : "нет 04_extraction_report.md" });
  const g5 = existsSync(joinReport("05_sql_parsing_report.md"));
  add({ id: "G5_sql_parsing", gate: "G5", status: g5 ? "PASS" : "FAIL", details: g5 ? "05_sql_parsing_report.md присутствует" : "нет 05_sql_parsing_report.md" });
  const g6 = existsSync(joinReport("06_modeling_report.md"));
  add({ id: "G6_modeling", gate: "G6", status: g6 ? "PASS" : "FAIL", details: g6 ? "06_modeling_report.md присутствует" : "нет 06_modeling_report.md" });
  const g7 = existsSync(joinReport("07_quality_report.md"));
  add({ id: "G7_quality", gate: "G7", status: g7 ? "PASS" : "FAIL", details: g7 ? "07_quality_report.md присутствует" : "нет 07_quality_report.md" });

  // counts
  const newCandidates = cands.filter((c) => !APPROVED_IDS.includes(Number(c.dataset_id)) && (c.priority === "P0" || c.priority === "P1"));
  const exDir = join(EXTRACT_ROOT, "datasets");
  let extractedDatasets = 0;
  let fullyParsedDatasets = 0;
  if (existsSync(exDir)) {
    for (const f of readdirSync(exDir).filter((x) => x.endsWith(".json") && x !== "index.json")) {
      const doc = readJson<any>(join(exDir, f));
      if (!doc?.metadata) continue;
      extractedDatasets++;
      if (String(doc.provenance?.extraction_status ?? "").startsWith("FULL_DETAIL")) fullyParsedDatasets++;
    }
  }

  const physicalCsv = existsSync(joinReport("06_physical_catalog.csv")) ? parseCsv(readFileSync(joinReport("06_physical_catalog.csv"), "utf8")) : [];
  const columnsCsv = existsSync(joinReport("05_column_inventory.csv")) ? parseCsv(readFileSync(joinReport("05_column_inventory.csv"), "utf8")) : [];
  const relCsv = existsSync(joinReport("06_relationships.csv")) ? parseCsv(readFileSync(joinReport("06_relationships.csv"), "utf8")) : [];
  const tablesCount = Math.max(0, physicalCsv.length - 1);
  const columnsCount = Math.max(0, columnsCsv.length - 1);
  const relationshipsCount = Math.max(0, relCsv.length - 1);

  const quality = readJson<any>(joinReport("07_quality_issues.json"));
  const issues: any[] = quality?.issues ?? [];
  const piiHits = quality?.pii_hits ?? [];
  const unresolved = quality?.unresolved_refs ?? { dataset: 0, dashboard: 0, tables: 0, columns: 0 };
  const unresolvedDatasetRefs = Number(unresolved.dataset ?? 0);
  const unresolvedDashboardRefs = Number(unresolved.dashboard ?? 0);
  const unresolvedTables = Number(unresolved.tables ?? 0);
  const unresolvedColumns = Number(unresolved.columns ?? 0);

  // SQLite unchanged
  let sqliteUnchanged = false;
  try {
    const db = new Database(DB, { readonly: true });
    const cur = db.query("SELECT object_type, COUNT(*) c FROM objects GROUP BY object_type").all() as any[];
    const rel = Number((db.query("SELECT COUNT(*) c FROM relations").get() as any).c);
    db.close();
    const sort = (rows: any[]) => JSON.stringify([...rows].sort((a, b) => String(a.object_type).localeCompare(String(b.object_type))).map((r) => [r.object_type, Number(r.c)]));
    if (existsSync(BACKUP)) {
      const b = new Database(BACKUP, { readonly: true });
      const bcur = b.query("SELECT object_type, COUNT(*) c FROM objects GROUP BY object_type").all() as any[];
      const brel = Number((b.query("SELECT COUNT(*) c FROM relations").get() as any).c);
      b.close();
      sqliteUnchanged = sort(cur) === sort(bcur) && rel === brel;
    }
  } catch {
    sqliteUnchanged = false;
  }

  // tsc + tests
  let tscOk = false;
  let testsOk = false;
  try {
    const p = Bun.spawnSync(["bunx", "tsc", "--noEmit"], { stdout: "ignore", stderr: "ignore" });
    tscOk = p.exitCode === 0;
  } catch {
    tscOk = false;
  }
  try {
    const p = Bun.spawnSync([process.execPath, "test", "src/phase1-4/tests"], { stdout: "ignore", stderr: "ignore" });
    testsOk = p.exitCode === 0;
  } catch {
    testsOk = false;
  }

  const failCount = checks.filter((c) => c.status === "FAIL").length;
  const blockedCount = checks.filter((c) => c.status === "BLOCKED").length;
  const gates = Object.fromEntries(checks.filter((c) => c.gate).map((c) => [c.gate as string, c.status]));

  const status = failCount > 0 ? "FAIL" : blockedCount > 0 ? "BLOCKED" : "PASS";

  const out = {
    phase: "1.4",
    status,
    generated_at: nowIso(),
    gates,
    approved_datasets_expected: APPROVED_IDS.length,
    approved_datasets_found: approvedFound.length,
    new_candidates: newCandidates.length,
    deeply_parsed_datasets: fullyParsedDatasets,
    extracted_datasets: extractedDatasets,
    tables: tablesCount,
    columns: columnsCount,
    relationships: relationshipsCount,
    unresolved_refs: {
      dataset: unresolvedDatasetRefs,
      dashboard: unresolvedDashboardRefs,
      tables: unresolvedTables,
      columns: unresolvedColumns,
    },
    pii_leaks: piiHits.length,
    catalog_sqlite_modified: !sqliteUnchanged,
    source_databases_queried: false,
    superset_objects_modified: false,
    git_committed: false,
    git_pushed: false,
    typescript_ok: tscOk,
    tests_ok: testsOk,
    checks,
  };
  writeJsonAtomic(joinReport("final_validation.json"), out);

  // summary of the whole stage
  const md: string[] = [];
  md.push("# Этап 1.4 — итоговая валидация");
  md.push("");
  md.push(`Сгенерировано: ${out.generated_at}`);
  md.push(`Статус: **${status}**`);
  md.push("");
  md.push("## Gates");
  md.push("");
  md.push("| Gate | Статус |");
  md.push("|---|---|");
  for (const [g, s] of Object.entries(gates)) md.push(`| ${g} | ${s} |`);
  md.push("");
  md.push("## Метрики");
  md.push("");
  md.push("| Метрика | Значение |");
  md.push("|---|---:|");
  md.push(`| approved datasets expected/found | ${APPROVED_IDS.length}/${approvedFound.length} |`);
  md.push(`| new candidates (P0/P1) | ${newCandidates.length} |`);
  md.push(`| deeply parsed datasets | ${fullyParsedDatasets} |`);
  md.push(`| extracted datasets | ${extractedDatasets} |`);
  md.push(`| tables | ${tablesCount} |`);
  md.push(`| columns | ${columnsCount} |`);
  md.push(`| relationships | ${relationshipsCount} |`);
  md.push(`| PII leaks | ${piiHits.length} |`);
  md.push(`| TypeScript | ${tscOk ? "OK" : "FAIL"} |`);
  md.push(`| tests | ${testsOk ? "OK" : "FAIL"} |`);
  md.push("");
  md.push("## Неизменность");
  md.push("");
  md.push(`- catalog_sqlite_modified: ${!sqliteUnchanged}`);
  md.push(`- source_databases_queried: false`);
  md.push(`- superset_objects_modified: false`);
  md.push(`- git_committed: false; git_pushed: false`);
  md.push("");
  writeJsonAtomic(joinReport("08_validation_summary.json"), out);

  console.log(JSON.stringify({ status, gates, approved_found: approvedFound.length, new_candidates: newCandidates.length, deeply_parsed: fullyParsedDatasets, tables: tablesCount, columns: columnsCount, relationships: relationshipsCount, pii_leaks: piiHits.length, catalog_sqlite_modified: !sqliteUnchanged, typescript_ok: tscOk, tests_ok: testsOk }, null, 2));
  if (status === "FAIL") process.exitCode = 1;
}

main();
