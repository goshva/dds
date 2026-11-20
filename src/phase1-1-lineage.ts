/**
 * Этап 1.1, задача 3 (пересборка по ТЗ §4) — единый Lineage Builder.
 *
 * Один запуск строит ОДИН snapshot связей и из него формирует:
 *   - lineage_evidence.csv  — все свидетельства (пара + метод + confidence), без подавления дублей;
 *   - lineage_relations.csv — уникальные связи (parent_type,parent_id,child_type,child_id,relation_type)
 *                             со списком методов и максимальным confidence;
 *   - lineage_preview.json  — метрики coverage/категории, согласованные с CSV.
 *
 * Источники свидетельств:
 *   A. dashboard_detail.result.position_json → CHART-узлы            DASHBOARD_POSITION_JSON     HIGH
 *   B. chart_detail.result.dashboards[]                              CHART_DASHBOARDS_ARRAY      HIGH
 *   C. chart_detail.result.datasource_id                             CHART_DATASOURCE_ID         VERIFIED (локально)
 *   D. api_chart_links_priority.json (API filter datasource_id)      API_FILTER_BY_DATASOURCE_ID VERIFIED (API)
 *
 * SQLite открывается readonly; relations не пишутся в БД.
 */
import { Database } from "bun:sqlite";
import { writeFileSync, readFileSync } from "fs";

const DB = "data/catalog.sqlite";
const OUT_DIR = "reports/phase-01-1";

type Confidence = "VERIFIED" | "HIGH" | "MEDIUM" | "LOW";
const CONF_ORDER: Record<Confidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, VERIFIED: 3 };

type Evidence = {
  parent_type: string; parent_id: string; child_type: string; child_id: string;
  relation_type: string; method: string; confidence: Confidence; scope: "local" | "api";
};

const evidences: Evidence[] = [];
function addEvidence(e: Omit<Evidence, never>) {
  evidences.push(e);
}

const db = new Database(DB, { readonly: true });
const idsOf = (t: string) =>
  new Set((db.query(`SELECT object_id FROM objects WHERE object_type=?`).all(t) as any[]).map((r) => r.object_id));

const chartListIds = idsOf("chart");
const datasetListIds = idsOf("dataset");
const dashboardListIds = idsOf("dashboard");
const dashboardDetailIds = idsOf("dashboard_detail");
const chartDetailIds = idsOf("chart_detail");

// ---------------- A. position_json ----------------
let posParseFail = 0, posNull = 0;
const ddRows = db.query(`SELECT object_id, payload_json FROM objects WHERE object_type='dashboard_detail'`).all() as any[];
for (const row of ddRows) {
  let pj: any;
  try { pj = JSON.parse(row.payload_json)?.result?.position_json; } catch { posParseFail++; continue; }
  if (!pj) { posNull++; continue; }
  let pos: any;
  try { pos = typeof pj === "string" ? JSON.parse(pj) : pj; } catch { posParseFail++; continue; }
  for (const node of Object.values(pos ?? {})) {
    const n = node as any;
    if (n?.type !== "CHART") continue;
    const cid = String(n?.meta?.chartId ?? "");
    if (!cid) continue;
    addEvidence({
      parent_type: "dashboard", parent_id: row.object_id, child_type: "chart", child_id: cid,
      relation_type: "DASHBOARD_HAS_CHART", method: "DASHBOARD_POSITION_JSON", confidence: "HIGH", scope: "local",
    });
  }
}

// ---------------- B + C. chart_detail ----------------
let chartsNoDs = 0;
const cdRows = db.query(`SELECT object_id, payload_json FROM objects WHERE object_type='chart_detail'`).all() as any[];
for (const row of cdRows) {
  let res: any;
  try { res = JSON.parse(row.payload_json)?.result; } catch { continue; }
  if (!res) continue;

  // B: обратные ссылки dashboards[]
  for (const d of res.dashboards ?? []) {
    const did = String(d?.id ?? d ?? "");
    if (!did) continue;
    addEvidence({
      parent_type: "dashboard", parent_id: did, child_type: "chart", child_id: row.object_id,
      relation_type: "DASHBOARD_HAS_CHART", method: "CHART_DASHBOARDS_ARRAY", confidence: "HIGH", scope: "local",
    });
  }

  // C: datasource_id
  const dsId = res.datasource_id != null ? String(res.datasource_id) : null;
  if (dsId == null) { chartsNoDs++; continue; }
  addEvidence({
    parent_type: "chart", parent_id: row.object_id, child_type: "dataset", child_id: dsId,
    relation_type: "CHART_USES_DATASET", method: "CHART_DATASOURCE_ID", confidence: "VERIFIED", scope: "local",
  });
}

