/**
 * Этап 1.6 — диагностика SQL Lab: права, CSRF, альтернативные маршруты.
 * Read-only. Никаких изменений в Superset.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config";
import { SqlLabClient } from "./client";

const REPORTS = "reports/phase-01-6";
function write(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
}

async function main() {
  const cfg = loadConfig();
  const client = new SqlLabClient(cfg);
  const out: any = { generated_at: new Date().toISOString(), sql_execution_enabled_env: Bun.env.SQL_EXECUTION_ENABLED ?? null, probes: [] };

  await client.login();
  const csrf = await client.getCsrf();
  out.csrf = csrf;

  const me = await client.get("/api/v1/me/");
  out.me = { status: me.status, roles: me.body?.result?.roles ?? null, user_id_present: Boolean(me.body?.result?.id), first_name_present: Boolean(me.body?.result?.first_name) };

  const endpoints: Array<{ label: string; path: string; method: "GET" | "POST"; body?: unknown }> = [
    { label: "sqllab-execute-clickhouse", path: "/api/v1/sqllab/execute/", method: "POST", body: { database_id: 92, sql: "SELECT 1 AS probe", json: true, runAsync: false, schema: null, expand_data: true, select_as_cta: false, client_id: crypto.randomUUID(), queryLimit: 10 } },
    { label: "sqllab-execute-gp", path: "/api/v1/sqllab/execute/", method: "POST", body: { database_id: 76, sql: "SELECT 1 AS probe", json: true, runAsync: false, schema: "agile_mart_operational", expand_data: true, select_as_cta: false, client_id: crypto.randomUUID(), queryLimit: 10 } },
    { label: "sqllab-estimate", path: "/api/v1/sqllab/estimate/", method: "POST", body: { database_id: 92, sql: "SELECT 1", schema: null } },
    { label: "legacy-sql-json", path: "/superset/sql_json/", method: "POST", body: { database_id: 92, sql: "SELECT 1 AS probe", json: true, runAsync: false, client_id: crypto.randomUUID() } },
    { label: "chart-data-7802", path: "/api/v1/chart/data", method: "POST", body: { datasource: { id: 7802, type: "table" }, queries: [{ granularity: "dt", groupby: [], metrics: [{ expressionType: "SIMPLE", column: { column_name: "id_shift" }, aggregate: "COUNT", label: "cnt" }], time_range: "No filter", row_limit: 10, is_timeseries: false }], form_data: { datasource: "7802__table", viz_type: "table", time_range: "No filter" }, result_type: "full", result_format: "json" } },
    { label: "chart-data-3466", path: "/api/v1/chart/data", method: "POST", body: { datasource: { id: 3466, type: "table" }, queries: [{ granularity: "date_order", groupby: [], metrics: [{ expressionType: "SIMPLE", column: { column_name: "id_order" }, aggregate: "COUNT", label: "cnt" }], time_range: "No filter", row_limit: 10, is_timeseries: false }], form_data: { datasource: "3466__table", viz_type: "table", time_range: "No filter" }, result_type: "full", result_format: "json" } },
    { label: "chart-data-5939", path: "/api/v1/chart/data", method: "POST", body: { datasource: { id: 5939, type: "table" }, queries: [{ granularity: "date", groupby: [], metrics: [{ expressionType: "SIMPLE", column: { column_name: "person_code" }, aggregate: "COUNT", label: "cnt" }], time_range: "No filter", row_limit: 10, is_timeseries: false }], form_data: { datasource: "5939__table", viz_type: "table", time_range: "No filter" }, result_type: "full", result_format: "json" } },
    { label: "sqllab-get", path: "/api/v1/sqllab/", method: "GET" },
    { label: "chart-list", path: "/api/v1/chart/?q=" + encodeURIComponent("(page:0,page_size:1)"), method: "GET" },
    { label: "database-list", path: "/api/v1/database/?q=" + encodeURIComponent("(page:0,page_size:50)"), method: "GET" },
  ];

  for (const e of endpoints) {
    try {
      const r = e.method === "GET" ? await client.get(e.path) : await client.post(e.path, e.body);
      out.probes.push({ label: e.label, path: e.path, method: e.method, http_status: r.status, ok: r.ok, body_keys: r.body && typeof r.body === "object" ? Object.keys(r.body).slice(0, 12) : null, body_preview: JSON.stringify(r.body ?? r.text).slice(0, 700) });
    } catch (err: any) {
      out.probes.push({ label: e.label, path: e.path, method: e.method, error: String(err?.message ?? err) });
    }
  }

  write(join(REPORTS, "evidence", "sqllab_diagnostics.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ csrf: out.csrf, me: out.me, probes: out.probes.map((p: any) => ({ label: p.label, status: p.http_status, ok: p.ok, preview: (p.body_preview ?? p.error ?? "").slice(0, 200) })) }, null, 2));
}

main();
