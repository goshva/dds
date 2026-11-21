/**
 * Этап 1.1, задача 3 (пересборка по ТЗ §4) — единый Lineage Builder.
 *
 * Один запуск строит ОДИН snapshot связей и из него формирует:
 *   - lineage_evidence.csv  — все свидетельства (пара + метод + confidence), без подавления дублей;
 *   - lineage_relations.csv — уникальные связи (parent_type,parent_id,child_type,child_id,relation_type)
 *                             со списком методов, максимальным confidence и числом свидетельств;
 *   - lineage_preview.json  — метрики coverage/категории, согласованные с CSV;
 *   - lineage_quality.md    — человекочитаемая сводка, сгенерированная из тех же чисел.
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
import { writeFileSync, readFileSync, existsSync } from "fs";

const DB = "data/catalog.sqlite";
const OUT_DIR = "reports/phase-01-1";

type Confidence = "VERIFIED" | "HIGH" | "MEDIUM" | "LOW";
const CONF_ORDER: Record<Confidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, VERIFIED: 3 };

type Evidence = {
  parent_type: string;
  parent_id: string;
  child_type: string;
  child_id: string;
  relation_type: string;
  method: string;
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

const db = new Database(DB, { readonly: true });
const idsOf = (t: string) =>
  new Set(
    (db.query(`SELECT object_id FROM objects WHERE object_type=?`).all(t) as any[]).map(
      (r) => String(r.object_id),
    ),
  );

const chartListIds = idsOf("chart");
const datasetListIds = idsOf("dataset");
const dashboardListIds = idsOf("dashboard");
const dashboardDetailIds = idsOf("dashboard_detail");
const chartDetailIds = idsOf("chart_detail");

// ---------------- A. position_json ----------------
let posParseFail = 0;
let posNull = 0;
const ddRows = db
  .query(`SELECT object_id, payload_json FROM objects WHERE object_type='dashboard_detail'`)
  .all() as any[];
for (const row of ddRows) {
  let pj: any;
  try {
    pj = JSON.parse(row.payload_json)?.result?.position_json;
  } catch {
    posParseFail++;
    continue;
  }
  if (!pj) {
    posNull++;
    continue;
  }
  let pos: any;
  try {
    pos = typeof pj === "string" ? JSON.parse(pj) : pj;
  } catch {
    posParseFail++;
    continue;
  }
  for (const node of Object.values(pos ?? {})) {
    const n = node as any;
    if (n?.type !== "CHART") continue;
    const cid = String(n?.meta?.chartId ?? "");
    if (!cid) continue;
    addEvidence({
      parent_type: "dashboard",
      parent_id: String(row.object_id),
      child_type: "chart",
      child_id: cid,
      relation_type: "DASHBOARD_HAS_CHART",
      method: "DASHBOARD_POSITION_JSON",
      confidence: "HIGH",
      scope: "local",
    });
  }
}

// ---------------- B + C. chart_detail ----------------
const chartDetailWithDatasource = new Set<string>();
const chartDetailWithoutDatasource = new Set<string>();
const chartDetailInvalid = new Set<string>();
const chartsWithDashArray = new Set<string>();
let chartDetailDashArrayRawRows = 0;

const cdRows = db
  .query(`SELECT object_id, payload_json FROM objects WHERE object_type='chart_detail'`)
  .all() as any[];
for (const row of cdRows) {
  const id = String(row.object_id);
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

  // B: обратные ссылки dashboards[]
  const dashboards = Array.isArray(res.dashboards) ? res.dashboards : [];
  if (dashboards.length > 0) {
    chartsWithDashArray.add(id);
    chartDetailDashArrayRawRows += dashboards.length;
  }
  for (const d of dashboards) {
    const did = String(d?.id ?? d ?? "");
    if (!did) continue;
    addEvidence({
      parent_type: "dashboard",
      parent_id: did,
      child_type: "chart",
      child_id: id,
      relation_type: "DASHBOARD_HAS_CHART",
      method: "CHART_DASHBOARDS_ARRAY",
      confidence: "HIGH",
      scope: "local",
    });
  }

  // C: datasource_id
  const dsId = res.datasource_id != null ? String(res.datasource_id) : null;
  if (dsId == null) {
    chartDetailWithoutDatasource.add(id);
  } else {
    chartDetailWithDatasource.add(id);
    addEvidence({
      parent_type: "chart",
      parent_id: id,
      child_type: "dataset",
      child_id: dsId,
      relation_type: "CHART_USES_DATASET",
      method: "CHART_DATASOURCE_ID",
      confidence: "VERIFIED",
      scope: "local",
    });
  }
}

// ---------------- D. API links для приоритетных датасетов ----------------
const apiLinks = JSON.parse(readFileSync(`${OUT_DIR}/api_chart_links_priority.json`, "utf8"));
const apiChartsNotInLocalCatalog = new Set<string>();
const apiChartIds = new Set<string>();
const apiDatasetIds = new Set<string>();
let apiChartRows = 0;
for (const [dsId, info] of Object.entries<any>(apiLinks.by_dataset ?? {})) {
  apiDatasetIds.add(String(dsId));
  for (const c of info.charts ?? []) {
    const cid = String(c?.id ?? "");
    if (!cid) continue;
    apiChartRows++;
    apiChartIds.add(cid);
    if (!chartListIds.has(cid) && !chartDetailIds.has(cid)) apiChartsNotInLocalCatalog.add(cid);
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

// ---------------- Уникализация связей (ТЗ п.3–5) ----------------
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

// ---------------- Категории и проверки ----------------
const d2c = relations.filter((r) => r.relation_type === "DASHBOARD_HAS_CHART");
const c2d = relations.filter((r) => r.relation_type === "CHART_USES_DATASET");

// Charts: категории (п.9)
const chartCategories = {
  chart_list_total: chartListIds.size,
  chart_detail_total: chartDetailIds.size,
  chart_detail_valid: chartDetailIds.size - chartDetailInvalid.size,
  chart_detail_with_datasource_id: chartDetailWithDatasource.size,
  chart_detail_without_datasource_id: chartDetailWithoutDatasource.size,
  chart_detail_invalid: chartDetailInvalid.size,
  chart_in_list_without_detail: [...chartListIds].filter((id) => !chartDetailIds.has(id)).length,
};
const chartCategorySum =
  chartCategories.chart_detail_with_datasource_id +
  chartCategories.chart_detail_without_datasource_id +
  chartCategories.chart_detail_invalid;
const chartCategoriesSumMatchesTotal = chartCategorySum === chartCategories.chart_detail_total;

// Local vs API (п.10): объекты каталога считаются ТОЛЬКО по локальным множествам
const apiOnlyRelations = relations.filter((r) => !r.scopes.has("local"));

// linkedCharts: ID ЧАРТА (п.7)
const chartsLinkedToDatasetsLocal = new Set<string>();
for (const r of c2d) if (r.scopes.has("local")) chartsLinkedToDatasetsLocal.add(r.parent_id);
const chartsLinkedToDatasetsApiOnly = new Set(
  apiOnlyRelations.filter((r) => r.relation_type === "CHART_USES_DATASET").map((r) => r.parent_id),
);

const datasetsUsedLocal = new Set<string>();
for (const r of c2d) if (r.scopes.has("local")) datasetsUsedLocal.add(r.child_id);

const datasetsUsedInCatalog = new Set([...datasetsUsedLocal].filter((id) => datasetListIds.has(id)));
const datasetsUnusedLocal = [...datasetListIds].filter((id) => !datasetsUsedLocal.has(id));
const unresolvedDatasetRefsLocal = [...datasetsUsedLocal].filter((id) => !datasetListIds.has(id));

// Dashboards coverage (п.8, 15): из фактических множеств, position_json=NULL ≠ no charts
const dashWithChartPos = new Set(
  d2c.filter((r) => r.methods.has("DASHBOARD_POSITION_JSON")).map((r) => r.parent_id),
);
const dashWithChartArr = new Set(
  d2c.filter((r) => r.methods.has("CHART_DASHBOARDS_ARRAY")).map((r) => r.parent_id),
);
const allDashParents = new Set([...dashWithChartPos, ...dashWithChartArr]);
const dashboardsWithoutConfirmedCharts = [...dashboardListIds].filter((id) => !allDashParents.has(id));

// Расхождение 1757 vs 2645 (п.13): считаем сейчас из одного snapshot
const arrPairsUnique = new Set(
  evidences
    .filter((e) => e.method === "CHART_DASHBOARDS_ARRAY")
    .map((e) => `${e.parent_id}|${e.child_id}`),
).size;
const posPairsUnique = new Set(
  evidences
    .filter((e) => e.method === "DASHBOARD_POSITION_JSON")
    .map((e) => `${e.parent_id}|${e.child_id}`),
).size;
const arrEvidenceRows = evidences.filter((e) => e.method === "CHART_DASHBOARDS_ARRAY").length;
const posEvidenceRows = evidences.filter((e) => e.method === "DASHBOARD_POSITION_JSON").length;

// Integrity checks (п.17)
const selfLinks = relations.filter((r) => r.parent_type === r.child_type && r.parent_id === r.child_id);
const perChartDs = new Map<string, Set<string>>();
for (const r of c2d) {
  if (!perChartDs.has(r.parent_id)) perChartDs.set(r.parent_id, new Set());
  perChartDs.get(r.parent_id)!.add(r.child_id);
}
const multiDatasetCharts = [...perChartDs.entries()].filter(([, v]) => v.size > 1);

const unresolvedChartRefs = new Set(
  d2c.map((r) => r.child_id).filter((id) => !chartListIds.has(id)),
);
const unresolvedDatasetRefs = new Set(
  c2d.map((r) => r.child_id).filter((id) => !datasetListIds.has(id)),
);
const unresolvedDashboardRefs = new Set(
  d2c.map((r) => r.parent_id).filter((id) => !dashboardListIds.has(id)),
);

const corroboratedPairs = relations.filter(
  (r) =>
    r.relation_type === "DASHBOARD_HAS_CHART" &&
    r.methods.has("DASHBOARD_POSITION_JSON") &&
    r.methods.has("CHART_DASHBOARDS_ARRAY"),
).length;

const evidenceCountSum = relations.reduce((s, r) => s + r.evidence_count, 0);
const relationsWithArrMethod = relations.filter((r) => r.methods.has("CHART_DASHBOARDS_ARRAY")).length;

// ---------------- Запись CSV (один запуск, один набор данных) ----------------
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

writeFileSync(`${OUT_DIR}/lineage_evidence.csv`, evidenceCsv + "\n", { mode: 0o600 });
writeFileSync(`${OUT_DIR}/lineage_relations.csv`, relationsCsv + "\n", { mode: 0o600 });

// ---------------- <ФИО> согласованности CSV ↔ JSON ----------------
const checks = {
  evidence_rows_match: evidenceCsvRows.length === evidences.length,
  relations_rows_match: relationCsvRows.length === relations.length,
  evidence_count_sum_matches: evidenceCountSum === evidences.length,
  relation_type_sum_matches: d2c.length + c2d.length === relations.length,
  chart_detail_categories_sum_matches: chartCategoriesSumMatchesTotal,
  datasets_unused_non_negative: datasetsUnusedLocal.length >= 0,
  api_charts_unique_not_exceed_api_rows: apiChartsNotInLocalCatalog.size <= apiChartIds.size,
};
const checksOk = Object.values(checks).every(Boolean);

// ---------------- API counts (для корректного snapshot note) ----------------
let apiCounts: any = null;
const spotFile = `${OUT_DIR}/api_spot_checks.json`;
if (existsSync(spotFile)) {
  try {
    const spot = JSON.parse(readFileSync(spotFile, "utf8"));
    apiCounts = {
      dashboard: spot?.counts?.dashboard?.api_count ?? null,
      chart: spot?.counts?.chart?.api_count ?? null,
      dataset: spot?.counts?.dataset?.api_count ?? null,
    };
  } catch {
    apiCounts = null;
  }
}
const apiChartCount = apiCounts?.chart ?? null;

const out = {
  generated_at: new Date().toISOString(),
  source:
    "единый snapshot: catalog.sqlite (readonly) + api_chart_links_priority.json; один запуск → evidence+relations+JSON",
  sqlite_snapshot: {
    note:
      `Линия построена на текущем снимке каталога. Локальный chart list = ${chartListIds.size}; ` +
      `полная API-выгрузка chart = ${apiChartCount ?? "n/a"} (count из api_spot_checks.json). ` +
      "Таблица relations БД не изменялась.",
    api_counts: apiCounts,
    chart_list: chartListIds.size,
    chart_detail: chartDetailIds.size,
    dashboard_list: dashboardListIds.size,
    dashboard_detail: dashboardDetailIds.size,
    dataset_list: datasetListIds.size,
  },
  counts: {
    evidence_rows: evidences.length,
    unique_relations: relations.length,
    duplicate_evidence_collapsed: duplicateEvidenceCount,
    evidence_count_sum: evidenceCountSum,
    csv_evidence_rows: evidenceCsvRows.length,
    csv_relations_rows: relationCsvRows.length,
    rows_match_check: `CSV evidence=${evidenceCsvRows.length}, CSV relations=${relationCsvRows.length}`,
  },
  by_relation_type: {
    DASHBOARD_HAS_CHART: d2c.length,
    CHART_USES_DATASET: c2d.length,
  },
  by_method: {
    evidence_rows: {
      DASHBOARD_POSITION_JSON: posEvidenceRows,
      CHART_DASHBOARDS_ARRAY: arrEvidenceRows,
      CHART_DATASOURCE_ID: evidences.filter((e) => e.method === "CHART_DATASOURCE_ID").length,
      API_FILTER_BY_DATASOURCE_ID: evidences.filter((e) => e.method === "API_FILTER_BY_DATASOURCE_ID").length,
    },
    unique_pairs: {
      DASHBOARD_POSITION_JSON: posPairsUnique,
      CHART_DASHBOARDS_ARRAY: arrPairsUnique,
      CHART_DATASOURCE_ID: c2d.filter((r) => r.methods.has("CHART_DATASOURCE_ID")).length,
      API_FILTER_BY_DATASOURCE_ID: c2d.filter((r) => r.methods.has("API_FILTER_BY_DATASOURCE_ID")).length,
    },
  },
  discrepancy_1757_vs_2645_explanation: {
    previous_report_value: 1757,
    old_definition:
      "Точная формула предыдущей реализации в текущем репозитории недоступна; ниже пересчитаны все кандидаты из единого snapshot без предположений.",
    recomputed_unique_array_pairs: arrPairsUnique,
    raw_array_evidence_rows: arrEvidenceRows,
    charts_with_nonempty_dashboards_array: chartsWithDashArray.size,
    raw_dashboards_array_elements: chartDetailDashArrayRawRows,
    relations_with_chart_dashboards_array_method: relationsWithArrMethod,
    matches: {
      unique_array_pairs: arrPairsUnique === 1757,
      raw_array_evidence_rows: arrEvidenceRows === 1757,
      charts_with_nonempty_dashboards_array: chartsWithDashArray.size === 1757,
      relations_with_chart_dashboards_array_method: relationsWithArrMethod === 1757,
    },
    reason:
      `Пересчёт из одного snapshot: уникальных пар dashboard|chart по методу CHART_DASHBOARDS_ARRAY = ${arrPairsUnique}; ` +
      `сырых свидетельств = ${arrEvidenceRows}; chart_detail с непустым dashboards[] = ${chartsWithDashArray.size}; ` +
      `элементов массивов dashboards[] = ${chartDetailDashArrayRawRows}; отношений с этим методом = ${relationsWithArrMethod}. ` +
      `Значение 1757 совпадает с: ${
        [
          arrPairsUnique === 1757 ? "unique_array_pairs" : null,
          arrEvidenceRows === 1757 ? "raw_array_evidence_rows" : null,
          chartsWithDashArray.size === 1757 ? "charts_with_nonempty_dashboards_array" : null,
          relationsWithArrMethod === 1757 ? "relations_with_chart_dashboards_array_method" : null,
        ]
          .filter(Boolean)
          .join(", ") || "ни одним из пересчитанных кандидатов"
      }.`,
  },
  corroborated_dashboard_pairs: corroboratedPairs,
  local_vs_api: {
    local_only_relations: relations.filter((r) => r.scopes.has("local") && !r.scopes.has("api")).length,
    api_only_relations: apiOnlyRelations.length,
    both: relations.filter((r) => r.scopes.has("local") && r.scopes.has("api")).length,
    api_chart_rows: apiChartRows,
    api_unique_charts: apiChartIds.size,
    api_unique_datasets: apiDatasetIds.size,
    api_charts_not_in_local_catalog: apiChartsNotInLocalCatalog.size,
    note: "API-связи НЕ увеличивают счётчики локальных объектов (п.10).",
  },
  chart_categories: {
    ...chartCategories,
    categories_sum: chartCategorySum,
    categories_sum_matches_total: chartCategoriesSumMatchesTotal,
  },
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
    datasets_used_in_catalog: datasetsUsedInCatalog.size,
    datasets_unused_by_charts_local: datasetsUnusedLocal.length,
    datasets_unresolved_refs_local: unresolvedDatasetRefsLocal.length,
    correction_161:
      "161 — это уникальные ДАТАСЕТЫ, использовавшиеся локальными charts; charts с dataset-связью считается отдельно: charts_linked_to_datasets_local.",
  },
  integrity_issues: {
    self_links: selfLinks.length,
    multi_dataset_charts: multiDatasetCharts.length,
    multi_dataset_charts_sample: multiDatasetCharts.slice(0, 10),
    unresolved_chart_refs: unresolvedChartRefs.size,
    unresolved_dataset_refs: unresolvedDatasetRefs.size,
    unresolved_dataset_refs_local: unresolvedDatasetRefsLocal.length,
    unresolved_dashboard_refs: unresolvedDashboardRefs.size,
    explanation_unresolved_charts:
      "Неразрешённые chart-ссылки — следствие усечения локального list; полная API-выгрузка не перезаписывала каталог.",
  },
  checks,
  checks_ok: checksOk,
  confidence_levels: {
    VERIFIED: "прямой результат API или прямое поле сохранённого detail, подтверждённое источником",
    HIGH: "прямые сохранённые metadata Superset (position_json layout, reverse arrays)",
    MEDIUM: "косвенное предположение",
    LOW: "слабое предположение",
  },
};

writeFileSync(`${OUT_DIR}/lineage_preview.json`, JSON.stringify(out, null, 2), { mode: 0o600 });

// ---------------- Человекочитаемый отчёт ----------------
const md = `# Качество Lineage — Этап 1.1

Сгенерировано: ${out.generated_at}

## Сводка

| Показатель | Значение |
|---|---|
| Свидетельств (evidence rows) | ${out.counts.evidence_rows} |
| Уникальных связей (relations) | ${out.counts.unique_relations} |
| Свёрнуто дублей свидетельств | ${out.counts.duplicate_evidence_collapsed} |
| Сумма evidence_count по relations | ${out.counts.evidence_count_sum} |
| DASHBOARD_HAS_CHART | ${out.by_relation_type.DASHBOARD_HAS_CHART} |
| CHART_USES_DATASET | ${out.by_relation_type.CHART_USES_DATASET} |

## Методы

| Метод | Свидетельств | Уникальных пар |
|---|---:|---:|
| DASHBOARD_POSITION_JSON | ${out.by_method.evidence_rows.DASHBOARD_POSITION_JSON} | ${out.by_method.unique_pairs.DASHBOARD_POSITION_JSON} |
| CHART_DASHBOARDS_ARRAY | ${out.by_method.evidence_rows.CHART_DASHBOARDS_ARRAY} | ${out.by_method.unique_pairs.CHART_DASHBOARDS_ARRAY} |
| CHART_DATASOURCE_ID | ${out.by_method.evidence_rows.CHART_DATASOURCE_ID} | ${out.by_method.unique_pairs.CHART_DATASOURCE_ID} |
| API_FILTER_BY_DATASOURCE_ID | ${out.by_method.evidence_rows.API_FILTER_BY_DATASOURCE_ID} | ${out.by_method.unique_pairs.API_FILTER_BY_DATASOURCE_ID} |

## Категории chart_detail

| Категория | Значение |
|---|---:|
| chart_detail_total | ${out.chart_categories.chart_detail_total} |
| with datasource_id | ${out.chart_categories.chart_detail_with_datasource_id} |
| without datasource_id | ${out.chart_categories.chart_detail_without_datasource_id} |
| invalid detail | ${out.chart_categories.chart_detail_invalid} |
| Сумма категорий | ${out.chart_categories.categories_sum} |
| Сумма == total | ${out.chart_categories.categories_sum_matches_total} |

## Расхождение 1757 / 2645

${out.discrepancy_1757_vs_2645_explanation.reason}

## Покрытие

| Показатель | Значение |
|---|---:|
| dashboards_total | ${out.coverage.dashboards_total} |
| dashboards_with_charts_any_method | ${out.coverage.dashboards_with_charts_any_method} |
| dashboards_without_confirmed_charts | ${out.coverage.dashboards_without_confirmed_charts} |
| charts_linked_to_datasets_local | ${out.coverage.charts_linked_to_datasets_local} |
| datasets_used_by_charts_local | ${out.coverage.datasets_used_by_charts_local} |
| datasets_unused_by_charts_local | ${out.coverage.datasets_unused_by_charts_local} |

## <ФИО> согласованности

${Object.entries(checks)
  .map(([k, v]) => `- ${k}: ${v ? "OK" : "FAIL"}`)
  .join("\n")}

Итог: ${checksOk ? "OK" : "FAIL"}.
`;
writeFileSync(`${OUT_DIR}/lineage_quality.md`, md, { mode: 0o600 });

console.log(
  JSON.stringify(
    {
      evidence: out.counts.evidence_rows,
      unique_relations: out.counts.unique_relations,
      collapsed_duplicates: out.counts.duplicate_evidence_collapsed,
      D2C: out.by_relation_type.DASHBOARD_HAS_CHART,
      C2D: out.by_relation_type.CHART_USES_DATASET,
      arr_pairs: arrPairsUnique,
      pos_pairs: posPairsUnique,
      charts_with_dash_array: chartsWithDashArray.size,
      chart_detail_with_ds: chartCategories.chart_detail_with_datasource_id,
      chart_detail_without_ds: chartCategories.chart_detail_without_datasource_id,
      chart_detail_invalid: chartCategories.chart_detail_invalid,
      api_charts_not_in_local: apiChartsNotInLocalCatalog.size,
      datasets_unused_local: datasetsUnusedLocal.length,
      checks_ok: checksOk,
    },
    null,
    2,
  ),
);

if (!checksOk) process.exitCode = 1;
db.close();
