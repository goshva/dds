/**
 * Этап 1.6.2, Этапы B/D/E/F/G — инвентаризация, аналитические проверки и аналитический пакет.
 * Читает локальный снимок (data/snapshots/phase-01-6-2), пишет reports/phase-01-6-2 и analysis_package.
 * Никаких запросов к Superset не делает.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  REPORTS, SNAP, ensureDir, nowIso, readJson, redactDeep, redactPii, writeCsv, writeJson, truncate,
} from "./utils";

/** Запись отчёта с обязательным редактированием ПДн. */
function writeJsonSafe(path: string, payload: unknown): void {
  writeJson(path, redactDeep(payload));
}
function writeCsvSafe(path: string, header: string[], rows: unknown[][]): void {
  writeCsv(path, header, rows.map((r) => r.map((c) => redactDeep(c))));
}

const PACKAGE = "analysis_package";
const DOCS = "docs/phase-01-6-2";

type Row = Record<string, any>;

const KEY_COLUMNS = [
  "id_order", "order_id", "id_courier", "courier_id", "id_shift", "shift_id",
  "id_pool", "pool_id", "id_tt", "shopno", "id_general", "id_shop", "id_darkstore",
  "id_zone", "id_route", "id_cell", "id_slot",
];

const STATUS_COLUMN_RE = /(status|state|stage|type|reason|category|kind|result|flag|is_|has_|cancel|return|deliver|ready|collect|print|pickup|assign)/i;
const TEMPORAL_NAME_RE = /(date|time|_dt|_at|dttm|timestamp|created|updated|start|finish|end|deadline|arrival|ready|delivered|collected)/i;

function domainOf(candidate: Row | undefined): string {
  const d = candidate?.matched_domains?.[0];
  return d ? String(d).toLowerCase() : "other";
}

function loadCandidates(): Map<number, Row> {
  const raw = readJson<any>(join("reports", "phase-01-4", "03_dataset_candidates.json"));
  const arr: Row[] = Array.isArray(raw) ? raw : raw?.datasets ?? [];
  const m = new Map<number, Row>();
  for (const c of arr) m.set(Number(c.dataset_id ?? c.id), c);
  return m;
}

function semanticRole(col: Row): string {
  const n = String(col.name ?? "").toLowerCase();
  const t = String(col.type ?? "").toUpperCase();
  if (/(^|_)id(_|$)/.test(n) || n.endsWith("_id") || n === "id") return "identifier";
  if (col.is_dttm || /DATE|TIME|TIMESTAMP/.test(t)) return "timestamp";
  if (/(status|state|stage|result|reason|type|kind|category)/.test(n)) return "status_or_category";
  if (/(amount|sum|price|cost|revenue|profit|pay|paid|fee|tariff)/.test(n)) return "money";
  if (/(qty|quantity|cnt|count|number|num)/.test(n)) return "quantity";
  if (/(lat|lon|geo|coord|address|zone|area|region)/.test(n)) return "geo";
  if (/(is_|has_|flag|bool)/.test(n)) return "flag";
  if (/(name|title|fio|description|comment)/.test(n)) return "name_or_text";
  return "other";
}

