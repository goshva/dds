/**
 * Этап 1.6, фаза 1.6.2 (метаданные) — доказательная база по 6 датасетам без выполнения SQL.
 * Read-only GET. Фиксирует: колонки, метрики, source-таблицы из SQL, использование в чартах,
 * связанные объекты, доступность saved_query/query API.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config";
import { SqlLabClient, redactSql } from "./client";
import { scanPii16 } from "./pii16";

const REPORTS = "reports/phase-01-6";
const TARGETS = [5939, 7802, 7712, 7021, 3466, 2339];

function write(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
}
function rison(obj: string) {
  return encodeURIComponent(obj);
}
function readJson(p: string): any | null {
  try {
    return JSON.parse(require("node:fs").readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** Извлекает физические источники из (обезличенного) SQL датасета. */
function extractSources(sql: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:from|join)\s+([a-zA-Z_][\w.]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) out.add(m[1]);
  return [...out];
}

async function main() {
  const cfg = loadConfig();
  const client = new SqlLabClient(cfg);
  await client.login();
  await client.getCsrf();

  const out: any = { generated_at: new Date().toISOString(), api_availability: {}, datasets: [], saved_queries: null, query_history: null, errors: [] };

  // доступность saved_query / query API
  const sq = await client.get(`/api/v1/saved_query/?q=${rison("(page:0,page_size:5)")}`);
  out.api_availability.saved_query = { status: sq.status, count: sq.body?.count ?? null };
  if (sq.ok && Array.isArray(sq.body?.result)) {
    out.saved_queries = sq.body.result.map((r: any) => ({
      id: r.id,
      label: typeof r.label === "string" && scanPii16(r.label).length === 0 ? r.label.slice(0, 200) : null,
      db_id: r.db_id ?? null,
      schema: r.schema ?? null,
      sql_len: typeof r.sql === "string" ? r.sql.length : 0,
      sql_redacted: typeof r.sql === "string" && scanPii16(redactSql(r.sql)).length === 0 ? redactSql(r.sql).slice(0, 3000) : null,
    }));
  }
  const qh = await client.get(`/api/v1/query/?q=${rison("(page:0,page_size:5)")}`);
  out.api_availability.query_history = { status: qh.status, count: qh.body?.count ?? null };
  if (qh.ok && Array.isArray(qh.body?.result)) {
    out.query_history = qh.body.result.map((r: any) => ({ id: r.id, status: r.status ?? null, rows: r.rows ?? null, sql_len: typeof r.sql === "string" ? r.sql.length : 0 }));
  }

  for (const id of TARGETS) {
    const meta = readJson(join(REPORTS, "evidence", "dataset_metadata", `${id}.json`));
    const entry: any = {
      dataset_id: id,
      table_name: meta?.table_name ?? null,
      kind: meta?.kind ?? null,
      schema: meta?.schema ?? null,
      database: meta?.database ?? null,
      sql_len: meta?.sql_len ?? null,
      sources: (meta?.sql_sources_physical as string[] | undefined) ?? (meta?.sql_redacted ? extractSources(meta.sql_redacted) : null),
      columns: (meta?.columns ?? []).map((c: any) => ({ name: c.column_name, type: c.type, is_dttm: c.is_dttm })),
      metrics: meta?.metric_names ?? [],
      charts: [],
      related_objects: null,
      chart_query_context: null,
    };

    // чарты на датасете
    const charts = await client.get(`/api/v1/chart/?q=${rison(`(filters:!((col:datasource_id,opr:eq,value:${id})),page:0,page_size:5)`)}`);
    if (charts.ok && Array.isArray(charts.body?.result)) {
      entry.charts = charts.body.result.map((c: any) => ({ id: c.id, name: c.slice_name ?? null, viz_type: c.viz_type ?? null, datasource_id: c.datasource_id ?? null }));
      const first = charts.body.result[0];
      if (first?.id) {
        const cd = await client.get(`/api/v1/chart/${first.id}`);
        const qc = cd.body?.result?.query_context;
        if (typeof qc === "string") {
          const red = redactSql(qc);
          entry.chart_query_context = scanPii16(red).length === 0 ? { chart_id: first.id, len: qc.length, redacted: red.slice(0, 4000) } : { chart_id: first.id, len: qc.length, redacted: null, note: "PII patterns" };
        }
      }
    }
    const rel = await client.get(`/api/v1/dataset/${id}/related_objects`);
    entry.related_objects = { status: rel.status, keys: rel.body && typeof rel.body === "object" ? Object.keys(rel.body).slice(0, 10) : null };
    out.datasets.push(entry);
  }

  write(join(REPORTS, "evidence", "metadata_evidence.json"), JSON.stringify(out, null, 2));

  const md: string[] = [];
  md.push("# 02. Доказательства по датасетам (метаданные Superset)");
  md.push("");
  md.push(`Сгенерировано: ${out.generated_at}`);
  md.push("");
  md.push(`- saved_query API: HTTP ${out.api_availability.saved_query.status}, count=${out.api_availability.saved_query.count ?? "—"}`);
  md.push(`- query history API: HTTP ${out.api_availability.query_history.status}, count=${out.api_availability.query_history.count ?? "—"}`);
  md.push("");
  for (const d of out.datasets) {
    md.push(`## Dataset ${d.dataset_id} — ${d.table_name ?? "—"}`);
    md.push("");
    md.push(`- тип: ${d.kind ?? "—"}; schema: ${d.schema ?? "—"}; БД: ${d.database?.name ?? "—"} (${d.database?.backend ?? "—"}); колонок: ${d.columns.length}; метрик: ${d.metrics.length}`);
    md.push(`- источники из SQL (обезличенного): ${d.sources?.join(", ") || "не извлечены"}`);
    md.push(`- чартов на датасете (первые): ${d.charts.map((c: any) => `${c.id}:${c.name}`).join("; ") || "нет"}`);
    md.push(`- related_objects: HTTP ${d.related_objects?.status ?? "—"}`);
    if (d.chart_query_context) md.push(`- query_context чарта ${d.chart_query_context.chart_id}: ${d.chart_query_context.redacted ? "сохранён (обезличен)" : "скрыт"}`);
    md.push("");
  }
  md.push("## ***REMOVED***");
  md.push("");
  md.push("<ФИО> метаданные и SQL-тексты, а не результаты запросов. Фактические данные проверить не удалось (см. 01_superset_access_audit.md).");
  md.push("");
  write(join(REPORTS, "02_dataset_evidence.md"), md.join("\n"));

  console.log(JSON.stringify({
    saved_query: out.api_availability.saved_query,
    query_history: out.api_availability.query_history,
    datasets: out.datasets.map((d: any) => ({ id: d.dataset_id, sources: d.sources, charts: d.charts.length, ctx: Boolean(d.chart_query_context?.redacted) })),
  }, null, 2));
}

main();
