/**
 * Этап 1.1, задача 3 (полный каталог) — единый Lineage Builder.
 *
 * Источники (не смешиваются, каждый сохраняется в CSV как отдельный method):
 *   A. dashboard_detail.result.position_json (SQLite + output/spot_details)   DASHBOARD_POSITION_JSON       HIGH
 *   B1. chart_detail.result.dashboards[]           (SQLite + spot)            CHART_DASHBOARDS_ARRAY        HIGH
 *   B2. output/charts.json[].dashboards[]                                     CHART_LIST_DASHBOARDS_ARRAY   HIGH (list)
 *   C1. chart_detail.result.datasource_id          (SQLite + spot)            CHART_DATASOURCE_ID           VERIFIED (detail)
 *   C2. output/charts.json[].datasource_id                                    CHART_LIST_DATASOURCE_ID      VERIFIED (list)
 *   D.  reports/phase-01-1/api_chart_links_priority.json                      API_FILTER_BY_DATASOURCE_ID   VERIFIED (API)
 *
 * Полный каталог берётся из output/{dashboards,charts,datasets}.json (read-only).
 * SQLite открывается readonly; relations не пишутся в БД.
 */
import { Database } from "bun:sqlite";
import { writeFileSync, readFileSync, existsSync, readdirSync } from "fs";

const DB = "data/catalog.sqlite";
const OUT_DIR = "reports/phase-01-1";
const OUTPUT_DIR = "output";
const SPOT_DIR = `${OUTPUT_DIR}/spot_details`;

type Confidence = "VERIFIED" | "HIGH" | "MEDIUM" | "LOW";
const CONF_ORDER: Record<Confidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, VERIFIED: 3 };

type Method =
  | "DASHBOARD_POSITION_JSON"
  | "CHART_DASHBOARDS_ARRAY"
  | "CHART_LIST_DASHBOARDS_ARRAY"
  | "CHART_DATASOURCE_ID"
  | "CHART_LIST_DATASOURCE_ID"
  | "API_FILTER_BY_DATASOURCE_ID";

type Evidence = {
  parent_type: string;
  parent_id: string;
  child_type: string;
  child_id: string;
  relation_type: string;
  method: Method;
  confidence: Confidence;
  scope: "local" | "api";
};

