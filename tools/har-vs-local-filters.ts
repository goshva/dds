// Verify that native filter ids from the HAR match the locally stored dashboard filters.
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

console.log("local filter row keys:", Object.keys(local[0] ?? {}).join(","));
console.log("sample local filter:", JSON.stringify(local[0], null, 1));
console.log("HAR filter sample:", JSON.stringify(nativeFilters[0], null, 1));

const idKey = Object.keys(local[0] ?? {}).find((k) => /filter_id|native_filter|^id$/i.test(k)) ?? "filter_id";
const localIds = new Set(local.map((f) => String(f[idKey] ?? f.filter_id ?? f.id ?? f.native_filter_id)));
const harIds = nativeFilters.map((f: any) => String(f.id));
const matched = harIds.filter((id) => localIds.has(id));
const unmatched = harIds.filter((id) => !localIds.has(id));
const onlyLocal = [...localIds].filter((id) => !harIds.includes(id));

console.log("id key used:", idKey);
console.log("HAR filters:", harIds.length, "local rows:", localIds.size);
console.log("matched:", matched.length);
console.log("HAR-only (not found locally):", unmatched.length, unmatched.join(","));
console.log("local-only (not in HAR state):", onlyLocal.length, onlyLocal.join(","));

// compare filter_type / targets / default values for matched ones
const diffs: any[] = [];
for (const f of nativeFilters as any[]) {
  const l = local.find((x) => String(x[idKey] ?? x.filter_id ?? x.id) === String(f.id));
  if (!l) continue;
  const harValue = f.filterState?.value ?? null;
  const localValue = l.default_value ?? null;
  const harType = f.filterType ?? null;
  const localType = l.filter_type ?? null;
  const harTargets = (f.targets ?? []).map((t: any) => `${t.datasetId ?? t.dataset_id}.${t.column?.name ?? t.column}`);
  const localTargets = (l.targets ?? []).map((t: any) => `${t.dataset_id ?? t.datasetId}.${t.column ?? t.column_name}`);
  if (JSON.stringify(harValue) !== JSON.stringify(localValue) || harType !== localType || JSON.stringify(harTargets) !== JSON.stringify(localTargets)) {
    diffs.push({ id: f.id, harType, localType, harValue, localValue, harTargets, localTargets });
  }
}
console.log("matched filters with differences:", diffs.length);
console.log(JSON.stringify(diffs.slice(0, 6), null, 1));

await Bun.write("tools/har-vs-local-filters.json", JSON.stringify({ matched: matched.length, unmatched, onlyLocal, diffs }, null, 1));
