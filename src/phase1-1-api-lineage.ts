/**
 * phase1-1-api-lineage.ts — точечный API-запрос: все charts для 12 приоритетных dataset.
 *
 * Superset 6.2 использует фильтр с ключом "opr" (не "operator"):
 *   GET /api/v1/chart/?q={"page_size":100,"filters":[{"col":"datasource_id","opr":"eq","value":<id>}]}
 *
 * Результат: reports/phase-01-1/api_chart_links_priority.json
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { SupersetClient } from "./superset";
import { loadConfig } from "./config";

const PRIORITY = ["4732","7119","7006","7024","7027","7775","5797","7465","7473","5247","5399","7293"];

async function main() {
  const cfg = loadConfig();
  const client = new SupersetClient(cfg);
  await client.login();

  const out: any = { generated_at: new Date().toISOString(), api_request_format: 'GET /api/v1/chart/?q={"page_size":N,"filters":[{"col":"datasource_id","opr":"eq","value":ID}]}', by_dataset: {} };

  for (const dsId of PRIORITY) {
    let page = 0;
    const all: any[] = [];
    while (true) {
      const q = encodeURIComponent(JSON.stringify({
        page, page_size: 100,
        filters: [{ col: "datasource_id", opr: "eq", value: Number(dsId) }]
      }));
      const r = await client.tryGet(`/api/v1/chart/?q=${q}`);
      if (!r.ok) { out.by_dataset[dsId] = { error: true, status: r.status }; break; }
      const rows = r.data?.result ?? [];
      all.push(...rows.map((c: any) => ({ id: c.id, name: c.slice_name, viz_type: c.viz_type, dashboards: c.dashboards ?? null })));
      if (rows.length < 100 || all.length >= (r.data?.count ?? 0)) {
        out.by_dataset[dsId] = { count: r.data?.count ?? all.length, charts: all };
        break;
      }
      page++;
      if (page > 20) { out.by_dataset[dsId] = { count: r.data?.count, truncated: true, charts: all }; break; }
    }
  }

  // сверка с локальным каталогом
  const { Database } = await import("bun:sqlite");
  const db = new Database("data/catalog.sqlite", { readonly: true });
  const chartIds = new Set((db.query("SELECT object_id FROM objects WHERE object_type=?").all("chart") as any[]).map(r => r.object_id));
  const detailIds = new Set((db.query("SELECT object_id FROM objects WHERE object_type=?").all("chart_detail") as any[]).map(r => r.object_id));

  let totalApiCharts = 0, inCatalog = 0, withDetail = 0;
  for (const v of Object.values(out.by_dataset) as any[]) {
    for (const c of v.charts ?? []) {
      totalApiCharts++;
      if (chartIds.has(String(c.id))) inCatalog++;
      if (detailIds.has(String(c.id))) withDetail++;
    }
  }
  out.summary = {
    priority_datasets: PRIORITY.length,
    total_charts_api: totalApiCharts,
    charts_present_in_local_catalog: inCatalog,
    charts_with_local_detail: withDetail,
    charts_absent_from_catalog: totalApiCharts - inCatalog
  };
  db.close();

  mkdirSync("reports/phase-01-1", { recursive: true });
  writeFileSync("reports/phase-01-1/api_chart_links_priority.json", JSON.stringify(out, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(out.summary, null, 2));
  for (const ds of PRIORITY) {
    const v = out.by_dataset[ds];
    console.log(`dataset ${ds}: charts=${v.count ?? "ERR"} | sample ids: ${(v.charts ?? []).slice(0,3).map((c:any)=>c.id).join(",")}`);
  }
}

main().catch(e => { console.error("[FATAL]", String(e).slice(0, 300)); process.exit(1); });
