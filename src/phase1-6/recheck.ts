/**
 * Этап 1.6 — повторная проверка блокера SQL Lab (BLOCK-1).
 * Read-only. Не перезаписывает исходное доказательство sqllab_diagnostics.json:
 * пишет результат в evidence/blocker_recheck_<timestamp>.json.
 *
 * Назначение: установить, не выданы ли учётной записи права SQL Lab после
 * предыдущего раунда. Запросы-пробы — только SELECT 1 (без побочных эффектов).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config";
import { SqlLabClient } from "./client";

const REPORTS = "reports/phase-01-6";

async function main() {
  const started = new Date().toISOString();
  const cfg = loadConfig();
  const client = new SqlLabClient(cfg);
  const out: any = {
    generated_at: started,
    purpose: "Повторная проверка BLOCK-1: доступность SQL Lab / chart data для учётной записи API.",
    probes: [],
    verdict: null as string | null,
  };

  try {
    await client.login();
    out.login = "OK";
  } catch (e: any) {
    out.login = "FAILED";
    out.login_error = String(e?.message ?? e);
    const stamp = started.replace(/[:.]/g, "-");
    mkdirSync(join(REPORTS, "evidence"), { recursive: true });
    writeFileSync(join(REPORTS, "evidence", `blocker_recheck_${stamp}.json`), JSON.stringify(out, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  try {
    out.csrf = await client.getCsrf();
  } catch (e: any) {
    out.csrf = `FAILED: ${String(e?.message ?? e)}`;
  }

  const me = await client.get("/api/v1/me/");
  out.me = {
    status: me.status,
    roles: me.body?.result?.roles ?? null,
    user_present: Boolean(me.body?.result?.id),
  };

  const probes: Array<{ label: string; path: string; method: "GET" | "POST"; body?: unknown }> = [
    { label: "database-list", path: "/api/v1/database/?q=" + encodeURIComponent("(page:0,page_size:50)"), method: "GET" },
    { label: "sqllab-get", path: "/api/v1/sqllab/", method: "GET" },
    { label: "sqllab-execute-select1", path: "/api/v1/sqllab/execute/", method: "POST", body: { database_id: 92, sql: "SELECT 1 AS probe", json: true, runAsync: false, schema: null, expand_data: true, select_as_cta: false, client_id: crypto.randomUUID(), queryLimit: 10 } },
    { label: "sqllab-estimate", path: "/api/v1/sqllab/estimate/", method: "POST", body: { database_id: 92, sql: "SELECT 1", schema: null } },
    { label: "chart-data-7802", path: "/api/v1/chart/data", method: "POST", body: { datasource: { id: 7802, type: "table" }, queries: [{ granularity: "dt", groupby: [], metrics: [{ expressionType: "SIMPLE", column: { column_name: "id_shift" }, aggregate: "COUNT", label: "cnt" }], time_range: "No filter", row_limit: 1, is_timeseries: false }], form_data: { datasource: "7802__table", viz_type: "table", time_range: "No filter" }, result_type: "full", result_format: "json" } },
  ];

  for (const p of probes) {
    const t0 = Date.now();
    try {
      const r = p.method === "GET" ? await client.get(p.path) : await client.post(p.path, p.body);
      out.probes.push({
        label: p.label,
        method: p.method,
        path: p.path,
        http_status: r.status,
        ok: r.ok,
        ms: Date.now() - t0,
        body_keys: r.body && typeof r.body === "object" ? Object.keys(r.body).slice(0, 12) : null,
        preview: JSON.stringify(r.body ?? r.text).slice(0, 400),
      });
    } catch (e: any) {
      out.probes.push({ label: p.label, method: p.method, path: p.path, error: String(e?.message ?? e), ms: Date.now() - t0 });
    }
  }

  const execute = out.probes.find((p: any) => p.label === "sqllab-execute-select1");
  const dbs = out.probes.find((p: any) => p.label === "database-list");
  const dbCount = dbs?.body_keys ? null : null;
  let visibleDbs: number | null = null;
  try {
    const raw = dbs?.preview ?? "";
    const m = raw.match(/"count"\s*:\s*(\d+)/);
    if (m) visibleDbs = Number(m[1]);
  } catch {
    /* noop */
  }
  out.visible_databases = visibleDbs;

  const sqlOk = execute?.http_status === 200;
  out.verdict = sqlOk ? "SQL_LAB_AVAILABLE" : "SQL_LAB_BLOCKED";
  out.note = sqlOk
    ? "Права SQL Lab доступны — можно выполнять план из reports/phase-01-6/query_plan.json."
    : "BLOCK-1 сохраняется: права SQL Lab не выданы.";

  const stamp = started.replace(/[:.]/g, "-");
  mkdirSync(join(REPORTS, "evidence"), { recursive: true });
  writeFileSync(join(REPORTS, "evidence", `blocker_recheck_${stamp}.json`), JSON.stringify(out, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ verdict: out.verdict, visible_databases: out.visible_databases, probes: out.probes.map((p: any) => ({ label: p.label, status: p.http_status, ms: p.ms })) }, null, 2));
}

main();
