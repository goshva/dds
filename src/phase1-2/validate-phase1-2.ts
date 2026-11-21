/**
 * Этап 1.2 — финальная валидация.
 *
 * Проверяет: 12 датасетов, SQL, поля, метрики, связи, реестр витрин, статусы,
 * доказательства, TypeScript, локальные тесты анализатора, неизменность catalog.sqlite.
 *
 * Пишет reports/phase-01-2/final_validation.json.
 */
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { parseSql } from "./parse-sql";

const DETAILS_DIR = "output/dataset_details";
const REPORT_DIR = "reports/phase-01-2";
const OUT = join(REPORT_DIR, "final_validation.json");
const DB = "data/catalog.sqlite";
const BACKUP = "backups/catalog-before-discovery.sqlite";
const APPROVED_IDS = [4732, 5247, 5399, 5797, 7006, 7024, 7027, 7119, 7293, 7465, 7473, 7775];
const KPI_STATUSES = ["VERIFIED", "PARTIAL", "DERIVABLE", "NEEDS_EVENT", "NEEDS_REFERENCE", "NEEDS_BUSINESS_RULE", "NOT_AVAILABLE", "NOT_CHECKED"];
const REQUIRED_MART_FIELDS = ["mart_id", "mart_name", "business_purpose", "grain", "primary_key", "source_datasets", "source_tables", "join_keys", "filters", "aggregation_period", "metrics", "dimensions", "calculation_rules", "data_availability", "confidence", "quality_checks", "missing_events", "missing_references", "business_questions", "implementation_priority"];

type Check = { id: string; status: "PASS" | "FAIL" | "WARN"; details: string; metrics?: any };
const checks: Check[] = [];
function add(c: Check) {
  checks.push(c);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
      continue;
    }
    if (c === '"') q = true;
    else if (c === ",") {
      row.push(f);
      f = "";
    } else if (c === "\n") {
      row.push(f);
      rows.push(row);
      row = [];
      f = "";
    } else if (c !== "\r") f += c;
  }
  if (f.length || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1);
}

function readJson(path: string): any | null {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
}