// ---------------- D. API links для приоритетных датасетов ----------------
const apiLinks = JSON.parse(readFileSync(`${OUT_DIR}/api_chart_links_priority.json`, "utf8"));
let apiChartsNotInLocalCatalog = 0;
for (const [dsId, info] of Object.entries<any>(apiLinks.by_dataset ?? {})) {
  for (const c of info.charts ?? []) {
    const cid = String(c.id);
    if (!chartListIds.has(cid) && !chartDetailIds.has(cid)) apiChartsNotInLocalCatalog++;
    addEvidence({
      parent_type: "chart", parent_id: cid, child_type: "dataset", child_id: String(dsId),
      relation_type: "CHART_USES_DATASET", method: "API_FILTER_BY_DATASOURCE_ID", confidence: "VERIFIED", scope: "api",
    });
  }
}

// ---------------- Уникализация связей (ТЗ п.3–5) ----------------
type Rel = {
  key: string;
  parent_type: string; parent_id: string; child_type: string; child_id: string; relation_type: string;
  methods: Map<string, Confidence>;
  max_confidence: Confidence;
  scopes: Set<"local" | "api">;
};
const relMap = new Map<string, Rel>();
let duplicateEvidenceCount = 0;
for (const e of evidences) {
  const key = `${e.parent_type}|${e.parent_id}|${e.child_type}|${e.child_id}|${e.relation_type}`;
  let rel = relMap.get(key);
  if (!rel) {
    rel = {
      key, parent_type: e.parent_type, parent_id: e.parent_id, child_type: e.child_type, child_id: e.child_id,
      relation_type: e.relation_type, methods: new Map(), max_confidence: e.confidence, scopes: new Set(),
    };
    relMap.set(key, rel);
  } else {
    duplicateEvidenceCount++;
  }
  if (!rel.methods.has(e.method) || CONF_ORDER[rel.methods.get(e.method)!] < CONF_ORDER[e.confidence]) {
    rel.methods.set(e.method, e.confidence);
  }
  if (CONF_ORDER[e.confidence] > CONF_ORDER[rel.max_confidence]) rel.max_confidence = e.confidence;
  rel.scopes.add(e.scope);
}
const relations = [...relMap.values()];

// ---------------- Категории и проверки (ТЗ п.7–10, 15, 17) ----------------
const d2c = relations.filter((r) => r.relation_type === "DASHBOARD_HAS_CHART");
const c2d = relations.filter((r) => r.relation_type === "CHART_USES_DATASET");

// Charts: 4 категории (п.9)
const chartsWithDetail = new Set([...chartDetailIds]);
const chartsWithDsLink = new Set(c2d.filter((r) => r.scopes.has("local")).map((r) => r.parent_id));
const chartCategories = {
  chart_list_total: chartListIds.size,
  chart_detail_total: chartDetailIds.size,
  chart_detail_with_datasource_id: chartDetailIds.size - chartsNoDs,
  chart_detail_without_datasource_id: chartsNoDs,
  chart_in_list_without_detail: [...chartListIds].filter((id) => !chartsWithDetail.has(id)).length,
};

// Local vs API (п.10): объекты каталога считаются ТОЛЬКО по локальным множествам
const localRelations = new Set(relations.filter((r) => r.scopes.has("local")).map((r) => r.key));
const apiOnlyRelations = relations.filter((r) => !r.scopes.has("local"));

// linkedCharts: ID ЧАРТА (п.7)
const chartsLinkedToDatasetsLocal = new Set<string>();
for (const r of c2d) if (r.scopes.has("local")) chartsLinkedToDatasetsLocal.add(r.parent_id);
const chartsLinkedToDatasetsApiOnly = new Set(apiOnlyRelations.filter((r) => r.relation_type === "CHART_USES_DATASET").map((r) => r.parent_id));

