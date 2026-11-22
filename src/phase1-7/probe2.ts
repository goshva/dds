/** Этап 1.7 — уточнение ключей и структуры строк. Read-only. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPORTS_162, SNAP_162 } from "./paths";

function load(rel: string): any {
  return JSON.parse(readFileSync(rel, "utf8"));
}

const rep = (p: string) => join(REPORTS_162, p);
const snap = (p: string) => join(SNAP_162, p);

const filters = load(rep("dashboard_filters.json"));
console.log("dashboard_filters keys:", Object.keys(filters), "rows", filters.filters?.length);
console.log("filter row keys:", Object.keys(filters.filters?.[0] ?? {}));
console.log("filter row sample:", JSON.stringify(filters.filters?.[0]).slice(0, 700));

const dsInv = load(rep("datasets_inventory.json"));
console.log("\ndatasets_inventory row keys:", Object.keys(dsInv.datasets?.[0] ?? {}));
console.log("datasets_inventory row:", JSON.stringify(dsInv.datasets?.[0]).slice(0, 500));

const cols = load(rep("column_values.json"));
console.log("\ncolumn_values row keys:", Object.keys(cols.columns?.[0] ?? {}));
console.log("column_values row:", JSON.stringify(cols.columns?.[0]).slice(0, 500));
console.log("column_values summary:", JSON.stringify(cols.summary).slice(0, 900));
console.log("column_values classification:", JSON.stringify(cols.classification).slice(0, 700));

const dd = load(snap("datasets.detail.json"));
const d0 = dd[0];
console.log("\ndataset detail keys:", Object.keys(d0));
console.log("column keys:", Object.keys(d0.columns?.[0] ?? {}));
console.log("column sample:", JSON.stringify(d0.columns?.[0]).slice(0, 400));
console.log("metric keys:", Object.keys(d0.metrics?.[0] ?? {}));
console.log("metric sample:", JSON.stringify(d0.metrics?.[0]).slice(0, 400));

const dbd = load(snap("dashboards.detail.json"));
const b0 = dbd[0];
console.log("\ndashboard detail keys:", Object.keys(b0));
console.log("native filter keys:", Object.keys(b0.native_filters?.[0] ?? {}));
console.log("native filter sample:", JSON.stringify(b0.native_filters?.[0]).slice(0, 900));

const ch = load(snap("charts.list.json"));
const c0 = ch[0];
console.log("\nchart keys:", Object.keys(c0));
console.log("chart form_data keys:", Object.keys(c0.form_data ?? {}));
console.log("chart sample:", JSON.stringify(c0).slice(0, 700));

const stats = load(rep("analysis_stats.json"));
console.log("\nanalysis_stats:", JSON.stringify(stats).slice(0, 1500));

const val = load(rep("final_validation.json"));
console.log("\nfinal_validation:", JSON.stringify(val).slice(0, 1200));
