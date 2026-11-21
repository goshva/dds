/**
 * Этап 1.1 — итоговая валидация.
 *
 * Проверяет:
 *  1. SQLite readonly + quick_check + отсутствие изменений относительно backup.
 *  2. 12 валидных dataset detail.
 *  3. Полноту Discovery (list count vs API count).
 *  4. Уникальность/согласованность Lineage.
 *  5. CSV ↔ JSON.
 *  6. Наличие всех 18 KPI и верификацию их полей.
 *  7. Отсутствие PII и секретов в отчётах.
 *  8. Наличие итоговых отчётов.
 *
 * Пишет reports/phase-01-1/final_validation.json.
 * При критических ошибках завершает процесс с кодом 1.
 */
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";

const DB = "data/catalog.sqlite";
const BACKUP = "backups/catalog-before-discovery.sqlite";
const OUT_DIR = "reports/phase-01-1";
const OUT = join(OUT_DIR, "final_validation.json");

const PRIORITY_IDS = [4732, 7119, 7006, 7024, 7027, 7775, 5797, 7465, 7473, 5247, 5399, 7293];
const OPERATIONAL_KPI_IDS = [
  "orders_volume",
  "sla_late",
  "delivery_duration",
  "assembly_duration",
  "gmv",
  "routing",
  "headcount",
  "productivity",
  "shifts",
  "attendance",
  "no_shows",
  "shifts_12h",
  "trips",
  "orders_per_trip",
  "available_pool",
  "idle_time",
  "courier_income_per_hour",
  "retention",
];
const KPI_STATUSES = ["FOUND", "PARTIAL", "NOT_FOUND", "NOT_VERIFIED"];

type CheckStatus = "PASS" | "FAIL" | "WARN";
type Check = {
  id: string;
  name: string;
  status: CheckStatus;
  details: string;
  metrics?: Record<string, unknown>;
};

const checks: Check[] = [];

function add(check: Check) {
  checks.push(check);
}

function readJson(path: string): any | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Минимальный CSV-парсер с поддержкой кавычек и "" внутри значения. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ""));
}

function tableCounts(db: Database): Record<string, number> {
  const rows = db.query("SELECT object_type, COUNT(*) AS c FROM objects GROUP BY object_type").all() as any[];
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.object_type)] = Number(r.c);
  return out;
}

function checkSqlite() {
  try {
    const db = new Database(DB, { readonly: true });
    const quick = db.query("PRAGMA quick_check").all() as any[];
    const quickOk = quick.length === 1 && String(quick[0].quick_check) === "ok";
    const current = tableCounts(db);
    const relations = Number((db.query("SELECT COUNT(*) AS c FROM relations").get() as any).c);
    db.close();

    let backup: Record<string, number> | null = null;
    let backupRelations: number | null = null;
    if (existsSync(BACKUP)) {
      const b = new Database(BACKUP, { readonly: true });
      backup = tableCounts(b);
      backupRelations = Number((b.query("SELECT COUNT(*) AS c FROM relations").get() as any).c);
      b.close();
    }

    const sameAsBackup = backup ? JSON.stringify(current) === JSON.stringify(backup) : null;
    const relationsSame = backupRelations !== null ? relations === backupRelations : null;

    add({
      id: "sqlite_readonly_quick_check",
      name: "SQLite readonly и quick_check",
      status: quickOk ? "PASS" : "FAIL",
      details: quickOk ? "quick_check = ok" : `quick_check вернул: ${JSON.stringify(quick)}`,
      metrics: { quick_check: quick[0]?.quick_check ?? null },
    });
    add({
      id: "sqlite_unchanged_vs_backup",
      name: "SQLite не изменена относительно backup",
      status: sameAsBackup === false ? "FAIL" : sameAsBackup === true ? "PASS" : "WARN",
      details:
        sameAsBackup === null
          ? "backup не найден — сравнение невозможно"
          : sameAsBackup
            ? "counts по object_type совпадают с backup"
            : `counts отличаются: current=${JSON.stringify(current)} backup=${JSON.stringify(backup)}`,
      metrics: { current, backup, relations, backup_relations: backupRelations },
    });
    add({
      id: "sqlite_relations_unchanged",
      name: "Таблица relations не изменена",
      status: relationsSame === false ? "FAIL" : relationsSame === true ? "PASS" : "WARN",
      details:
        relationsSame === null
          ? "backup не найден"
          : relationsSame
            ? `relations=${relations} (как в backup)`
            : `relations=${relations}, в backup=${backupRelations}`,
      metrics: { relations, backup_relations: backupRelations },
    });
  } catch (error: any) {
    add({
      id: "sqlite_readonly_quick_check",
      name: "SQLite readonly и quick_check",
      status: "FAIL",
      details: `ошибка открытия/чтения: ${String(error?.message ?? error)}`,
    });
  }
}