function metricAggregation(expression: string): string {
  const m = String(expression ?? "").match(/\b(SUM|COUNT|AVG|MIN|MAX|COUNT_DISTINCT|APPROX_COUNT_DISTINCT)\s*\(/i);
  return m ? m[1].toUpperCase() : "UNKNOWN";
}

function metricSourceFields(expression: string): string[] {
  const out = new Set<string>();
  for (const m of String(expression ?? "").matchAll(/\b([a-z_][a-z0-9_]*)\b/gi)) {
    const w = m[1].toLowerCase();
    if (["sum", "count", "avg", "min", "max", "case", "when", "then", "else", "end", "null", "distinct", "as", "and", "or", "if", "cast", "date", "to", "from"].includes(w)) continue;
    if (w.length > 2) out.add(w);
  }
  return [...out].slice(0, 12);
}

function main() {
  ensureDir(REPORTS);
  ensureDir(PACKAGE);
  ensureDir(DOCS);

  const datasetsList: Row[] = readJson(join(SNAP, "datasets.list.json")) ?? [];
  const datasetsDetail: Row[] = readJson(join(SNAP, "datasets.detail.json")) ?? [];
  const charts: Row[] = readJson(join(SNAP, "charts.list.json")) ?? [];
  const dashboardsList: Row[] = readJson(join(SNAP, "dashboards.list.json")) ?? [];
  const dashboardsDetail: Row[] = readJson(join(SNAP, "dashboards.detail.json")) ?? [];
  const columnValues: Row[] = readJson(join(REPORTS, "column_values.json"))?.columns ?? [];
  const candidates = loadCandidates();

  const detailById = new Map<number, Row>();
  for (const d of datasetsDetail) detailById.set(Number(d.id), d);
  const datasetNameById = new Map<number, string>();
  for (const d of datasetsList) datasetNameById.set(Number(d.id), d.name ?? null);

  const chartsByDataset = new Map<number, Row[]>();
  for (const c of charts) {
    const ds = Number(c.datasource_id);
    if (!Number.isFinite(ds)) continue;
    if (!chartsByDataset.has(ds)) chartsByDataset.set(ds, []);
    chartsByDataset.get(ds)!.push(c);
  }

  const dashboardsByChart = new Map<number, Set<number>>();
  for (const c of charts) {
    for (const did of c.dashboards ?? []) {
      if (!dashboardsByChart.has(Number(c.id))) dashboardsByChart.set(Number(c.id), new Set());
      dashboardsByChart.get(Number(c.id))!.add(Number(did));
    }
  }

  // ---------- datasets inventory ----------
  const datasetsInventory: Row[] = datasetsList.map((d) => {
    const id = Number(d.id);
    const cand = candidates.get(id);
    const det = detailById.get(id);
    const cols = det?.columns ?? [];
    const metrics = det?.metrics ?? [];
    const dsCharts = chartsByDataset.get(id) ?? [];
    const dashboards = new Set<number>();
    for (const c of dsCharts) for (const did of c.dashboards ?? []) dashboards.add(Number(did));
    return {
      dataset_id: id,
      name: d.name ?? null,
      schema: d.schema ?? null,
      database_name: d.database_name ?? null,
      kind: d.kind ?? null,
      description: truncate(det?.description ?? d.description ?? "", 300),
      sql_definition_present: Boolean(d.sql && String(d.sql).trim().length > 0),
      sql_definition_sha256: d.sql_hash ?? null,
      columns_count: cols.length,
      metrics_count: metrics.length,
      calculated_columns_count: cols.filter((c: Row) => Boolean(c.expression)).length,
      temporal_columns_count: cols.filter((c: Row) => c.is_dttm || /DATE|TIME|TIMESTAMP/.test(String(c.type ?? "").toUpperCase())).length,
      datasource_type: d.kind ?? null,
      priority: cand?.priority ?? "UNKNOWN",
      domains: cand?.matched_domains ?? [],
      primary_domain: domainOf(cand),
      related_charts_count: dsCharts.length,
      related_dashboards_count: dashboards.size,
      access: "METADATA_ONLY",
      detail_loaded: Boolean(det),
    };
  });

  writeJsonSafe(join(REPORTS, "datasets_inventory.json"), {
    generated_at: nowIso(),
    total: datasetsInventory.length,
    by_priority: countBy(datasetsInventory, "priority"),
    datasets: datasetsInventory,
  });
  writeCsvSafe(join(REPORTS, "datasets_inventory.csv"),
    ["dataset_id", "name", "schema", "database_name", "kind", "priority", "primary_domain", "columns_count", "metrics_count", "temporal_columns_count", "related_charts_count", "related_dashboards_count", "sql_definition_present", "detail_loaded"],
    datasetsInventory.map((d) => [d.dataset_id, d.name, d.schema, d.database_name, d.kind, d.priority, d.primary_domain, d.columns_count, d.metrics_count, d.temporal_columns_count, d.related_charts_count, d.related_dashboards_count, d.sql_definition_present, d.detail_loaded]));

  // ---------- dataset columns ----------
  const columnRows: Row[] = [];
  for (const d of datasetsDetail) {
    const cand = candidates.get(Number(d.id));
    for (const c of d.columns ?? []) {
      columnRows.push({
        dataset_id: Number(d.id),
        dataset_name: d.name ?? null,
        domain: domainOf(cand),
        column_name: c.name,
        data_type: c.type ?? null,
        is_dttm: Boolean(c.is_dttm),
        filterable: c.filterable ?? null,
        groupby: c.groupby ?? null,
        description: truncate(c.description ?? "", 300),
        expression: truncate(c.expression ?? "", 300),
        semantic_role: semanticRole(c),
      });
    }
  }
  writeCsvSafe(join(REPORTS, "dataset_columns.csv"),
    ["dataset_id", "dataset_name", "domain", "column_name", "data_type", "is_dttm", "filterable", "groupby", "description", "expression", "semantic_role"],
    columnRows.map((c) => [c.dataset_id, c.dataset_name, c.domain, c.column_name, c.data_type, c.is_dttm, c.filterable, c.groupby, c.description, c.expression, c.semantic_role]));

  // ---------- dataset metrics ----------
  const metricRows: Row[] = [];
  for (const d of datasetsDetail) {
    const cand = candidates.get(Number(d.id));
    for (const m of d.metrics ?? []) {
      metricRows.push({
        dataset_id: Number(d.id),
        dataset_name: d.name ?? null,
        domain: domainOf(cand),
        metric_name: m.name,
        expression: m.expression ?? null,
        verbose_name: m.verbose_name ?? null,
        description: truncate(m.description ?? "", 300),
        aggregation: metricAggregation(m.expression ?? ""),
        source_fields: metricSourceFields(m.expression ?? ""),
      });
    }
  }
  writeCsvSafe(join(REPORTS, "dataset_metrics.csv"),
    ["dataset_id", "dataset_name", "domain", "metric_name", "expression", "verbose_name", "description", "aggregation", "source_fields"],
    metricRows.map((m) => [m.dataset_id, m.dataset_name, m.domain, m.metric_name, m.expression, m.verbose_name, m.description, m.aggregation, (m.source_fields ?? []).join(";")]));

  // ---------- charts inventory ----------
  const chartsInventory: Row[] = charts.map((c) => {
    const ds = Number(c.datasource_id);
    const cand = candidates.get(ds);
    const fd = c.form_data ?? {};
    return {
      chart_id: Number(c.id),
      name: c.name ?? null,
      viz_type: c.viz_type ?? null,
      dataset_id: ds,
      dataset_name: datasetNameById.get(ds) ?? null,
      dataset_priority: cand?.priority ?? "UNKNOWN",
      dashboard_ids: c.dashboards ?? [],
      metrics_count: Array.isArray(fd.metrics) ? fd.metrics.length : 0,
      groupby_count: Array.isArray(fd.groupby) ? fd.groupby.length : 0,
      adhoc_filters_count: Array.isArray(fd.adhoc_filters) ? fd.adhoc_filters.length : 0,
      time_range: fd.time_range ?? null,
      granularity: fd.granularity ?? null,
      params_parse_status: c.params_parse_status ?? "UNKNOWN",
      access: "METADATA_ONLY",
    };
  });
  writeJsonSafe(join(REPORTS, "charts_inventory.json"), {
    generated_at: nowIso(),
    total: chartsInventory.length,
    by_priority: countBy(chartsInventory, "dataset_priority"),
    charts: chartsInventory,
  });

  // ---------- chart metrics ----------
  const chartMetricRows: Row[] = [];
  for (const c of charts) {
    const ds = Number(c.datasource_id);
    const cand = candidates.get(ds);
    if (!["P0", "P1"].includes(String(cand?.priority))) continue;
    const fd = c.form_data ?? {};
    const metrics = Array.isArray(fd.metrics) ? fd.metrics : [];
    for (const m of metrics) {
      if (typeof m === "string") {
        chartMetricRows.push({
          chart_id: Number(c.id), chart_name: c.name ?? null, dataset_id: ds, dataset_priority: cand?.priority ?? null,
          metric_name: m, metric_type: "DATASET_METRIC_REF", expression: null, aggregation: "UNKNOWN",
          filters: (fd.adhoc_filters ?? []).map((f: Row) => `${f.subject ?? f.col ?? ""} ${f.operator ?? f.op ?? ""} ${f.comparator ?? f.val ?? ""}`).join(" | ").slice(0, 300),
          time_range: fd.time_range ?? null,
        });
      } else if (m && typeof m === "object") {
        const label = m.label ?? m.verbose_name ?? m.metric_name ?? null;
        const expr = m.expressionType === "SIMPLE" ? `${m.aggregate ?? "?"}(${m.column?.column_name ?? "?"})` : m.sqlExpression ?? null;
        chartMetricRows.push({
          chart_id: Number(c.id), chart_name: c.name ?? null, dataset_id: ds, dataset_priority: cand?.priority ?? null,
          metric_name: label, metric_type: m.expressionType ?? "UNKNOWN", expression: expr,
          aggregation: m.aggregate ?? metricAggregation(expr ?? ""),
          filters: (fd.adhoc_filters ?? []).map((f: Row) => `${f.subject ?? f.col ?? ""} ${f.operator ?? f.op ?? ""} ${f.comparator ?? f.val ?? ""}`).join(" | ").slice(0, 300),
          time_range: fd.time_range ?? null,
        });
      }
    }
  }
  writeCsvSafe(join(REPORTS, "chart_metrics.csv"),
    ["chart_id", "chart_name", "dataset_id", "dataset_priority", "metric_name", "metric_type", "expression", "aggregation", "filters", "time_range"],
    chartMetricRows.map((m) => [m.chart_id, m.chart_name, m.dataset_id, m.dataset_priority, m.metric_name, m.metric_type, m.expression, m.aggregation, m.filters, m.time_range]));

  // ---------- dashboards inventory ----------
  // Если детали дашбордов не загружены (нет сети/прав), инвентарь строится из списка:
  // количество чартов и датасетов считается по связям чартов, native_filters = null.
  const dashboardsSource: Row[] = dashboardsDetail.length > 0 ? dashboardsDetail : dashboardsList;
  const dashboardsInventory: Row[] = dashboardsSource.map((d) => {
    const id = Number(d.id);
    const chartsInDash = new Set<number>(
      Array.isArray(d.chart_ids) ? d.chart_ids.map(Number) : charts.filter((c) => (c.dashboards ?? []).includes(id)).map((c) => Number(c.id)),
    );
    const datasets = new Set<number>();
    for (const c of charts) if ((c.dashboards ?? []).includes(id)) datasets.add(Number(c.datasource_id));
    return {
      dashboard_id: id,
      title: d.title ?? d.dashboard_title ?? null,
      published: d.published ?? null,
      chart_count: chartsInDash.size,
      dataset_count: datasets.size,
      native_filters_count: Array.isArray(d.native_filters) ? d.native_filters.length : null,
      access: dashboardsDetail.length > 0 ? "METADATA_ONLY" : "LIST_ONLY",
    };
  });
  writeJsonSafe(join(REPORTS, "dashboards_inventory.json"), {
    generated_at: nowIso(),
    total: dashboardsInventory.length,
    dashboards: dashboardsInventory,
  });

  // ---------- dashboard filters ----------
  const filterRows: Row[] = [];
  for (const d of dashboardsDetail) {
    for (const f of d.native_filters ?? []) {
      for (const t of f.targets ?? []) {
        filterRows.push({
          dashboard_id: Number(d.id),
          dashboard_title: d.title ?? null,
          filter_name: f.name ?? null,
          filter_type: f.filter_type ?? null,
          dataset_id: Number(t.datasetId ?? t.dataset_id ?? NaN),
          column_name: t.column ?? null,
          default_value: f.default_value ?? null,
          multi_select: f.multi_select ?? null,
          default_to_first: f.default_to_first ?? null,
        });
      }
    }
  }
  writeJsonSafe(join(REPORTS, "dashboard_filters.json"), {
    generated_at: nowIso(),
    total_filters: filterRows.length,
    filters: filterRows,
  });

  // ---------- relationships candidates ----------
  const relationships: Row[] = [];
  const colsByKey = new Map<string, Row[]>();
  for (const c of columnRows) {
    const n = String(c.column_name ?? "").toLowerCase();
    if (!KEY_COLUMNS.includes(n)) continue;
    if (!colsByKey.has(n)) colsByKey.set(n, []);
    colsByKey.get(n)!.push(c);
  }
  for (const [key, cols] of colsByKey) {
    const byDataset = new Map<number, Row>();
    for (const c of cols) if (!byDataset.has(c.dataset_id)) byDataset.set(c.dataset_id, c);
    const list = [...byDataset.values()];
    if (list.length < 2) continue;
    const pairs = Math.min(list.length - 1, 40);
    for (let i = 0; i < pairs; i++) {
      relationships.push({
        left_dataset: list[0].dataset_id,
        left_dataset_name: list[0].dataset_name,
        left_field: key,
        right_dataset: list[i + 1].dataset_id,
        right_dataset_name: list[i + 1].dataset_name,
        right_field: key,
        relationship_type: "shared_key_candidate",
        evidence: "Одноимённая колонка присутствует в обоих датасетах; JOIN не проверялся.",
        cardinality: "unknown",
        verification_status: "NOT_VERIFIED",
        notes: "Совпадение имени не является доказательством FK.",
      });
    }
  }
  // связи из этапа 1.6, если файл существует
  const rel16 = readJson<any>(join("reports", "phase-01-6", "relationship_checks.json"));
  if (rel16) {
    const arr = Array.isArray(rel16) ? rel16 : rel16.relationships ?? [];
    for (const r of arr) {
      relationships.push({
        left_dataset: r.left?.dataset_id ?? r.left_dataset ?? null,
        left_dataset_name: r.left?.dataset_name ?? r.left_dataset_name ?? null,
        left_field: r.left?.field ?? r.left_field ?? null,
        right_dataset: r.right?.dataset_id ?? r.right_dataset ?? null,
        right_dataset_name: r.right?.dataset_name ?? r.right_dataset_name ?? null,
        right_field: r.right?.field ?? r.right_field ?? null,
        relationship_type: r.relationship_type ?? "declared",
        evidence: r.evidence ?? r.notes ?? null,
        cardinality: r.cardinality ?? "unknown",
        verification_status: r.verification_status ?? r.status ?? "NOT_VERIFIED",
        notes: r.notes ?? null,
      });
    }
  }
  writeCsvSafe(join(PACKAGE, "relationships_candidates.csv"),
    ["left_dataset", "left_dataset_name", "left_field", "right_dataset", "right_dataset_name", "right_field", "relationship_type", "evidence", "cardinality", "verification_status", "notes"],
    relationships.map((r) => [r.left_dataset, r.left_dataset_name, r.left_field, r.right_dataset, r.right_dataset_name, r.right_field, r.relationship_type, r.evidence, r.cardinality, r.verification_status, r.notes]));

  // ---------- data dictionary ----------
  const dictRows = columnRows.map((c) => ({
    domain: c.domain,
    dataset_id: c.dataset_id,
    dataset_name: c.dataset_name,
    field_name: c.column_name,
    data_type: c.data_type,
    description: c.description,
    semantic_role: c.semantic_role,
    source_table: c.dataset_name,
    evidence_status: "METADATA_ONLY",
    limitations: "Тип и описание из метаданных Superset; фактические значения не проверялись.",
  }));
  writeCsvSafe(join(PACKAGE, "data_dictionary.csv"),
    ["domain", "dataset_id", "dataset_name", "field_name", "data_type", "description", "semantic_role", "source_table", "evidence_status", "limitations"],
    dictRows.map((d) => [d.domain, d.dataset_id, d.dataset_name, d.field_name, d.data_type, d.description, d.semantic_role, d.source_table, d.evidence_status, d.limitations]));

  // ---------- temporal fields ----------
  const temporalRows = columnRows.filter((c) => c.is_dttm || /DATE|TIME|TIMESTAMP/.test(String(c.data_type ?? "").toUpperCase()) || TEMPORAL_NAME_RE.test(String(c.column_name ?? "")));
  writeCsvSafe(join(PACKAGE, "temporal_fields.csv"),
    ["dataset_id", "dataset_name", "field_name", "data_type", "min_value", "max_value", "null_count", "timezone_notes", "semantic_status", "evidence_status"],
    temporalRows.map((c) => [c.dataset_id, c.dataset_name, c.column_name, c.data_type, "", "", "", "Смещение +3 часа не подтверждено; происхождение неизвестно.", "METADATA_ONLY", "METADATA_ONLY"]));

  // ---------- metrics catalog ----------
  const metricsCatalog: Row[] = [];
  for (const m of metricRows) {
    metricsCatalog.push({
      dataset_id: m.dataset_id,
      metric_name: m.metric_name,
      metric_definition: m.expression,
      source_fields: (m.source_fields ?? []).join(";"),
      formula: m.expression,
      aggregation: m.aggregation,
      filters: "",
      business_meaning: m.verbose_name ?? m.description ?? "",
      verification_status: "METADATA_ONLY",
    });
  }
  for (const cm of chartMetricRows) {
    metricsCatalog.push({
      dataset_id: cm.dataset_id,
      metric_name: cm.metric_name,
      metric_definition: cm.expression ?? cm.metric_type,
      source_fields: metricSourceFields(cm.expression ?? "").join(";"),
      formula: cm.expression,
      aggregation: cm.aggregation,
      filters: cm.filters,
      business_meaning: `Метрика чарта ${cm.chart_id} (${cm.chart_name ?? ""})`,
      verification_status: "METADATA_ONLY",
    });
  }
  writeCsvSafe(join(PACKAGE, "metrics_catalog.csv"),
    ["dataset_id", "metric_name", "metric_definition", "source_fields", "formula", "aggregation", "filters", "business_meaning", "verification_status"],
    metricsCatalog.map((m) => [m.dataset_id, m.metric_name, m.metric_definition, m.source_fields, m.formula, m.aggregation, m.filters, m.business_meaning, m.verification_status]));

  // ---------- analytical checks (data for md) ----------
  const statusColumns = columnValues.filter((c) => STATUS_COLUMN_RE.test(String(c.column_name ?? "")) && (c.top_values ?? []).length > 0);
  const statusValues = statusColumns.map((c) => ({
    dataset_id: c.dataset_id,
    dataset_name: c.dataset_name,
    column_name: c.column_name,
    values: (c.top_values ?? []).map((v: Row) => v.value),
    source: c.source,
  }));

  const stats = {
    generated_at: nowIso(),
    datasets_total: datasetsInventory.length,
    datasets_detail_loaded: datasetsDetail.length,
    datasets_by_priority: countBy(datasetsInventory, "priority"),
    charts_total: chartsInventory.length,
    charts_by_priority: countBy(chartsInventory, "dataset_priority"),
    dashboards_total: dashboardsInventory.length,
    dashboard_filters_total: filterRows.length,
    columns_total: columnRows.length,
    columns_with_values: columnValues.filter((c) => (c.top_values ?? []).length > 0).length,
    columns_not_available: columnValues.filter((c) => c.retrieval_status === "NOT_AVAILABLE").length,
    column_values_total: columnValues.length,
    metrics_dataset_total: metricRows.length,
    metrics_chart_total: chartMetricRows.length,
    relationships_total: relationships.length,
    relationships_verified: relationships.filter((r) => r.verification_status === "VERIFIED").length,
    status_columns: statusColumns.length,
    status_values: statusValues,
    temporal_fields_total: temporalRows.length,
    by_domain: countBy(datasetsInventory, "primary_domain"),
  };
  writeJsonSafe(join(REPORTS, "analysis_stats.json"), stats);

  // ---------- ANALYST_BRIEF.md ----------
  const brief = buildBrief(stats, datasetsInventory, statusValues, relationships, filterRows, dashboardsInventory);
  writeFile(join(PACKAGE, "ANALYST_BRIEF.md"), brief);

  console.log(JSON.stringify({
    datasets: stats.datasets_total,
    datasets_detail: stats.datasets_detail_loaded,
    charts: stats.charts_total,
    dashboards: stats.dashboards_total,
    columns: stats.columns_total,
    columns_with_values: stats.columns_with_values,
    metrics: stats.metrics_dataset_total + stats.metrics_chart_total,
    relationships: stats.relationships_total,
    filters: stats.dashboard_filters_total,
  }, null, 2));
}

function countBy(rows: Row[], key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[key] ?? "UNKNOWN");
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function writeFile(path: string, content: string) {
  ensureDir(join(path, ".."));
  writeFileSync(path, redactPii(content), "utf8");
}

function buildBrief(stats: any, datasets: Row[], statusValues: Row[], relationships: Row[], filters: Row[], dashboards: Row[]): string {
  const p0 = datasets.filter((d) => d.priority === "P0");
  const p1 = datasets.filter((d) => d.priority === "P1");
  const lines: string[] = [];
  lines.push("# ANALYST_BRIEF — доступные значения и источники Superset (Этап 1.6.2)");
  lines.push("");
  lines.push(`Сформировано: ${stats.generated_at}. Режим: read-only, без обхода RBAC.`);
  lines.push("");
  lines.push("## 1. Что доступно");
  lines.push("");
  lines.push(`- Датасетов в каталоге: **${stats.datasets_total}** (P0 — ${stats.datasets_by_priority.P0 ?? 0}, P1 — ${stats.datasets_by_priority.P1 ?? 0}, P2 — ${stats.datasets_by_priority.P2 ?? 0}).`);
  lines.push(`- Детальные метаданные загружены по **${stats.datasets_detail_loaded}** датасетам (P0+P1).`);
  lines.push(`- Чартов: **${stats.charts_total}**; дашбордов: **${stats.dashboards_total}**; фильтров дашбордов: **${stats.dashboard_filters_total}**.`);
  lines.push(`- Колонок в P0/P1: **${stats.columns_total}**; колонок с фактическими значениями из фильтров: **${stats.columns_with_values}**.`);
  lines.push(`- SQL Lab и chart data API: **недоступны** (403/401). Значения из реальных выборок не получены.`);
  lines.push("");
  lines.push("## 2. Происхождение значений");
  lines.push("");
  lines.push("| Класс | Что означает | Сколько |");
  lines.push("|---|---|---:|");
  lines.push(`| ACTUAL_VALUES | Результаты запросов к данным | 0 |`);
  lines.push(`| FILTER_VALUES | Значения по умолчанию фильтров дашбордов | ${filters.filter((f) => f.default_value !== null && f.default_value !== undefined).length} |`);
  lines.push(`| SQL_DERIVED | Литералы из определений чартов и SQL | ${stats.columns_with_values} |`);
  lines.push(`| METADATA_ONLY | Только описание колонок и типов | ${stats.columns_total} |`);
  lines.push(`| NOT_AVAILABLE | Значения получить нельзя | ${stats.columns_not_available} |`);
  lines.push("");
  lines.push("## 3. Статусы и категории, найденные в определениях фильтров");
  lines.push("");
  if (statusValues.length === 0) {
    lines.push("Значения статусов в определениях фильтров не обнаружены.");
  } else {
    lines.push("| Датасет | Колонка | Значения | Источник |");
    lines.push("|---|---|---|---|");
    for (const s of statusValues.slice(0, 60)) {
      lines.push(`| ${s.dataset_id} | ${s.column_name} | ${s.values.slice(0, 12).join(", ")} | ${s.source} |`);
    }
  }
  lines.push("");
  lines.push("## 4. Связи-кандидаты");
  lines.push("");
  lines.push(`Всего кандидатов: **${stats.relationships_total}**, подтверждённых по данным: **${stats.relationships_verified}**.`);
  lines.push("Совпадение имени колонки не является доказательством FK; кардинальность не измерена.");
  lines.push("");
  lines.push("## 5. Ограничения");
  lines.push("");
  lines.push("- Нет фактических значений: SQL Lab 403, chart data 401, `/api/v1/database/` возвращает 0 баз.");
  lines.push("- Все значения из фильтров — это литералы, заданные авторами чартов/дашбордов, а не статистика данных.");
  lines.push("- Частоты отражают число определений, где встречается значение, а не частоту в данных.");
  lines.push("- PII-колонки не извлекались; фиксировался только факт наличия поля.");
  lines.push("");
  lines.push("## 6. Что нужно проверить при появлении доступа");
  lines.push("");
  lines.push("1. Фактические значения статусов заказов и их распределение.");
  lines.push("2. Заполняемость кандидатов готовности (`date_set_cell`, `date_collected`, `date_printed`, `date_status_10`, `is_collected`).");
  lines.push("3. Зерно и уникальность `id_shift` в 7802 и исходной таблице.");
  lines.push("4. Размеры пулов и повторное назначение заказов.");
  lines.push("5. Покрытие и кардинальность связей shifts↔pools, attempts↔shifts, sheet↔darkstore_time.");
  lines.push("");
  return lines.join("\n");
}

main();
