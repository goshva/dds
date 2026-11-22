// Cross-reference: which datasets appear in the HAR (as datasource or /dataset/{id} fetch)
// vs which datasets the local repository catalog knows about.
import { readFileSync } from "node:fs";

const har = JSON.parse(readFileSync("har.har", "utf8"));
const entries: any[] = har.log.entries;

// 1) datasets requested directly
const datasetDetailIds = new Set<number>();
for (const e of entries) {
  const m = new URL(e.request.url).pathname.match(/^\/api\/v1\/dataset\/(\d+)$/);
  if (m) datasetDetailIds.add(Number(m[1]));
}

// 2) datasets used as chart/data datasource
const chartDataIds = new Map<number, number>();
for (const e of entries) {
  if (!e.request.url.includes("/api/v1/chart/data")) continue;
  let body: any = null;
  try { body = JSON.parse(e.request.postData?.text ?? "null"); } catch { /* ignore */ }
  const id = body?.datasource?.id;
  if (typeof id === "number") chartDataIds.set(id, (chartDataIds.get(id) ?? 0) + 1);
}

// 3) local catalog
const catalog = JSON.parse(readFileSync("reports/phase-01-6-2/datasets_inventory.json", "utf8"));
const datasets: any[] = Array.isArray(catalog) ? catalog : catalog.datasets;
const byId = new Map<number, any>(datasets.map((d) => [Number(d.dataset_id), d]));

const all = [...new Set([...datasetDetailIds, ...chartDataIds.keys()])].sort((a, b) => a - b);
const report = all.map((id) => {
  const inv = byId.get(id);
  return {
    dataset_id: id,
    in_har_detail: datasetDetailIds.has(id),
    chart_data_requests: chartDataIds.get(id) ?? 0,
    in_local_catalog: Boolean(inv),
    local_name: inv?.name ?? null,
    local_schema: inv?.schema ?? null,
    local_database: inv?.database_name ?? null,
    local_kind: inv?.kind ?? null,
    local_priority: inv?.priority ?? null,
    local_columns_count: inv?.columns_count ?? null,
    local_metrics_count: inv?.metrics_count ?? null,
    local_detail_loaded: inv?.detail_loaded ?? null,
    local_access: inv?.access ?? null,
  };
});

const unknown = report.filter((r) => !r.in_local_catalog).map((r) => r.dataset_id);
const known = report.filter((r) => r.in_local_catalog).map((r) => r.dataset_id);

console.log("HAR datasets total:", all.length);
console.log("present in local catalog:", known.length);
console.log("absent from local catalog:", unknown.length, unknown.join(","));
console.log("local catalog size:", datasets.length);
console.log("");
console.log("id | harDetail | chartDataReq | localName | priority | kind | cols | detailLoaded");
for (const r of report) {
  console.log(
    [r.dataset_id, r.in_har_detail ? "Y" : "-", r.chart_data_requests, r.local_name ?? "<NOT IN CATALOG>", r.local_priority ?? "-", r.local_kind ?? "-", r.local_columns_count ?? "-", r.local_detail_loaded === null ? "-" : String(r.local_detail_loaded)].join(" | "),
  );
}

await Bun.write("tools/har-dataset-crossref.json", JSON.stringify({ report, unknown, known, localCatalogSize: datasets.length }, null, 1));
