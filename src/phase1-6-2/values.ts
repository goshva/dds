/**
 * Этап 1.6.2, Этапы C/D — извлечение доступных значений колонок из разрешённых источников.
 *
 * Источники значений (по убыванию достоверности):
 *  1. dashboard_native_filter — значения по умолчанию в фильтрах дашбордов (FILTER_VALUES)
 *  2. chart_adhoc_filter / chart_legacy_filter — литералы в определениях чартов (SQL_DERIVED)
 *  3. saved_query — литералы в сохранённых SQL-запросах (SQL_DERIVED)
 *  4. metadata — только описание колонки (METADATA_ONLY)
 *  5. not_available — значений получить нельзя (NOT_AVAILABLE)
 *
 * SQL Lab и chart data недоступны (403/401), поэтому фактических распределений нет.
 * Пишет: reports/phase-01-6-2/column_values.json, analysis_package/column_values.csv,
 *        reports/phase-01-6-2/evidence/values_sources.json
 */
import { join } from "node:path";
import { BulkClient, q } from "./bulk";
import { extractColumnLiterals } from "./sqlliterals";
import {
  EVIDENCE, REPORTS, SNAP, ensureDir, isPiiColumn, isPiiValue, nowIso, readJson, redactDeep, writeCsv, writeJson,
} from "./utils";

const PACKAGE = "analysis_package";

type ColumnValue = {
  dataset_id: number;
  dataset_name: string | null;
  column_name: string;
  column_type: string | null;
  source: string;
  retrieval_status: "SUCCESS" | "PARTIAL" | "NOT_AVAILABLE";
  evidence_status: "FILTER_VALUES" | "SQL_DERIVED" | "METADATA_ONLY" | "NOT_AVAILABLE";
  distinct_count: number | null;
  null_count: number | null;
  empty_count: number | null;
  min_value: string | null;
  max_value: string | null;
  top_values: Array<{ value: string; count: number; sources: string[] }>;
  all_values: string[];
  sample_limit: number;
  is_complete: boolean;
  evidence_ref: string;
  notes: string;
};

type Obs = {
  dataset_id: number;
  column: string;
  values: Map<string, { count: number; sources: Set<string>; chart_ids: Set<number>; dashboard_ids: Set<number> }>;
  ops: Set<string>;
};

function asArray(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.flatMap((x) => asArray(x));
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("value" in o) return asArray(o.value);
    if ("label" in o) return asArray(o.label);
    return [];
  }
  const s = String(v).trim();
  if (!s) return [];
  if (/^(no filter|none|null|undefined|nan)$/i.test(s)) return [];
  return [s];
}

function isTechnicalValue(v: string): boolean {
  return /^(1970-01-01|0000-00-00|9999-12-31|1900-01-01)$/i.test(v);
}

function datasetIdOf(ds: unknown): number | null {
  if (ds === null || ds === undefined) return null;
  if (typeof ds === "number") return ds;
  const m = String(ds).match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

async function fetchSavedQueries(client: BulkClient): Promise<any[]> {
  const out: any[] = [];
  try {
    const r = await client.get(`/api/v1/query/?q=${q("(page:0,page_size:100)")}`);
    if (!r.ok) return out;
    const count = Number(r.body?.count ?? 0);
    const pages = Math.max(1, Math.ceil(count / 100));
    const first = Array.isArray(r.body?.result) ? r.body.result : [];
    out.push(...first);
    for (let p = 1; p < pages; p++) {
      const rr = await client.get(`/api/v1/query/?q=${q(`(page:${p},page_size:100)`)}`);
      if (rr.ok && Array.isArray(rr.body?.result)) out.push(...rr.body.result);
    }
  } catch {
    /* сохранённые запросы недоступны — не критично */
  }
  return out;
}

function extractSqlLiterals(sql: string): string[] {
  const values: string[] = [];
  // IN ('a','b','c') и = 'x'
  const inRe = /\b(?:in|not\s+in)\s*\(([^)]{0,2000})\)/gi;
  for (const m of sql.matchAll(inRe)) {
    for (const part of m[1].split(",")) {
      const t = part.trim().replace(/^'|'$/g, "");
      if (t && !/^\d+$/.test(t) && t.length < 80) values.push(t);
    }
  }
  const eqRe = /=\s*'([^']{1,80})'/g;
  for (const m of sql.matchAll(eqRe)) {
    const t = m[1].trim();
    if (t && !/^\d+$/.test(t)) values.push(t);
  }
  return values;
}

