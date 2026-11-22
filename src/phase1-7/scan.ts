/** Этап 1.7 — разведка каталога: какие датасеты и колонки подтверждают сущности. Read-only. */
import { findColumns, findDatasets, loadCatalog } from "./load";

const cat = loadCatalog();

const groups: Array<{ label: string; terms: string[] }> = [
  { label: "shifts", terms: ["shifts", "timesheetfact", "id_shift"] },
  { label: "pools", terms: ["pools", "id_pool"] },
  { label: "courier_queue", terms: ["courier_queue", "queue_in_dttm", "queue_out_dttm"] },
  { label: "photo_control", terms: ["photo_control_shift_attempt", "photo_control"] },
  { label: "darkstore_time", terms: ["darkstore_time_sheet", "darkstore_time"] },
  { label: "orders", terms: ["id_order", "order_status", "id_general"] },
  { label: "couriers", terms: ["id_courier", "courier_type", "courier"] },
  { label: "delivery", terms: ["delivery_type", "delivery_type_group", "delivery"] },
  { label: "finance", terms: ["accrual", "payout", "начислен", "earnings"] },
  { label: "sla", terms: ["sla", "time_ready", "ready_time"] },
  { label: "webcall", terms: ["webcall_log_ui_period", "ksa_time_vw"] },
];

for (const g of groups) {
  const hits = findDatasets(cat, g.terms, { maxHits: 12 });
  console.log(`\n### ${g.label} — ${hits.length} hits`);
  for (const h of hits) {
    console.log(`  ${h.id} | ${h.name} | ${h.schema} | prio=${h.priority} | detail=${h.detailLoaded} | in=${h.matchedIn.join("+")} | cols=${h.columnMatches.slice(0, 5).join(",")}`);
    if (h.sqlSnippet) console.log(`     sql: ${h.sqlSnippet.slice(0, 160)}`);
  }
}

console.log("\n=== COLUMN SEARCH ===");
const colGroups: Array<{ label: string; res: RegExp[] }> = [
  { label: "shift keys", res: [/^id_shift$/i, /^shift_start$/i, /^shift_finish$/i, /^id_courier$/i] },
  { label: "pool keys", res: [/^id_pool$/i, /^pool_start$/i, /^pool_finish$/i] },
  { label: "queue", res: [/queue_in/i, /queue_out/i, /has_order/i, /first_delivery/i] },
  { label: "arrival", res: [/arrival/i, /^arrived/i] },
  { label: "status", res: [/^order_status$/i, /^status$/i, /^delivery_status$/i] },
  { label: "finance", res: [/accrual/i, /payout/i, /^sum_/i, /^amount/i] },
];
for (const g of colGroups) {
  const cols = findColumns(cat, g.res, 25);
  console.log(`\n--- ${g.label} (${cols.length}) ---`);
  for (const c of cols) console.log(`  ${c.dataset_id} ${c.dataset_name} :: ${c.column} (${c.type}) prio=${c.priority}`);
}

console.log("\n=== COUNTS ===");
console.log("datasets", cat.datasetsList.length, "detail", cat.datasetsDetail.length, "charts", cat.charts.length, "dashboards", cat.dashboards.length);
console.log("filters", cat.filters.length, "columnValues", cat.columnValues.length, "relationships", cat.relationships.length);
const byStatus: Record<string, number> = {};
for (const r of cat.columnValues) byStatus[r.evidence_status] = (byStatus[r.evidence_status] ?? 0) + 1;
console.log("evidence_status", JSON.stringify(byStatus));
const filterCols = new Set(cat.filters.map((f) => `${f.dataset_id}::${f.column_name}`));
console.log("distinct filter-target columns", filterCols.size);
console.log("decisions", cat.decisionRegister15.length, "queryPlan queries", cat.queryPlan?.queries?.length ?? cat.queryPlan?.length ?? "n/a");