function main() {
  // 1. 12 датасетов и SQL
  const detailFiles = existsSync(DETAILS_DIR) ? readdirSync(DETAILS_DIR).filter((f) => f.endsWith(".json")) : [];
  const present = detailFiles.map((f) => Number(f.replace(".json", "")));
  const missing = APPROVED_IDS.filter((id) => !present.includes(id));
  const withSql: number[] = [];
  const withoutSql: number[] = [];
  const fieldCountByDataset = new Map<number, number>();
  const metricCountByDataset = new Map<number, number>();
  for (const id of APPROVED_IDS) {
    if (missing.includes(id)) continue;
    const j = readJson(join(DETAILS_DIR, `${id}.json`));
    const sql = String(j?.result?.sql ?? "");
    if (sql.length > 0) withSql.push(id);
    else withoutSql.push(id);
  }
  add({
    id: "datasets_12_sql",
    status: missing.length === 0 && withSql.length === APPROVED_IDS.length ? "PASS" : "FAIL",
    details: `approved=${APPROVED_IDS.length}, present=${present.length}, with_sql=${withSql.length}, without_sql=${withoutSql.length}, missing=[${missing.join(",")}]`,
    metrics: { missing, with_sql: withSql, without_sql: withoutSql },
  });

  // 2. Поля и метрики
  const fieldsCsv = existsSync(join(REPORT_DIR, "dataset_fields_inventory.csv"))
    ? parseCsv(readFileSync(join(REPORT_DIR, "dataset_fields_inventory.csv"), "utf8"))
    : [];
  const metricsCsv = existsSync(join(REPORT_DIR, "dataset_metrics_inventory.csv"))
    ? parseCsv(readFileSync(join(REPORT_DIR, "dataset_metrics_inventory.csv"), "utf8"))
    : [];
  const fh = fieldsCsv[0] ?? [];
  const mh = metricsCsv[0] ?? [];
  const fdi = fh.indexOf("dataset_id");
  const mdi = mh.indexOf("dataset_id");
  for (const r of fieldsCsv.slice(1)) fieldCountByDataset.set(Number(r[fdi]), (fieldCountByDataset.get(Number(r[fdi])) ?? 0) + 1);
  for (const r of metricsCsv.slice(1)) metricCountByDataset.set(Number(r[mdi]), (metricCountByDataset.get(Number(r[mdi])) ?? 0) + 1);
  const fieldMismatches: string[] = [];
  const metricMismatches: string[] = [];
  for (const id of APPROVED_IDS) {
    const j = readJson(join(DETAILS_DIR, `${id}.json`));
    const cols = Array.isArray(j?.result?.columns) ? j.result.columns.length : 0;
    const calc = Array.isArray(j?.result?.calculated_columns) ? j.result.calculated_columns.length : 0;
    const mets = Array.isArray(j?.result?.metrics) ? j.result.metrics.length : 0;
    if ((fieldCountByDataset.get(id) ?? 0) !== cols + calc) fieldMismatches.push(`${id}: inventory=${fieldCountByDataset.get(id) ?? 0} detail=${cols + calc}`);
    if ((metricCountByDataset.get(id) ?? 0) !== mets) metricMismatches.push(`${id}: inventory=${metricCountByDataset.get(id) ?? 0} detail=${mets}`);
  }
  add({
    id: "fields_metrics_processed",
    status: fieldMismatches.length === 0 && metricMismatches.length === 0 ? "PASS" : "FAIL",
    details:
      fieldMismatches.length === 0 && metricMismatches.length === 0
        ? `fields=${fieldsCsv.length - 1}, metrics=${metricsCsv.length - 1}; counts совпадают с detail JSON`
        : `field mismatches=[${fieldMismatches.join("; ")}]; metric mismatches=[${metricMismatches.join("; ")}]`,
    metrics: { fields: fieldsCsv.length - 1, metrics: metricsCsv.length - 1, field_mismatches: fieldMismatches, metric_mismatches: metricMismatches },
  });

  // 3. Карта связей
  const joinCsv = existsSync(join(REPORT_DIR, "dataset_join_map.csv")) ? parseCsv(readFileSync(join(REPORT_DIR, "dataset_join_map.csv"), "utf8")) : [];
  const jh = joinCsv[0] ?? [];
  const sdi = jh.indexOf("source_dataset_id");
  const tdi = jh.indexOf("target_dataset_id");
  const confi = jh.indexOf("confidence");
  const joinProblems: string[] = [];
  const confSet = new Set<string>();
  for (const r of joinCsv.slice(1)) {
    const s = Number(r[sdi]);
    const t = Number(r[tdi]);
    if (s === t) joinProblems.push(`self-join ${s}`);
    if (!APPROVED_IDS.includes(s) || !APPROVED_IDS.includes(t)) joinProblems.push(`unknown dataset ${s}->${t}`);
    confSet.add(r[confi]);
  }
  const badConf = [...confSet].filter((c) => !["VERIFIED", "PROBABLE", "PARTIAL", "UNKNOWN"].includes(c));
  add({
    id: "join_map",
    status: joinProblems.length === 0 && badConf.length === 0 ? "PASS" : "FAIL",
    details: joinProblems.length === 0 && badConf.length === 0 ? `edges=${joinCsv.length - 1}, confidence=${[...confSet].join("/")}` : `problems=[${joinProblems.join("; ")}]; bad confidence=[${badConf.join(",")}]`,
    metrics: { edges: joinCsv.length - 1, confidence: [...confSet] },
  });

  // 4. Реестр витрин
  const registry = readJson(join(REPORT_DIR, "data_mart_registry.json"));
  const marts: any[] = registry?.marts ?? [];
  const kpis: any[] = registry?.kpis ?? [];
  const martIds = marts.map((m) => String(m.mart_id));
  const martProblems: string[] = [];
  for (const m of marts) {
    for (const f of REQUIRED_MART_FIELDS) {
      const v = m[f];
      if (v === undefined || v === null || (Array.isArray(v) && v.length === 0) || (typeof v === "string" && !v.trim())) {
        if (f !== "missing_events" && f !== "missing_references" && f !== "filters") martProblems.push(`${m.mart_id}: empty ${f}`);
      }
    }
    if (!["P0", "P1", "P2"].includes(m.implementation_priority)) martProblems.push(`${m.mart_id}: bad priority`);
  }
  add({
    id: "mart_registry",
    status: marts.length >= 11 && new Set(martIds).size === martIds.length && martProblems.length === 0 ? "PASS" : "FAIL",
    details: `marts=${marts.length}, unique=${new Set(martIds).size}, problems=[${martProblems.join("; ")}]`,
    metrics: { marts: marts.length, unique: new Set(martIds).size, problems: martProblems },
  });

  // 5. KPI-матрица
  const kpiProblems: string[] = [];
  const statusCounts: Record<string, number> = {};
  for (const k of kpis) {
    if (!KPI_STATUSES.includes(k.status)) kpiProblems.push(`${k.kpi_id}: bad status ${k.status}`);
    if (!martIds.includes(k.target_mart)) kpiProblems.push(`${k.kpi_id}: unknown mart ${k.target_mart}`);
    statusCounts[k.status] = (statusCounts[k.status] ?? 0) + 1;
  }
  add({
    id: "kpi_matrix",
    status: kpis.length > 0 && kpiProblems.length === 0 ? "PASS" : "FAIL",
    details: `kpis=${kpis.length}, statuses=${JSON.stringify(statusCounts)}, problems=[${kpiProblems.join("; ")}]`,
    metrics: { kpis: kpis.length, status_counts: statusCounts, problems: kpiProblems },
  });

  // 6. Доказательства
  const evidenceIssues: any[] = registry?.evidence_issues ?? [];
  add({
    id: "evidence",
    status: evidenceIssues.length === 0 ? "PASS" : "FAIL",
    details: evidenceIssues.length === 0 ? "все ссылки на поля/метрики разрешены" : `unresolved=${evidenceIssues.length}`,
    metrics: { evidence_issues: evidenceIssues },
  });

  // 7. События и справочники
  const events = readJson(join(REPORT_DIR, "missing_events_registry.json")) ?? null;
  const eventsCsv = existsSync(join(REPORT_DIR, "missing_events_registry.csv")) ? parseCsv(readFileSync(join(REPORT_DIR, "missing_events_registry.csv"), "utf8")) : [];
  const refsCsv = existsSync(join(REPORT_DIR, "missing_references_registry.csv")) ? parseCsv(readFileSync(join(REPORT_DIR, "missing_references_registry.csv"), "utf8")) : [];
  const eventIds = eventsCsv.slice(1).map((r) => r[0]);
  const expectedEvents = ["order_ready", "batch_created", "batch_assigned", "courier_accepted_assignment", "order_picked_up", "courier_shift_started", "courier_shift_ended", "courier_income_accrued", "courier_income_adjusted"];
  const missingEvents = expectedEvents.filter((e) => !eventIds.includes(e));
  add({
    id: "missing_events_references",
    status: eventsCsv.length > 1 && refsCsv.length > 1 && missingEvents.length === 0 ? "PASS" : "FAIL",
    details: `events=${eventsCsv.length - 1}, references=${refsCsv.length - 1}, missing required events=[${missingEvents.join(",")}]`,
    metrics: { events: eventsCsv.length - 1, references: refsCsv.length - 1, missing_events: missingEvents },
  });

  // 8. Локальные тесты анализатора
  const parserTests: string[] = [];
  try {
    const sql4732 = String(readJson(join(DETAILS_DIR, "4732.json"))?.result?.sql ?? "");
    const p4732 = parseSql(sql4732);
    if (p4732.ctes.length !== 0) parserTests.push("4732 cte!=0");
    if (!p4732.sources.some((s) => s.name === "darkstore_time_sheet")) parserTests.push("4732 source missing");
    const sql7024 = String(readJson(join(DETAILS_DIR, "7024.json"))?.result?.sql ?? "");
    const p7024 = parseSql(sql7024);
    if (p7024.ctes.length < 10) parserTests.push(`7024 cte=${p7024.ctes.length}`);
    if (p7024.parseUncertain) parserTests.push(`7024 uncertain=${p7024.uncertainties.join("|")}`);
    const sql5247 = String(readJson(join(DETAILS_DIR, "5247.json"))?.result?.sql ?? "");
    const p5247 = parseSql(sql5247);
    if (p5247.parseUncertain) parserTests.push(`5247 uncertain=${p5247.uncertainties.join("|")}`);
    if (p5247.unionCount !== 0) parserTests.push("5247 union!=0");
    const sql5399 = String(readJson(join(DETAILS_DIR, "5399.json"))?.result?.sql ?? "");
    const p5399 = parseSql(sql5399);
    if (p5399.parseUncertain) parserTests.push(`5399 uncertain=${p5399.uncertainties.join("|")}`);
  } catch (e: any) {
    parserTests.push(`exception: ${String(e?.message ?? e)}`);
  }
  add({
    id: "parser_local_tests",
    status: parserTests.length === 0 ? "PASS" : "FAIL",
    details: parserTests.length === 0 ? "локальные тесты анализатора пройдены" : parserTests.join("; "),
    metrics: { failures: parserTests },
  });

  // 9. TypeScript
  try {
    const proc = Bun.spawnSync(["bunx", "tsc", "--noEmit"], { stdout: "ignore", stderr: "ignore" });
    add({
      id: "typescript_compile",
      status: proc.exitCode === 0 ? "PASS" : "FAIL",
      details: proc.exitCode === 0 ? "bunx tsc --noEmit: exit 0" : `exit ${proc.exitCode}`,
    });
  } catch (e: any) {
    add({ id: "typescript_compile", status: "FAIL", details: `не удалось запустить tsc: ${String(e?.message ?? e)}` });
  }

  // 10. SQLite неизменность
  let sqliteUnchanged = false;
  let sqliteDetails = "backup не найден";
  try {
    const db = new Database(DB, { readonly: true });
    const quick = db.query("PRAGMA quick_check").all() as any[];
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
      sqliteDetails = `quick_check=${quick[0]?.quick_check}, relations=${rel}, unchanged_vs_backup=${sqliteUnchanged}`;
    } else {
      sqliteDetails = `quick_check=${quick[0]?.quick_check}, relations=${rel}, backup missing`;
    }
  } catch (e: any) {
    sqliteDetails = `error: ${String(e?.message ?? e)}`;
  }
  add({
    id: "catalog_sqlite_unchanged",
    status: sqliteUnchanged ? "PASS" : "FAIL",
    details: sqliteDetails,
  });

  // --- Итог ---
  const fail = checks.filter((c) => c.status === "FAIL").length;
  const warn = checks.filter((c) => c.status === "WARN").length;
  const pass = checks.filter((c) => c.status === "PASS").length;
  const status = fail === 0 ? (warn === 0 ? "PASS" : "PASS_WITH_WARNINGS") : "FAIL";

  const verified = (statusCounts.VERIFIED ?? 0) + (statusCounts.DERIVABLE ?? 0);
  const partial = (statusCounts.PARTIAL ?? 0) + (statusCounts.NEEDS_REFERENCE ?? 0) + (statusCounts.NEEDS_BUSINESS_RULE ?? 0);
  const needsEvent = statusCounts.NEEDS_EVENT ?? 0;
  const notAvailable = statusCounts.NOT_AVAILABLE ?? 0;

  const out = {
    phase: "1.2",
    status,
    generated_at: new Date().toISOString(),
    datasets_expected: APPROVED_IDS.length,
    datasets_audited: withSql.length + withoutSql.length,
    datasets_with_sql: withSql.length,
    datasets_without_sql: withoutSql.length,
    marts_registered: marts.length,
    metrics_registered: kpis.length,
    metrics_verified: verified,
    metrics_partial: partial,
    metrics_needs_event: needsEvent,
    metrics_not_available: notAvailable,
    missing_events: eventsCsv.length - 1,
    missing_references: refsCsv.length - 1,
    validation_errors: fail,
    catalog_sqlite_modified: !sqliteUnchanged,
    source_databases_accessed: false,
    full_discovery_rerun: false,
    status_breakdown: statusCounts,
    summary: { total_checks: checks.length, pass, fail, warn },
    checks,
    approved_ids: APPROVED_IDS,
    notes: {
      metrics_verified: "VERIFIED + DERIVABLE",
      metrics_partial: "PARTIAL + NEEDS_REFERENCE + NEEDS_BUSINESS_RULE",
      metrics_needs_event: "NEEDS_EVENT",
      metrics_not_available: "NOT_AVAILABLE",
    },
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2), { mode: 0o600 });

  console.log(`=== Phase 1.2 validation: ${status} (${pass} pass, ${fail} fail, ${warn} warn) ===`);
  for (const c of checks) console.log(`[${c.status}] ${c.id} — ${c.details}`);
  console.log(`report: ${OUT}`);

  if (fail > 0) process.exitCode = 1;
}

main();
