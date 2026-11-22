// Compare HAR objects (dashboard, charts, datasets, native filters) with the local catalog.
import { readFileSync } from "node:fs";

const har = JSON.parse(readFileSync("har.har", "utf8"));
const entries: any[] = har.log.entries;

// HAR-side identifiers
const datasetDetailIds = new Set<number>();
let dashboardSlug: string | null = null;
let dashboardIdFromQuery: number | null = null;
for (const e of entries) {
  const u = new URL(e.request.url);
  const dm = u.pathname.match(/^\/api\/v1\/dataset\/(\d+)$/);
  if (dm) datasetDetailIds.add(Number(dm[1]));
  const ds = u.pathname.match(/^\/api\/v1\/dashboard\/([^/]+)$/);
  if (ds && !/^\d+$/.test(ds[1])) dashboardSlug = ds[1];
  if (u.searchParams.get("dashboard_id")) dashboardIdFromQuery = Number(u.searchParams.get("dashboard_id"));
}

// slice ids from query strings and bodies
const sliceIds = new Set<number>();
for (const e of entries) {
  const u = new URL(e.request.url);
  const fd = u.searchParams.get("form_data");
  if (fd) {
    try {
      const j = JSON.parse(fd);
      if (j.slice_id) sliceIds.add(Number(j.slice_id));
    } catch { /* ignore */ }
  }
  if (e.request.postData?.text) {
    try {
      const j = JSON.parse(e.request.postData.text);
      if (j?.form_data?.slice_id) sliceIds.add(Number(j.form_data.slice_id));
    } catch { /* ignore */ }
  }
}

// native filter definitions from the filter_state POST body
let nativeFilters: any[] = [];
for (const e of entries) {
  if (!e.request.url.includes("/filter_state")) continue;
  try {
    const j = JSON.parse(e.request.postData.text);
    const inner = typeof j?.value === "string" ? JSON.parse(j.value) : null;
    if (inner) nativeFilters = Object.values(inner);
  } catch { /* ignore */ }
}

// local catalog
const chartsInv = JSON.parse(readFileSync("reports/phase-01-6-2/charts_inventory.json", "utf8"));
const charts: any[] = Array.isArray(chartsInv) ? chartsInv : chartsInv.charts ?? chartsInv.rows;
const chartIds = new Set<number>(charts.map((c) => Number(c.chart_id ?? c.id)).filter(Number.isFinite));
const chartsOnDashboard = charts.filter((c) => {
  const ds = c.dashboards ?? c.dashboard_ids ?? [];
  return Array.isArray(ds) && ds.map(Number).includes(Number(dashboardIdFromQuery));
});

const dashInv = JSON.parse(readFileSync("reports/phase-01-6-2/dashboards_inventory.json", "utf8"));
const dashboards: any[] = Array.isArray(dashInv) ? dashInv : dashInv.dashboards ?? dashInv.rows;
const dashMatch = dashboards.filter((d) => String(d.slug ?? "") === String(dashboardSlug) || Number(d.dashboard_id ?? d.id) === Number(dashboardIdFromQuery));

const filtersInv = JSON.parse(readFileSync("reports/phase-01-6-2/dashboard_filters.json", "utf8"));
const filters: any[] = Array.isArray(filtersInv) ? filtersInv : filtersInv.filters ?? [];
const filtersForDashboard = filters.filter((f) => Number(f.dashboard_id) === Number(dashboardIdFromQuery));

console.log("HAR dashboard slug:", dashboardSlug, "dashboard_id:", dashboardIdFromQuery);
console.log("HAR slice_ids referenced:", sliceIds.size, [...sliceIds].slice(0, 60).join(","));
console.log("local charts inventory rows:", charts.length);
console.log("local chart ids containing HAR slice_ids:", [...sliceIds].filter((id) => chartIds.has(id)).length, "of", sliceIds.size);
const missingCharts = [...sliceIds].filter((id) => !chartIds.has(id));
console.log("HAR slice_ids absent from local chart catalog:", missingCharts.length, missingCharts.slice(0, 40).join(","));
console.log("local charts linked to this dashboard:", chartsOnDashboard.length);
console.log("local dashboard rows matching slug/id:", JSON.stringify(dashMatch, null, 1).slice(0, 1200));
console.log("HAR native filters:", nativeFilters.length);
console.log("HAR native filter ids:", nativeFilters.map((f: any) => f.id).join(","));
console.log("local filter rows for dashboard:", filtersForDashboard.length);
console.log("local filter ids:", filtersForDashboard.map((f) => f.filter_id ?? f.id).join(","));

await Bun.write("tools/har-vs-local-objects.json", JSON.stringify({
  har: {
    dashboardSlug, dashboardId: dashboardIdFromQuery,
    datasetDetailIds: [...datasetDetailIds],
    sliceIds: [...sliceIds],
    nativeFilters,
  },
  local: {
    charts: charts.length, dashboards: dashboards.length, filters: filters.length,
    dashMatch, filtersForDashboard, chartsOnDashboard: chartsOnDashboard.length,
    missingCharts,
  },
}, null, 1));
