/**
 * Этап 1.6.2 — разведка API Superset: какие read-only маршруты реально доступны.
 * Только GET. Ничего не изменяет. Пишет reports/phase-01-6-2/evidence/endpoint_probe.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config";
import { SqlLabClient } from "../phase1-6/client";

const OUT = "reports/phase-01-6-2/evidence";

const CANDIDATES: Array<{ label: string; path: string }> = [
  { label: "openapi-swagger", path: "/swagger/v1/swagger.json" },
  { label: "openapi-json", path: "/api/v1/openapi.json" },
  { label: "dataset-list", path: "/api/v1/dataset/?q=" + encodeURIComponent("(page:0,page_size:1)") },
  { label: "chart-list", path: "/api/v1/chart/?q=" + encodeURIComponent("(page:0,page_size:1)") },
  { label: "dashboard-list", path: "/api/v1/dashboard/?q=" + encodeURIComponent("(page:0,page_size:1)") },
  { label: "dataset-3466", path: "/api/v1/dataset/3466" },
  { label: "dataset-7802", path: "/api/v1/dataset/7802" },
  { label: "chart-32584", path: "/api/v1/chart/32584" },
  { label: "dashboard-1680", path: "/api/v1/dashboard/1680" },
  { label: "dashboard-1680-filter-state", path: "/api/v1/dashboard/1680/filter_state" },
  { label: "dashboard-1680-filters", path: "/api/v1/dashboard/1680/filters" },
  { label: "dashboard-1680-charts", path: "/api/v1/dashboard/1680/charts" },
  { label: "dataset-3466-related", path: "/api/v1/dataset/3466/related_objects" },
  { label: "dataset-3466-col-values", path: "/api/v1/dataset/3466/column/date_order/values" },
  { label: "datasource-table-3466-col-values", path: "/api/v1/datasource/table/3466/column/date_order/values" },
  { label: "datasource-table-3466-col-values-slash", path: "/api/v1/datasource/table/3466/column/date_order/values/" },
  { label: "table-3466-col-values", path: "/api/v1/table/3466/column/date_order/values" },
  { label: "query-list", path: "/api/v1/query/?q=" + encodeURIComponent("(page:0,page_size:1)") },
  { label: "database-92", path: "/api/v1/database/92" },
  { label: "database-76", path: "/api/v1/database/76" },
  { label: "me", path: "/api/v1/me/" },
];

async function main() {
  const client = new SqlLabClient(loadConfig());
  await client.login();
  await client.getCsrf();
  const started = new Date().toISOString();
  const out: any = { generated_at: started, probes: [] };
  for (const c of CANDIDATES) {
    const t0 = Date.now();
    try {
      const r = await client.get(c.path);
      let preview = "";
      try {
        preview = JSON.stringify(r.body ?? r.text).slice(0, 500);
      } catch {
        preview = String(r.text).slice(0, 500);
      }
      out.probes.push({ label: c.label, path: c.path, status: r.status, ok: r.ok, ms: Date.now() - t0, preview });
    } catch (e: any) {
      out.probes.push({ label: c.label, path: c.path, error: String(e?.message ?? e), ms: Date.now() - t0 });
    }
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "endpoint_probe.json"), JSON.stringify(out, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(out.probes.map((p: any) => ({ label: p.label, status: p.status, ms: p.ms })), null, 2));
}

main();
