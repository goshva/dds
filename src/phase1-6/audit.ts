/**
 * Этап 1.6, фаза 1.6.0 — аудит репозитория и первичных артефактов 1.5.
 * Read-only: ничего не изменяет, пишет только в reports/phase-01-6/.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPORTS = "reports/phase-01-6";
const EVIDENCE = join(REPORTS, "evidence");

function write(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
}
function readJson(p: string): any | null {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  } catch {
    return null;
  }
}
function capture(args: string[]): string {
  try {
    const p = Bun.spawnSync(args, { stdio: ["ignore", "pipe", "pipe"] as const });
    return p.stdout ? new TextDecoder().decode(p.stdout).trim() : "";
  } catch {
    return "";
  }
}

const REQUIRED_1_5 = [
  "reports/phase-01-5/phase_01_5_summary.md",
  "reports/phase-01-5/final_validation.json",
  "docs/phase-01-5/00_scope_and_assumptions.md",
  "docs/phase-01-5/repository_audit.md",
  "docs/phase-01-5/01_business_rules_register.md",
  "docs/phase-01-5/02_business_decisions_register.md",
  "docs/phase-01-5/business_decisions_register.json",
  "docs/phase-01-5/03_domain_glossary.md",
  "docs/phase-01-5/04_logical_data_model.md",
  "docs/phase-01-5/05_physical_data_model.md",
  "docs/phase-01-5/06_conceptual_model.md",
  "docs/phase-01-5/06_er_model.mmd",
  "docs/phase-01-5/07_order_lifecycle.mmd",
  "docs/phase-01-5/08_trip_and_queue_lifecycle.mmd",
  "docs/phase-01-5/09_financial_flow.mmd",
  "docs/phase-01-5/10_event_catalog.md",
  "docs/phase-01-5/11_event_catalog.json",
  "docs/phase-01-5/12_integrity_rules.md",
  "docs/phase-01-5/13_indexes_and_constraints.md",
  "docs/phase-01-5/14_superset_mapping.md",
  "docs/phase-01-5/superset-to-domain-mapping.json",
  "docs/phase-01-5/15_source_of_truth_matrix.csv",
  "docs/phase-01-5/16_external_id_mapping.md",
  "docs/phase-01-5/17_migration_plan.md",
  "docs/phase-01-5/18_migration_matrix.csv",
  "docs/phase-01-5/19_security_and_pii.md",
  "docs/phase-01-5/20_open_questions.md",
  "docs/phase-01-5/validation/model_validation.json",
  "docs/phase-01-5/validation/schema_lint.json",
  "docs/phase-01-5/validation/coverage_matrix.csv",
  "docs/phase-01-5/schemas/event-envelope.schema.json",
  "src/phase1-5/model.ts",
  "src/phase1-5/registries.ts",
  "src/phase1-5/generate.ts",
  "src/phase1-5/validate.ts",
];

function main() {
  mkdirSync(EVIDENCE, { recursive: true });

  const missing = REQUIRED_1_5.filter((p) => !existsSync(p));
  const mv = readJson("docs/phase-01-5/validation/model_validation.json");
  const fv = readJson("reports/phase-01-5/final_validation.json");
  const bd = readJson("docs/phase-01-5/business_decisions_register.json");
  const ec = readJson("docs/phase-01-5/11_event_catalog.json");
  const mapping = readJson("docs/phase-01-5/superset-to-domain-mapping.json");
  const model = readJson("docs/phase-01-5/validation/model_validation.json");

  const ddlDir = "docs/phase-01-5/ddl/postgres";
  const ddlFiles = existsSync(ddlDir) ? readdirSync(ddlDir).filter((f) => f.endsWith(".sql")) : [];
  const ddlTables = ddlFiles.reduce((acc, f) => acc + (readFileSync(join(ddlDir, f), "utf8").match(/CREATE TABLE/g) ?? []).length, 0);
  const schemaDir = "docs/phase-01-5/schemas/events";
  const schemas = existsSync(schemaDir) ? readdirSync(schemaDir).filter((f) => f.endsWith(".json")) : [];
  const fixtures = existsSync("docs/phase-01-5/fixtures") ? readdirSync("docs/phase-01-5/fixtures").filter((f) => f.endsWith(".json")) : [];

  const decisions = (bd?.decisions ?? []) as any[];
  const decisionIds = decisions.map((d) => d.id);
  const expected = Array.from({ length: 24 }, (_, i) => `BD-${String(i + 1).padStart(3, "0")}`);
  const missingDecisions = expected.filter((id) => !decisionIds.includes(id));

  const git = {
    branch: capture(["git", "branch", "--show-current"]),
    head: capture(["git", "log", "-1", "--oneline"]),
    status_short: capture(["git", "status", "--short"]).split("\n").filter(Boolean),
    tracked_count: capture(["git", "ls-files"]).split("\n").filter(Boolean).length,
    tracked_phase15: capture(["git", "ls-files", "docs/phase-01-5", "src/phase1-5", "reports/phase-01-5"]).split("\n").filter(Boolean).length,
  };

  const snapshot = {
    generated_at: new Date().toISOString(),
    git,
    phase_1_5: {
      required_files: REQUIRED_1_5.length,
      missing_files: missing,
      model_validation_status: mv?.status ?? null,
      model_validation_checks: (mv?.checks ?? []).length,
      model_validation_failures: (mv?.checks ?? []).filter((c: any) => c.status !== "PASS").map((c: any) => c.id),
      final_validation_status: fv?.status ?? null,
      gates: fv?.gates ?? null,
      tables: fv?.counts?.tables ?? mv?.counts?.tables ?? null,
      events: ec?.count ?? null,
      decisions: decisions.length,
      decision_ids: decisionIds,
      missing_decisions: missingDecisions,
      mapping_rows: mapping?.count ?? null,
      ddl_files: ddlFiles.length,
      ddl_tables: ddlTables,
      event_schemas: schemas.length,
      fixtures: fixtures.length,
      sqlite_unchanged_check: (model?.checks ?? []).find((c: any) => c.id === "catalog_sqlite_unchanged")?.status ?? null,
      docs_no_pii_check: (model?.checks ?? []).find((c: any) => c.id === "docs_no_pii")?.status ?? null,
    },
  };
  write(join(EVIDENCE, "project_snapshot.json"), JSON.stringify(snapshot, null, 2));

  const md: string[] = [];
  md.push("# Этап 1.6.0 — Аудит репозитория и исходных артефактов");
  md.push("");
  md.push(`Сгенерировано: ${snapshot.generated_at}`);
  md.push("");
  md.push("## Git");
  md.push("");
  md.push(`- ветка: \`${git.branch}\``);
  md.push(`- HEAD: \`${git.head}\``);
  md.push(`- tracked-файлов: ${git.tracked_count}; из них Phase 1.5: ${git.tracked_phase15}`);
  md.push(`- незакоммиченные изменения: ${git.status_short.length ? git.status_short.join("; ") : "нет"}`);
  md.push("");
  md.push("## Артефакты Phase 1.5");
  md.push("");
  md.push(`- обязательных файлов проверено: ${REQUIRED_1_5.length}; отсутствует: ${missing.length}`);
  if (missing.length) for (const m of missing) md.push(`  - MISSING: \`${m}\``);
  md.push(`- model_validation: статус ${mv?.status ?? "—"}, проверок ${(mv?.checks ?? []).length}, провалов ${(mv?.checks ?? []).filter((c: any) => c.status !== "PASS").length}`);
  md.push(`- final_validation: статус ${fv?.status ?? "—"}; gates ${JSON.stringify(fv?.gates ?? {})}`);
  md.push(`- таблиц: ${fv?.counts?.tables ?? "—"}; событий: ${ec?.count ?? "—"}; решений BD: ${decisions.length}`);
  md.push(`- mapping-строк: ${mapping?.count ?? "—"}; DDL-файлов: ${ddlFiles.length} (CREATE TABLE: ${ddlTables}); JSON Schema событий: ${schemas.length}; fixtures: ${fixtures.length}`);
  md.push(`- catalog.sqlite неизменность (1.5): ${snapshot.phase_1_5.sqlite_unchanged_check ?? "—"}; PII-проверка: ${snapshot.phase_1_5.docs_no_pii_check ?? "—"}`);
  md.push("");
  md.push("## Решения BD");
  md.push("");
  md.push(`- найдено: ${decisions.length}; отсутствуют: ${missingDecisions.length ? missingDecisions.join(", ") : "нет"}`);
  md.push("");
  md.push("## Первичные артефакты (проверены напрямую)");
  md.push("");
  md.push("- `docs/phase-01-5/validation/model_validation.json` — источник фактов о проверках 1.5;");
  md.push("- `docs/phase-01-5/business_decisions_register.json` — источник списка BD;");
  md.push("- `docs/phase-01-5/ddl/postgres/*.sql` — DRAFT ONLY, не применялись;");
  md.push("- `docs/phase-01-5/schemas/event-envelope.schema.json` и `schemas/events/*.json`;");
  md.push("- `docs/phase-01-5/superset-to-domain-mapping.json` — 60 строк mapping;");
  md.push("- `src/phase1-5/model.ts`, `src/phase1-5/registries.ts` — канонические определения.");
  md.push("");
  md.push("## ***REMOVED*** G0");
  md.push("");
  if (missing.length === 0 && missingDecisions.length === 0 && mv?.status === "PASS") {
    md.push("Все обязательные артефакты 1.5 присутствуют, model_validation = PASS, все 24 решения BD на месте.");
    md.push("**G0 = PASS.**");
  } else {
    md.push("Обнаружены пробелы (см. выше). G0 требует внимания.");
  }
  md.push("");
  write(join(REPORTS, "00_repository_audit.md"), md.join("\n"));

  console.log(JSON.stringify({ git: { branch: git.branch, head: git.head, dirty: git.status_short.length }, missing_files: missing.length, missing_decisions: missingDecisions, model_validation: mv?.status, final_validation: fv?.status, decisions: decisions.length, ddl_files: ddlFiles.length, event_schemas: schemas.length, mapping_rows: mapping?.count, events: ec?.count, tables: fv?.counts?.tables }, null, 2));
  if (missing.length || missingDecisions.length || mv?.status !== "PASS") process.exitCode = 1;
}

main();
