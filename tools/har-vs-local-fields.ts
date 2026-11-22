// Compare column/metric names visible in HAR chart/data requests with the local catalog.
// Uses a quote-aware CSV reader (values contain commas and quotes).
import { readFileSync } from "node:fs";

function readCsv(rel: string): Array<Record<string, string>> {
  const text = readFileSync(rel, "utf8").replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch === "\r") { /* skip */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows
    .filter((r) => r.some((v) => v.length))
    .map((r) => {
      const o: Record<string, string> = {};
      header.forEach((h, i) => { o[h] = r[i] ?? ""; });
      return o;
    });
}

const har = JSON.parse(readFileSync("har.har", "utf8"));
const entries: any[] = har.log.entries;

type Bucket = { columns: Set<string>; metrics: Set<string>; filters: Set<string>; groupby: Set<string> };
const used = new Map<number, Bucket>();
const vizPerDataset = new Map<number, Set<string>>();
const rowLimits = new Map<number, Set<number>>();
const filterOps = new Map<number, Set<string>>();

function bucket(id: number): Bucket {
  let b = used.get(id);
  if (!b) { b = { columns: new Set(), metrics: new Set(), filters: new Set(), groupby: new Set() }; used.set(id, b); }
  return b;
}
function add<T>(m: Map<number, Set<T>>, id: number, v: T) {
  let s = m.get(id);
  if (!s) { s = new Set(); m.set(id, s); }
  s.add(v);
}

for (const e of entries) {
  if (!e.request.url.includes("/api/v1/chart/data")) continue;
  let body: any = null;
  try { body = JSON.parse(e.request.postData?.text ?? "null"); } catch { continue; }
  const id = body?.datasource?.id;
  if (typeof id !== "number") continue;
  const b = bucket(id);
  const fd = body?.form_data ?? {};
  if (fd.viz_type) add(vizPerDataset, id, String(fd.viz_type));
  for (const q of body?.queries ?? []) {
    for (const c of q.columns ?? []) b.columns.add(String(c));
    for (const m of q.metrics ?? []) b.metrics.add(String(m));
    for (const f of q.filters ?? []) {
      b.filters.add(String(f.col));
      add(filterOps, id, `${f.col} ${f.op}`);
    }
    if (typeof q.row_limit === "number") add(rowLimits, id, q.row_limit);
  }
  for (const g of fd.groupby ?? []) b.groupby.add(String(g));
  for (const m of fd.metrics ?? []) b.metrics.add(String(m));
  for (const f of fd.adhoc_filters ?? []) if (f.col) b.filters.add(String(f.col));
}

const inv = JSON.parse(readFileSync("reports/phase-01-6-2/datasets_inventory.json", "utf8").replace(/^\uFEFF/, ""));
const datasets: any[] = Array.isArray(inv) ? inv : inv.datasets;
const byId = new Map<number, any>(datasets.map((d) => [Number(d.dataset_id), d]));

const localCols = new Map<number, Set<string>>();
for (const r of readCsv("reports/phase-01-6-2/dataset_columns.csv")) {
  const id = Number(r.dataset_id);
  if (!Number.isFinite(id) || !r.column_name) continue;
  let s = localCols.get(id);
  if (!s) { s = new Set(); localCols.set(id, s); }
  s.add(r.column_name);
}
const localMetrics = new Map<number, Set<string>>();
for (const r of readCsv("reports/phase-01-6-2/dataset_metrics.csv")) {
  const id = Number(r.dataset_id);
  if (!Number.isFinite(id) || !r.metric_name) continue;
  let s = localMetrics.get(id);
  if (!s) { s = new Set(); localMetrics.set(id, s); }
  s.add(r.metric_name);
}

const report: any[] = [];
for (const [id, b] of [...used.entries()].sort((a, b2) => a[0] - b2[0])) {
  const lc = localCols.get(id) ?? new Set<string>();
  const lm = localMetrics.get(id) ?? new Set<string>();
  const referenced = new Set([...b.columns, ...b.filters, ...b.groupby]);
  report.push({
    dataset_id: id,
    name: byId.get(id)?.name ?? null,
    local_columns: lc.size,
    local_metrics: lm.size,
    har_fields: [...referenced],
    har_metrics: [...b.metrics],
    viz_types: [...(vizPerDataset.get(id) ?? [])],
    row_limits: [...(rowLimits.get(id) ?? [])],
    filter_ops: [...(filterOps.get(id) ?? [])],
    fields_absent_in_local_catalog: [...referenced].filter((c) => !lc.has(c)),
    metrics_absent_in_local_catalog: [...b.metrics].filter((m) => !lm.has(m) && !/^(count|COUNT\(\*\))$/.test(m)),
  });
}

await Bun.write("tools/har-vs-local-fields.json", JSON.stringify(report, null, 1));
const gapCols = report.filter((r) => r.fields_absent_in_local_catalog.length);
const gapMetrics = report.filter((r) => r.metrics_absent_in_local_catalog.length);
console.log("datasets compared:", report.length);
console.log("datasets whose HAR fields are all present locally:", report.length - gapCols.length);
console.log("datasets with HAR fields absent locally:", gapCols.length);
console.log("datasets with HAR metrics absent locally:", gapMetrics.length);
for (const r of report) {
  if (!r.fields_absent_in_local_catalog.length && !r.metrics_absent_in_local_catalog.length) continue;
  console.log(`${r.dataset_id} ${r.name}: localCols=${r.local_columns} localMetrics=${r.local_metrics} missingFields=[${r.fields_absent_in_local_catalog.join(",")}] missingMetrics=[${r.metrics_absent_in_local_catalog.join(",")}]`);
}
