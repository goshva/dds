/**
 * Этап 1.7 — загрузка ранее собранных артефактов и поиск по каталогу Superset.
 *
 * Только чтение. Ничего не пишет и не ходит в сеть.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE, REPORTS_162, REPORTS_16, SNAP_162 } from "./paths";

export interface DatasetListRow {
  id: number;
  name: string | null;
  schema: string | null;
  database_id: number | null;
  database_name: string | null;
  catalog: string | null;
  kind: string | null;
  description: string | null;
  sql: string | null;
}

export interface DatasetDetailRow {
  id: number;
  name: string;
  schema: string | null;
  database_id: number | null;
  database_name: string | null;
  kind: string | null;
  description: string | null;
  sql: string | null;
  main_dttm_col: string | null;
  columns: Array<{
    name: string;
    type: string | null;
    is_dttm: boolean;
    description: string | null;
    expression: string | null;
    verbose_name: string | null;
  }>;
  metrics: Array<{ name: string; verbose_name: string | null; expression: string | null; description: string | null }>;
}

export interface ChartRow {
  id: number;
  name: string | null;
  viz_type: string | null;
  datasource_id: number | null;
  datasource_type: string | null;
  dashboards: number[];
  form_data: Record<string, any> | null;
}

export interface DashboardRow {
  id: number;
  title: string | null;
  slug: string | null;
  published: boolean;
  description: string | null;
  chart_ids: number[];
  native_filters: Array<{
    id: string;
    name: string;
    filter_type: string | null;
    targets: Array<{ dataset_id: number | null; column: string | null }>;
    default_value: unknown;
    multi_select: boolean | null;
  }>;
}

export interface FilterRow {
  dashboard_id: number;
  dashboard_title: string | null;
  filter_name: string | null;
  filter_type: string | null;
  dataset_id: number | null;
  column_name: string | null;
  default_value: unknown;
  multi_select: boolean | null;
}

export interface DatasetInventoryRow {
  dataset_id: number;
  name: string | null;
  schema: string | null;
  database_name: string | null;
  kind: string | null;
  description: string | null;
  sql_definition_present: boolean;
  sql_definition_sha256: string | null;
  columns_count: number;
  metrics_count: number;
  calculated_columns_count: number;
  temporal_columns_count: number;
  priority: string;
  domains: string[];
  primary_domain: string | null;
  related_charts_count: number;
  related_dashboards_count: number;
  access: string;
  detail_loaded: boolean;
}

export interface ColumnValueRow {
  dataset_id: number;
  dataset_name: string | null;
  column_name: string;
  column_type: string | null;
  source: string;
  retrieval_status: string;
  evidence_status: string;
  distinct_count: number | null;
  top_values: Array<{ value: string; count: number | null }>;
  all_values: string[];
  evidence_ref: string | null;
  notes: string | null;
}

export interface RelationshipRow {
  left_dataset: string;
  left_dataset_name: string;
  left_field: string;
  right_dataset: string;
  right_dataset_name: string;
  right_field: string;
  relationship_type: string;
  evidence: string;
  cardinality: string | null;
  verification_status: string;
  notes: string | null;
}

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(rel, "utf8")) as T;
}

export function readText(rel: string): string {
  return readFileSync(rel, "utf8");
}

/** Минимальный CSV-парсер: кавычки, удвоенные кавычки, переводы строк внутри поля. */
export function readCsv(rel: string): Array<Record<string, string>> {
  const text = readFileSync(rel, "utf8");
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // пропускаем
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  return rows
    .filter((r) => r.length > 1 || (r[0] ?? "").length > 0)
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, i) => {
        obj[h] = r[i] ?? "";
      });
      return obj;
    });
}

export interface Catalog {
  datasetsList: DatasetListRow[];
  datasetsDetail: DatasetDetailRow[];
  datasetsDetailById: Map<number, DatasetDetailRow>;
  charts: ChartRow[];
  dashboards: DashboardRow[];
  filters: FilterRow[];
  datasetsInventory: DatasetInventoryRow[];
  inventoryById: Map<number, DatasetInventoryRow>;
  columnValues: ColumnValueRow[];
  relationships: RelationshipRow[];
  accessMatrix: any;
  finalValidation162: any;
  analysisStats: any;
  queryPlan: any;
  decisionRegister15: any[];
  manifest: any;
}

