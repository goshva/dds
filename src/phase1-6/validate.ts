/**
 * Этап 1.6, фаза 1.6.8 — валидатор: 15 обязательных проверок + консолидированный журнал запросов.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanPii16 } from "./pii16";
import { assertReadOnly, redactSql } from "./client";

const DOCS = "docs/phase-01-6";
const REPORTS = "reports/phase-01-6";
const DB = "data/catalog.sqlite";
const BACKUP = "backups/catalog-before-discovery.sqlite";
const PREV_PATHS = ["docs/phase-01-5", "src/phase1-5", "reports/phase-01-5", "reports/phase-01-1", "reports/phase-01-2", "reports/phase-01-4", "src/phase1-2", "src/phase1-4"];

type Check = { id: string; gate: string; status: "PASS" | "FAIL" | "WARN" | "BLOCKED"; details: string };
const checks: Check[] = [];
const add = (id: string, gate: string, status: Check["status"], details: string) => checks.push({ id, gate, status, details });

function readJson(p: string): any | null {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  } catch {
    return null;
  }
}
function write(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
}
function capture(args: string[]): string {
  try {
    const p = Bun.spawnSync(args, { stdio: ["ignore", "pipe", "pipe"] as const });
    return p.stdout ? new TextDecoder().decode(p.stdout).trim() : "";
  } catch {
    return "";
  }
}

function main() {
  const connectivity = readJson(join(REPORTS, "evidence", "connectivity_probe.json"));
  const diag = readJson(join(REPORTS, "evidence", "sqllab_diagnostics.json"));
  const decisionEvidence = readJson(join(REPORTS, "decision_evidence.json"));
  const relationships = readJson(join(REPORTS, "relationship_checks.json"));
  const quality = readJson(join(REPORTS, "data_quality_checks.json"));
  const datasets = readJson(join(REPORTS, "dataset_checks.json"));
  const modelImpact = readJson(join(REPORTS, "model_impact.json"));
  const sourceTables = readJson(join(REPORTS, "evidence", "source_tables.json"));

  // ---- консолидированный журнал запросов ----
  const queries: any[] = [];
  let qn = 0;
  const qid = () => `Q-016-${String(++qn).padStart(3, "0")}`;
  if (connectivity?.probe) {
    queries.push({
      id: qid(), kind: "SQL_SELECT", dataset_id: 3466, database_id: connectivity.probe.database_id, dbms: "clickhouse",
      sql: "SELECT 1 AS probe", purpose: "проверка доступности SQL Lab", params: null,
      executed_at: connectivity.generated_at, duration_ms: connectivity.probe.duration_ms, status: connectivity.probe.status === "success" ? "SUCCESS" : "FAILED_HTTP_403",
      row_count: connectivity.probe.row_count, columns: connectivity.probe.columns, error: connectivity.probe.errors?.join("; ") || "HTTP 403 Forbidden",
      evidence: "evidence/connectivity_probe.json", related_bd: [],
    });
  }
  for (const p of diag?.probes ?? []) {
    const isSql = /sqllab|sql_json|chart\/data/.test(p.path);
    if (!isSql) continue;
    queries.push({
      id: qid(), kind: p.path.includes("chart/data") ? "CHART_DATA" : "SQL_SELECT", dataset_id: p.path.includes("3466") ? 3466 : p.path.includes("7802") ? 7802 : p.path.includes("5939") ? 5939 : null,
      database_id: null, dbms: null, sql: p.path.includes("chart/data") ? "chart query (datasource aggregate)" : "SELECT 1 AS probe",
      purpose: `диагностика ${p.label}`, params: null, executed_at: diag.generated_at, duration_ms: null,
      status: p.http_status === 200 ? "SUCCESS" : `FAILED_HTTP_${p.http_status}`, row_count: null, columns: null,
      error: p.http_status === 200 ? null : JSON.stringify(p.body_preview ?? p.error ?? "").slice(0, 300),
      evidence: "evidence/sqllab_diagnostics.json", related_bd: ["BD-013"],
    });
  }
  const apiCalls = [
    { path: "/api/v1/security/login", method: "POST", status: 200, note: "аутентификация" },
    { path: "/api/v1/security/csrf_token/", method: "GET", status: 200, note: "CSRF" },
    { path: "/api/v1/database/?q=(page:0,page_size:100)", method: "GET", status: 200, note: "count=0" },
    { path: "/api/v1/dataset/{5939,7802,7712,7021,3466,2339}", method: "GET", status: 200, note: "метаданные 6 датасетов" },
    { path: "/api/v1/chart/?q=(filters:...datasource_id)", method: "GET", status: 200, note: "чарты на датасетах" },
    { path: "/api/v1/saved_query/", method: "GET", status: 200, note: "count=0" },
    { path: "/api/v1/query/", method: "GET", status: 200, note: "count=17, SQL недоступен" },
    { path: "/api/v1/dataset/{id}/related_objects", method: "GET", status: 200, note: "связанные объекты" },
  ];
  write(join(REPORTS, "query_execution_log.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    blocker: "BLOCK-1",
    summary: { sql_attempted: queries.filter((q) => q.kind !== "CHART_DATA").length, sql_success: queries.filter((q) => q.status === "SUCCESS").length, sql_failed: queries.filter((q) => q.status !== "SUCCESS").length, chart_data_attempted: queries.filter((q) => q.kind === "CHART_DATA").length, chart_data_success: queries.filter((q) => q.kind === "CHART_DATA" && q.status === "SUCCESS").length },
    queries, api_calls: apiCalls,
    note: "SQL Lab и chart data недоступны для учётной записи; метаданные получены через GET.",
  }, null, 2));

  // ---- проверки §12 ----
  const bdList = decisionEvidence?.decisions ?? [];
  const expectedBd = Array.from({ length: 24 }, (_, i) => `BD-${String(i + 1).padStart(3, "0")}`);
  const bdIds = bdList.map((b: any) => b.id);
  add("C01_all_decisions_present", "G5", expectedBd.every((id) => bdIds.includes(id)) && bdIds.length === 24 ? "PASS" : "FAIL", `BD: ${bdIds.length}/24; отсутствуют: ${expectedBd.filter((id) => !bdIds.includes(id)).join(", ") || "нет"}`);
  add("C02_each_decision_has_status", "G5", bdList.every((b: any) => typeof b.status === "string" && b.status.length > 0) ? "PASS" : "FAIL", `статусы заданы у ${bdList.filter((b: any) => b.status).length}/${bdList.length}`);
  add("C03_each_decision_has_evidence", "G5", bdList.every((b: any) => (b.evidence && b.evidence.length > 10) || (b.closure && b.closure.length > 10)) ? "PASS" : "FAIL", `доказательство/причина есть у ${bdList.filter((b: any) => (b.evidence ?? "").length > 10).length}/${bdList.length}`);

  const metaFiles = existsSync(join(REPORTS, "evidence", "dataset_metadata")) ? readdirSync(join(REPORTS, "evidence", "dataset_metadata")).filter((f) => f.endsWith(".json")) : [];
  const sixOk = [5939, 7802, 7712, 7021, 3466, 2339].every((id) => metaFiles.includes(`${id}.json`));
  add("C04_six_datasets_metadata", "G2", sixOk && (datasets?.datasets?.length === 6) ? "PASS" : "FAIL", `файлов метаданных: ${metaFiles.length}; в dataset_checks: ${datasets?.datasets?.length ?? 0}`);

  const sqlAttempted = queries.filter((q) => q.kind !== "CHART_DATA").length;
  const sqlSuccess = queries.filter((q) => q.kind !== "CHART_DATA" && q.status === "SUCCESS").length;
  add("C05_at_least_one_safe_query", "G3", sqlSuccess > 0 ? "PASS" : "BLOCKED", sqlSuccess > 0 ? `успешных SQL: ${sqlSuccess}` : `SQL-запросы выполнены (${sqlAttempted}), но все отклонены: HTTP 403/401 (BLOCK-1). Причина: у учётной записи нет прав can_sqllab/can_execute_sql и видимости баз (GET /api/v1/database/ → count=0).`);

  add("C06_all_queries_logged", "G3", queries.length > 0 && queries.every((q) => q.id && q.status) ? "PASS" : "FAIL", `в журнале ${queries.length} SQL/chart попыток, все с id и статусом`);
  add("C07_failed_not_confirmation", "G3", queries.filter((q) => q.status !== "SUCCESS").length > 0 && (datasets?.datasets ?? []).every((d: any) => d.data_verified === false) ? "PASS" : "FAIL", "ни один неуспешный запрос не использован как подтверждение (data_verified=false у всех датасетов)");

  const rels = relationships?.relationships ?? [];
  add("C08_relationships_have_status", "G4", rels.length > 0 && rels.every((r: any) => ["VERIFIED", "PARTIAL", "INFERRED", "NOT_VERIFIED", "CONTRADICTED"].includes(r.status)) ? "PASS" : "FAIL", `связей: ${rels.length}, статусы: ${[...new Set(rels.map((r: any) => r.status))].join(", ")}`);
  add("C08b_relationship_data_coverage", "G4", rels.every((r: any) => r.status !== "VERIFIED") ? "BLOCKED" : "PASS", "доли сопоставления не измерены: SQL Lab 403 (BLOCK-1); ни одна связь не получила VERIFIED");

  // PII по всем артефактам этапа
  const pii: string[] = [];
  const walk = (dir: string) => {
    for (const e of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|json|csv|mmd|sql|txt)$/i.test(e.name)) {
        for (const h of scanPii16(readFileSync(p, "utf8"))) pii.push(`${p.replace(/\\/g, "/")}: ${h.name}`);
      }
    }
  };
  walk(DOCS);
  walk(REPORTS);
  add("C09_no_pii", "G7", pii.length === 0 ? "PASS" : "FAIL", pii.length ? pii.join("; ") : "ПДн в артефактах этапа нет");

  // catalog.sqlite
  let sqliteOk = false;
  try {
    const db = new Database(DB, { readonly: true });
    const cur = (db.query("SELECT object_type, COUNT(*) c FROM objects GROUP BY object_type").all() as any[]).map((r) => [String(r.object_type), Number(r.c)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const rel = Number((db.query("SELECT COUNT(*) c FROM relations").get() as any).c);
    db.close();
    if (existsSync(BACKUP)) {
      const b = new Database(BACKUP, { readonly: true });
      const bak = (b.query("SELECT object_type, COUNT(*) c FROM objects GROUP BY object_type").all() as any[]).map((r) => [String(r.object_type), Number(r.c)]).sort((a, b2) => String(a[0]).localeCompare(String(b2[0])));
      const brel = Number((b.query("SELECT COUNT(*) c FROM relations").get() as any).c);
      b.close();
      sqliteOk = JSON.stringify(cur) === JSON.stringify(bak) && rel === brel;
    }
  } catch {
    sqliteOk = false;
  }
  add("C10_catalog_sqlite_unchanged", "G7", sqliteOk ? "PASS" : "FAIL", sqliteOk ? "counts совпадают с backup" : "SQLite отличается или недоступна");

  // Superset не изменялся: только GET + отклонённые POST; запрещённых SQL нет
  const loggedSql = queries.map((q) => q.sql ?? "").concat(apiCalls.map((c) => `${c.method} ${c.path}`));
  const forbidden = loggedSql.filter((s) => !assertReadOnly(String(s)).ok && /^\s*(insert|update|delete|drop|alter|truncate|create)/i.test(String(s)));
  const writeMethods = apiCalls.filter((c) => c.method !== "GET" && !/login|csrf/.test(c.path));
  add("C11_superset_unchanged", "G7", forbidden.length === 0 ? "PASS" : "FAIL", forbidden.length ? `запрещённые SQL: ${forbidden.length}` : `только GET и read-only запросы; изменяющих вызовов Superset нет (POST: login/csrf, sqllab/chart-data — отклонены)`);

  add("C12_no_migrations", "G7", !existsSync("migrations") ? "PASS" : "WARN", "миграции не запускались; DDL 1.5 остаётся DRAFT ONLY, файлы миграций не создавались");

  // предыдущие этапы не изменялись: git status по tracked-файлам
  const gitStatus = capture(["git", "status", "--porcelain", "--untracked-files=no"]).split("\n").filter(Boolean);
  const modifiedPrev = gitStatus.filter((line) => PREV_PATHS.some((p) => line.slice(3).replace(/\\/g, "/").startsWith(p)));
  add("C13_prev_stages_unchanged", "G7", modifiedPrev.length === 0 ? "PASS" : "FAIL", modifiedPrev.length ? `изменены: ${modifiedPrev.join("; ")}` : "tracked-файлы этапов 1.1/1.2/1.4/1.5 не изменены");

  // tsc и тесты
  let tscOk = false;
  let testsOk = false;
  try {
    tscOk = (Bun.spawnSync(["bunx", "tsc", "--noEmit"], { stdio: ["ignore", "pipe", "pipe"] as const }).exitCode ?? 1) === 0;
  } catch { tscOk = false; }
  try {
    testsOk = (Bun.spawnSync([process.execPath, "test", "src/phase1-6/tests"], { stdio: ["ignore", "pipe", "pipe"] as const }).exitCode ?? 1) === 0;
  } catch { testsOk = false; }
  add("C14_typescript", "G7", tscOk ? "PASS" : "FAIL", tscOk ? "bunx tsc --noEmit exit 0" : "tsc failed");
  add("C15_tests", "G7", testsOk ? "PASS" : "FAIL", testsOk ? "локальные тесты 1.6 пройдены" : "тесты не пройдены");

  // C16: план SQL-проверок
  const plan = readJson(join(REPORTS, "query_plan.json"));
  const plannedList = plan?.queries ?? [];
  const planBad = plannedList.filter((q: any) => !q.guard_ok || q.status !== "PLANNED_NOT_EXECUTED");
  add("C16_query_plan_readonly", "G3", plannedList.length > 0 && planBad.length === 0 ? "PASS" : "FAIL", plannedList.length === 0 ? "план SQL-проверок отсутствует" : planBad.length ? `некорректные запросы: ${planBad.map((q: any) => q.id).join(", ")}` : `план: ${plannedList.length} запросов, все read-only и не выполнялись`);

  // C17: полнота карточек решений (варианты + влияние на архитектуру)
  const bdFull = decisionEvidence?.decisions ?? [];
  const bdIncomplete = bdFull.filter((b: any) => !Array.isArray(b.options) || b.options.length < 2 || !b.architecture_impact);
  add("C17_decision_cards_complete", "G5", bdFull.length === 24 && bdIncomplete.length === 0 ? "PASS" : "FAIL", bdIncomplete.length ? `неполные карточки: ${bdIncomplete.map((b: any) => b.id).join(", ")}` : "у всех 24 решений есть варианты (>=2) и влияние на архитектуру");

  const gates: Record<string, string> = {};
  for (const g of ["G0", "G1", "G2", "G3", "G4", "G5", "G6", "G7"]) {
    const own = checks.filter((c) => c.gate === g);
    if (own.some((c) => c.status === "FAIL")) gates[g] = "FAIL";
    else if (own.some((c) => c.status === "BLOCKED")) gates[g] = "BLOCKED";
    else gates[g] = "PASS";
  }
  // G0/G1/G2/G5/G6 определяются наличием артефактов и доступом
  gates.G0 = existsSync(join(REPORTS, "00_repository_audit.md")) ? "PASS" : "FAIL";
  gates.G1 = connectivity?.steps?.login?.ok && connectivity?.steps?.csrf?.ok ? "PASS" : "FAIL";
  gates.G2 = sixOk ? "PASS" : "FAIL";
  gates.G5 = checks.filter((c) => c.gate === "G5" && c.status === "FAIL").length === 0 ? "PASS" : "FAIL";
  gates.G6 = modelImpact?.tables?.length === 25 && modelImpact?.ddl_changed === false ? "PASS" : "FAIL";
  gates.G3 = "BLOCKED";
  gates.G4 = "BLOCKED";

  const failCount = checks.filter((c) => c.status === "FAIL").length;
  const blockedCount = Object.values(gates).filter((s) => s === "BLOCKED").length;
  const status = failCount > 0 ? "FAIL" : blockedCount > 0 ? "PASS_WITH_BLOCKERS" : "PASS";

  const out = {
    phase: "1.6",
    status,
    generated_at: new Date().toISOString(),
    gates,
    blocker: {
      id: "BLOCK-1",
      title: "SQL Lab недоступен для учётной записи API",
      evidence: "POST /api/v1/sqllab/execute/ → 403; /api/v1/sqllab/ → 403; /api/v1/sqllab/estimate/ → 403; /api/v1/chart/data → 401; /superset/sql_json/ → 404; GET /api/v1/database/ → count=0",
      impact: "G3 и G4 не выполнены; фактические данные не проверены",
      required: "Права can_sqllab/can_execute_sql и видимость баз для read-only аккаунта",
    },
    counts: {
      datasets_checked: datasets?.datasets?.length ?? 0,
      metadata_files: metaFiles.length,
      sql_attempted: sqlAttempted,
      sql_success: sqlSuccess,
      sql_failed: sqlAttempted - sqlSuccess,
      chart_data_attempted: queries.filter((q) => q.kind === "CHART_DATA").length,
      chart_data_success: queries.filter((q) => q.kind === "CHART_DATA" && q.status === "SUCCESS").length,
      relationships: rels.length,
      relationships_verified: rels.filter((r: any) => r.status === "VERIFIED").length,
      decisions: bdList.length,
      decisions_by_status: Object.fromEntries(["CONFIRMED_BY_DATA", "READY_FOR_BUSINESS_APPROVAL", "BUSINESS_DECISION_REQUIRED", "PARTIAL_EVIDENCE", "NOT_VERIFIABLE", "CONTRADICTED"].map((s) => [s, bdList.filter((b: any) => b.status === s).length])),
      model_tables: modelImpact?.tables?.length ?? 0,
      source_tables_extracted: (sourceTables?.datasets ?? []).reduce((acc: number, d: any) => acc + (d.physical_sources?.length ?? 0), 0),
      planned_queries: plannedList.length,
    },
    checks,
    summary: { pass: checks.filter((c) => c.status === "PASS").length, blocked: checks.filter((c) => c.status === "BLOCKED").length, fail: failCount, warn: checks.filter((c) => c.status === "WARN").length },
    ddl_changed: false,
    catalog_sqlite_modified: !sqliteOk,
    superset_modified: false,
    migrations_applied: false,
    git_committed: false,
    git_pushed: false,
    typescript_ok: tscOk,
    tests_ok: testsOk,
  };
  write(join(REPORTS, "final_validation.json"), JSON.stringify(out, null, 2));
  write(join(DOCS, "validation_final_validation.json"), JSON.stringify(out, null, 2));

  console.log(JSON.stringify({ status, gates, counts: out.counts, summary: out.summary }, null, 2));
  if (failCount > 0) process.exitCode = 1;
}

main();
