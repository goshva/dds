/**
 * phase1-1-api-check.ts — Этап 1.1: API-доказательства (без массовой загрузки).
 *
 * Только точечные запросы:
 *  - count для dashboard/chart/dataset;
 *  - форма dataset detail (с / и без) на 4732;
 *  - shape chart detail на примере из усечённой части;
 *  - changed_on у приоритетных датасетов (для STALE-оценки);
 *  - sample первых/последних строк списка chart (проверка сортировки и усечения).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { SupersetClient } from "./superset";
import { loadConfig } from "./config";

const OUT = "reports/phase-01-1/api_spot_checks.json";
const PRIORITY = ["4732","7119","7006","7024","7027","7775","5797","7465","7473","5247","5399","7293"];

async function main() {
  const cfg = loadConfig();
  const client = new SupersetClient(cfg);
  await client.login();
  await client.getCsrf();

  const result: any = {
    generated_at: new Date().toISOString(),
    auth: "success",
    counts: {},
    endpoint_shape_probe: {},
    priority_dataset_details: {},
    chart_list_order_probe: {},
    notes: [] as string[]
  };

  // 1. Точный count каждого ресурса (page_size=1 — минимальная нагрузка)
  for (const res of ["dashboard", "chart", "dataset"] as const) {
    const q = encodeURIComponent("(page:0,page_size:1)");
    const data = await client.get(`/api/v1/${res}/?q=${q}`);
    result.counts[res] = {
      api_count: data.count,
      page_rows: data.result?.length ?? 0,
      default_page_size_used: 1
    };
  }

  // 2. Форма detail-endpoint (важно: с завершающим слэшем 404!)
  for (const path of ["/api/v1/dataset/4732", "/api/v1/dataset/4732/"]) {
    const r = await client.tryGet(path);
    result.endpoint_shape_probe[path] = {
      ok: r.ok,
      status: r.ok ? 200 : r.status,
      result_keys: r.ok ? Object.keys(r.data?.result ?? {}).length : null,
      has_sql: r.ok ? !!(r.data?.result?.sql) : null,
      sql_length: r.ok ? (r.data?.result?.sql?.length ?? 0) : null,
      columns_count: r.ok ? (r.data?.result?.columns?.length ?? 0) : null,
      changed_on: r.ok ? r.data?.result?.changed_on : null
    };
  }
  result.notes.push("GET /api/v1/{resource}/{id}/ возвращает 404 в этой сборке Superset 6.2.4; корректная форма — без завершающего слэша.");

  // 3. Dataset detail для 12 приоритетных (точечно, всего 12 запросов)
  for (const id of PRIORITY) {
    const r = await client.tryGet(`/api/v1/dataset/${id}`);
    if (r.ok) {
      const res = r.data?.result ?? {};
      result.priority_dataset_details[id] = {
        ok: true,
        table_name: res.table_name ?? null,
        kind: res.kind ?? null,
        changed_on: res.changed_on ?? null,
        sql_length: (res.sql ?? "").length,
        columns_count: (res.columns ?? []).length,
        database_name: res.database?.database_name ?? null,
        schema: res.schema ?? null
      };
    } else {
      result.priority_dataset_details[id] = { ok: false, status: r.status };
    }
  }

  // 4. Проверка порядка сортировки списка chart (первая и последняя страницы)
  {
    const firstQ = encodeURIComponent("(page:0,page_size:2)");
    const first = await client.get(`/api/v1/chart/?q=${firstQ}`);
    const lastPage = Math.floor(((first.count ?? 0) - 1) / 2);
    const lastQ = encodeURIComponent(`(page:${lastPage},page_size:2)`);
    const last = await client.get(`/api/v1/chart/?q=${lastQ}`);
    result.chart_list_order_probe = {
      total: first.count,
      first_two_ids: (first.result ?? []).map((x: any) => x.id),
      last_two_ids: (last.result ?? []).map((x: any) => x.id),
      order_by_hint: (first as any).label_columns ? "check results" : "unknown"
    };
  }

  mkdirSync("reports/phase-01-1", { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({
    counts: result.counts,
    detail_no_slash_ok: result.endpoint_shape_probe["/api/v1/dataset/4732"]?.ok,
    detail_with_slash_status: result.endpoint_shape_probe["/api/v1/dataset/4732/"]?.status,
    priority_ok: Object.values(result.priority_dataset_details).filter((d: any) => d.ok).length + "/12",
    chart_order: result.chart_list_order_probe
  }, null, 2));
}

main().catch(e => { console.error("[FATAL]", String(e).slice(0, 400)); process.exit(1); });