export function loadCatalog(): Catalog {
  const datasetsList = readJson<DatasetListRow[]>(join(SNAP_162, "datasets.list.json"));
  const datasetsDetail = readJson<DatasetDetailRow[]>(join(SNAP_162, "datasets.detail.json"));
  const charts = readJson<ChartRow[]>(join(SNAP_162, "charts.list.json"));
  const dashboards = readJson<DashboardRow[]>(join(SNAP_162, "dashboards.detail.json"));
  const filters = readJson<{ filters: FilterRow[] }>(join(REPORTS_162, "dashboard_filters.json")).filters;
  const datasetsInventory = readJson<{ datasets: DatasetInventoryRow[] }>(join(REPORTS_162, "datasets_inventory.json")).datasets;
  const columnValues = readJson<{ columns: ColumnValueRow[] }>(join(REPORTS_162, "column_values.json")).columns;
  const relationships = readCsv(join(PACKAGE, "relationships_candidates.csv")) as unknown as RelationshipRow[];
  const accessMatrix = readJson<any>(join(REPORTS_162, "superset_access_matrix.json"));
  const finalValidation162 = readJson<any>(join(REPORTS_162, "final_validation.json"));
  const analysisStats = readJson<any>(join(REPORTS_162, "analysis_stats.json"));
  const queryPlan = readJson<any>(join(REPORTS_16, "query_plan.json"));
  const decisionRegister15 = readJson<{ decisions: any[] }>(join("docs/phase-01-5", "business_decisions_register.json")).decisions;
  const manifest = readJson<any>(join(SNAP_162, "manifest.json"));

  const datasetsDetailById = new Map(datasetsDetail.map((d) => [Number(d.id), d]));
  const inventoryById = new Map(datasetsInventory.map((d) => [Number(d.dataset_id), d]));

  return {
    datasetsList,
    datasetsDetail,
    datasetsDetailById,
    charts,
    dashboards,
    filters,
    datasetsInventory,
    inventoryById,
    columnValues,
    relationships,
    accessMatrix,
    finalValidation162,
    analysisStats,
    queryPlan,
    decisionRegister15,
    manifest,
  };
}

export interface DatasetHit {
  id: number;
  name: string;
  schema: string | null;
  database: string | null;
  kind: string | null;
  priority: string | null;
  domains: string[];
  detailLoaded: boolean;
  matchedIn: string[];
  sqlSnippet: string | null;
  columnMatches: string[];
}

const norm = (s: string) => s.toLowerCase();

/**
 * Поиск датасетов по именам таблиц и ключевым словам в SQL, имени и колонках.
 * Возвращает только совпадения; пустой результат — честный «не найдено в охвате».
 */
export function findDatasets(cat: Catalog, terms: string[], opts: { maxHits?: number; includeColumns?: boolean } = {}): DatasetHit[] {
  const maxHits = opts.maxHits ?? 40;
  const includeColumns = opts.includeColumns ?? true;
  const needles = terms.map(norm).filter((t) => t.length > 1);
  const hits: DatasetHit[] = [];

  for (const ds of cat.datasetsList) {
    const inv = cat.inventoryById.get(Number(ds.id));
    const name = ds.name ?? "";
    const sql = ds.sql ?? "";
    const matchedIn: string[] = [];
    let sqlSnippet: string | null = null;
    const lowerName = norm(name);
    const lowerSql = norm(sql);

    for (const t of needles) {
      if (lowerName.includes(t)) matchedIn.push("name");
      if (lowerSql.includes(t)) {
        if (!matchedIn.includes("sql")) matchedIn.push("sql");
        if (!sqlSnippet) {
          const idx = lowerSql.indexOf(t);
          sqlSnippet = sql.slice(Math.max(0, idx - 90), Math.min(sql.length, idx + 150)).replace(/\s+/g, " ").trim();
        }
      }
    }

    const columnMatches: string[] = [];
    if (includeColumns && inv?.detail_loaded) {
      const det = cat.datasetsDetailById.get(Number(ds.id));
      for (const c of det?.columns ?? []) {
        const cn = norm(c.name);
        if (needles.some((t) => cn.includes(t) || t.includes(cn))) columnMatches.push(c.name);
      }
      if (columnMatches.length && !matchedIn.includes("column")) matchedIn.push("column");
    }

    if (matchedIn.length) {
      hits.push({
        id: Number(ds.id),
        name,
        schema: ds.schema ?? null,
        database: ds.database_name ?? null,
        kind: ds.kind ?? null,
        priority: inv?.priority ?? null,
        domains: inv?.domains ?? [],
        detailLoaded: Boolean(inv?.detail_loaded),
        matchedIn,
        sqlSnippet,
        columnMatches: columnMatches.slice(0, 12),
      });
    }
    if (hits.length >= maxHits) break;
  }
  return hits;
}

/** Поиск колонок по имени во всех загруженных деталях датасетов. */
export function findColumns(cat: Catalog, patterns: RegExp[], maxHits = 60): Array<{ dataset_id: number; dataset_name: string; column: string; type: string | null; priority: string | null }> {
  const out: Array<{ dataset_id: number; dataset_name: string; column: string; type: string | null; priority: string | null }> = [];
  for (const ds of cat.datasetsDetail) {
    const inv = cat.inventoryById.get(Number(ds.id));
    for (const c of ds.columns ?? []) {
      if (patterns.some((p) => p.test(c.name))) {
        out.push({ dataset_id: Number(ds.id), dataset_name: ds.name, column: c.name, type: c.type, priority: inv?.priority ?? null });
        if (out.length >= maxHits) return out;
      }
    }
  }
  return out;
}

/** Значения колонки из доступных источников (FILTER_VALUES / SQL_DERIVED). */
export function valuesFor(cat: Catalog, datasetId: number, column: string): ColumnValueRow | null {
  return cat.columnValues.find((r) => Number(r.dataset_id) === datasetId && r.column_name === column) ?? null;
}

/** Все строки значений по датасету. */
export function valuesForDataset(cat: Catalog, datasetId: number): ColumnValueRow[] {
  return cat.columnValues.filter((r) => Number(r.dataset_id) === datasetId);
}
