/**
 * Этап 1.6.2 — резервный локальный снимок метаданных из артефактов этапов 1.4/1.6.
 * Используется ТОЛЬКО если Superset недоступен (VPN/сеть). Не заменяет live-синхронизацию.
 * Пишет те же файлы, что и sync.ts, с пометкой source=CACHED_ARTIFACTS.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, nowIso, writeJson } from "./utils";

const SNAP = "data/snapshots/phase-01-6-2";
const EXTRACTED = "data/extracted/phase-01-4/datasets";
const P14 = "reports/phase-01-4";
const P16 = "reports/phase-01-6/evidence";

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

function compactDatasetList(c: any): any {
  return {
    id: Number(c.dataset_id ?? c.id),
    name: c.name ?? c.table_name ?? null,
    schema: c.schema ?? null,
    database_name: c.database ?? null,
    kind: c.kind ?? null,
    description: null,
    sql: null,
    sql_hash: null,
    changed_on: null,
    priority: c.priority ?? "UNKNOWN",
    domains: c.matched_domains ?? [],
  };
}

function compactDetail(m: any): any {
  const columns = (m.columns ?? []).map((c: any) => ({
    name: c.column_name ?? c.name ?? null,
    type: c.type ?? null,
    is_dttm: Boolean(c.is_dttm),
    expression: c.expression ?? null,
    verbose_name: c.verbose_name ?? null,
    description: c.description ?? null,
  }));
  const metrics = (m.metrics ?? []).map((x: any) => ({
    name: x.metric_name ?? x.name ?? null,
    expression: x.expression ?? null,
    verbose_name: x.verbose_name ?? null,
    description: x.description ?? null,
  }));
  return {
    id: Number(m.id ?? m.dataset_id),
    name: m.table_name ?? m.name ?? null,
    schema: m.schema ?? null,
    database_name: typeof m.database === "string" ? m.database : m.database?.name ?? null,
    kind: m.kind ?? null,
    description: m.description ?? null,
    sql: m.sql ?? null,
    main_dttm_col: m.main_dttm_col ?? null,
    columns,
    metrics,
    source: "CACHED_ARTIFACTS",
  };
}

function main() {
  ensureDir(SNAP);
  const manifest: any = {
    generated_at: nowIso(),
    source: "CACHED_ARTIFACTS",
    note: "Superset недоступен (сеть/VPN). Данные взяты из артефактов этапов 1.4/1.6; это не live-синхронизация.",
    resources: {},
  };

  // 1. датасеты: список из 1.4
  const cand = readJson(join(P14, "03_dataset_candidates.json"));
  const datasets = (cand.datasets ?? cand.candidates ?? []).map(compactDatasetList);
  writeJson(join(SNAP, "datasets.list.json"), datasets);
  manifest.resources.datasets_list = { count: datasets.length, source: "reports/phase-01-4/03_dataset_candidates.json" };

  // 2. детали датасетов: 1.4 extracted + 1.6 metadata
  const details: any[] = [];
  const seen = new Set<number>();
  try {
    for (const f of readdirSync(EXTRACTED)) {
      if (!f.endsWith(".json")) continue;
      const doc = readJson(join(EXTRACTED, f));
      const m = doc.metadata ?? doc.result ?? doc;
      if (!m?.id) continue;
      const d = compactDetail(m);
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      details.push(d);
    }
  } catch (e: any) {
    manifest.resources.datasets_detail_error = String(e?.message ?? e);
  }
  // 1.6 dataset_metadata (6)
  try {
    for (const f of readdirSync(join(P16, "dataset_metadata"))) {
      if (!f.endsWith(".json")) continue;
      const m = readJson(join(P16, "dataset_metadata", f));
      if (!m?.dataset_id || seen.has(Number(m.dataset_id))) continue;
      const d = compactDetail({ ...m, id: m.dataset_id });
      seen.add(d.id);
      details.push(d);
    }
  } catch {
    /* нет каталога — не критично */
  }
  // metadata_evidence (12?) — если есть columns
  try {
    const me = readJson(join(P16, "metadata_evidence.json"));
    for (const m of me.datasets ?? []) {
      if (!m?.dataset_id || seen.has(Number(m.dataset_id))) continue;
      const d = compactDetail({ ...m, id: m.dataset_id, table_name: m.table_name });
      seen.add(d.id);
      details.push(d);
    }
  } catch {
    /* нет файла — не критично */
  }
  writeJson(join(SNAP, "datasets.detail.json"), details);
  manifest.resources.datasets_detail = { count: details.length, source: "1.4 extracted + 1.6 metadata" };

  // 3. чарты: compact snapshot 1.4
  let charts: any[] = [];
  try {
    const snap = readJson("data/snapshots/phase-01-4/charts.compact.json");
    charts = (snap.docs ?? []).map((c: any) => ({
      id: Number(c.id),
      name: c.name ?? null,
      viz_type: c.viz_type ?? null,
      datasource_id: c.datasource_id ?? null,
      datasource_type: c.datasource_type ?? null,
      dashboards: [],
      params_parse_status: c.params_parse_status ?? "UNKNOWN",
      form_data: {
        metrics: c.metrics ?? [],
        groupby: c.groupby ?? [],
        adhoc_filters: [],
        filters: [],
        time_range: c.time_range ?? null,
        granularity: c.granularity ?? null,
        filter_columns: c.filter_columns ?? [],
      },
    }));
  } catch (e: any) {
    manifest.resources.charts_error = String(e?.message ?? e);
  }
  writeJson(join(SNAP, "charts.list.json"), charts);
  manifest.resources.charts_list = { count: charts.length, source: "data/snapshots/phase-01-4/charts.compact.json" };

  // 4. дашборды
  let dashboards: any[] = [];
  try {
    const d = readJson(join(P14, "03_dashboard_candidates.json"));
    dashboards = (d.candidates ?? d.dashboards ?? []).map((x: any) => ({
      id: Number(x.dashboard_id ?? x.id),
      dashboard_title: x.name ?? x.dashboard_title ?? null,
      published: x.published ?? null,
      changed_on: null,
    }));
  } catch (e: any) {
    manifest.resources.dashboards_error = String(e?.message ?? e);
  }
  writeJson(join(SNAP, "dashboards.list.json"), dashboards);
  writeJson(join(SNAP, "dashboards.detail.json"), []);
  manifest.resources.dashboards_list = { count: dashboards.length, source: "reports/phase-01-4/03_dashboard_candidates.json" };
  manifest.resources.dashboards_detail = { count: 0, source: "нет кэша фильтров дашбордов" };

  writeJson(join(SNAP, "manifest.json"), manifest);
  console.log(JSON.stringify({ source: "CACHED_ARTIFACTS", datasets: datasets.length, details: details.length, charts: charts.length, dashboards: dashboards.length }, null, 2));
}

main();
