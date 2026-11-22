/**
 * Этап 1.6.2 — синхронизация метаданных Superset (read-only, GET).
 *
 * Сохраняет в data/snapshots/phase-01-6-2/:
 *  - datasets.list.json       — все датасеты (list API, компактные поля)
 *  - charts.list.json         — все чарты (list API + разобранный params)
 *  - dashboards.list.json     — все дашборды (list API)
 *  - dashboards.detail.json   — детали дашбордов (json_metadata, native filters, chart ids)
 *  - datasets.detail.json     — детали P0/P1 датасетов (колонки, метрики, SQL)
 *  - manifest.json            — счётчики, время, ошибки, идемпотентность
 *
 * Идемпотентность: повторный запуск переиспользует готовые файлы, --force перезаписывает.
 * Никаких изменений в Superset, никаких POST кроме login.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BulkClient, q } from "./bulk";
import { SNAP, ensureDir, nowIso, readJson, writeJson } from "./utils";

const PAGE_SIZE = 1000;
const CONCURRENCY = 4;
const FORCE = process.argv.includes("--force");

const FILES = {
  datasetsList: join(SNAP, "datasets.list.json"),
  chartsList: join(SNAP, "charts.list.json"),
  dashboardsList: join(SNAP, "dashboards.list.json"),
  dashboardsDetail: join(SNAP, "dashboards.detail.json"),
  datasetsDetail: join(SNAP, "datasets.detail.json"),
  manifest: join(SNAP, "manifest.json"),
};

type Row = Record<string, any>;

function compactDatasetList(r: Row): Row {
  const sql = typeof r.sql === "string" ? r.sql : null;
  return {
    id: Number(r.id),
    name: r.table_name ?? r.name ?? null,
    schema: r.schema ?? null,
    database_id: r.database?.id ?? null,
    database_name: r.database?.database_name ?? null,
    catalog: r.catalog ?? null,
    kind: r.kind ?? null,
    description: r.description ?? null,
    sql,
    sql_len: sql ? sql.length : 0,
    sql_hash: sql ? createHash("sha256").update(sql).digest("hex") : null,
    changed_on: r.changed_on ?? null,
  };
}

function parseParams(raw: unknown): { ok: boolean; params: Row | null } {
  if (!raw) return { ok: false, params: null };
  if (typeof raw === "object") return { ok: true, params: raw as Row };
  try {
    return { ok: true, params: JSON.parse(String(raw)) };
  } catch {
    return { ok: false, params: null };
  }
}

function compactChart(r: Row): Row {
  const { ok, params } = parseParams(r.params);
  const p = params ?? {};
  return {
    id: Number(r.id),
    name: r.slice_name ?? r.name ?? null,
    viz_type: r.viz_type ?? p.viz_type ?? null,
    datasource_id: r.datasource_id ?? p.datasource ?? null,
    datasource_type: r.datasource_type ?? p.datasource_type ?? null,
    dashboards: Array.isArray(r.dashboards) ? r.dashboards.map((d: Row) => Number(d.id)) : [],
    description: r.description ?? null,
    certified_by: r.certified_by ?? null,
    changed_on: r.changed_on ?? null,
    params_parse_status: ok ? "PARSED" : "UNRESOLVED",
    params_hash: typeof r.params === "string" ? createHash("sha256").update(r.params).digest("hex") : null,
    form_data: {
      metrics: p.metrics ?? p.metric ?? null,
      groupby: p.groupby ?? p.group_by ?? null,
      adhoc_filters: p.adhoc_filters ?? null,
      filters: p.filters ?? null,
      time_range: p.time_range ?? null,
      granularity_sqla: p.granularity_sqla ?? p.granularity ?? null,
      row_limit: p.row_limit ?? null,
      columns: p.columns ?? null,
      order_by: p.order_by ?? null,
      series_limit: p.series_limit ?? null,
      percent_metrics: p.percent_metrics ?? null,
      timeseries_limit_metric: p.timeseries_limit_metric ?? null,
      url_params: p.url_params ?? null,
    },
  };
}

function compactDashboardList(r: Row): Row {
  return {
    id: Number(r.id),
    title: r.dashboard_title ?? r.title ?? null,
    slug: r.slug ?? null,
    published: Boolean(r.published),
    description: r.description ?? null,
    changed_on: r.changed_on ?? null,
  };
}

function compactDashboardDetail(res: Row): Row {
  const jmRaw = res.json_metadata;
  let jm: Row = {};
  if (typeof jmRaw === "string") {
    try {
      jm = JSON.parse(jmRaw);
    } catch {
      jm = {};
    }
  } else if (jmRaw && typeof jmRaw === "object") {
    jm = jmRaw as Row;
  }
  let pos: Row = {};
  if (typeof res.position_json === "string") {
    try {
      pos = JSON.parse(res.position_json);
    } catch {
      pos = {};
    }
  } else if (res.position_json && typeof res.position_json === "object") {
    pos = res.position_json as Row;
  }
  const chartIds: number[] = [];
  for (const v of Object.values(pos)) {
    const meta = (v as Row)?.meta;
    if (meta?.chartId) chartIds.push(Number(meta.chartId));
  }
  const nfc = jm.native_filter_configuration ?? jm.native_filters ?? [];
  const filters = (Array.isArray(nfc) ? nfc : []).map((f: Row) => ({
    id: f.id ?? null,
    name: f.name ?? null,
    filter_type: f.filterType ?? null,
    targets: (f.targets ?? []).map((t: Row) => ({
      dataset_id: t.datasetId ?? t.dataset_id ?? null,
      column: t.column?.name ?? t.column ?? null,
    })),
    default_value: f.defaultDataMask?.filterState?.value ?? f.defaultDataMask?.value ?? null,
    extra_form_data: f.defaultDataMask?.extraFormData ?? null,
    default_to_first_item: Boolean(f.controlValues?.defaultToFirstItem),
    multi_select: Boolean(f.controlValues?.multiSelect),
    scope_excluded: f.scope?.excluded ?? [],
  }));
  return {
    id: Number(res.id),
    title: res.dashboard_title ?? null,
    slug: res.slug ?? null,
    published: Boolean(res.published),
    description: res.description ?? null,
    chart_ids: [...new Set(chartIds)],
    native_filters: filters,
    default_filters: jm.default_filters ?? null,
    chart_configuration_keys: Object.keys(jm.chart_configuration ?? {}),
    cross_filters_enabled: Boolean(jm.cross_filters_enabled),
    css_len: typeof res.css === "string" ? res.css.length : 0,
    changed_on: res.changed_on ?? null,
  };
}

function compactDatasetDetail(res: Row): Row {
  const cols = Array.isArray(res.columns) ? res.columns : [];
  const metrics = Array.isArray(res.metrics) ? res.metrics : [];
  return {
    id: Number(res.id),
    name: res.table_name ?? res.name ?? null,
    schema: res.schema ?? null,
    database_id: res.database?.id ?? null,
    database_name: res.database?.database_name ?? null,
    kind: res.kind ?? null,
    description: res.description ?? null,
    sql: typeof res.sql === "string" ? res.sql : null,
    main_dttm_col: res.main_dttm_col ?? null,
    columns: cols.map((c: Row) => ({
      name: c.column_name ?? c.name ?? null,
      type: c.type ?? null,
      is_dttm: Boolean(c.is_dttm),
      filterable: c.filterable !== false,
      groupby: c.groupby !== false,
      is_active: c.is_active !== false,
      description: c.description ?? null,
      expression: c.expression ?? null,
      verbose_name: c.verbose_name ?? null,
    })),
    metrics: metrics.map((m: Row) => ({
      name: m.metric_name ?? m.name ?? null,
      verbose_name: m.verbose_name ?? null,
      expression: m.expression ?? null,
      description: m.description ?? null,
      d3format: m.d3format ?? null,
      warning_text: m.warning_text ?? null,
    })),
    changed_on: res.changed_on ?? null,
  };
}

async function listResource(client: BulkClient, resource: string): Promise<Row[]> {
  const first = await client.get(`/api/v1/${resource}/?q=${q(`(page:0,page_size:${PAGE_SIZE})`)}`);
  if (!first.ok) throw new Error(`${resource} list page 0 failed: HTTP ${first.status} ${first.text.slice(0, 200)}`);
  const count = Number(first.body?.count ?? 0);
  const firstRows: Row[] = Array.isArray(first.body?.result) ? first.body.result : [];
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const rest = Array.from({ length: pages - 1 }, (_, i) => i + 1);
  const pageRows = await client.pool(
    rest,
    async (page) => {
      const r = await client.get(`/api/v1/${resource}/?q=${q(`(page:${page},page_size:${PAGE_SIZE})`)}`);
      if (!r.ok) throw new Error(`${resource} page ${page} failed: HTTP ${r.status}`);
      return (Array.isArray(r.body?.result) ? r.body.result : []) as Row[];
    },
    CONCURRENCY,
  );
  const rows = firstRows.concat(...pageRows);
  const ids = new Set(rows.map((r) => String(r.id)));
  if (rows.length !== count || ids.size !== count) {
    throw new Error(`${resource}: downloaded ${rows.length} (unique ${ids.size}) vs count ${count}`);
  }
  return rows;
}

async function main() {
  ensureDir(SNAP);
  const started = nowIso();
  const manifest: Row = {
    stage: "1.6.2",
    started_at: started,
    page_size: PAGE_SIZE,
    concurrency: CONCURRENCY,
    force: FORCE,
    resources: {},
    errors: [],
    client: {},
  };

  const client = new BulkClient();
  await client.login();
  console.log(`[sync] login OK, page_size=${PAGE_SIZE}, concurrency=${CONCURRENCY}`);

  // ---- datasets list
  if (!FORCE && existsSync(FILES.datasetsList)) {
    const rows = readJson<Row[]>(FILES.datasetsList) ?? [];
    manifest.resources.datasets_list = { count: rows.length, reused: true };
    console.log(`[sync] datasets list reused: ${rows.length}`);
  } else {
    const t0 = Date.now();
    const rows = await listResource(client, "dataset");
    const compact = rows.map(compactDatasetList);
    writeJson(FILES.datasetsList, compact);
    manifest.resources.datasets_list = { count: compact.length, ms: Date.now() - t0, reused: false };
    console.log(`[sync] datasets list: ${compact.length} in ${Date.now() - t0}ms`);
  }

  // ---- charts list
  if (!FORCE && existsSync(FILES.chartsList)) {
    const rows = readJson<Row[]>(FILES.chartsList) ?? [];
    manifest.resources.charts_list = { count: rows.length, reused: true };
    console.log(`[sync] charts list reused: ${rows.length}`);
  } else {
    const t0 = Date.now();
    const rows = await listResource(client, "chart");
    const compact = rows.map(compactChart);
    writeJson(FILES.chartsList, compact);
    manifest.resources.charts_list = { count: compact.length, ms: Date.now() - t0, reused: false };
    console.log(`[sync] charts list: ${compact.length} in ${Date.now() - t0}ms`);
  }

  // ---- dashboards list
  let dashboards: Row[] = [];
  if (!FORCE && existsSync(FILES.dashboardsList)) {
    dashboards = readJson<Row[]>(FILES.dashboardsList) ?? [];
    manifest.resources.dashboards_list = { count: dashboards.length, reused: true };
    console.log(`[sync] dashboards list reused: ${dashboards.length}`);
  } else {
    const t0 = Date.now();
    const rows = await listResource(client, "dashboard");
    dashboards = rows.map(compactDashboardList);
    writeJson(FILES.dashboardsList, dashboards);
    manifest.resources.dashboards_list = { count: dashboards.length, ms: Date.now() - t0, reused: false };
    console.log(`[sync] dashboards list: ${dashboards.length} in ${Date.now() - t0}ms`);
  }

  // ---- dashboards detail
  if (!FORCE && existsSync(FILES.dashboardsDetail)) {
    const rows = readJson<Row[]>(FILES.dashboardsDetail) ?? [];
    manifest.resources.dashboards_detail = { count: rows.length, reused: true };
    console.log(`[sync] dashboards detail reused: ${rows.length}`);
  } else {
    const t0 = Date.now();
    const ids = dashboards.map((d) => d.id);
    let done = 0;
    const details = await client.pool(
      ids,
      async (id) => {
        const r = await client.get(`/api/v1/dashboard/${id}`);
        done++;
        if (done % 50 === 0) console.log(`[sync] dashboards detail ${done}/${ids.length}`);
        if (!r.ok) {
          manifest.errors.push(`dashboard ${id}: HTTP ${r.status}`);
          return null;
        }
        const res = r.body?.result ?? r.body;
        return compactDashboardDetail(res);
      },
      CONCURRENCY,
    );
    const compact = details.filter(Boolean) as Row[];
    writeJson(FILES.dashboardsDetail, compact);
    manifest.resources.dashboards_detail = { count: compact.length, requested: ids.length, ms: Date.now() - t0, reused: false };
    console.log(`[sync] dashboards detail: ${compact.length}/${ids.length} in ${Date.now() - t0}ms`);
  }

  // ---- datasets detail (P0 + P1)
  if (!FORCE && existsSync(FILES.datasetsDetail)) {
    const rows = readJson<Row[]>(FILES.datasetsDetail) ?? [];
    manifest.resources.datasets_detail = { count: rows.length, reused: true };
    console.log(`[sync] datasets detail reused: ${rows.length}`);
  } else {
    const t0 = Date.now();
    const candidates = JSON.parse(readFileSync("reports/phase-01-4/03_dataset_candidates.json", "utf8"));
    const arr: Row[] = Array.isArray(candidates) ? candidates : candidates.datasets ?? [];
    const targets = arr.filter((c) => ["P0", "P1"].includes(String(c.priority ?? c.p)));
    const ids = [...new Set(targets.map((c) => Number(c.dataset_id ?? c.id)))].filter((n) => Number.isFinite(n));
    let done = 0;
    const details = await client.pool(
      ids,
      async (id) => {
        const r = await client.get(`/api/v1/dataset/${id}`);
        done++;
        if (done % 50 === 0) console.log(`[sync] datasets detail ${done}/${ids.length}`);
        if (!r.ok) {
          manifest.errors.push(`dataset ${id}: HTTP ${r.status}`);
          return null;
        }
        const res = r.body?.result ?? r.body;
        return compactDatasetDetail(res);
      },
      CONCURRENCY,
    );
    const compact = details.filter(Boolean) as Row[];
    writeJson(FILES.datasetsDetail, compact);
    manifest.resources.datasets_detail = { count: compact.length, requested: ids.length, ms: Date.now() - t0, reused: false };
    console.log(`[sync] datasets detail: ${compact.length}/${ids.length} in ${Date.now() - t0}ms`);
  }

  manifest.finished_at = nowIso();
  manifest.client = { requests: client.requests, retries: client.retries, errors: client.errors.slice(0, 50) };
  manifest.completed = true;
  writeJson(FILES.manifest, manifest);
  console.log(`[sync] done in ${(Date.now() - Date.parse(started)) / 1000}s; requests=${client.requests} retries=${client.retries} errors=${client.errors.length}`);
}

main().catch((e) => {
  console.error("[sync] FAILED:", e);
  process.exitCode = 1;
});
