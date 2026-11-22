/** Этап 1.7 — доступные значения колонок: FILTER_VALUES и SQL_DERIVED. Read-only. */
import { loadCatalog } from "./load";

const cat = loadCatalog();
const byStatus: Record<string, number> = {};
for (const r of cat.columnValues) byStatus[r.evidence_status] = (byStatus[r.evidence_status] ?? 0) + 1;
console.log("evidence_status:", JSON.stringify(byStatus));

const withValues = cat.columnValues.filter((r) => (r.top_values ?? []).length > 0);
console.log("rows with values:", withValues.length);

const fv = withValues.filter((r) => r.evidence_status === "FILTER_VALUES");
console.log("\n=== FILTER_VALUES columns:", fv.length);
for (const r of fv.slice(0, 40)) {
  console.log(`  ${r.dataset_id} ${r.dataset_name} :: ${r.column_name} => ${r.top_values.map((v) => v.value).slice(0, 8).join(" | ")}`);
}

const sd = withValues.filter((r) => r.evidence_status === "SQL_DERIVED");
console.log("\n=== SQL_DERIVED columns:", sd.length);
const wanted = ["order_status", "status_name", "delivery_type_group", "delivery_type", "partner_type", "zone", "region_tt", "courier_type", "shift_type", "feature_tt", "type", "причина", "reason"];
for (const r of sd) {
  if (wanted.some((w) => r.column_name.toLowerCase().includes(w))) {
    console.log(`  ${r.dataset_id} ${r.dataset_name} :: ${r.column_name} (${r.source}) => ${r.top_values.map((v) => v.value).slice(0, 10).join(" | ")}`);
  }
}

const top = withValues
  .filter((r) => r.evidence_status === "SQL_DERIVED")
  .sort((a, b) => b.top_values.length - a.top_values.length)
  .slice(0, 25);
console.log("\n=== TOP SQL_DERIVED by value count ===");
for (const r of top) console.log(`  ${r.dataset_id} ${r.dataset_name} :: ${r.column_name} (${r.top_values.length}) => ${r.top_values.map((v) => v.value).slice(0, 6).join(" | ")}`);

console.log("\n=== filters with default_value ===");
const withDefault = cat.filters.filter((f) => f.default_value !== null && f.default_value !== undefined && String(f.default_value) !== "");
console.log("total filters:", cat.filters.length, "with default:", withDefault.length);
for (const f of withDefault.slice(0, 30)) console.log(`  ds=${f.dataset_id} col=${f.column_name} dash=${f.dashboard_id} default=${JSON.stringify(f.default_value).slice(0, 120)}`);
