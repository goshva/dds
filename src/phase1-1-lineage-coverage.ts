/**
 * Этап 1.1, задача 3 — диагностика полноты методов lineage (только чтение SQLite).
 * Отвечает на вопрос: почему в lineage_preview.json методы разошлись с фактическими данными.
 */
import { Database } from "bun:sqlite";

const db = new Database("data/catalog.sqlite", { readonly: true });

// --- Метод A: DASHBOARD_HAS_CHART из position_json (лежит в dashboard_detail.payload.result.position_json — строка JSON)
const dashRows = (db.query(`SELECT object_id, payload_json FROM objects WHERE object_type='dashboard_detail'`).all() as any[]);
const posPairs = new Set<string>();
let dashWithNodes = 0, posRefs = 0, posParseFail = 0, posNull = 0;
for (const r of dashRows) {
  const id = r.object_id;
  let pj: string | null = null;
  try { pj = JSON.parse(r.payload_json)?.result?.position_json ?? null; } catch { posParseFail++; continue; }
  if (!pj) { posNull++; continue; }
  try {
    const pos = typeof pj === "string" ? JSON.parse(pj) : pj;
    let n = 0;
    for (const v of Object.values(pos || {})) {
      const cid = (v as any)?.meta?.chartId;
      if (cid != null) { n++; posRefs++; posPairs.add(`${id}|${cid}`); }
    }
    if (n > 0) dashWithNodes++;
  } catch { posParseFail++; }
}

// --- Метод B: DASHBOARD_HAS_CHART из chart_detail.result.dashboards[]
const cdRows = db.query(`SELECT object_id, payload_json FROM objects WHERE object_type='chart_detail'`).all() as any[];
const arrPairs = new Set<string>();
let chartsWithDs = 0, chartsNoDs = 0;
const dsChartCount = new Map<number, number>();
for (const r of cdRows) {
  let res: any = {};
  try { res = JSON.parse(r.payload_json)?.result ?? {}; } catch {}
  const dsId = res.datasource_id;
  if (dsId != null) {
    chartsWithDs++;
    dsChartCount.set(Number(dsId), (dsChartCount.get(Number(dsId)) ?? 0) + 1);
  } else chartsNoDs++;
  for (const d of res.dashboards ?? []) arrPairs.add(`${d.id}|${r.object_id}`);
}

// --- Пересечение методов A и B
let inter = 0;
for (const k of arrPairs) if (posPairs.has(k)) inter++;

// --- Проверка против CSV (lineage_relations.csv уже построен скриптом phase1-1-lineage.ts)
import { readFileSync } from "fs";
const csv = readFileSync("reports/phase-01-1/lineage_relations.csv", "utf8").trim().split(/\r?\n/);
const csvCounts: Record<string, number> = {};
const csvMethodPairs: Record<string, Set<string>> = {};
for (let i = 1; i < csv.length; i++) {
  const c = csv[i].split(",");
  const key = `${c[4]}|${c[5]}`;
  csvCounts[key] = (csvCounts[key] ?? 0) + 1;
  (csvMethodPairs[key] ??= new Set()).add(`${c[1]}|${c[3]}`);
}

console.log(JSON.stringify({
  method_A_position_json: {
    dashboards_total: dashRows.length, position_json_null_or_empty: posNull, parse_failures: posParseFail,
    dashboards_with_chart_nodes: dashWithNodes, raw_refs: posRefs, unique_pairs: posPairs.size,
  },
  method_B_chart_dashboards_array: {
    chart_details_total: cdRows.length, pairs_unique: arrPairs.size,
    charts_with_datasource_id: chartsWithDs, charts_without_datasource_id: chartsNoDs,
  },
  methods_intersection: { both: inter, only_position: posPairs.size - inter, only_array: arrPairs.size - inter },
  csv_now: Object.fromEntries(Object.entries(csvCounts).map(([k, v]) => [k, { rows: v, unique_pairs: csvMethodPairs[k]?.size ?? 0 }])),
  local_dataset_usage_top12: [...dsChartCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
}, null, 2));
