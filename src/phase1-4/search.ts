/**
 * Этап 1.4, фаза 1.4.3 — расширенный поиск релевантных datasets/charts/dashboards
 * с объяснимым scoring по 12 предметным областям.
 *
 * Read-only. Пишет:
 *  - reports/phase-01-4/03_dataset_candidates.csv/json
 *  - reports/phase-01-4/03_chart_candidates.csv
 *  - reports/phase-01-4/03_dashboard_candidates.csv
 *  - reports/phase-01-4/03_search_coverage.md
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  SNAPSHOT_ROOT,
  ensureDir,
  readJson,
  writeJsonAtomic,
  writeAtomic,
  csv,
  joinReport,
  nowIso,
} from "./utils";
import { priority } from "./lib";

const APPROVED_IDS = [4732, 5247, 5399, 5797, 7006, 7024, 7027, 7119, 7293, 7465, 7473, 7775];

type Doc = Record<string, any>;

const DOMAINS: Record<string, string[]> = {
  ORDERS: ["заказ", "order", "состав заказ", "статус", "покупк", "id_order", "order_status", "qty_order", "sum_order"],
  FULFILLMENT: ["сборк", "комплект", "готов", "выдач", "collect", "assembly", "printed", "sbor", "ready"],
  DELIVERY: ["достав", "delivered", "delivery", "возврат", "returned", "date_delivered", "delivery_time", "вручен"],
  COURIER: ["курьер", "courier", "исполнител", "сотрудник", "id_courier", "courier_id", "rider", "driver"],
  SHOP: ["торгов", "магазин", "даркстор", "darkstore", "shop", "id_tt", "shopno", "точк"],
  GEO: ["адрес", "координат", "район", "территор", "address", "latitude", "longitude", "geo", "cluster", "zone", "area"],
  ROUTE: ["маршрут", "поездк", "ходк", "групп заказ", "route", "parcel", "pickup", "distance", "duration", "seq"],
  QUEUE: ["прибыт", "ожидан", "очеред", "доступн", "arrival", "wait", "queue", "pool", "slots"],
  SHIFT: ["смен", "график", "shift", "schedule", "work_minutes", "5shifts", "five_shifts"],
  PAY: ["начислен", "тариф", "доход", "выплат", "ставк", "profit", "income", "payment", "sum_paid", "payout", "rate"],
  MENTOR: ["куратор", "наставник", "новичок", "стажировк", "mentor", "curator", "trainee", "onboarding"],
  EVENTS: ["событ", "истори", "изменен", "timestamp", "event", "log", "status", "changed_on", "флаг", "flag"],
};

function matchTerms(haystack: string, terms: string[]): string[] {
  const low = haystack.toLowerCase();
  const hit: string[] = [];
  for (const t of terms) if (low.includes(t.toLowerCase())) hit.push(t);
  return hit;
}

function domainMatches(texts: string[]): { domains: string[]; terms: string[] } {
  const hay = texts.filter(Boolean).join(" \n ");
  const domains: string[] = [];
  const terms: string[] = [];
  for (const [domain, list] of Object.entries(DOMAINS)) {
    const hits = matchTerms(hay, list);
    if (hits.length) {
      domains.push(domain);
      terms.push(...hits);
    }
  }
  return { domains, terms: [...new Set(terms)] };
}

type Chase = { score: number; matched: number; total: number };

function main() {
  ensureDir("reports/phase-01-4");
  const snapshotId = readJson<any>(join(SNAPSHOT_ROOT, "manifest.json"))?.snapshot_id ?? "local-output-baseline";

  const datasets: Doc[] = readJson<any>(join(SNAPSHOT_ROOT, "datasets.compact.json"))?.docs ?? [];
  const charts: Doc[] = readJson<any>(join(SNAPSHOT_ROOT, "charts.compact.json"))?.docs ?? [];
  const dashboards: Doc[] = readJson<any>(join(SNAPSHOT_ROOT, "dashboards.compact.json"))?.docs ?? [];
  const coverageLimits: string[] = [];
  if (!datasets.length) coverageLimits.push("snapshot datasets.compact.json пуст или отсутствует — поиск по datasets ограничен");
  if (!charts.length) coverageLimits.push("snapshot charts.compact.json пуст или отсутствует — поиск по charts ограничен");
  if (!dashboards.length) coverageLimits.push("snapshot dashboards.compact.json пуст или отсутствует — поиск по dashboards ограничен");

  // detail для 12 утверждённых
  const details = new Map<number, any>();
  const ddDir = "output/dataset_details";
  if (existsSync(ddDir)) {
    for (const f of readdirSync(ddDir).filter((x) => x.endsWith(".json"))) {
      const j = readJson<any>(join(ddDir, f));
      if (j?.result?.id != null) details.set(Number(j.result.id), j.result);
    }
  }
  if (details.size < 12) coverageLimits.push(`detail JSON доступны только для ${details.size}/12 утверждённых датасетов`);

  // chart → dataset / dashboard
  const chartsByDataset = new Map<string, Doc[]>();
  const dashboardsByDataset = new Map<string, Set<string>>();
  const dashboardsById = new Map<string, Doc>();
  for (const d of dashboards) dashboardsById.set(String(d.id), d);
  for (const c of charts) {
    const ds = c.datasource_id ? String(c.datasource_id) : null;
    if (!ds) continue;
    if (!chartsByDataset.has(ds)) chartsByDataset.set(ds, []);
    chartsByDataset.get(ds)!.push(c);
    if (!dashboardsByDataset.has(ds)) dashboardsByDataset.set(ds, new Set());
    for (const did of c.dashboards ?? []) dashboardsByDataset.get(ds)!.add(String(did));
  }

  // ---- datasets ----
  const datasetRows: any[] = [];
  const datasetCsv: unknown[][] = [[
    "dataset_id", "name", "database", "schema", "kind", "description_present", "sql_available", "fields_available", "metrics_available",
    "matched_domains", "matched_terms", "score_name_desc", "score_sql", "score_fields", "score_metrics", "score_charts", "score_dashboards",
    "total_score", "priority", "linked_charts", "linked_dashboards", "inclusion_reason", "verification_status", "snapshot_id",
  ]];

  for (const d of datasets) {
    const id = String(d.id);
    const detail = details.get(Number(id));
    const columns: string[] = detail ? (detail.columns ?? []).map((c: any) => String(c.column_name ?? "")) : [];
    const colDescriptions: string[] = detail ? (detail.columns ?? []).map((c: any) => String(c.description ?? c.verbose_name ?? "")) : [];
    const metrics: string[] = detail ? (detail.metrics ?? []).map((m: any) => String(m.metric_name ?? "")) : [];

    const nameTexts = [d.name, d.description];
    const sqlTexts = [d.sql, d.table_name, d.schema, d.database];
    const fieldTexts = [...columns, ...colDescriptions];
    const metricTexts = metrics;

    const nameMatch = domainMatches(nameTexts);
    const sqlMatch = domainMatches(sqlTexts);
    const fieldMatch = domainMatches(fieldTexts);
    const metricMatch = domainMatches(metricTexts);

    const linked = chartsByDataset.get(id) ?? [];
    const linkedChartMatches = linked.filter((c) => domainMatches([c.name, (c.metrics ?? []).join(" "), (c.groupby ?? []).join(" ")]).terms.length > 0);
    const linkedDashIds = [...(dashboardsByDataset.get(id) ?? new Set<string>())];
    const linkedDashMatches = linkedDashIds.filter((did) => domainMatches([dashboardsById.get(did)?.name]).terms.length > 0);

    const scoreNameDesc = Math.min(20, (nameMatch.terms.length ? 12 : 0) + (nameMatch.terms.length >= 2 ? 8 : nameMatch.terms.length ? 4 : 0));
    const scoreSql = Math.min(30, (sqlMatch.terms.length ? 10 : 0) + Math.min(20, sqlMatch.terms.length * 5));
    const scoreFields = Math.min(20, fieldMatch.terms.length * 4);
    const scoreMetrics = Math.min(10, metricMatch.terms.length * 3);
    const scoreCharts = Math.min(10, Math.min(6, linkedChartMatches.length * 2) + (linked.length ? 2 : 0));
    const scoreDashboards = Math.min(10, Math.min(8, linkedDashMatches.length * 2) + (linkedDashIds.length ? 2 : 0));
    const total = scoreNameDesc + scoreSql + scoreFields + scoreMetrics + scoreCharts + scoreDashboards;

    const approved = APPROVED_IDS.includes(Number(id));
    const domains = [...new Set([...nameMatch.domains, ...sqlMatch.domains, ...fieldMatch.domains, ...metricMatch.domains])];
    const terms = [...new Set([...nameMatch.terms, ...sqlMatch.terms, ...fieldMatch.terms, ...metricMatch.terms])];
    const fieldsAvailable = Boolean(detail);
    const row = {
      dataset_id: Number(id),
      name: d.name,
      database: d.database ?? null,
      schema: d.schema ?? null,
      kind: d.kind ?? null,
      description_present: Boolean(d.description),
      sql_available: Boolean(d.sql && String(d.sql).length > 0),
      fields_available: fieldsAvailable,
      metrics_available: fieldsAvailable,
      matched_domains: domains,
      matched_terms: terms,
      score_name_desc: scoreNameDesc,
      score_sql: scoreSql,
      score_fields: scoreFields,
      score_metrics: scoreMetrics,
      score_charts: scoreCharts,
      score_dashboards: scoreDashboards,
      total_score: approved ? Math.max(total, 70) : total,
      raw_score: total,
      priority: approved ? "P0" : priority(total),
      linked_charts: linked.length,
      linked_dashboards: linkedDashIds.length,
      inclusion_reason: approved
        ? "approved Phase 1.2 dataset (включён обязательно)"
        : terms.length
          ? `совпали термины: ${terms.slice(0, 8).join(", ")}`
          : "нет совпадений терминов",
      verification_status: approved ? (fieldsAvailable ? "APPROVED_BASELINE" : "APPROVED_DETAIL_MISSING") : terms.length ? "CANDIDATE" : "NO_TERMS",
      snapshot_id: snapshotId,
    };
    datasetRows.push(row);
    datasetCsv.push([
      row.dataset_id, row.name, row.database, row.schema, row.kind, row.description_present, row.sql_available, row.fields_available, row.metrics_available,
      row.matched_domains.join(";"), row.matched_terms.join(";"), row.score_name_desc, row.score_sql, row.score_fields, row.score_metrics, row.score_charts, row.score_dashboards,
      row.total_score, row.priority, row.linked_charts, row.linked_dashboards, row.inclusion_reason, row.verification_status, row.snapshot_id,
    ]);
  }

  datasetRows.sort((a, b) => b.total_score - a.total_score || a.dataset_id - b.dataset_id);
  writeJsonAtomic(joinReport("03_dataset_candidates.json"), { generated_at: nowIso(), snapshot_id: snapshotId, domains: Object.keys(DOMAINS), datasets: datasetRows });
  writeAtomic(joinReport("03_dataset_candidates.csv"), csv(datasetCsv));

  // ---- charts ----
  const chartRows: any[] = [];
  const chartCsv: unknown[][] = [["chart_id", "name", "viz_type", "dataset_id", "matched_domains", "matched_terms", "score", "priority", "dashboards", "params_parse_status"]];
  for (const c of charts) {
    const m = domainMatches([c.name, c.description, (c.metrics ?? []).join(" "), (c.groupby ?? []).join(" "), (c.filter_columns ?? []).join(" "), c.time_range, c.granularity]);
    const score = Math.min(20, (m.terms.length ? 12 : 0) + Math.min(8, m.terms.length * 2));
    const pr = priority(score);
    const row = {
      chart_id: Number(c.id),
      name: c.name,
      viz_type: c.viz_type,
      dataset_id: c.datasource_id ?? null,
      matched_domains: m.domains,
      matched_terms: m.terms,
      score,
      priority: pr,
      dashboards: c.dashboards ?? [],
      params_parse_status: c.params_parse_status ?? null,
    };
    if (pr !== "OUT_OF_SCOPE") chartRows.push(row);
    chartCsv.push([row.chart_id, row.name, row.viz_type, row.dataset_id, row.matched_domains.join(";"), row.matched_terms.join(";"), row.score, row.priority, row.dashboards.join(";"), row.params_parse_status]);
  }
  chartRows.sort((a, b) => b.score - a.score || a.chart_id - b.chart_id);
  writeAtomic(joinReport("03_chart_candidates.csv"), csv(chartCsv));
  writeJsonAtomic(joinReport("03_chart_candidates.json"), { generated_at: nowIso(), snapshot_id: snapshotId, total_charts: charts.length, candidates: chartRows });

  // ---- dashboards ----
  const dashRows: any[] = [];
  const dashCsv: unknown[][] = [["dashboard_id", "name", "matched_domains", "matched_terms", "score", "priority", "chart_count", "dataset_count"]];
  const chartsByDashboard = new Map<string, Doc[]>();
  for (const c of charts) for (const did of c.dashboards ?? []) {
    if (!chartsByDashboard.has(String(did))) chartsByDashboard.set(String(did), []);
    chartsByDashboard.get(String(did))!.push(c);
  }
  for (const d of dashboards) {
    const m = domainMatches([d.name, d.description]);
    const chs = chartsByDashboard.get(String(d.id)) ?? [];
    const datasetsLinked = new Set(chs.map((c) => c.datasource_id).filter(Boolean).map(String));
    const score = Math.min(20, (m.terms.length ? 12 : 0) + Math.min(8, m.terms.length * 2));
    const pr = priority(score);
    const row = {
      dashboard_id: Number(d.id),
      name: d.name,
      matched_domains: m.domains,
      matched_terms: m.terms,
      score,
      priority: pr,
      chart_count: chs.length,
      dataset_count: datasetsLinked.size,
    };
    if (pr !== "OUT_OF_SCOPE") dashRows.push(row);
    dashCsv.push([row.dashboard_id, row.name, row.matched_domains.join(";"), row.matched_terms.join(";"), row.score, row.priority, row.chart_count, row.dataset_count]);
  }
  dashRows.sort((a, b) => b.score - a.score || a.dashboard_id - b.dashboard_id);
  writeAtomic(joinReport("03_dashboard_candidates.csv"), csv(dashCsv));
  writeJsonAtomic(joinReport("03_dashboard_candidates.json"), { generated_at: nowIso(), snapshot_id: snapshotId, total_dashboards: dashboards.length, candidates: dashRows });

  // ---- coverage ----
  const byDomain: Record<string, number> = {};
  const byPriority: Record<string, number> = { P0: 0, P1: 0, P2: 0, OUT_OF_SCOPE: 0 };
  for (const r of datasetRows) {
    for (const d of r.matched_domains) byDomain[d] = (byDomain[d] ?? 0) + 1;
    byPriority[r.priority] = (byPriority[r.priority] ?? 0) + 1;
  }
  const md: string[] = [];
  md.push("# Фаза 1.4.3 — Расширенный поиск: покрытие");
  md.push("");
  md.push(`Сгенерировано: ${nowIso()}`);
  md.push(`Snapshot: \`${snapshotId}\``);
  md.push("");
  md.push(`- datasets в snapshot: ${datasets.length}`);
  md.push(`- charts в snapshot: ${charts.length}`);
  md.push(`- dashboards в snapshot: ${dashboards.length}`);
  md.push(`- datasets с совпавшими терминами: ${datasetRows.filter((r) => r.matched_terms.length).length}`);
  md.push(`- charts-кандидатов (P0/P1/P2): ${chartRows.length}`);
  md.push(`- dashboards-кандидатов (P0/P1/P2): ${dashRows.length}`);
  md.push("");
  md.push("## Datasets по приоритету");
  md.push("");
  md.push("| Приоритет | Кол-во |");
  md.push("|---|---:|");
  for (const p of ["P0", "P1", "P2", "OUT_OF_SCOPE"]) md.push(`| ${p} | ${byPriority[p] ?? 0} |`);
  md.push("");
  md.push("## Совпадения по предметным областям (datasets)");
  md.push("");
  md.push("| Область | Кол-во datasets |");
  md.push("|---|---:|");
  for (const d of Object.keys(DOMAINS)) md.push(`| ${d} | ${byDomain[d] ?? 0} |`);
  md.push("");
  md.push("## Утверждённые 12 датасетов");
  md.push("");
  md.push("| ID | name | priority | verification |");
  md.push("|---:|---|---|---|");
  for (const id of APPROVED_IDS) {
    const r = datasetRows.find((x) => x.dataset_id === id);
    md.push(`| ${id} | ${r?.name ?? "—"} | ${r?.priority ?? "—"} | ${r?.verification_status ?? "MISSING"} |`);
  }
  md.push("");
  md.push("## Ограничения покрытия");
  md.push("");
  if (coverageLimits.length === 0) md.push("- существенных ограничений не выявлено");
  else for (const l of coverageLimits) md.push(`- ${l}`);
  md.push("");
  md.push("Термины — поисковые подсказки, не доказательство существования сущности. Scoring сортирует очередь исследования.");
  md.push("");
  writeAtomic(joinReport("03_search_coverage.md"), md.join("\n"));

  console.log(JSON.stringify({
    snapshot_id: snapshotId,
    datasets: datasets.length,
    charts: charts.length,
    dashboards: dashboards.length,
    dataset_candidates_with_terms: datasetRows.filter((r) => r.matched_terms.length).length,
    by_priority: byPriority,
    chart_candidates: chartRows.length,
    dashboard_candidates: dashRows.length,
    coverage_limits: coverageLimits,
    reports: ["03_dataset_candidates.csv/json", "03_chart_candidates.csv", "03_dashboard_candidates.csv", "03_search_coverage.md"],
  }, null, 2));
}

main();