function checkDatasetDetails() {
  const rows: any[] = [];
  const problems: string[] = [];
  for (const id of PRIORITY_IDS) {
    const path = join("output", "dataset_details", `${id}.json`);
    if (!existsSync(path)) {
      problems.push(`${id}: file_missing`);
      rows.push({ dataset_id: id, ok: false, reason: "file_missing" });
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      const res = parsed?.result;
      const row = {
        dataset_id: id,
        ok: true,
        id_match: String(res?.id) === String(id),
        table_name: typeof res?.table_name === "string" ? res.table_name : null,
        columns: Array.isArray(res?.columns) ? res.columns.length : null,
        metrics: Array.isArray(res?.metrics) ? res.metrics.length : null,
        sql_length: typeof res?.sql === "string" ? res.sql.length : 0,
      };
      const rowProblems: string[] = [];
      if (!row.id_match) rowProblems.push("id_mismatch");
      if (!row.table_name) rowProblems.push("table_name_missing");
      if (row.columns === null) rowProblems.push("columns_not_array");
      if (row.metrics === null) rowProblems.push("metrics_not_array");
      if (!row.sql_length) rowProblems.push("sql_empty");
      if (rowProblems.length) {
        problems.push(`${id}: ${rowProblems.join(",")}`);
        rows.push({ ...row, ok: false, problems: rowProblems });
      } else {
        rows.push(row);
      }
    } catch (error: any) {
      problems.push(`${id}: parse_error ${String(error?.message ?? error)}`);
      rows.push({ dataset_id: id, ok: false, reason: "parse_error" });
    }
  }

  const summary = readJson("output/dataset_detail_summary.json");
  const summaryChecks = {
    exists: Boolean(summary),
    priority: summary?.totals?.priority === PRIORITY_IDS.length,
    valid: summary?.totals?.valid_details === PRIORITY_IDS.length,
    all_valid: summary?.verification?.all_valid === true,
    datasets: summary?.datasets?.length === PRIORITY_IDS.length,
  };
  const summaryProblems = Object.entries(summaryChecks)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  add({
    id: "dataset_details_12",
    name: "12 валидных dataset detail",
    status: problems.length === 0 && summaryProblems.length === 0 ? "PASS" : "FAIL",
    details:
      problems.length === 0 && summaryProblems.length === 0
        ? "все 12 файлов валидны, summary согласован"
        : `file problems: ${problems.join("; ") || "none"}; summary problems: ${summaryProblems.join(",") || "none"}`,
    metrics: { files: rows, summary_checks: summaryChecks },
  });
}

function checkDiscovery() {
  const summary = readJson("output/discovery_summary.json");
  const spot = readJson(join(OUT_DIR, "api_spot_checks.json"));
  const apiCounts: Record<string, number | null> = {
    dashboard: spot?.counts?.dashboard?.api_count ?? null,
    chart: spot?.counts?.chart?.api_count ?? null,
    dataset: spot?.counts?.dataset?.api_count ?? null,
  };
  const resources = summary?.resources ?? {};
  const problems: string[] = [];
  const details: Record<string, any> = {};

  for (const resource of ["dashboard", "chart", "dataset"] as const) {
    const r = resources[resource];
    if (!r) {
      problems.push(`${resource}: resource missing in summary`);
      details[resource] = { present: false };
      continue;
    }
    const downloaded = r.downloaded_count ?? r.count ?? null;
    const api = r.api_count ?? apiCounts[resource];
    const status = r.status ?? null;
    const complete = status === "complete" || (api !== null && downloaded === api);
    details[resource] = { downloaded, api, status, complete };
    if (!complete) problems.push(`${resource}: downloaded=${downloaded} api=${api} status=${status}`);
  }

  add({
    id: "discovery_complete",
    name: "Полнота Discovery",
    status: problems.length === 0 ? "PASS" : "FAIL",
    details:
      problems.length === 0
        ? "все list-ресурсы полны (downloaded = api_count)"
        : problems.join("; "),
    metrics: { resources: details, api_counts: apiCounts, summary_generated_at: summary?.generated_at ?? null },
  });
}

