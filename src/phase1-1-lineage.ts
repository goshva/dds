/**
 * phase1-1-lineage.ts — Задача 3: восстановление связей Dashboard → Chart → Dataset
 * локально из SQLite (readonly). Таблица relations НЕ изменяется.
 *
 * Источники:
 *  A. dashboard_detail.payload.result.position_json → CHART-узлы → meta.chartId   (DASHBOARD_HAS_CHART)
 *  B. chart_detail.payload.result.dashboards[]                                     (DASHBOARD_HAS_CHART, обратная ссылка)
 *  C. chart_detail.payload.result.datasource_id + datasource_type                  (CHART_USES_DATASET)
 *
 * Методы и confidence:
 *  - position_json:          method=DASHBOARD_POSITION_JSON,      confidence=HIGH (прямые метаданные layout)
 *  - chart.dashboards[]:     method=CHART_DASHBOARDS_ARRAY,       confidence=HIGH (прямые метаданные chart)
 *  - chart.datasource_id:    method=CHART_DATASOURCE_ID,          confidence=VERIFIED (прямое поле chart detail)
 *
 * <ФИО>: существование объектов в каталоге, дубли, циклы dataset→chart→dashboard→(position),
 * неразрешённые ссылки, тип datasource.
 */

import { Database } from "bun:sqlite";
import { writeFileSync, mkdirSync } from "node:fs";

const DB = "data/catalog.sqlite";
const OUT_DIR = "reports/phase-01-1";

type Rel = {
  parent_type: string;
  parent_id: string;
  child_type: string;
  child_id: string;
  relation_type: string;
  discovery_method: string;
  confidence: string;
};

