// Analyze chart/data POST bodies in a HAR and print a compact summary.
const harPath = process.argv[2] ?? "har.har";
const har = JSON.parse(await Bun.file(harPath).text());
const entries: any[] = har.log.entries;

const rows: any[] = [];
let n = 0;
for (const e of entries) {
  if (!e.request.url.includes("/api/v1/chart/data")) continue;
  n++;
  const u = new URL(e.request.url);
  let body: any = null;
  try { body = JSON.parse(e.request.postData?.text ?? "null"); } catch { body = null; }
  const q = body?.queries?.[0] ?? {};
  const fd = body?.form_data ?? {};
  rows.push({
    n,
    method: e.request.method,
    status: e.response.status,
    ms: Math.round(e.time),
    started: e.startedDateTime,
    qs: Object.fromEntries(u.searchParams.entries()),
    datasource: body?.datasource ?? null,
    viz_type: fd.viz_type ?? null,
    slice_id: fd.slice_id ?? null,
    result_type: fd.result_type ?? q.result_type ?? null,
    result_format: fd.result_format ?? null,
    queries_count: Array.isArray(body?.queries) ? body.queries.length : 0,
    columns: q.columns ?? fd.groupby ?? [],
    metrics: q.metrics ?? fd.metrics ?? [],
    filters: (q.filters ?? []).map((f: any) => ({ col: f.col, op: f.op, val: f.val })),
    adhoc_filters: (fd.adhoc_filters ?? []).map((f: any) => ({ col: f.col ?? f.subject, op: f.op, comparator: f.comparator, expressionType: f.expressionType })),
    row_limit: q.row_limit ?? fd.row_limit ?? null,
    time_range: q.time_range ?? fd.time_range ?? null,
    granularity: q.granularity ?? fd.granularity_sqla ?? null,
    extras: q.extras ?? null,
    native_filter_id: fd.native_filter_id ?? null,
    groupby: fd.groupby ?? null,
  });
}

const byStatus: Record<string, number> = {};
const byDs: Record<string, number> = {};
const byViz: Record<string, number> = {};
const byResultType: Record<string, number> = {};
for (const r of rows) {
  byStatus[String(r.status)] = (byStatus[String(r.status)] ?? 0) + 1;
  const ds = r.datasource ? `${r.datasource.id}__${r.datasource.type}` : "none";
  byDs[ds] = (byDs[ds] ?? 0) + 1;
  byViz[String(r.viz_type)] = (byViz[String(r.viz_type)] ?? 0) + 1;
  byResultType[String(r.result_type)] = (byResultType[String(r.result_type)] ?? 0) + 1;
}

const out = { count: rows.length, byStatus, byDatasource: byDs, byVizType: byViz, byResultType, rows };
await Bun.write("tools/har-chartdata.json", JSON.stringify(out, null, 1));
console.log("chart/data entries:", rows.length);
console.log("status:", JSON.stringify(byStatus));
console.log("datasources:", JSON.stringify(byDs));
console.log("viz_type:", JSON.stringify(byViz));
console.log("result_type:", JSON.stringify(byResultType));