const datasetsUsedLocal = new Set<string>();
for (const r of c2d) if (r.scopes.has("local")) datasetsUsedLocal.add(r.child_id);

// Dashboards coverage (п.8, 15): из фактических множеств, position_json=NULL ≠ no charts
const dashWithChartPos = new Set(d2c.filter((r) => r.methods.has("DASHBOARD_POSITION_JSON")).map((r) => r.parent_id));
const dashWithChartArr = new Set(d2c.filter((r) => r.methods.has("CHART_DASHBOARDS_ARRAY")).map((r) => r.parent_id));
const allDashParents = new Set([...dashWithChartPos, ...dashWithChartArr]);
const dashboardsWithoutConfirmedCharts = [...dashboardListIds].filter((id) => !allDashParents.has(id));

// Расхождение 1757 vs 2645 (п.13): считаем сейчас из одного snapshot
const arrPairsUnique = dashWithChartArr.size >= 0 ? new Set(
  evidences.filter((e) => e.method === "CHART_DASHBOARDS_ARRAY").map((e) => `${e.parent_id}|${e.child_id}`)
).size : 0;
const posPairsUnique = new Set(
  evidences.filter((e) => e.method === "DASHBOARD_POSITION_JSON").map((e) => `${e.parent_id}|${e.child_id}`)
).size;

// Integrity checks (п.17)
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

const corroboratedPairs = relations.filter((r) =>
  r.relation_type === "DASHBOARD_HAS_CHART" && r.methods.has("DASHBOARD_POSITION_JSON") && r.methods.has("CHART_DASHBOARDS_ARRAY")
).length;

// ---------------- Запись CSV (п.6: один запуск, один набор данных) ----------------
const evidenceCsv =
  "parent_type,parent_id,child_type,child_id,relation_type,method,confidence,scope\n" +
  evidences.map((e) => [e.parent_type, e.parent_id, e.child_type, e.child_id, e.relation_type, e.method, e.confidence, e.scope].join(",")).join("\n");

const relationsCsv =
  "parent_type,parent_id,child_type,child_id,relation_type,methods,confidences,max_confidence,scopes,evidence_count\n" +
  relations.map((r) => {
    const methods = [...r.methods.keys()].join(";");
    const confs = [...r.methods.entries()].map(([m, c]) => `${m}:${c}`).join(";");
    return [r.parent_type, r.parent_id, r.child_type, r.child_id, r.relation_type, methods, confs, r.max_confidence, [...r.scopes].join(";"), r.methods.size].join(",");
  }).join("\n");

writeFileSync(`${OUT_DIR}/lineage_evidence.csv`, evidenceCsv + "\n", { mode: 0o600 });
writeFileSync(`${OUT_DIR}/lineage_relations.csv`, relationsCsv + "\n", { mode: 0o600 });