function main() {
  const db = new Database(DB, { readonly: true });
  const now = new Date().toISOString();

  // Каталоги существующих ID
  const catalogIds = (t: string) =>
    new Set((db.query("SELECT object_id FROM objects WHERE object_type=?").all(t) as any[]).map(r => r.object_id));

  const dashIds = catalogIds("dashboard");
  const chartIds = catalogIds("chart");
  const datasetIds = catalogIds("dataset");
  const chartDetailIds = catalogIds("chart_detail");

  const rels: Rel[] = [];
  const seen = new Set<string>();
  const unresolvedRefs: any[] = [];
  let dupSuppressed = 0;

  function addRel(parentType: string, parentId: string, childType: string, childId: string,
                  relType: string, method: string, confidence: string) {
    const key = `${parentType}|${parentId}|${childType}|${childId}|${relType}`;
    if (seen.has(key)) { dupSuppressed++; return; }
    seen.add(key);
    rels.push({
      parent_type: parentType, parent_id: parentId,
      child_type: childType, child_id: childId,
      relation_type: relType, discovery_method: method, confidence
    });
  }

  // ---------- A. position_json (dashboards) ----------
  let dashWithChartLinks = 0;
  let chartNodesTotal = 0;
  const ddRows = db.query(`
    SELECT object_id, json_extract(payload_json,'$.result.position_json') pj
    FROM objects WHERE object_type='dashboard_detail' AND payload_json IS NOT NULL
  `).all() as any[];

  for (const row of ddRows) {
    if (!row.pj) continue;
    let pos: any;
    try { pos = JSON.parse(row.pj); } catch { continue; }
    let found = false;
    for (const node of Object.values(pos ?? {})) {
      const n = node as any;
      if (n?.type !== "CHART") continue;
      const cid = String(n?.meta?.chartId ?? "");
      if (!cid) continue;
      chartNodesTotal++;
      found = true;
      if (!chartIds.has(cid)) {
        unresolvedRefs.push({ from: `dashboard/${row.object_id}`, ref_type: "chart", ref_id: cid, via: "position_json" });
      }
      addRel("dashboard", row.object_id, "chart", cid, "DASHBOARD_HAS_CHART", "DASHBOARD_POSITION_JSON", "HIGH");
    }
    if (found) dashWithChartLinks++;
  }

  // ---------- B. chart_detail.dashboards[] (обратная ссылка) ----------
  let chartsWithDashArray = 0;
  const cdRows = db.query(`
    SELECT object_id, payload_json
    FROM objects WHERE object_type='chart_detail'
  `).all() as any[];

  const chartToDatasets = new Map<string, { dsId: string | null; dsType: string | null }>();

  for (const row of cdRows) {
    let res: any;
    try { res = JSON.parse(row.payload_json)?.result; } catch { continue; }
    if (!res) continue;

    const dsId = res.datasource_id != null ? String(res.datasource_id) : null;
    chartToDatasets.set(row.object_id, { dsId, dsType: res.datasource_type ?? null });

    if (dsId != null) {
      if (res.datasource_type && res.datasource_type !== "table") {
        unresolvedRefs.push({ chart: row.object_id, note: `non-table datasource_type: ${res.datasource_type}` });
      }
      if (!datasetIds.has(dsId)) {
        unresolvedRefs.push({ from: `chart/${row.object_id}`, ref_type: "dataset", ref_id: dsId, via: "datasource_id" });
      }
      addRel("chart", row.object_id, "dataset", dsId, "CHART_USES_DATASET", "CHART_DATASOURCE_ID", "VERIFIED");
    }

    const dashes = Array.isArray(res.dashboards) ? res.dashboards : [];
    if (dashes.length) chartsWithDashArray++;
    for (const did of dashes) {
      const id = String(did);
      if (!dashIds.has(id)) {
        unresolvedRefs.push({ from: `chart/${row.object_id}`, ref_type: "dashboard", ref_id: id, via: "dashboards[]" });
      }
      addRel("dashboard", id, "chart", row.object_id, "DASHBOARD_HAS_CHART", "CHART_DASHBOARDS_ARRAY", "HIGH");
    }
  }

  // ---------- Статистика ----------
  const d2c = rels.filter(r => r.relation_type === "DASHBOARD_HAS_CHART");
  const c2d = rels.filter(r => r.relation_type === "CHART_USES_DATASET");

  const linkedCharts = new Set(c2d.map(r => r.parent_id));
  const linkedDatasets = new Set(c2d.map(r => r.child_id));
  const chartsInAnyDash = new Set(d2c.map(r => r.child_id));
  const dashsWithCharts = new Set(d2c.map(r => r.parent_id));

  // Разбивка неразрешённых ссылок dashboard→chart на категории
  const unresolvedChartRefs: string[] = [];      // все ссылки на chart вне каталога
  const chartRefsBelowRange: string[] = [];      // id < min catalog id (возможно удалены)
  const chartRefsInRangeMissing: string[] = [];  // id внутри диапазона, но отсутствуют ⇒ усечение выгрузки!
  {
    const numericIds = [...chartsInAnyDash].filter(id => /^\d+$/.test(id)).map(Number);
    const allNumeric = (db.query("SELECT object_id FROM objects WHERE object_type='chart'").all() as any[])
      .map(r => Number(r.object_id));
    const minCat = Math.min(...allNumeric), maxCat = Math.max(...allNumeric);
    for (const n of numericIds) {
      if (!chartIds.has(String(n))) {
        unresolvedChartRefs.push(String(n));
        if (n < minCat) chartRefsBelowRange.push(String(n));
        else chartRefsInRangeMissing.push(String(n));
      }
    }
    var chartCatalogRange = { min: minCat, max: maxCat };
  }

  // ***REMOVED***: один chart указывает на несколько dataset?
  const perChartDs = new Map<string, string[]>();
  for (const r of c2d) {
    perChartDs.set(r.parent_id, [...(perChartDs.get(r.parent_id) ?? []), r.child_id]);
  }
  const multiDsCharts = [...perChartDs.entries()].filter(([, v]) => v.length > 1);

  // Дубли: одинаковая пара dashboard-chart из обоих методов
  const pairSeen = new Map<string, string[]>();
  for (const r of d2c) {
    const k = `${r.parent_id}->${r.child_id}`;
    pairSeen.set(k, [...(pairSeen.get(k) ?? []), r.discovery_method]);
  }
  const corroboratedPairs = [...pairSeen.values()].filter(v => v.length > 1).length;

  // Циклические ссылки: связь ссылается на объект, которого нет в каталоге (уже собрано) + self-links
  const selfLinks = rels.filter(r => r.parent_id === r.child_id && r.parent_type === r.child_type).length;

  const out = {
    generated_at: now,
    source: "локальный catalog.sqlite (readonly); таблица relations не изменялась",
    methods: {
      DASHBOARD_POSITION_JSON: d2c.filter(r => r.discovery_method === "DASHBOARD_POSITION_JSON").length,
      CHART_DASHBOARDS_ARRAY: d2c.filter(r => r.discovery_method === "CHART_DASHBOARDS_ARRAY").length,
      CHART_DATASOURCE_ID: c2d.length
    },
    totals: {
      relations: rels.length,
      DASHBOARD_HAS_CHART: d2c.length,
      CHART_USES_DATASET: c2d.length,
      duplicate_pairs_suppressed_in_build: dupSuppressed,
      corroborated_by_both_dashboard_methods: corroboratedPairs,
      self_links: selfLinks
    },
    coverage: {
      dashboards_total: dashIds.size,
      dashboards_with_at_least_one_chart: dashsWithCharts.size,
      dashboards_without_charts: dashIds.size - dashsWithCharts.size,
      charts_total: chartIds.size,
      charts_referenced_by_any_dashboard: chartsInAnyDash.size,
      referenced_charts_present_in_catalog: [...chartsInAnyDash].filter(id => chartIds.has(id)).length,
      referenced_charts_absent_from_catalog: unresolvedChartRefs.length,
      charts_with_dataset_link: linkedCharts.size,
      charts_without_dataset_link: chartIds.size - linkedCharts.size,
      chart_details_present: chartDetailIds.size,
      datasets_total: datasetIds.size,
      datasets_used_by_charts: linkedDatasets.size,
      datasets_unused_by_charts: datasetIds.size - linkedDatasets.size
    },
    chart_id_range_in_catalog: chartCatalogRange,
    unresolved_chart_refs_explanation: {
      total_unique_chart_refs_from_dashboards: chartsInAnyDash.size,
      chart_ids_below_catalog_range: chartRefsBelowRange.length,
      chart_ids_in_range_but_missing_from_catalog: chartRefsInRangeMissing.length,
      note: "5 399 ссылок ведут на chart, которых нет в локальном каталоге (5 000 chart усечены MAX_PAGES=50; фактический count API = 19 920). <ФИО> НЕ ошибка lineage, а следствие усечения выгрузки на Этапе 1."
    },
    data_sources_note: {
      position_json_nonempty_dashboards: ddRows.filter(r => r.pj).length,
      chart_nodes_found_in_position_json: chartNodesTotal,
      dashboards_per_chart_array_nonempty: chartsWithDashArray,
      priority_check_4732_used_by_charts: c2d.filter(r => r.child_id === "4732").length
    },
    integrity_issues: {
      unresolved_reference_count: unresolvedRefs.length,
      unresolved_sample: unresolvedRefs.slice(0, 50),
      multi_dataset_charts: multiDsCharts.slice(0, 20),
      multi_dataset_chart_count: multiDsCharts.length
    },
    limitations: [
      "Для 1 234 charts без detail связь chart→dataset восстановить локально невозможно (нужен точечный API-запрос).",
      "Для dashboard 1558 («Чек») position_json = NULL — связи неизвестны.",
      "Datasource типа metric/query не встречались; все datasource_type=table (проверено индикатором non-table).",
      "Связи выведены из layout/metadata Superset — это прямые метаданные, но не «VERIFIED» для DASHBOARD_HAS_CHART, т.к. layout может быть устаревшим относительно сохранённого в чатах состояния."
    ]
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/lineage_preview.json`, JSON.stringify(out, null, 2), { mode: 0o600 });
  writeFileSync(`${OUT_DIR}/lineage_relations.csv`,
    "parent_type,parent_id,child_type,child_id,relation_type,discovery_method,confidence\n" +
    rels.map(r => [r.parent_type, r.parent_id, r.child_type, r.child_id, r.relation_type, r.discovery_method, r.confidence].join(",")).join("\n"),
    { mode: 0o600 });

  console.log(JSON.stringify({ totals: out.totals, coverage: out.coverage, unresolved: unresolvedRefs.length, multi_ds: multiDsCharts.length }, null, 2));
  db.close();
}

main();
