/**
 * Этап 1.7 — разведка входных артефактов (read-only).
 * Печатает структуру, размеры и признак двойного кодирования.
 * Ничего не пишет.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE, REPORTS_162, SNAP_162 } from "./paths";

const MOJIBAKE = /[\u0420\u0421][\u0402\u0403\u0408\u0409\u040A\u040C\u040D\u040E\u040F\u0452\u0453\u0455\u0457\u0459\u045A\u045B\u045C\u045F\u2018\u2019\u201A\u201C\u201D\u201E\u2013\u2014\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2116\u2122]/;

function mojibakeCount(text: string): number {
  const m = text.match(new RegExp(MOJIBAKE.source, "g"));
  return m ? m.length : 0;
}

function inspectFile(rel: string): void {
  try {
    const raw = readFileSync(rel, "utf8");
    console.log(`${rel}\n  size=${raw.length} mojibake=${mojibakeCount(raw)}`);
  } catch (e: any) {
    console.log(`${rel}\n  MISSING (${String(e?.message ?? e).slice(0, 80)})`);
  }
}

function sampleJson(rel: string, pick: (v: any) => unknown): void {
  try {
    const v = JSON.parse(readFileSync(rel, "utf8"));
    const arr = Array.isArray(v) ? v : Array.isArray(v?.rows) ? v.rows : Array.isArray(v?.datasets) ? v.datasets : Array.isArray(v?.charts) ? v.charts : Array.isArray(v?.dashboards) ? v.dashboards : Array.isArray(v?.columns) ? v.columns : Array.isArray(v?.filters) ? v.filters : null;
    console.log(`${rel}\n  kind=${Array.isArray(v) ? "array" : "object"} keys=${Array.isArray(v) ? "-" : Object.keys(v).slice(0, 12).join(",")} rows=${arr ? arr.length : "n/a"}`);
    if (arr && arr.length) console.log("  sample=", JSON.stringify(pick(arr[0])).slice(0, 420));
  } catch (e: any) {
    console.log(`${rel}\n  MISSING (${String(e?.message ?? e).slice(0, 80)})`);
  }
}

console.log("=== SNAPSHOT 1.6.2 ===");
for (const f of ["datasets.list.json", "charts.list.json", "dashboards.list.json", "dashboards.detail.json", "datasets.detail.json", "manifest.json"]) {
  inspectFile(join(SNAP_162, f));
}
sampleJson(join(SNAP_162, "datasets.list.json"), (r) => ({ id: r.id, name: r.name, schema: r.schema, kind: r.kind, sql_len: r.sql_len, desc: r.description?.slice(0, 80) }));
sampleJson(join(SNAP_162, "datasets.detail.json"), (r) => ({ id: r.id, name: r.name, cols: r.columns?.length, metrics: r.metrics?.length, main_dttm: r.main_dttm_col, sql_len: r.sql?.length }));
sampleJson(join(SNAP_162, "charts.list.json"), (r) => ({ id: r.id, name: r.name, viz: r.viz_type, ds: r.datasource_id, fd: r.form_data ? Object.keys(r.form_data) : null }));
sampleJson(join(SNAP_162, "dashboards.detail.json"), (r) => ({ id: r.id, title: r.title, charts: r.chart_ids?.length, filters: r.native_filters?.length }));

console.log("\n=== REPORTS 1.6.2 ===");
for (const f of ["datasets_inventory.json", "charts_inventory.json", "dashboards_inventory.json", "dashboard_filters.json", "column_values.json", "analysis_stats.json", "final_validation.json", "superset_access_matrix.json", "analytical_checks.md"]) {
  inspectFile(join(REPORTS_162, f));
}
sampleJson(join(REPORTS_162, "datasets_inventory.json"), (r) => ({ id: r.dataset_id, name: r.name, schema: r.schema, kind: r.kind, access: r.access, cols: r.column_count }));
sampleJson(join(REPORTS_162, "dashboards_inventory.json"), (r) => ({ id: r.dashboard_id, title: r.title, charts: r.chart_count, filters: r.native_filters_count, access: r.access }));
sampleJson(join(REPORTS_162, "dashboard_filters.json"), (r) => ({ id: r.dashboard_id, title: r.title, filters: r.filters?.length, sample: r.filters?.[0] }));
sampleJson(join(REPORTS_162, "column_values.json"), (r) => ({ ds: r.dataset_id, col: r.column_name, src: r.source, ev: r.evidence_status, vals: r.top_values?.length }));
sampleJson(join(REPORTS_162, "analysis_stats.json"), (r) => r);

console.log("\n=== PACKAGE ===");
for (const f of ["ANALYST_BRIEF.md", "column_values.csv", "data_dictionary.csv", "temporal_fields.csv", "relationships_candidates.csv", "metrics_catalog.csv"]) {
  inspectFile(join(PACKAGE, f));
}