async function main() {
  ensureDir(EVIDENCE);
  ensureDir(PACKAGE);

  const datasetsList = readJson<any[]>(join(SNAP, "datasets.list.json")) ?? [];
  const datasetsDetail = readJson<any[]>(join(SNAP, "datasets.detail.json")) ?? [];
  const charts = readJson<any[]>(join(SNAP, "charts.list.json")) ?? [];
  const dashboardsDetail = readJson<any[]>(join(SNAP, "dashboards.detail.json")) ?? [];

  const dsName = new Map<number, string>();
  for (const d of datasetsList) dsName.set(Number(d.id), d.name ?? null);

  const dsColumns = new Map<number, Map<string, any>>();
  for (const d of datasetsDetail) {
    const m = new Map<string, any>();
    for (const c of d.columns ?? []) m.set(String(c.name), c);
    dsColumns.set(Number(d.id), m);
  }

  const obs = new Map<string, Obs>();
  const add = (datasetId: number | null, column: string | null, value: string, source: string, extra: { chart_id?: number; dashboard_id?: number; op?: string } = {}) => {
    if (datasetId === null || !column) return;
    const key = `${datasetId}::${column}`;
    let o = obs.get(key);
    if (!o) {
      o = { dataset_id: datasetId, column, values: new Map(), ops: new Set() };
      obs.set(key, o);
    }
    if (extra.op) o.ops.add(extra.op);
    let v = o.values.get(value);
    if (!v) {
      v = { count: 0, sources: new Set(), chart_ids: new Set(), dashboard_ids: new Set() };
      o.values.set(value, v);
    }
    v.count++;
    v.sources.add(source);
    if (extra.chart_id) v.chart_ids.add(extra.chart_id);
    if (extra.dashboard_id) v.dashboard_ids.add(extra.dashboard_id);
  };

  // ---- 1. чарты: adhoc_filters / filters
  let chartsWithFilters = 0;
  for (const c of charts) {
    const dsId = datasetIdOf(c.datasource_id);
    if (dsId === null) continue;
    const fd = c.form_data ?? {};
    let used = false;
    for (const f of fd.adhoc_filters ?? []) {
      if (!f || typeof f !== "object") continue;
      const type = String(f.expressionType ?? "SIMPLE").toUpperCase();
      if (type !== "SIMPLE") continue;
      const col = f.col ?? f.subject ?? null;
      if (!col) continue;
      const vals = asArray(f.comparator);
      if (vals.length === 0) continue;
      used = true;
      for (const v of vals) add(dsId, String(col), v, "chart_adhoc_filter", { chart_id: Number(c.id), op: f.op ?? f.operator });
    }
    for (const f of fd.filters ?? []) {
      if (!f || typeof f !== "object") continue;
      const col = f.col ?? null;
      const vals = asArray(f.val);
      if (!col || vals.length === 0) continue;
      used = true;
      for (const v of vals) add(dsId, String(col), v, "chart_legacy_filter", { chart_id: Number(c.id), op: f.op });
    }
    if (used) chartsWithFilters++;
  }

  // ---- 2. дашборды: native filters
  let dashboardsWithFilters = 0;
  for (const d of dashboardsDetail) {
    let used = false;
    for (const f of d.native_filters ?? []) {
      const vals = asArray(f.default_value);
      if (vals.length === 0) continue;
      used = true;
      for (const t of f.targets ?? []) {
        for (const v of vals) add(Number(t.dataset_id), t.column, v, "dashboard_native_filter", { dashboard_id: Number(d.id) });
      }
    }
    const df = d.default_filters;
    if (df && typeof df === "object") {
      for (const [k, v] of Object.entries(df)) {
        const dsId = datasetIdOf(k);
        if (dsId === null) continue;
        for (const vv of asArray(v)) {
          used = true;
          add(dsId, null, vv, "dashboard_default_filter", { dashboard_id: Number(d.id) });
        }
      }
    }
    if (used) dashboardsWithFilters++;
  }

  // ---- 3. сохранённые запросы (SQL_DERIVED)
  const client = new BulkClient();
  let queries: any[] = [];
  try {
    await client.login();
    queries = await fetchSavedQueries(client);
  } catch (e: any) {
    // Сеть/VPN недоступны — работаем на локальном fallback-снимке, без сохранённых запросов.
    console.error(`[values] saved queries unavailable: ${String(e?.message ?? e).slice(0, 200)}`);
  }
  writeJson(join(SNAP, "queries.json"), queries.map((x) => ({ id: x.id, label: x.label ?? null, schema: x.schema ?? null, sql: typeof x.sql === "string" ? x.sql.slice(0, 4000) : null })));

  const rows: ColumnValue[] = [];
  const now = nowIso();
  const evidenceRef = "reports/phase-01-6-2/column_values.json";

  // 3a. значения из сохранённых запросов — без привязки к датасету (нет dataset_id в API),
  // поэтому они попадают только в сводку, а не в column_values по колонкам.
  const queryLiterals: string[] = [];
  for (const qrow of queries) {
    if (typeof qrow.sql !== "string") continue;
    for (const v of extractSqlLiterals(qrow.sql)) queryLiterals.push(v);
  }

  // ---- 3b. литералы из SQL датасетов с привязкой к колонкам (SQL_DERIVED)
  // Датасеты P0/P1 = те, чьи детали загружены в datasetsDetail.
  let sqlLiteralDatasets = 0;
  let sqlLiteralValues = 0;
  const sqlLiteralColumns = new Set<string>();
  for (const d of datasetsDetail) {
    const dsId = Number(d.id);
    const sql = typeof d.sql === "string" ? d.sql : "";
    if (!sql) continue;
    const colNames = (d.columns ?? []).map((c: any) => String(c.name));
    const literals = extractColumnLiterals(sql, colNames);
    if (literals.length === 0) continue;
    for (const lit of literals) {
      add(dsId, lit.column, lit.value, "dataset_sql", { op: lit.op });
      sqlLiteralColumns.add(`${dsId}::${lit.column}`);
      sqlLiteralValues++;
    }
    sqlLiteralDatasets++;
  }

  // ---- 4. собираем column_values по датасетам P0/P1
  const detailIds = new Set(datasetsDetail.map((d) => Number(d.id)));
  for (const d of datasetsDetail) {
    const dsId = Number(d.id);
    const cols = d.columns ?? [];
    for (const c of cols) {
      const colName = String(c.name);
      const key = `${dsId}::${colName}`;
      const o = obs.get(key);
      const type = c.type ?? null;
      const isDttm = Boolean(c.is_dttm);
      const rawSorted = o ? [...o.values.entries()].sort((a, b) => b[1].count - a[1].count) : [];
      // PII-колонка или PII-значения — не выгружаем: ни имена, ни почты, ни телефоны.
      const pii = isPiiColumn(colName) || rawSorted.some(([v]) => isPiiValue(v));
      if (o && !pii) {
        const sorted = rawSorted;
        const top = sorted.slice(0, 100).map(([value, meta]) => ({
          value,
          count: meta.count,
          sources: [...meta.sources],
        }));
        const all = sorted.slice(0, 500).map(([value]) => value);
        const hasDashboard = sorted.some(([, m]) => m.sources.has("dashboard_native_filter"));
        const hasChart = sorted.some(([, m]) => m.sources.has("chart_adhoc_filter") || m.sources.has("chart_legacy_filter"));
        const hasDatasetSql = sorted.some(([, m]) => m.sources.has("dataset_sql"));
        rows.push({
          dataset_id: dsId,
          dataset_name: dsName.get(dsId) ?? null,
          column_name: colName,
          column_type: type,
          source: hasDashboard ? "dashboard_filter" : hasChart ? "chart_data" : hasDatasetSql ? "dataset_sql" : "metadata",
          retrieval_status: hasDashboard ? "SUCCESS" : "PARTIAL",
          evidence_status: hasDashboard ? "FILTER_VALUES" : "SQL_DERIVED",
          distinct_count: null,
          null_count: null,
          empty_count: null,
          min_value: null,
          max_value: null,
          top_values: top,
          all_values: all,
          sample_limit: 500,
          is_complete: false,
          evidence_ref: evidenceRef,
          notes: hasDatasetSql && !hasDashboard && !hasChart
            ? `Литералы из SQL-определения датасета (${[...o.ops].join(", ") || "op не указан"}); это не распределение данных и не факт наличия значения.`
            : `Значения из определений фильтров (${[...o.ops].join(", ") || "op не указан"}); это не распределение данных.`,
        });
      } else {
        rows.push({
          dataset_id: dsId,
          dataset_name: dsName.get(dsId) ?? null,
          column_name: colName,
          column_type: type,
          source: "metadata",
          retrieval_status: "NOT_AVAILABLE",
          evidence_status: pii ? "METADATA_ONLY" : "NOT_AVAILABLE",
          distinct_count: null,
          null_count: null,
          empty_count: null,
          min_value: null,
          max_value: null,
          top_values: [],
          all_values: [],
          sample_limit: 500,
          is_complete: false,
          evidence_ref: evidenceRef,
          notes: pii
            ? "Колонка или её значения содержат PII — значения намеренно не выгружались."
            : "SQL Lab и chart data недоступны (403/401); фактических значений получить нельзя.",
        });
      }
    }
  }

  // 4b. колонки датасетов, для которых есть значения, но нет деталей (P2) — добавляем с null-типом
  for (const [key, o] of obs) {
    if (detailIds.has(o.dataset_id)) continue;
    const sorted = [...o.values.entries()].sort((a, b) => b[1].count - a[1].count);
    if (isPiiColumn(o.column) || sorted.some(([v]) => isPiiValue(v))) continue;
    const hasDashboard = sorted.some(([, m]) => m.sources.has("dashboard_native_filter"));
    const hasChart = sorted.some(([, m]) => m.sources.has("chart_adhoc_filter") || m.sources.has("chart_legacy_filter"));
    const hasDatasetSql = sorted.some(([, m]) => m.sources.has("dataset_sql"));
    rows.push({
      dataset_id: o.dataset_id,
      dataset_name: dsName.get(o.dataset_id) ?? null,
      column_name: o.column,
      column_type: null,
      source: hasDashboard ? "dashboard_filter" : hasChart ? "chart_data" : hasDatasetSql ? "dataset_sql" : "metadata",
      retrieval_status: hasDashboard ? "SUCCESS" : "PARTIAL",
      evidence_status: hasDashboard ? "FILTER_VALUES" : "SQL_DERIVED",
      distinct_count: null,
      null_count: null,
      empty_count: null,
      min_value: null,
      max_value: null,
      top_values: sorted.slice(0, 100).map(([value, meta]) => ({ value, count: meta.count, sources: [...meta.sources] })),
      all_values: sorted.slice(0, 500).map(([v]) => v),
      sample_limit: 500,
      is_complete: false,
      evidence_ref: evidenceRef,
      notes: hasDashboard
        ? "Значения по умолчанию native-фильтров дашбордов; детали датасета не загружались (P2)."
        : "Значения из определений чартов/датасетов; детали датасета не загружались (P2).",
    });
  }

  writeJson(join(REPORTS, "column_values.json"), redactDeep({
    generated_at: now,
    classification: {
      ACTUAL_VALUES: "значения из результатов запросов/данных — недоступны (SQL Lab 403, chart data 401)",
      FILTER_VALUES: "значения по умолчанию в фильтрах дашбордов",
      SQL_DERIVED: "литералы в определениях чартов, датасетов и сохранённых SQL",
      METADATA_ONLY: "только описание колонки",
      NOT_AVAILABLE: "значения получить нельзя",
    },
    summary: {
      datasets_detail: datasetsDetail.length,
      charts: charts.length,
      charts_with_filters: chartsWithFilters,
      dashboards: dashboardsDetail.length,
      dashboards_listed: (readJson<any[]>(join(SNAP, "dashboards.list.json")) ?? []).length,
      dashboards_detail_available: dashboardsDetail.length > 0,
      dashboards_with_filters: dashboardsWithFilters,
      saved_queries: queries.length,
      saved_query_literals: queryLiterals.length,
      sync_mode: (() => {
        const m = readJson<any>(join(SNAP, "manifest.json"));
        return m?.source === "CACHED_ARTIFACTS" ? "CACHED" : "LIVE";
      })(),
      sources_note: dashboardsDetail.length > 0
        ? "Live-синхронизация: значения из native-фильтров дашбордов (FILTER_VALUES), adhoc/legacy-фильтров чартов и SQL-определений датасетов (SQL_DERIVED). Это не распределения данных: SQL Lab и chart data по-прежнему недоступны."
        : "Сеть/VPN недоступны: значения взяты из локального fallback-снимка. В кэше чартов 1.4 adhoc_filters и filters пусты, деталей дашбордов нет — поэтому FILTER_VALUES не получены. SQL_DERIVED — литералы из SQL-определений датасетов.",
      sql_literal_datasets: sqlLiteralDatasets,
      sql_literal_values: sqlLiteralValues,
      sql_literal_columns: sqlLiteralColumns.size,
      columns_with_values: rows.filter((r) => r.retrieval_status !== "NOT_AVAILABLE").length,
      columns_not_available: rows.filter((r) => r.retrieval_status === "NOT_AVAILABLE").length,
      rows: rows.length,
    },
    saved_query_literals_sample: queryLiterals.slice(0, 200),
    columns: rows,
  }));

  writeCsv(
    join(PACKAGE, "column_values.csv"),
    ["domain", "dataset_id", "dataset_name", "column_name", "data_type", "value", "frequency", "source", "evidence_status"],
    rows.flatMap((r) => {
      const domain = domainOf(r.dataset_name, r.column_name);
      if (r.top_values.length === 0) {
        return [[domain, r.dataset_id, r.dataset_name, r.column_name, r.column_type, "", "", r.source, r.evidence_status]];
      }
      return r.top_values.map((tv) => [domain, r.dataset_id, r.dataset_name, r.column_name, r.column_type, tv.value, tv.count, r.source, r.evidence_status]);
    }).map((row) => row.map((cell) => redactDeep(cell))),
  );

  writeJson(join(EVIDENCE, "values_sources.json"), redactDeep({
    generated_at: now,
    charts_with_filters: chartsWithFilters,
    dashboards_with_filters: dashboardsWithFilters,
    saved_queries: queries.length,
    saved_query_literals: queryLiterals.slice(0, 500),
    sql_literal_datasets: sqlLiteralDatasets,
    sql_literal_values: sqlLiteralValues,
    sql_literal_columns: sqlLiteralColumns.size,
    columns_with_values: rows.filter((r) => r.retrieval_status !== "NOT_AVAILABLE").length,
  }));

  console.log(JSON.stringify({
    datasets: datasetsDetail.length,
    charts: charts.length,
    charts_with_filters: chartsWithFilters,
    dashboards: dashboardsDetail.length,
    dashboards_with_filters: dashboardsWithFilters,
    saved_queries: queries.length,
    sql_literal_datasets: sqlLiteralDatasets,
    sql_literal_values: sqlLiteralValues,
    sql_literal_columns: sqlLiteralColumns.size,
    columns_with_values: rows.filter((r) => r.retrieval_status !== "NOT_AVAILABLE").length,
    columns_not_available: rows.filter((r) => r.retrieval_status === "NOT_AVAILABLE").length,
  }, null, 2));
}

function domainOf(datasetName: string | null, column: string): string {
  const s = `${datasetName ?? ""} ${column}`.toLowerCase();
  if (/(order|заказ|zakaz)/.test(s)) return "orders";
  if (/(courier|курьер|kuryer)/.test(s)) return "couriers";
  if (/(shift|смен|smen)/.test(s)) return "shifts";
  if (/(queue|очеред|ochered)/.test(s)) return "queue";
  if (/(pool|пул|pul)/.test(s)) return "pools";
  if (/(darkstore|даркстор|shop|store|магазин)/.test(s)) return "darkstores";
  if (/(mentor|наставник)/.test(s)) return "mentorship";
  if (/(pay|profit|оплат|начисл|tariff|тариф)/.test(s)) return "finance";
  if (/(sla|delivery|доставк)/.test(s)) return "delivery";
  return "other";
}

main().catch((e) => {
  console.error("[values] FAILED:", e);
  process.exitCode = 1;
});
