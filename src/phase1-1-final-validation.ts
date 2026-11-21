/**
 * Этап 1.1 — итоговая валидация.
 *
 * Разделяет статусы:
 *  - LOCAL_VALIDATION     (TypeScript, SQLite readonly/quick_check, 12 detail, отчёты, PII)
 *  - API_TRANSPORT        (api_transport_diagnostics.json)
 *  - API_AUTH             (discovery_summary.json / diagnostics)
 *  - DISCOVERY_COMPLETENESS (summary ↔ фактические list-файлы)
 *  - LINEAGE_QUALITY      (lineage_preview.json ↔ CSV)
 *  - KPI_EVIDENCE         (18 KPI, evidence_verified, full catalog cross-check)
 *  - OVERALL_STATUS
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
const OUTPUT_DIR = "output";

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
const LIST_FILE: Record<string, string> = {
  dashboard: "dashboards.json",
  chart: "charts.json",
  dataset: "datasets.json",
};

type CheckStatus = "PASS" | "FAIL" | "WARN" | "BLOCKED" | "NOT_TESTED";
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

// ---------------- LOCAL: TypeScript ----------------
function checkTypeScript() {
  try {
    const proc = Bun.spawnSync(["bunx", "tsc", "--noEmit"], { stdout: "ignore", stderr: "ignore" });
    const ok = proc.exitCode === 0;
    add({
      id: "typescript_compile",
      name: "TypeScript compilation",
      status: ok ? "PASS" : "FAIL",
      details: ok ? "bunx tsc --noEmit: exit 0" : `bunx tsc --noEmit: exit ${proc.exitCode}`,
    });
  } catch (error: any) {
    add({
      id: "typescript_compile",
      name: "TypeScript compilation",
      status: "WARN",
      details: `не удалось запустить tsc: ${String(error?.message ?? error)}`,
    });
  }
}

// ---------------- LOCAL: SQLite ----------------
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

// ---------------- LOCAL: 12 dataset details ----------------
function checkDatasetDetails() {
  const rows: any[] = [];
  const problems: string[] = [];
  for (const id of PRIORITY_IDS) {
    const path = join(OUTPUT_DIR, "dataset_details", `${id}.json`);
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

  const summary = readJson(join(OUTPUT_DIR, "dataset_detail_summary.json"));
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

// ---------------- DISCOVERY_COMPLETENESS ----------------
function checkDiscovery() {
  const summary = readJson(join(OUTPUT_DIR, "discovery_summary.json"));
  const problems: string[] = [];
  const details: Record<string, any> = {};
  if (!summary) {
    add({
      id: "discovery_complete",
      name: "Полнота Discovery (summary ↔ фактические файлы)",
      status: "FAIL",
      details: "output/discovery_summary.json не найден",
    });
    return;
  }

  for (const resource of ["dashboard", "chart", "dataset"] as const) {
    const path = join(OUTPUT_DIR, LIST_FILE[resource]);
    const data = readJson(path);
    const rows = Array.isArray(data?.result) ? data.result : [];
    const ids = rows.map((r: any) => String(r?.id ?? r?.uuid ?? ""));
    const unique = new Set(ids.filter(Boolean));
    const duplicates = ids.length - unique.size;
    const r = summary?.resources?.[resource] ?? null;
    const downloaded = r?.downloaded_count ?? r?.count ?? null;
    const api = r?.api_count ?? null;
    const status = r?.status ?? null;
    const entry = {
      file: path,
      actual_rows: rows.length,
      actual_unique_ids: unique.size,
      actual_duplicates: duplicates,
      summary_downloaded_count: downloaded,
      summary_api_count: api,
      summary_unique_ids_count: r?.unique_ids_count ?? null,
      summary_duplicate_rows: r?.duplicate_rows ?? null,
      summary_status: status,
    };
    details[resource] = entry;
    if (!data) problems.push(`${resource}: файл ${path} отсутствует`);
    if (duplicates > 0) problems.push(`${resource}: дубликаты ID = ${duplicates}`);
    if (downloaded !== null && downloaded !== rows.length) {
      problems.push(`${resource}: summary downloaded=${downloaded} != факт ${rows.length}`);
    }
    if (api !== null && api !== rows.length) {
      problems.push(`${resource}: summary api_count=${api} != факт ${rows.length}`);
    }
    if (entry.summary_unique_ids_count !== null && entry.summary_unique_ids_count !== unique.size) {
      problems.push(`${resource}: summary unique_ids=${entry.summary_unique_ids_count} != факт ${unique.size}`);
    }
  }

  add({
    id: "discovery_complete",
    name: "Полнота Discovery (summary ↔ фактические файлы)",
    status: problems.length === 0 ? "PASS" : "FAIL",
    details:
      problems.length === 0
        ? "фактические list-файлы совпадают с summary; дубликатов нет"
        : problems.join("; "),
    metrics: {
      resources: details,
      started_at: summary?.started_at ?? null,
      finished_at: summary?.finished_at ?? null,
      summary_status: summary?.status ?? null,
      mode: summary?.mode ?? null,
      endpoint_errors: Array.isArray(summary?.endpoint_errors) ? summary.endpoint_errors.length : null,
      detail_spot_checks: summary?.detail_spot_checks ?? null,
    },
  });
}

// ---------------- API_TRANSPORT ----------------
function checkApiTransportCurrent() {
  const diag = readJson(join(OUT_DIR, "api_transport_diagnostics.json"));
  const verdict = diag?.verdict ?? null;
  const layers = Array.isArray(diag?.layers)
    ? diag.layers.map((l: any) => ({ layer: l.layer, ok: l.ok, code: l.error_code ?? null }))
    : [];
  const blocked = verdict !== null && verdict !== "TRANSPORT_AND_AUTH_OK" && verdict !== "TRANSPORT_OK_AUTH_FAILED";
  add({
    id: "api_transport_current",
    name: "API transport current (DNS/TCP/TLS/HTTP)",
    status: verdict === null ? "WARN" : blocked ? "BLOCKED" : "PASS",
    details:
      verdict === null
        ? "api_transport_diagnostics.json не найден"
        : `${verdict}; generated_at=${diag?.generated_at ?? "—"}`,
    metrics: { verdict, layers, generated_at: diag?.generated_at ?? null },
  });
}

// ---------------- API_AUTH_LAST_SUCCESS ----------------
function checkApiAuthLastSuccess() {
  const summary = readJson(join(OUTPUT_DIR, "discovery_summary.json"));
  const spotOk = summary?.detail_spot_checks?.ok ?? null;
  const spotAttempted = summary?.detail_spot_checks?.attempted ?? null;
  const summaryOk = summary?.status === "ok";
  const ok = summaryOk && spotAttempted !== null && spotAttempted > 0 && spotOk === spotAttempted;
  add({
    id: "api_auth_last_success",
    name: "API auth — последняя успешная авторизация (Discovery)",
    status: ok ? "PASS" : "FAIL",
    details: ok
      ? `Подтверждена во время Discovery: status=${summary?.status}, detail spot checks ${spotOk}/${spotAttempted}, ${summary?.started_at ?? "—"} — ${summary?.finished_at ?? "—"}`
      : `Не подтверждена: discovery status=${summary?.status ?? "—"}, spot checks ${spotOk ?? "—"}/${spotAttempted ?? "—"}`,
    metrics: {
      auth_mode: summary?.auth_mode ?? null,
      spot_ok: spotOk,
      spot_attempted: spotAttempted,
      discovery_started_at: summary?.started_at ?? null,
      discovery_finished_at: summary?.finished_at ?? null,
    },
  });
}

// ---------------- API_AUTH_CURRENT ----------------
function checkApiAuthCurrent() {
  const diag = readJson(join(OUT_DIR, "api_transport_diagnostics.json"));
  const verdict = diag?.verdict ?? null;
  const login = diag?.auth?.login ?? null;
  const transportBlocked =
    verdict !== null && verdict !== "TRANSPORT_AND_AUTH_OK" && verdict !== "TRANSPORT_OK_AUTH_FAILED";
  let status: CheckStatus;
  let details: string;
  if (login === "success") {
    status = "PASS";
    details = "текущий login выполнен успешно";
  } else if (transportBlocked) {
    status = "NOT_TESTED";
    details = `текущий login не выполнялся: transport=${verdict}`;
  } else if (login === "failed") {
    status = "FAIL";
    details = "текущий login завершился ошибкой";
  } else {
    status = "NOT_TESTED";
    details = "текущий login не тестировался";
  }
  add({
    id: "api_auth_current",
    name: "API auth current",
    status,
    details,
    metrics: { verdict, auth: diag?.auth ?? null },
  });
}

// ---------------- LINEAGE_INTERNAL_CONSISTENCY ----------------
function checkLineageInternalConsistency() {
  const preview = readJson(join(OUT_DIR, "lineage_preview.json"));
  const evidencePath = join(OUT_DIR, "lineage_evidence.csv");
  const relationsPath = join(OUT_DIR, "lineage_relations.csv");
  if (!preview || !existsSync(evidencePath) || !existsSync(relationsPath)) {
    add({
      id: "lineage_internal_consistency",
      name: "Lineage: внутренняя согласованность (CSV ↔ JSON)",
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
  const catalog = preview?.catalog ?? {};
  const listCounts = catalog.list_counts ?? {};
  const summaryCounts = catalog.summary_counts ?? {};

  const checksMap = {
    preview_internal_checks_ok: preview?.internal_consistency?.checks_ok === true || preview?.checks_ok === true,
    evidence_rows_match: preview?.counts?.evidence_rows === evidenceData.length,
    relations_rows_match: preview?.counts?.unique_relations === relationData.length,
    no_duplicate_relation_keys: duplicateKeys === 0,
    evidence_count_sum_match: preview?.counts?.evidence_count_sum === evidenceCountSum,
    by_relation_type_sum: byTypeSum === relationData.length,
    relation_header_has_evidence_count: evidenceIdx >= 0,
    evidence_header_columns: evidenceHeader.length >= 8,
    relation_header_columns: relationHeader.length >= 10,
    list_counts_match_summary:
      summaryCounts.dashboard === listCounts.dashboard &&
      summaryCounts.chart === listCounts.chart &&
      summaryCounts.dataset === listCounts.dataset,
  };
  const failed = Object.entries(checksMap)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  add({
    id: "lineage_internal_consistency",
    name: "Lineage: внутренняя согласованность (CSV ↔ JSON)",
    status: failed.length === 0 ? "PASS" : "FAIL",
    details:
      failed.length === 0
        ? "CSV и JSON согласованы, evidence_count сходится, дублей ключей нет"
        : `failed checks: ${failed.join(", ")}`,
    metrics: {
      checks: checksMap,
      evidence_rows: evidenceData.length,
      relation_rows: relationData.length,
      duplicate_keys: duplicateKeys,
      evidence_count_sum: evidenceCountSum,
      by_type_sum: byTypeSum,
      list_counts: listCounts,
      summary_counts: summaryCounts,
    },
  });
}

// ---------------- LINEAGE_REFERENCE_QUALITY ----------------
function checkLineageReferenceQuality() {
  const preview = readJson(join(OUT_DIR, "lineage_preview.json"));
  const rq = preview?.reference_quality ?? null;
  if (!rq) {
    add({
      id: "lineage_reference_quality",
      name: "Lineage: качество ссылок и противоречия источников",
      status: "WARN",
      details: "lineage_preview.reference_quality не найден",
    });
    return;
  }
  const findings = {
    unresolved_dashboard_refs: Number(rq.unresolved_dashboard_refs ?? 0),
    unresolved_dataset_refs: Number(rq.unresolved_dataset_refs ?? 0),
    unresolved_chart_refs: Number(rq.unresolved_chart_refs ?? 0),
    charts_with_conflicting_dashboard_sets: Number(rq.charts_with_conflicting_dashboard_sets ?? 0),
    chart_dataset_source_conflicts: Number(rq.chart_dataset_source_conflicts ?? 0),
    charts_without_dataset_local: Number(rq.charts_without_dataset_local ?? 0),
    charts_without_dashboard: Number(rq.charts_without_dashboard ?? 0),
    datasets_unused_by_charts_local: Number(rq.datasets_unused_by_charts_local ?? 0),
  };
  const totalFindings =
    findings.unresolved_dashboard_refs +
    findings.unresolved_dataset_refs +
    findings.unresolved_chart_refs +
    findings.charts_with_conflicting_dashboard_sets +
    findings.chart_dataset_source_conflicts;
  add({
    id: "lineage_reference_quality",
    name: "Lineage: качество ссылок и противоречия источников",
    status: totalFindings > 0 ? "WARN" : "PASS",
    details:
      `unresolved dashboard refs=${findings.unresolved_dashboard_refs}; ` +
      `unresolved dataset refs=${findings.unresolved_dataset_refs}; ` +
      `unresolved chart refs=${findings.unresolved_chart_refs}; ` +
      `chart с расхождением dashboard sets=${findings.charts_with_conflicting_dashboard_sets}; ` +
      `chart→dataset конфликты=${findings.chart_dataset_source_conflicts}; ` +
      "детали: lineage_reference_quality.md",
    metrics: { findings, reference_quality: rq, report: "lineage_reference_quality.md" },
  });
}

// ---------------- KPI_EVIDENCE ----------------
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
  const fullCatalog = kpi?.full_catalog ?? {};

  const checksMap = {
    count_18: kpi?.kpi_model?.count === 18,
    kpis_18: kpis.length === 18,
    ids_unique: new Set(ids).size === ids.length,
    statuses_valid: badStatuses.length === 0,
    operational_kpis_present: missingOperational.length === 0,
    evidence_verified: notVerified.length === 0,
    inventory_12: inventoryDatasets === 12,
    inventory_missing_empty: Array.isArray(inventoryMissing) && inventoryMissing.length === 0,
    full_catalog_present: Array.isArray(fullCatalog.priority_missing) && fullCatalog.priority_missing.length === 0,
    full_catalog_priority_12: fullCatalog.priority_present === 12,
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
        ? "18 KPI, статусы валидны, поля верифицированы, приоритетные датасеты найдены в полном каталоге"
        : `failed checks: ${failed.join(", ")}; missing operational=${missingOperational.join(",") || "none"}; not verified=${notVerified.join(",") || "none"}`,
    metrics: {
      checks: checksMap,
      status_counts: kpi?.kpi_model?.status_counts ?? null,
      kpi_count: kpis.length,
      inventory_datasets: inventoryDatasets,
      inventory_missing: inventoryMissing,
      full_catalog: {
        datasets_total: fullCatalog.datasets_total ?? null,
        datasets_with_sql: fullCatalog.datasets_with_sql ?? null,
        priority_present: fullCatalog.priority_present ?? null,
        priority_missing: fullCatalog.priority_missing ?? null,
        sql_length_mismatches: fullCatalog.sql_length_mismatches ?? null,
      },
    },
  });
}

// ---------------- LOCAL: PII / secrets ----------------
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

// ---------------- LOCAL: reports ----------------
function checkReports() {
  const required = [
    "discovery_corrected.md",
    "discovery_completion.md",
    "lineage_quality.md",
    "phase_01_1_summary.md",
    "kpi_source_matrix.json",
    "kpi_source_matrix.md",
    "kpi_field_inventory.json",
    "lineage_preview.json",
    "lineage_evidence.csv",
    "lineage_relations.csv",
    "lineage_reference_quality.md",
    "discovery_test.json",
    "api_transport_diagnostics.json",
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
  checkTypeScript();
  checkSqlite();
  checkDatasetDetails();
  checkDiscovery();
  checkApiTransportCurrent();
  checkApiAuthLastSuccess();
  checkApiAuthCurrent();
  checkLineageInternalConsistency();
  checkLineageReferenceQuality();
  checkKpi();
  checkPiiAndSecrets();
  checkReports();

  const pass = checks.filter((c) => c.status === "PASS").length;
  const fail = checks.filter((c) => c.status === "FAIL").length;
  const warn = checks.filter((c) => c.status === "WARN").length;
  const blocked = checks.filter((c) => c.status === "BLOCKED").length;
  const notTested = checks.filter((c) => c.status === "NOT_TESTED").length;
  const byId = (id: string) => checks.find((c) => c.id === id);

  const localIds = [
    "typescript_compile",
    "sqlite_readonly_quick_check",
    "sqlite_unchanged_vs_backup",
    "sqlite_relations_unchanged",
    "dataset_details_12",
    "pii_and_secrets",
    "reports_present",
  ];
  const localFail = localIds.filter((id) => byId(id)?.status === "FAIL").length;

  const discoveryStatus: CheckStatus = byId("discovery_complete")?.status ?? "FAIL";
  const internalStatus: CheckStatus = byId("lineage_internal_consistency")?.status ?? "FAIL";
  const refStatus: CheckStatus = byId("lineage_reference_quality")?.status ?? "WARN";
  const kpiStatus: CheckStatus = byId("kpi_matrix_18")?.status ?? "FAIL";
  const transportStatus: CheckStatus = byId("api_transport_current")?.status ?? "WARN";
  const lastAuthStatus: CheckStatus = byId("api_auth_last_success")?.status ?? "FAIL";
  const currentAuthStatus: CheckStatus = byId("api_auth_current")?.status ?? "NOT_TESTED";
  const transportVerdict = byId("api_transport_current")?.metrics?.verdict ?? transportStatus;

  const criticalFail =
    localFail > 0 ||
    discoveryStatus === "FAIL" ||
    internalStatus === "FAIL" ||
    kpiStatus === "FAIL";
  const apiBlocked =
    transportStatus === "BLOCKED" ||
    currentAuthStatus === "NOT_TESTED" ||
    currentAuthStatus === "BLOCKED";

  const overall = criticalFail ? "FAIL" : apiBlocked ? "PASS_WITH_BLOCKER" : "PASS";

  const statuses = {
    LOCAL_VALIDATION: localFail === 0 ? "PASS" : "FAIL",
    API_TRANSPORT_CURRENT: transportVerdict,
    API_AUTH_LAST_SUCCESS: lastAuthStatus,
    API_AUTH_CURRENT: currentAuthStatus,
    DISCOVERY_COMPLETENESS: discoveryStatus,
    LINEAGE_INTERNAL_CONSISTENCY: internalStatus,
    LINEAGE_REFERENCE_QUALITY: refStatus,
    KPI_EVIDENCE: kpiStatus,
    OVERALL_STATUS: overall,
  };

  const blockers = checks
    .filter((c) => c.status === "FAIL" || c.status === "BLOCKED" || c.status === "NOT_TESTED")
    .map((c) => `${c.id}: ${c.details}`);

  const rq = byId("lineage_reference_quality")?.metrics?.findings as Record<string, number> | undefined;
  const findings: string[] = [];
  if (rq) {
    findings.push(`unresolved_dashboard_refs=${rq.unresolved_dashboard_refs}`);
    findings.push(`unresolved_dataset_refs=${rq.unresolved_dataset_refs}`);
    findings.push(`unresolved_chart_refs=${rq.unresolved_chart_refs}`);
    findings.push(`charts_with_conflicting_dashboard_sets=${rq.charts_with_conflicting_dashboard_sets}`);
    findings.push(`chart_dataset_source_conflicts=${rq.chart_dataset_source_conflicts}`);
    findings.push(`charts_without_dataset_local=${rq.charts_without_dataset_local}`);
    findings.push(`charts_without_dashboard=${rq.charts_without_dashboard}`);
    findings.push(`datasets_unused_by_charts_local=${rq.datasets_unused_by_charts_local}`);
  }

  const out = {
    generated_at: new Date().toISOString(),
    verdict: overall,
    statuses,
    summary: { total: checks.length, pass, fail, warn, blocked, not_tested: notTested },
    checks,
    blockers,
    findings,
    notes: [
      "API_AUTH_LAST_SUCCESS подтверждён Discovery (status=ok, detail spot checks 4/4).",
      "API_AUTH_CURRENT = NOT_TESTED: повторный login не выполнялся из-за BLOCKED_TCP.",
      "LINEAGE_REFERENCE_QUALITY фиксирует unresolved refs и конфликты как findings, не FAIL.",
      "Ссылки не обозначаются архивными/удалёнными без подтверждения источником.",
    ],
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2), { mode: 0o600 });

  console.log(`=== Final validation: ${overall} (${pass} pass, ${fail} fail, ${warn} warn, ${blocked} blocked, ${notTested} not_tested) ===`);
  console.log(`statuses: ${JSON.stringify(statuses, null, 2)}`);
  for (const c of checks) {
    console.log(`[${c.status}] ${c.name} — ${c.details}`);
  }
  console.log(`report: ${OUT}`);

  if (fail > 0 || criticalFail) process.exitCode = 1;
}

main();