function checkLineage() {
  const preview = readJson(join(OUT_DIR, "lineage_preview.json"));
  const evidencePath = join(OUT_DIR, "lineage_evidence.csv");
  const relationsPath = join(OUT_DIR, "lineage_relations.csv");
  if (!preview || !existsSync(evidencePath) || !existsSync(relationsPath)) {
    add({
      id: "lineage_consistency",
      name: "Lineage: уникальность и согласованность",
      status: "FAIL",
      details: "lineage_preview.json или CSV не найдены",
    });
    return;
  }

  const evidenceRows = parseCsv(readFileSync(evidencePath, "utf8"));
  const relationRows = parseCsv(readFileSync(relationsPath, "utf8"));
  const evidenceHeader = evidenceRows[0] ?? [];
  const relationHeader = relationRows[0] ?? [];
  const evidenceData = evidenceRows.slice(1);
  const relationData = relationRows.slice(1);

  const keySet = new Set<string>();
  let duplicateKeys = 0;
  let evidenceCountSum = 0;
  const evidenceIdx = relationHeader.indexOf("evidence_count");
  for (const row of relationData) {
    const key = row.slice(0, 5).join("|");
    if (keySet.has(key)) duplicateKeys++;
    keySet.add(key);
    if (evidenceIdx >= 0) evidenceCountSum += Number(row[evidenceIdx] ?? 0);
  }

  const byType = preview?.by_relation_type ?? {};
  const byTypeSum = Number(byType.DASHBOARD_HAS_CHART ?? 0) + Number(byType.CHART_USES_DATASET ?? 0);

  const checksMap = {
    preview_checks_ok: preview?.checks_ok === true,
    evidence_rows_match: preview?.counts?.evidence_rows === evidenceData.length,
    relations_rows_match: preview?.counts?.unique_relations === relationData.length,
    no_duplicate_relation_keys: duplicateKeys === 0,
    evidence_count_sum_match: preview?.counts?.evidence_count_sum === evidenceCountSum,
    by_relation_type_sum: byTypeSum === relationData.length,
    relation_header_has_evidence_count: evidenceIdx >= 0,
    evidence_header_columns: evidenceHeader.length >= 8,
    relation_header_columns: relationHeader.length >= 10,
  };
  const failed = Object.entries(checksMap)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  add({
    id: "lineage_consistency",
    name: "Lineage: уникальность и согласованность",
    status: failed.length === 0 ? "PASS" : "FAIL",
    details:
      failed.length === 0
        ? "CSV и JSON согласованы, дублей ключей нет"
        : `failed checks: ${failed.join(", ")}`,
    metrics: {
      checks: checksMap,
      evidence_rows: evidenceData.length,
      relation_rows: relationData.length,
      duplicate_keys: duplicateKeys,
      evidence_count_sum: evidenceCountSum,
      by_type_sum: byTypeSum,
    },
  });
}

function checkKpi() {
  const kpi = readJson(join(OUT_DIR, "kpi_source_matrix.json"));
  const inventory = readJson(join(OUT_DIR, "kpi_field_inventory.json"));
  if (!kpi) {
    add({
      id: "kpi_matrix_18",
      name: "KPI Matrix: 18 показателей",
      status: "FAIL",
      details: "kpi_source_matrix.json не найден",
    });
    return;
  }

  const kpis = Array.isArray(kpi.kpis) ? kpi.kpis : [];
  const ids = kpis.map((k: any) => String(k.id));
  const statuses = kpis.map((k: any) => String(k.status));
  const badStatuses = statuses.filter((s: string) => !KPI_STATUSES.includes(s));
  const missingOperational = OPERATIONAL_KPI_IDS.filter((id) => !ids.includes(id));
  const notVerified = kpis.filter((k: any) => !k.evidence_verified).map((k: any) => k.id);
  const inventoryMissing = inventory?.missing_ids ?? [];
  const inventoryDatasets = inventory?.datasets?.length ?? 0;

  const checksMap = {
    count_18: kpi?.kpi_model?.count === 18,
    kpis_18: kpis.length === 18,
    ids_unique: new Set(ids).size === ids.length,
    statuses_valid: badStatuses.length === 0,
    operational_kpis_present: missingOperational.length === 0,
    evidence_verified: notVerified.length === 0,
    inventory_12: inventoryDatasets === 12,
    inventory_missing_empty: Array.isArray(inventoryMissing) && inventoryMissing.length === 0,
  };
  const failed = Object.entries(checksMap)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  add({
    id: "kpi_matrix_18",
    name: "KPI Matrix: 18 показателей",
    status: failed.length === 0 ? "PASS" : "FAIL",
    details:
      failed.length === 0
        ? "18 KPI, статусы валидны, поля верифицированы"
        : `failed checks: ${failed.join(", ")}; missing operational=${missingOperational.join(",") || "none"}; not verified=${notVerified.join(",") || "none"}`,
    metrics: {
      checks: checksMap,
      status_counts: kpi?.kpi_model?.status_counts ?? null,
      kpi_count: kpis.length,
      inventory_datasets: inventoryDatasets,
      inventory_missing: inventoryMissing,
    },
  });
}