const out = {
  generated_at: new Date().toISOString(),
  source: "единый snapshot: catalog.sqlite (readonly) + api_chart_links_priority.json; один запуск → evidence+relations+JSON",
  sqlite_snapshot: {
    note: "Линия построена на текущем снимке каталога (charts усечены до 5 000 из 19 922 полных API-выгрузок; см. discovery_test.log). Таблица relations БД не изменялась.",
    chart_list: chartListIds.size, chart_detail: chartDetailIds.size,
    dashboard_list: dashboardListIds.size, dashboard_detail: dashboardDetailIds.size,
    dataset_list: datasetListIds.size,
  },
  counts: {
    evidence_rows: evidences.length,
    unique_relations: relations.length,
    duplicate_evidence_collapsed: duplicateEvidenceCount,
    rows_match_check: `CSV evidence=${evidences.length}, CSV relations=${relations.length}`,
  },
  by_relation_type: {
    DASHBOARD_HAS_CHART: d2c.length,
    CHART_USES_DATASET: c2d.length,
  },
  by_method_unique_pairs: {
    DASHBOARD_POSITION_JSON: posPairsUnique,
    CHART_DASHBOARDS_ARRAY: arrPairsUnique,
    CHART_DATASOURCE_ID: c2d.filter((r) => r.methods.has("CHART_DATASOURCE_ID")).length,
    API_FILTER_BY_DATASOURCE_ID: c2d.filter((r) => r.methods.has("API_FILTER_BY_DATASOURCE_ID")).length,
  },
  discrepancy_1757_vs_2645_explanation: {
    previous_report_value: 1757,
    recomputed_from_single_snapshot: arrPairsUnique,
    reason: "Старое значение 1757 было числом чарт-объектов с непустым dashboards[] (chartsWithDashArray), а не числом пар dashboard|chart. Реальное число уникальных пар по методу CHART_DASHBOARDS_ARRAY пересчитано из единого snapshot.",
    raw_array_pairs_non_deduped: evidences.filter((e) => e.method === "CHART_DASHBOARDS_ARRAY").length,
  },
  corroborated_dashboard_pairs: corroboratedPairs,
  local_vs_api: {
    local_only_relations: relations.filter((r) => r.scopes.has("local") && !r.scopes.has("api")).length,
    api_only_relations: apiOnlyRelations.length,
    both: relations.filter((r) => r.scopes.has("local") && r.scopes.has("api")).length,
    api_charts_not_in_local_catalog: apiChartsNotInLocalCatalog,
    note: "API-связи НЕ увеличивают счётчики локальных объектов (п.10).",
  },
  chart_categories: chartCategories,
  coverage: {
    dashboards_total: dashboardListIds.size,
    dashboards_with_charts_position_json: dashWithChartPos.size,
    dashboards_with_charts_any_method: allDashParents.size,
    dashboards_without_confirmed_charts: dashboardsWithoutConfirmedCharts.length,
    dashboards_without_confirmed_charts_ids: dashboardsWithoutConfirmedCharts.slice(0, 30),
    position_json_null: posNull,
    position_json_parse_fail: posParseFail,
    charts_linked_to_datasets_local: chartsLinkedToDatasetsLocal.size,
    charts_linked_via_api_only: chartsLinkedToDatasetsApiOnly.size,
    datasets_used_by_charts_local: datasetsUsedLocal.size,
    datasets_unused_by_charts_local: datasetListIds.size - datasetsUsedLocal.size,
    correction_161: "161 — это уникальные ДАТАСЕТЫ, использовавшиеся локальными charts; charts с dataset-связью считается отдельно: charts_linked_to_datasets_local.",
  },
  integrity_issues: {
    self_links: selfLinks.length,
    multi_dataset_charts: multiDatasetCharts.length,
    multi_dataset_charts_sample: multiDatasetCharts.slice(0, 10),
    unresolved_chart_refs: unresolvedChartRefs.size,
    unresolved_dataset_refs: unresolvedDatasetRefs.size,
    unresolved_dashboard_refs: unresolvedDashboardRefs.size,
    explanation_unresolved_charts: "Неразрешённые chart-ссылки — следствие усечения локального list (5 000 из 19 922); полная выгрузка выполнена тестом discovery, но исходный каталог не перезаписывался (ТЗ §2.5).",
  },
  confidence_levels: {
    VERIFIED: "прямой результат API или прямое поле сохранённого detail, подтверждённое источником",
    HIGH: "прямые сохранённые metadata Superset (position_json layout, reverse arrays)",
    MEDIUM: "косвенное предположение",
    LOW: "слабое предположение",
  },
};

writeFileSync(`${OUT_DIR}/lineage_preview.json`, JSON.stringify(out, null, 2), { mode: 0o600 });

console.log(JSON.stringify({
  evidence: out.counts.evidence_rows,
  unique_relations: out.counts.unique_relations,
  collapsed_duplicates: out.counts.duplicate_evidence_collapsed,
  D2C: out.by_relation_type.DASHBOARD_HAS_CHART,
  C2D: out.by_relation_type.CHART_USES_DATASET,
  arr_pairs: arrPairsUnique,
  pos_pairs: posPairsUnique,
  corroborated: corroboratedPairs,
  charts_linked_local: chartsLinkedToDatasetsLocal.size,
  datasets_used_local: datasetsUsedLocal.size,
  dash_no_charts: dashboardsWithoutConfirmedCharts.length,
}, null, 2));
db.close();
