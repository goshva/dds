// Compare HAR native filters with local dashboard filters by position and target
// (the local artifact stores no native filter id).
import { readFileSync } from "node:fs";

const har = JSON.parse(readFileSync("har.har", "utf8"));
let nativeFilters: any[] = [];
for (const e of har.log.entries) {
  if (!e.request.url.includes("/filter_state")) continue;
  try {
    const j = JSON.parse(e.request.postData.text);
    const inner = typeof j?.value === "string" ? JSON.parse(j.value) : null;
    if (inner) nativeFilters = Object.values(inner);
  } catch { /* ignore */ }
}

const filtersInv = JSON.parse(readFileSync("reports/phase-01-6-2/dashboard_filters.json", "utf8"));
const filters: any[] = Array.isArray(filtersInv) ? filtersInv : filtersInv.filters ?? [];
const local = filters.filter((f) => Number(f.dashboard_id) === 977);

// filter_select requests in the HAR carry native_filter_id + target column + dataset
const harSelects: any[] = [];
for (const e of har.log.entries) {
  if (!e.request.url.includes("/api/v1/chart/data")) continue;
  try {
    const b = JSON.parse(e.request.postData.text);
    const fd = b?.form_data ?? {};
    if (fd.native_filter_id) {
      harSelects.push({
        native_filter_id: fd.native_filter_id,
        dataset_id: b?.datasource?.id ?? null,
        column: (b?.queries?.[0]?.columns ?? [])[0] ?? null,
        defaultValue: fd.defaultValue ?? null,
        multiSelect: fd.multiSelect ?? null,
        inverseSelection: fd.inverseSelection ?? null,
        rowLimit: b?.queries?.[0]?.row_limit ?? null,
      });
    }
  } catch { /* ignore */ }
}

console.log("HAR filter_select requests:", harSelects.length);
console.log("local filter rows for dashboard 977:", local.length);

// match by target column + dataset
let matchedByTarget = 0;
const detail: any[] = [];
for (const s of harSelects) {
  const cand = local.filter((l) => Number(l.dataset_id) === Number(s.dataset_id) && String(l.column_name ?? "") === String(s.column ?? ""));
  if (cand.length) matchedByTarget++;
  detail.push({
    native_filter_id: s.native_filter_id,
    dataset_id: s.dataset_id,
    column: s.column,
    har_default: s.defaultValue,
    har_multi_select: s.multiSelect,
    local_candidates: cand.map((c) => ({ filter_name: c.filter_name, default_value: c.default_value, multi_select: c.multi_select })),
  });
}

// local filters that were never exercised by the HAR session
const harColumns = new Set(harSelects.map((s) => `${s.dataset_id}.${s.column}`));
const notExercised = local.filter((l) => !harColumns.has(`${Number(l.dataset_id)}.${l.column_name}`));

// time filters present in HAR but not as filter_select
const timeFilters = nativeFilters.filter((f: any) => f.filterState?.value && f.extraFormData?.granularity_sqla || f.extraFormData?.time_range);

console.log("matched by dataset+column:", matchedByTarget, "of", harSelects.length);
console.log("local filters never exercised in this HAR session:", notExercised.length);
console.log(notExercised.slice(0, 10).map((l) => `${l.filter_name} [${l.filter_type}] ${l.dataset_id}.${l.column_name ?? "-"}`).join("\n"));
console.log("HAR time filters:", JSON.stringify(timeFilters, null, 1).slice(0, 800));

await Bun.write("tools/har-vs-local-filters-by-target.json", JSON.stringify({ harSelects, detail, notExercised }, null, 1));