function checkPiiAndSecrets() {
  const files: string[] = [];
  for (const name of readdirSync(OUT_DIR)) {
    if (/\.(md|json|csv)$/i.test(name)) files.push(join(OUT_DIR, name));
  }
  const secretPatterns: Array<{ name: string; re: RegExp }> = [
    { name: "bearer_token", re: /Bearer\s+[A-Za-z0-9._\-]+/i },
    { name: "access_token", re: /access_token\s*[:=]\s*["']?[A-Za-z0-9._\-]{8,}/i },
    { name: "password", re: /password\s*[:=]\s*["']?[^"'\s]{4,}/i },
    { name: "superset_password", re: /SUPERSET_PASSWORD\s*=\s*\S+/i },
    { name: "phone", re: /\+7[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/ },
    { name: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
    { name: "inn_12", re: /\b\d{12}\b/ },
  ];

  const hits: Array<{ file: string; pattern: string; sample: string }> = [];
  for (const file of files) {
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const p of secretPatterns) {
      const m = text.match(p.re);
      if (m) {
        hits.push({ file: file.replace(/\\/g, "/"), pattern: p.name, sample: m[0].slice(0, 40) });
      }
    }
  }

  add({
    id: "pii_and_secrets",
    name: "Отсутствие PII и секретов в отчётах",
    status: hits.length === 0 ? "PASS" : "FAIL",
    details:
      hits.length === 0
        ? "секреты и PII-значения не найдены"
        : `найдены совпадения: ${hits.map((h) => `${h.file}:${h.pattern}`).join("; ")}`,
    metrics: { scanned_files: files.length, hits },
  });
}

function checkReports() {
  const required = [
    "discovery_corrected.md",
    "lineage_quality.md",
    "phase_01_1_summary.md",
    "kpi_source_matrix.json",
    "kpi_source_matrix.md",
    "kpi_field_inventory.json",
    "lineage_preview.json",
    "lineage_evidence.csv",
    "lineage_relations.csv",
  ];
  const missing = required.filter((f) => !existsSync(join(OUT_DIR, f)));
  add({
    id: "reports_present",
    name: "Наличие итоговых отчётов",
    status: missing.length === 0 ? "PASS" : "FAIL",
    details: missing.length === 0 ? "все обязательные отчёты на месте" : `missing: ${missing.join(", ")}`,
    metrics: { required, missing },
  });
}

function main() {
  checkSqlite();
  checkDatasetDetails();
  checkDiscovery();
  checkLineage();
  checkKpi();
  checkPiiAndSecrets();
  checkReports();

  const pass = checks.filter((c) => c.status === "PASS").length;
  const fail = checks.filter((c) => c.status === "FAIL").length;
  const warn = checks.filter((c) => c.status === "WARN").length;
  const blockers = checks.filter((c) => c.status === "FAIL").map((c) => `${c.id}: ${c.details}`);

  const out = {
    generated_at: new Date().toISOString(),
    verdict: fail === 0 ? "PASS" : "FAIL",
    summary: { total: checks.length, pass, fail, warn },
    checks,
    blockers,
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2), { mode: 0o600 });

  console.log(`=== Final validation: ${out.verdict} (${pass} pass, ${fail} fail, ${warn} warn) ===`);
  for (const c of checks) {
    console.log(`[${c.status}] ${c.name} — ${c.details}`);
  }
  console.log(`report: ${OUT}`);

  if (fail > 0) process.exitCode = 1;
}

main();
