/**
 * Этап 1.6, фаза 1.6.1 — проверка подключения к Superset и SQL Lab, снятие метаданных 6 датасетов.
 * Read-only: только GET + один пробный SELECT через SQL Lab.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config";
import { SqlLabClient, redactSql } from "./client";
import { scanPii16 } from "./pii16";

const REPORTS = "reports/phase-01-6";
const META_DIR = join(REPORTS, "evidence", "dataset_metadata");
const TARGETS = [5939, 7802, 7712, 7021, 3466, 2339];

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
function write(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
}

function safeDatasetMetadata(detail: any): any {
  const r = detail?.result ?? {};
  const rawSql = typeof r.sql === "string" ? r.sql : "";
  const redacted = redactSql(rawSql);
  const pii = scanPii16(redacted);
  const sources = new Set<string>();
  for (const m of redacted.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)?(?:\.[a-zA-Z_][\w]*)?)/gi)) sources.add(m[1]);
  for (const m of redacted.matchAll(/\b(?:from|join)\s+"([^"]+)"\.([a-zA-Z_][\w]*)/gi)) sources.add(`${m[1]}.${m[2]}`);
  const ctes = new Set<string>();
  for (const m of redacted.matchAll(/(?:^|,|\()\s*([a-zA-Z_][\w]*)\s+as\s*\(/gi)) ctes.add(m[1]);
  const cteSet = new Set([...ctes].map((c) => c.toLowerCase()));
  const physical = [...sources].filter((s) => !cteSet.has(s.toLowerCase()) && s.includes("."));
  const unknown = [...sources].filter((s) => !cteSet.has(s.toLowerCase()) && !s.includes("."));
  return {
    dataset_id: r.id ?? null,
    table_name: r.table_name ?? null,
    kind: r.kind ?? null,
    schema: r.schema ?? null,
    database: r.database ? { id: r.database.id ?? null, name: r.database.database_name ?? null, backend: r.database.backend ?? null } : null,
    description: typeof r.description === "string" && scanPii16(r.description).length === 0 ? r.description.slice(0, 500) : null,
    main_dttm_col: r.main_dttm_col ?? null,
    changed_on: r.changed_on ?? null,
    sql_len: rawSql.length,
    sql_sha256: sha256(rawSql),
    sql_redacted: pii.length ? null : redacted.slice(0, 6000),
    sql_redaction_note: pii.length ? `redacted SQL contains PII patterns: ${pii.map((p) => p.name).join(",")}` : null,
    sql_sources_physical: physical,
    sql_sources_unknown: unknown,
    sql_ctes: [...ctes],
    columns_count: Array.isArray(r.columns) ? r.columns.length : 0,
    columns: (r.columns ?? []).map((c: any) => ({
      column_name: c.column_name ?? null,
      type: c.type ?? null,
      is_dttm: c.is_dttm ?? null,
      filterable: c.filterable ?? null,
      groupby: c.groupby ?? null,
      is_active: c.is_active ?? null,
    })),
    metrics_count: Array.isArray(r.metrics) ? r.metrics.length : 0,
    metric_names: (r.metrics ?? []).map((m: any) => m.metric_name ?? null).filter(Boolean),
    owners_present: Array.isArray(r.owners) ? r.owners.length : 0,
  };
}

async function main() {
  const cfg = loadConfig();
  const client = new SqlLabClient(cfg);
  const started = Date.now();
  const out: any = { generated_at: new Date().toISOString(), base_url_host: new URL(cfg.baseUrl).host, steps: {}, datasets: [], probe: null, errors: [] };

  // 1. login
  try {
    await client.login();
    out.steps.login = { ok: true, auth_mode: cfg.accessToken ? "jwt" : "username-password" };
  } catch (e: any) {
    out.steps.login = { ok: false, error: String(e?.message ?? e) };
    out.errors.push(`login: ${String(e?.message ?? e)}`);
  }

  // 2. csrf
  const csrf = await client.getCsrf();
  out.steps.csrf = { ok: csrf.ok, http_status: csrf.status };

  // 3. databases
  try {
    const dbs = await client.databases();
    out.steps.databases = { ok: true, count: dbs.length, list: dbs.map((d: any) => ({ id: d.id, name: d.database_name ?? d.name, backend: d.backend ?? null, allow_dml: d.allow_dml ?? null, expose_in_sqllab: d.expose_in_sqllab ?? null })) };
  } catch (e: any) {
    out.steps.databases = { ok: false, error: String(e?.message ?? e) };
    out.errors.push(`databases: ${String(e?.message ?? e)}`);
  }

  // 4. dataset metadata
  for (const id of TARGETS) {
    const detail = await client.datasetDetail(id);
    if (!detail?.result) {
      out.datasets.push({ dataset_id: id, ok: false, error: "detail недоступен" });
      out.errors.push(`dataset ${id}: detail недоступен`);
      continue;
    }
    const meta = safeDatasetMetadata(detail);
    write(join(META_DIR, `${id}.json`), JSON.stringify(meta, null, 2));
    out.datasets.push({ dataset_id: id, ok: true, table_name: meta.table_name, kind: meta.kind, schema: meta.schema, database: meta.database, columns_count: meta.columns_count, metrics_count: meta.metrics_count, sql_len: meta.sql_len, sql_redacted_present: Boolean(meta.sql_redacted) });
  }

  // 5. SQL Lab probe на ClickHouse базе датасета 3466
  const ds3466 = out.datasets.find((d: any) => d.dataset_id === 3466);
  const probeDb = ds3466?.database?.id ?? out.steps.databases?.list?.[0]?.id;
  if (probeDb) {
    const probe = await client.execute({ databaseId: Number(probeDb), sql: "SELECT 1 AS probe", schema: null, limit: 10, label: "Q-016-000-probe" });
    out.probe = { database_id: probeDb, status: probe.status, row_count: probe.rowCount, columns: probe.columns, errors: probe.errors, duration_ms: probe.durationMs };
    if (probe.status !== "success") out.errors.push(`SQL Lab probe: ${probe.status} ${probe.errors.join("; ")}`);
  } else {
    out.probe = { status: "NOT_RUN", reason: "не определён database_id" };
    out.errors.push("SQL Lab probe не выполнен: нет database_id");
  }

  const log = client.getLog();
  write(join(REPORTS, "evidence", "query_execution_log.json"), JSON.stringify({ generated_at: new Date().toISOString(), note: "журнал пополняется на каждом этапе 1.6", queries: log }, null, 2));
  write(join(REPORTS, "evidence", "connectivity_probe.json"), JSON.stringify({ ...out, total_duration_ms: Date.now() - started }, null, 2));

  const md: string[] = [];
  md.push("# 01. Аудит доступа к Superset и SQL Lab");
  md.push("");
  md.push(`Сгенерировано: ${out.generated_at}; хост: \`${out.base_url_host}\`.`);
  md.push("");
  md.push("## Шаги");
  md.push("");
  md.push(`- login: ${out.steps.login?.ok ? "OK" : "FAIL"} (${out.steps.login?.auth_mode ?? "—"})`);
  md.push(`- CSRF: ${out.steps.csrf?.ok ? "OK" : "FAIL"} (HTTP ${out.steps.csrf?.http_status})`);
  md.push(`- базы данных: ${out.steps.databases?.ok ? `OK, доступно ${out.steps.databases.count}` : "FAIL"}`);
  md.push(`- SQL Lab probe: ${out.probe?.status} (rows=${out.probe?.row_count ?? "—"}, ${out.probe?.duration_ms ?? "—"} ms)`);
  md.push("");
  md.push("## Доступные базы данных");
  md.push("");
  md.push("| ID | Название | Backend | expose_in_sqllab | allow_dml |");
  md.push("|---|---|---|---|---|");
  for (const d of out.steps.databases?.list ?? []) md.push(`| ${d.id} | ${d.name} | ${d.backend ?? "—"} | ${d.expose_in_sqllab ?? "—"} | ${d.allow_dml ?? "—"} |`);
  md.push("");
  md.push("## Метаданные шести датасетов");
  md.push("");
  md.push("| Dataset | Таблица | Тип | Schema | DB | Колонок | Метрик | SQL (redacted) |");
  md.push("|---|---|---|---|---|---:|---:|---|");
  for (const d of out.datasets) {
    md.push(`| ${d.dataset_id} | ${d.table_name ?? "—"} | ${d.kind ?? "—"} | ${d.schema ?? "—"} | ${d.database?.name ?? "—"} (${d.database?.backend ?? "—"}) | ${d.columns_count ?? "—"} | ${d.metrics_count ?? "—"} | ${d.sql_redacted_present ? "есть" : "скрыт/нет"} |`);
  }
  md.push("");
  md.push("Сырые SQL датасетов не сохраняются: комментарии содержат авторские ПДн. Хранятся sha256, длина и обезличенный текст.");
  md.push("");
  md.push("## Ошибки");
  md.push("");
  if (!out.errors.length) md.push("- нет");
  else for (const e of out.errors) md.push(`- ${e}`);
  md.push("");
  write(join(REPORTS, "01_superset_access_audit.md"), md.join("\n"));

  console.log(JSON.stringify({ login: out.steps.login, csrf: out.steps.csrf, databases: out.steps.databases?.count ?? 0, datasets_ok: out.datasets.filter((d: any) => d.ok).length, probe: out.probe?.status, errors: out.errors }, null, 2));
  if (out.errors.length) process.exitCode = 2;
}

main();