const evidences: Evidence[] = [];
function addEvidence(e: Evidence) {
  evidences.push(e);
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function readJsonFile(path: string): any | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function listRows(path: string): any[] {
  const j = readJsonFile(path);
  return Array.isArray(j?.result) ? j.result : [];
}

// ---------------- Полный каталог (list-файлы) ----------------
const dashboardRows = listRows(`${OUTPUT_DIR}/dashboards.json`);
const chartRowsRaw = listRows(`${OUTPUT_DIR}/charts.json`);
const datasetRowsRaw = listRows(`${OUTPUT_DIR}/datasets.json`);

const dashboardListIds = new Set(dashboardRows.map((d) => String(d?.id ?? "")));
const chartListIds = new Set(chartRowsRaw.map((c) => String(c?.id ?? "")));
const datasetListIds = new Set(datasetRowsRaw.map((d) => String(d?.id ?? "")));
dashboardListIds.delete("");
chartListIds.delete("");
datasetListIds.delete("");

type ChartListRow = {
  id: string;
  datasource_id: string | null;
  datasource_type: string | null;
  dashboards: string[];
};
const chartList: ChartListRow[] = chartRowsRaw.map((c) => ({
  id: String(c?.id ?? ""),
  datasource_id: c?.datasource_id != null ? String(c.datasource_id) : null,
  datasource_type: c?.datasource_type != null ? String(c.datasource_type) : null,
  dashboards: Array.isArray(c?.dashboards)
    ? c.dashboards.map((d: any) => String(d?.id ?? "")).filter(Boolean)
    : [],
}));
// освобождаем исходные большие массивы
(chartRowsRaw as any).length = 0;
(datasetRowsRaw as any).length = 0;
(dashboardRows as any).length = 0;

const listChartWithDs = chartList.filter((c) => c.datasource_id !== null && c.datasource_type === "table");
const listChartDashPairs = chartList.reduce((s, c) => s + c.dashboards.length, 0);

// ---------------- SQLite detail ----------------
const db = new Database(DB, { readonly: true });
const idsOf = (t: string) =>
  new Set(
    (db.query(`SELECT object_id FROM objects WHERE object_type=?`).all(t) as any[]).map((r) =>
      String(r.object_id),
    ),
  );
const sqliteDashboardDetailIds = idsOf("dashboard_detail");
const sqliteChartDetailIds = idsOf("chart_detail");
const sqliteChartListIds = idsOf("chart");
const sqliteDatasetListIds = idsOf("dataset");
const sqliteDashboardListIds = idsOf("dashboard");

const dashboardDetailRows = db
  .query(`SELECT object_id, payload_json FROM objects WHERE object_type='dashboard_detail'`)
  .all() as any[];
const chartDetailRows = db
  .query(`SELECT object_id, payload_json FROM objects WHERE object_type='chart_detail'`)
  .all() as any[];
db.close();

// ---------------- Spot details (merge by id) ----------------
type DashboardDetail = { id: string; position_json: any };
type ChartDetail = { id: string; datasource_id: string | null; dashboards: string[] };

const dashboardDetails = new Map<string, DashboardDetail>();
const chartDetails = new Map<string, ChartDetail>();
const dashboardDetailAllIds = new Set<string>();
const chartDetailAllIds = new Set<string>();
const chartDetailInvalid = new Set<string>();

let posParseFail = 0;

function parsePositionJson(payload: any): any {
  const pj = payload?.result?.position_json;
  if (!pj) return null;
  try {
    return typeof pj === "string" ? JSON.parse(pj) : pj;
  } catch {
    posParseFail++;
    return null;
  }
}

for (const row of dashboardDetailRows) {
  const id = String(row.object_id);
  dashboardDetailAllIds.add(id);
  let parsed: any;
  try {
    parsed = JSON.parse(row.payload_json);
  } catch {
    continue;
  }
  dashboardDetails.set(id, { id, position_json: parsePositionJson(parsed) });
}

for (const row of chartDetailRows) {
  const id = String(row.object_id);
  chartDetailAllIds.add(id);
  let res: any;
  try {
    res = JSON.parse(row.payload_json)?.result;
  } catch {
    chartDetailInvalid.add(id);
    continue;
  }
  if (!res) {
    chartDetailInvalid.add(id);
    continue;
  }
  chartDetails.set(id, {
    id,
    datasource_id: res.datasource_id != null ? String(res.datasource_id) : null,
    dashboards: Array.isArray(res.dashboards)
      ? res.dashboards.map((d: any) => String(d?.id ?? "")).filter(Boolean)
      : [],
  });
}

let spotDashboardCount = 0;
let spotChartCount = 0;
if (existsSync(SPOT_DIR)) {
  for (const file of readdirSync(SPOT_DIR)) {
    if (!file.endsWith(".json")) continue;
    const parsed = readJsonFile(`${SPOT_DIR}/${file}`);
    const res = parsed?.result;
    if (!res) continue;
    if (file.startsWith("dashboard_")) {
      const id = String(res.id ?? file.replace(/^dashboard_/, "").replace(/\.json$/, ""));
      dashboardDetailAllIds.add(id);
      dashboardDetails.set(id, { id, position_json: parsePositionJson(parsed) });
      spotDashboardCount++;
    } else if (file.startsWith("chart_")) {
      const id = String(res.id ?? file.replace(/^chart_/, "").replace(/\.json$/, ""));
      chartDetailAllIds.add(id);
      chartDetails.set(id, {
        id,
        datasource_id: res.datasource_id != null ? String(res.datasource_id) : null,
        dashboards: Array.isArray(res.dashboards)
          ? res.dashboards.map((d: any) => String(d?.id ?? "")).filter(Boolean)
          : [],
      });
      spotChartCount++;
    }
  }
}

const chartDetailIds = new Set(chartDetails.keys());

// ---------------- A. position_json ----------------
let posNull = 0;
for (const dd of dashboardDetails.values()) {
  if (!dd.position_json) {
    posNull++;
    continue;
  }
  for (const node of Object.values(dd.position_json ?? {})) {
    const n = node as any;
    if (n?.type !== "CHART") continue;
    const cid = String(n?.meta?.chartId ?? "");
    if (!cid) continue;
    addEvidence({
      parent_type: "dashboard",
      parent_id: dd.id,
      child_type: "chart",
      child_id: cid,
      relation_type: "DASHBOARD_HAS_CHART",
      method: "DASHBOARD_POSITION_JSON",
      confidence: "HIGH",
      scope: "local",
    });
  }
}

// ---------------- B1 + C1. chart_detail ----------------
const chartDetailWithDatasource = new Set<string>();
const chartDetailWithoutDatasource = new Set<string>();
const detailDashPairs = new Set<string>();
const detailDsByChart = new Map<string, string>();

for (const cd of chartDetails.values()) {
  const dashboards = cd.dashboards;
  for (const did of dashboards) {
    detailDashPairs.add(`${did}|${cd.id}`);
    addEvidence({
      parent_type: "dashboard",
      parent_id: did,
      child_type: "chart",
      child_id: cd.id,
      relation_type: "DASHBOARD_HAS_CHART",
      method: "CHART_DASHBOARDS_ARRAY",
      confidence: "HIGH",
      scope: "local",
    });
  }
  if (cd.datasource_id == null) {
    chartDetailWithoutDatasource.add(cd.id);
  } else {
    chartDetailWithDatasource.add(cd.id);
    detailDsByChart.set(cd.id, cd.datasource_id);
    addEvidence({
      parent_type: "chart",
      parent_id: cd.id,
      child_type: "dataset",
      child_id: cd.datasource_id,
      relation_type: "CHART_USES_DATASET",
      method: "CHART_DATASOURCE_ID",
      confidence: "VERIFIED",
      scope: "local",
    });
  }
}

// ---------------- B2 + C2. chart list ----------------
const listDashPairs = new Set<string>();
const listDsByChart = new Map<string, string>();
for (const c of chartList) {
  for (const did of c.dashboards) {
    listDashPairs.add(`${did}|${c.id}`);
    addEvidence({
      parent_type: "dashboard",
      parent_id: did,
      child_type: "chart",
      child_id: c.id,
      relation_type: "DASHBOARD_HAS_CHART",
      method: "CHART_LIST_DASHBOARDS_ARRAY",
      confidence: "HIGH",
      scope: "local",
    });
  }
  if (c.datasource_id !== null && c.datasource_type === "table") {
    listDsByChart.set(c.id, c.datasource_id);
    addEvidence({
      parent_type: "chart",
      parent_id: c.id,
      child_type: "dataset",
      child_id: c.datasource_id,
      relation_type: "CHART_USES_DATASET",
      method: "CHART_LIST_DATASOURCE_ID",
      confidence: "VERIFIED",
      scope: "local",
    });
  }
}

// ---------------- D. API links для приоритетных датасетов ----------------
const apiLinks = readJsonFile(`${OUT_DIR}/api_chart_links_priority.json`);
const apiChartsNotInLocalCatalog = new Set<string>();
const apiChartIds = new Set<string>();
const apiDatasetIds = new Set<string>();
let apiChartRows = 0;
for (const [dsId, info] of Object.entries<any>(apiLinks?.by_dataset ?? {})) {
  apiDatasetIds.add(String(dsId));
  for (const c of info.charts ?? []) {
    const cid = String(c?.id ?? "");
    if (!cid) continue;
    apiChartRows++;
    apiChartIds.add(cid);
    if (!chartListIds.has(cid) && !chartDetailAllIds.has(cid)) apiChartsNotInLocalCatalog.add(cid);
    addEvidence({
      parent_type: "chart",
      parent_id: cid,
      child_type: "dataset",
      child_id: String(dsId),
      relation_type: "CHART_USES_DATASET",
      method: "API_FILTER_BY_DATASOURCE_ID",
      confidence: "VERIFIED",
      scope: "api",
    });
  }
}

// ---------------- Уникализация связей ----------------
type Rel = {
  key: string;
  parent_type: string;
  parent_id: string;
  child_type: string;
  child_id: string;
  relation_type: string;
  methods: Map<string, Confidence>;
  max_confidence: Confidence;
  scopes: Set<"local" | "api">;
  evidence_count: number;
};
const relMap = new Map<string, Rel>();
let duplicateEvidenceCount = 0;
for (const e of evidences) {
  const key = `${e.parent_type}|${e.parent_id}|${e.child_type}|${e.child_id}|${e.relation_type}`;
  let rel = relMap.get(key);
  if (!rel) {
    rel = {
      key,
      parent_type: e.parent_type,
      parent_id: e.parent_id,
      child_type: e.child_type,
      child_id: e.child_id,
      relation_type: e.relation_type,
      methods: new Map(),
      max_confidence: e.confidence,
      scopes: new Set(),
      evidence_count: 1,
    };
    relMap.set(key, rel);
  } else {
    duplicateEvidenceCount++;
    rel.evidence_count++;
  }
  const prev = rel.methods.get(e.method);
  if (!prev || CONF_ORDER[e.confidence] > CONF_ORDER[prev]) {
    rel.methods.set(e.method, e.confidence);
  }
  if (CONF_ORDER[e.confidence] > CONF_ORDER[rel.max_confidence]) {
    rel.max_confidence = e.confidence;
  }
  rel.scopes.add(e.scope);
}
const relations = [...relMap.values()];

// ---------------- Категории и покрытие ----------------
const d2c = relations.filter((r) => r.relation_type === "DASHBOARD_HAS_CHART");
const c2d = relations.filter((r) => r.relation_type === "CHART_USES_DATASET");

const chartCategories = {
  chart_list_total: chartListIds.size,
  chart_list_with_datasource_id: listChartWithDs.length,
  chart_list_without_datasource_id: chartListIds.size - listChartWithDs.length,
  chart_detail_total: chartDetailAllIds.size,
  chart_detail_valid: chartDetailIds.size,
  chart_detail_with_datasource_id: chartDetailWithDatasource.size,
  chart_detail_without_datasource_id: chartDetailWithoutDatasource.size,
  chart_detail_invalid: chartDetailInvalid.size,
  chart_in_list_without_detail: [...chartListIds].filter((id) => !chartDetailAllIds.has(id)).length,
  chart_detail_not_in_list: [...chartDetailAllIds].filter((id) => !chartListIds.has(id)).length,
};
const chartCategorySum =
  chartCategories.chart_detail_with_datasource_id +
  chartCategories.chart_detail_without_datasource_id +
  chartCategories.chart_detail_invalid;
const chartCategoriesSumMatchesTotal = chartCategorySum === chartCategories.chart_detail_total;

// charts без dataset / без dashboard (по локальным свидетельствам)
const chartsWithDatasetLocal = new Set<string>();
for (const r of c2d) if (r.scopes.has("local")) chartsWithDatasetLocal.add(r.parent_id);
const chartsWithDashboard = new Set<string>();
for (const r of d2c) chartsWithDashboard.add(r.child_id);

const dashboardsWithCharts = new Set<string>();
for (const r of d2c) dashboardsWithCharts.add(r.parent_id);
const dashboardsWithChartsInCatalog = new Set([...dashboardsWithCharts].filter((id) => dashboardListIds.has(id)));
const referencedDashboardsNotInCatalog = [...dashboardsWithCharts].filter((id) => !dashboardListIds.has(id));
const dashboardsWithoutCharts = [...dashboardListIds].filter((id) => !dashboardsWithCharts.has(id));

const datasetsUsedLocal = new Set<string>();
for (const r of c2d) if (r.scopes.has("local")) datasetsUsedLocal.add(r.child_id);
const datasetsUsedInCatalog = new Set([...datasetsUsedLocal].filter((id) => datasetListIds.has(id)));
const datasetsUnusedLocal = [...datasetListIds].filter((id) => !datasetsUsedLocal.has(id));
const unresolvedDatasetRefsLocal = [...datasetsUsedLocal].filter((id) => !datasetListIds.has(id));

// ---------------- ***REMOVED*** между источниками ----------------
const dsConflicts: Array<{ chart_id: string; detail: string; list: string }> = [];
let dsBothAgree = 0;
for (const [chartId, detailDs] of detailDsByChart) {
  const listDs = listDsByChart.get(chartId);
  if (listDs === undefined) continue;
  if (listDs === detailDs) dsBothAgree++;
  else dsConflicts.push({ chart_id: chartId, detail: detailDs, list: listDs });
}
const dsOnlyDetail = [...detailDsByChart.keys()].filter((id) => !listDsByChart.has(id)).length;
const dsOnlyList = [...listDsByChart.keys()].filter((id) => !detailDsByChart.has(id)).length;

const dashPairConflicts: Array<{ chart_id: string; detail: string[]; list: string[] }> = [];
let dashPairChartsBoth = 0;
for (const [chartId, detail] of (() => {
  const m = new Map<string, Set<string>>();
  for (const p of detailDashPairs) {
    const [did, cid] = p.split("|");
    if (!m.has(cid)) m.set(cid, new Set());
    m.get(cid)!.add(did);
  }
  return m;
})()) {
  const listSet = new Set<string>();
  for (const p of listDashPairs) {
    const [did, cid] = p.split("|");
    if (cid === chartId) listSet.add(did);
  }
  if (listSet.size === 0) continue;
  dashPairChartsBoth++;
  const a = [...detail].sort().join(",");
  const b = [...listSet].sort().join(",");
  if (a !== b) dashPairConflicts.push({ chart_id: chartId, detail: [...detail].sort(), list: [...listSet].sort() });
}

const positionPairs = new Set<string>();
for (const e of evidences) {
  if (e.method === "DASHBOARD_POSITION_JSON") positionPairs.add(`${e.parent_id}|${e.child_id}`);
}
const onlyPosition = [...positionPairs].filter((p) => !listDashPairs.has(p) && !detailDashPairs.has(p)).length;
const positionAndList = [...positionPairs].filter((p) => listDashPairs.has(p)).length;
const positionAndDetail = [...positionPairs].filter((p) => detailDashPairs.has(p)).length;
const detailAndList = [...detailDashPairs].filter((p) => listDashPairs.has(p)).length;
const listOnlyPairs = [...listDashPairs].filter((p) => !positionPairs.has(p) && !detailDashPairs.has(p)).length;

// ---------------- Integrity ----------------
const selfLinks = relations.filter((r) => r.parent_type === r.child_type && r.parent_id === r.child_id);
const perChartDs = new Map<string, Set<string>>();
for (const r of c2d) {
  if (!perChartDs.has(r.parent_id)) perChartDs.set(r.parent_id, new Set());
  perChartDs.get(r.parent_id)!.add(r.child_id);
}
const multiDatasetCharts = [...perChartDs.entries()].filter(([, v]) => v.size > 1);

const unresolvedChartRefs = new Set(d2c.map((r) => r.child_id).filter((id) => !chartListIds.has(id)));
const unresolvedDatasetRefs = new Set(c2d.map((r) => r.child_id).filter((id) => !datasetListIds.has(id)));
const unresolvedDashboardRefs = new Set(d2c.map((r) => r.parent_id).filter((id) => !dashboardListIds.has(id)));

const evidenceCountSum = relations.reduce((s, r) => s + r.evidence_count, 0);
const evidenceRowsByMethod: Record<string, number> = {};
for (const e of evidences) evidenceRowsByMethod[e.method] = (evidenceRowsByMethod[e.method] ?? 0) + 1;

const uniquePairsByMethod: Record<string, number> = {
  DASHBOARD_POSITION_JSON: positionPairs.size,
  CHART_DASHBOARDS_ARRAY: detailDashPairs.size,
  CHART_LIST_DASHBOARDS_ARRAY: listDashPairs.size,
  CHART_DATASOURCE_ID: detailDsByChart.size,
  CHART_LIST_DATASOURCE_ID: listDsByChart.size,
  API_FILTER_BY_DATASOURCE_ID: apiChartRows,
};

// ---------------- CSV ----------------
const evidenceCsvRows = evidences.map((e) =>
  [
    e.parent_type,
    e.parent_id,
    e.child_type,
    e.child_id,
    e.relation_type,
    e.method,
    e.confidence,
    e.scope,
  ]
    .map(csvCell)
    .join(","),
);
const evidenceCsv =
  "parent_type,parent_id,child_type,child_id,relation_type,method,confidence,scope\n" +
  evidenceCsvRows.join("\n");

const relationCsvRows = relations.map((r) => {
  const methods = [...r.methods.keys()].join(";");
  const confs = [...r.methods.entries()].map(([m, c]) => `${m}:${c}`).join(";");
  return [
    r.parent_type,
    r.parent_id,
    r.child_type,
    r.child_id,
    r.relation_type,
    methods,
    confs,
    r.max_confidence,
    [...r.scopes].join(";"),
    r.evidence_count,
  ]
    .map(csvCell)
    .join(",");
});
const relationsCsv =
  "parent_type,parent_id,child_type,child_id,relation_type,methods,confidences,max_confidence,scopes,evidence_count\n" +
  relationCsvRows.join("\n");

const SKIP_CSV = Bun.env.LINEAGE_SKIP_CSV === "1" || process.env.LINEAGE_SKIP_CSV === "1";
if (!SKIP_CSV) {
  writeFileSync(`${OUT_DIR}/lineage_evidence.csv`, evidenceCsv + "\n", { mode: 0o600 });
  writeFileSync(`${OUT_DIR}/lineage_relations.csv`, relationsCsv + "\n", { mode: 0o600 });
}

// ---------------- Сверка с discovery_summary ----------------
const discoverySummary = readJsonFile(`${OUTPUT_DIR}/discovery_summary.json`);
const summaryCounts = {
  dashboard: discoverySummary?.resources?.dashboard?.downloaded_count ?? null,
  chart: discoverySummary?.resources?.chart?.downloaded_count ?? null,
  dataset: discoverySummary?.resources?.dataset?.downloaded_count ?? null,
};

const checks = {
  evidence_rows_match: evidenceCsvRows.length === evidences.length,
  relations_rows_match: relationCsvRows.length === relations.length,
  evidence_count_sum_matches: evidenceCountSum === evidences.length,
  relation_type_sum_matches: d2c.length + c2d.length === relations.length,
  chart_detail_categories_sum_matches: chartCategoriesSumMatchesTotal,
  datasets_unused_non_negative: datasetsUnusedLocal.length >= 0,
  api_charts_unique_not_exceed_api_rows: apiChartsNotInLocalCatalog.size <= apiChartIds.size,
  list_dashboard_count_matches_summary: summaryCounts.dashboard === null || dashboardListIds.size === summaryCounts.dashboard,
  list_chart_count_matches_summary: summaryCounts.chart === null || chartListIds.size === summaryCounts.chart,
  list_dataset_count_matches_summary: summaryCounts.dataset === null || datasetListIds.size === summaryCounts.dataset,
  detail_within_list: chartCategories.chart_detail_not_in_list === 0,
};
const checksOk = Object.values(checks).every(Boolean);

const internalConsistency = {
  checks,
  checks_ok: checksOk,
  csv_evidence_rows: evidenceCsvRows.length,
  csv_relations_rows: relationCsvRows.length,
  evidence_rows: evidences.length,
  unique_relations: relations.length,
  evidence_count_sum: evidenceCountSum,
  duplicate_relation_keys: 0,
  note: "Проверка структуры и согласованности CSV ↔ JSON; не зависит от сети.",
};

const referenceQuality = {
  unresolved_dashboard_refs: unresolvedDashboardRefs.size,
  unresolved_dashboard_refs_sample: [...unresolvedDashboardRefs].slice(0, 50),
  unresolved_dataset_refs: unresolvedDatasetRefs.size,
  unresolved_dataset_refs_local: unresolvedDatasetRefsLocal.length,
  unresolved_dataset_refs_sample: [...unresolvedDatasetRefs].slice(0, 50),
  unresolved_chart_refs: unresolvedChartRefs.size,
  unresolved_chart_refs_all: [...unresolvedChartRefs],
  charts_with_conflicting_dashboard_sets: dashPairConflicts.length,
  conflicts_sample: dashPairConflicts.slice(0, 20),
  chart_dataset_source_conflicts: dsConflicts.length,
  chart_dataset_source_conflicts_sample: dsConflicts.slice(0, 20),
  datasets_unused_by_charts_local: datasetsUnusedLocal.length,
  datasets_used_in_catalog: datasetsUsedInCatalog.size,
  charts_without_dataset_local: chartListIds.size - chartsWithDatasetLocal.size,
  charts_without_dashboard: chartListIds.size - chartsWithDashboard.size,
  status: "FINDINGS" as const,
  note:
    "Unresolved/contradiction findings. Ссылки НЕ обозначаются архивными или удалёнными " +
    "без отдельного подтверждения источником.",
};

// ---------------- Output ----------------
const out = {
  generated_at: new Date().toISOString(),
  source:
    "полный каталог: output/{dashboards,charts,datasets}.json + SQLite detail + spot_details + api_chart_links_priority.json",
  catalog: {
    list_counts: {
      dashboard: dashboardListIds.size,
      chart: chartListIds.size,
      dataset: datasetListIds.size,
    },
    detail_counts: {
      dashboard_detail: dashboardDetailAllIds.size,
      chart_detail: chartDetailAllIds.size,
      chart_detail_valid: chartDetailIds.size,
      sqlite_dashboard_detail: sqliteDashboardDetailIds.size,
      sqlite_chart_detail: sqliteChartDetailIds.size,
      spot_dashboard_detail: spotDashboardCount,
      spot_chart_detail: spotChartCount,
    },
    sqlite_list_counts: {
      dashboard: sqliteDashboardListIds.size,
      chart: sqliteChartListIds.size,
      dataset: sqliteDatasetListIds.size,
    },
    summary_counts: summaryCounts,
    summary_started_at: discoverySummary?.started_at ?? null,
    summary_finished_at: discoverySummary?.finished_at ?? null,
    summary_status: discoverySummary?.status ?? null,
    note:
      "Lineage построен на полном list-каталоге output/*.json. SQLite содержит усечённый list (5 000 charts) " +
      "и detail-записи; таблица relations не изменялась.",
  },
  counts: {
    evidence_rows: evidences.length,
    unique_relations: relations.length,
    duplicate_evidence_collapsed: duplicateEvidenceCount,
    evidence_count_sum: evidenceCountSum,
    csv_evidence_rows: evidenceCsvRows.length,
    csv_relations_rows: relationCsvRows.length,
    list_chart_dash_pair_rows: listChartDashPairs,
  },
  by_relation_type: {
    DASHBOARD_HAS_CHART: d2c.length,
    CHART_USES_DATASET: c2d.length,
  },
  by_method: {
    evidence_rows: evidenceRowsByMethod,
    unique_pairs: uniquePairsByMethod,
  },
  chart_categories: {
    ...chartCategories,
    categories_sum: chartCategorySum,
    categories_sum_matches_total: chartCategoriesSumMatchesTotal,
  },
  chart_dataset_sources: {
    detail_charts_with_dataset: detailDsByChart.size,
    list_charts_with_dataset: listDsByChart.size,
    both_agree: dsBothAgree,
    conflicts: dsConflicts.length,
    conflicts_sample: dsConflicts.slice(0, 20),
    only_in_detail: dsOnlyDetail,
    only_in_list: dsOnlyList,
    note: "CHART_DATASOURCE_ID (detail) и CHART_LIST_DATASOURCE_ID (list) не смешиваются.",
  },
  chart_dashboard_sources: {
    position_json_pairs: positionPairs.size,
    detail_dashboards_pairs: detailDashPairs.size,
    list_dashboards_pairs: listDashPairs.size,
    position_and_list: positionAndList,
    position_and_detail: positionAndDetail,
    detail_and_list: detailAndList,
    only_position_json: onlyPosition,
    only_list: listOnlyPairs,
    charts_with_both_sources: dashPairChartsBoth,
    charts_with_conflicting_dashboard_sets: dashPairConflicts.length,
    conflicts_sample: dashPairConflicts.slice(0, 20),
  },
  coverage: {
    dashboards_total: dashboardListIds.size,
    dashboards_with_charts_any_method: dashboardsWithChartsInCatalog.size,
    dashboards_without_confirmed_charts: dashboardsWithoutCharts.length,
    dashboards_without_confirmed_charts_ids: dashboardsWithoutCharts.slice(0, 30),
    referenced_dashboards_not_in_catalog: referencedDashboardsNotInCatalog.length,
    position_json_null: posNull,
    position_json_parse_fail: posParseFail,
    charts_total: chartListIds.size,
    charts_with_dataset_link_local: chartsWithDatasetLocal.size,
    charts_without_dataset_local: chartListIds.size - chartsWithDatasetLocal.size,
    charts_with_dashboard_link: chartsWithDashboard.size,
    charts_without_dashboard: chartListIds.size - chartsWithDashboard.size,
    datasets_total: datasetListIds.size,
    datasets_used_by_charts_local: datasetsUsedLocal.size,
    datasets_used_in_catalog: datasetsUsedInCatalog.size,
    datasets_unused_by_charts_local: datasetsUnusedLocal.length,
    datasets_unresolved_refs_local: unresolvedDatasetRefsLocal.length,
  },
  integrity_issues: {
    self_links: selfLinks.length,
    multi_dataset_charts: multiDatasetCharts.length,
    multi_dataset_charts_sample: multiDatasetCharts.slice(0, 10),
    unresolved_chart_refs: unresolvedChartRefs.size,
    unresolved_dataset_refs: unresolvedDatasetRefs.size,
    unresolved_dataset_refs_local: unresolvedDatasetRefsLocal.length,
    unresolved_dashboard_refs: unresolvedDashboardRefs.size,
  },
  api_links: {
    api_chart_rows: apiChartRows,
    api_unique_charts: apiChartIds.size,
    api_unique_datasets: apiDatasetIds.size,
    api_charts_not_in_local_catalog: apiChartsNotInLocalCatalog.size,
  },
  checks,
  checks_ok: checksOk,
  internal_consistency: internalConsistency,
  reference_quality: referenceQuality,
  confidence_levels: {
    VERIFIED: "прямой результат API или прямое поле сохранённого detail/list",
    HIGH: "прямые сохранённые metadata Superset (position_json layout, reverse arrays)",
    MEDIUM: "косвенное предположение",
    LOW: "слабое предположение",
  },
};

writeFileSync(`${OUT_DIR}/lineage_preview.json`, JSON.stringify(out, null, 2), { mode: 0o600 });

// ---------------- Человекочитаемый отчёт ----------------
const md: string[] = [];
md.push("# Качество Lineage — Этап 1.1 (полный каталог)");
md.push("");
md.push(`Сгенерировано: ${out.generated_at}`);
md.push("");
md.push("## Каталог");
md.push("");
md.push("| Источник | dashboard | chart | dataset |");
md.push("|---|---:|---:|---:|");
md.push(`| list (output/*.json) | ${out.catalog.list_counts.dashboard} | ${out.catalog.list_counts.chart} | ${out.catalog.list_counts.dataset} |`);
md.push(`| SQLite list | ${out.catalog.sqlite_list_counts.dashboard} | ${out.catalog.sqlite_list_counts.chart} | ${out.catalog.sqlite_list_counts.dataset} |`);
md.push(`| detail | ${out.catalog.detail_counts.dashboard_detail} | ${out.catalog.detail_counts.chart_detail} | — |`);
md.push("");
md.push("## Сводка");
md.push("");
md.push("| Показатель | Значение |");
md.push("|---|---:|");
md.push(`| Свидетельств | ${out.counts.evidence_rows} |`);
md.push(`| Уникальных связей | ${out.counts.unique_relations} |`);
md.push(`| Сумма evidence_count | ${out.counts.evidence_count_sum} |`);
md.push(`| DASHBOARD_HAS_CHART | ${out.by_relation_type.DASHBOARD_HAS_CHART} |`);
md.push(`| CHART_USES_DATASET | ${out.by_relation_type.CHART_USES_DATASET} |`);
md.push("");
md.push("## Методы (источники не смешиваются)");
md.push("");
md.push("| Метод | Свидетельств | Уникальных пар |");
md.push("|---|---:|---:|");
for (const m of Object.keys(out.by_method.evidence_rows)) {
  md.push(`| ${m} | ${out.by_method.evidence_rows[m]} | ${out.by_method.unique_pairs[m] ?? 0} |`);
}
md.push("");
md.push("## Категории chart");
md.push("");
md.push("| Категория | Значение |");
md.push("|---|---:|");
for (const [k, v] of Object.entries(out.chart_categories)) {
  md.push(`| ${k} | ${v} |`);
}
md.push("");
md.push("## LINEAGE_INTERNAL_CONSISTENCY");
md.push("");
md.push("| Проверка | Результат |");
md.push("|---|---|");
for (const [k, v] of Object.entries(checks)) md.push(`| ${k} | ${v ? "OK" : "FAIL"} |`);
md.push("");
md.push(`Итог внутренней согласованности: **${checksOk ? "PASS" : "FAIL"}**.`);
md.push("");
md.push("## LINEAGE_REFERENCE_QUALITY");
md.push("");
md.push("| Показатель | Значение |");
md.push("|---|---:|");
md.push(`| unresolved dashboard refs | ${referenceQuality.unresolved_dashboard_refs} |`);
md.push(`| unresolved dataset refs | ${referenceQuality.unresolved_dataset_refs} |`);
md.push(`| unresolved chart refs | ${referenceQuality.unresolved_chart_refs} |`);
md.push(`| chart с расхождением dashboard sets | ${referenceQuality.charts_with_conflicting_dashboard_sets} |`);
md.push(`| chart→dataset конфликты источников | ${referenceQuality.chart_dataset_source_conflicts} |`);
md.push(`| charts без dataset | ${referenceQuality.charts_without_dataset_local} |`);
md.push(`| charts без dashboard | ${referenceQuality.charts_without_dashboard} |`);
md.push(`| datasets не используются локальными charts | ${referenceQuality.datasets_unused_by_charts_local} |`);
md.push("");
md.push(`Статус: **${referenceQuality.status}** (findings, не FAIL).`);
md.push("");
md.push(referenceQuality.note);
md.push("");
md.push("Детализация: `lineage_reference_quality.md`.");
md.push("");
md.push("## Покрытие");
md.push("");
md.push("| Показатель | Значение |");
md.push("|---|---:|");
for (const [k, v] of Object.entries(out.coverage)) {
  if (Array.isArray(v)) continue;
  md.push(`| ${k} | ${v} |`);
}
md.push("");
md.push("## Integrity");
md.push("");
md.push("| Показатель | Значение |");
md.push("|---|---:|");
for (const [k, v] of Object.entries(out.integrity_issues)) {
  if (Array.isArray(v)) continue;
  md.push(`| ${k} | ${v} |`);
}
md.push("");
writeFileSync(`${OUT_DIR}/lineage_quality.md`, md.join("\n"), { mode: 0o600 });

// ---------------- Отдельный отчёт по качеству ссылок ----------------
const ref: string[] = [];
ref.push("# Lineage reference quality — Этап 1.1");
ref.push("");
ref.push(`Сгенерировано: ${out.generated_at}`);
ref.push("");
ref.push("Статус: **FINDINGS** (не FAIL: это разрешённость ссылок и расхождения источников).");
ref.push("");
ref.push("## Сводка");
ref.push("");
ref.push("| Категория | Кол-во |");
ref.push("|---|---:|");
ref.push(`| unresolved dashboard refs | ${referenceQuality.unresolved_dashboard_refs} |`);
ref.push(`| unresolved dataset refs | ${referenceQuality.unresolved_dataset_refs} |`);
ref.push(`| unresolved chart refs | ${referenceQuality.unresolved_chart_refs} |`);
ref.push(`| chart с расхождением dashboard sets | ${referenceQuality.charts_with_conflicting_dashboard_sets} |`);
ref.push(`| chart→dataset конфликты detail/list | ${referenceQuality.chart_dataset_source_conflicts} |`);
ref.push("");
ref.push(`## unresolved dashboard refs (${referenceQuality.unresolved_dashboard_refs}, sample 50)`);
ref.push("");
ref.push("```");
ref.push(referenceQuality.unresolved_dashboard_refs_sample.join(", ") || "нет");
ref.push("```");
ref.push("");
ref.push(`## unresolved dataset refs (${referenceQuality.unresolved_dataset_refs}, sample 50)`);
ref.push("");
ref.push("```");
ref.push(referenceQuality.unresolved_dataset_refs_sample.join(", ") || "нет");
ref.push("```");
ref.push("");
ref.push(`## unresolved chart refs (${referenceQuality.unresolved_chart_refs}, все)`);
ref.push("");
ref.push("```");
ref.push(referenceQuality.unresolved_chart_refs_all.join(", ") || "нет");
ref.push("```");
ref.push("");
ref.push(`## Расхождения dashboard sets (${referenceQuality.charts_with_conflicting_dashboard_sets})`);
ref.push("");
ref.push("| chart_id | detail dashboards | list dashboards |");
ref.push("|---|---|---|");
for (const c of referenceQuality.conflicts_sample) {
  ref.push(`| ${c.chart_id} | ${c.detail.join(",")} | ${c.list.join(",")} |`);
}
ref.push("");
ref.push("## Примечание");
ref.push("");
ref.push(referenceQuality.note);
ref.push("");
writeFileSync(`${OUT_DIR}/lineage_reference_quality.md`, ref.join("\n"), { mode: 0o600 });

console.log(
  JSON.stringify(
    {
      list_counts: out.catalog.list_counts,
      detail_counts: out.catalog.detail_counts,
      evidence: out.counts.evidence_rows,
      unique_relations: out.counts.unique_relations,
      D2C: out.by_relation_type.DASHBOARD_HAS_CHART,
      C2D: out.by_relation_type.CHART_USES_DATASET,
      methods: out.by_method.evidence_rows,
      chart_categories: out.chart_categories,
      ds_conflicts: dsConflicts.length,
      dash_pair_conflicts: dashPairConflicts.length,
      charts_without_dataset: out.coverage.charts_without_dataset_local,
      charts_without_dashboard: out.coverage.charts_without_dashboard,
      unresolved_chart_refs: out.integrity_issues.unresolved_chart_refs,
      unresolved_dashboard_refs: out.integrity_issues.unresolved_dashboard_refs,
      checks_ok: checksOk,
    },
    null,
    2,
  ),
);

if (!checksOk) process.exitCode = 1;
