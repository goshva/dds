/**
 * Этап 1.4, фаза 1.4.5 — расширенный SQL-парсинг.
 *
 * Базовый парсер: src/phase1-2/parse-sql.ts (расширен parseSqlExtended, обратная совместимость).
 * Read-only. Пишет 05_* отчёты в reports/phase-01-4/.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseSqlExtended, type ParsedSqlExtended } from "../phase1-2/parse-sql";
import {
  EXTRACT_ROOT,
  SNAPSHOT_ROOT,
  ensureDir,
  readJson,
  writeJsonAtomic,
  writeAtomic,
  csv,
  joinReport,
  nowIso,
  sha256,
} from "./utils";
import { normalizeSources, type SourceRow } from "./lib";

const PARSER_VERSION = "phase1-4@1";

function metricRefs(expression: string, columns: Set<string>): { refs: string[]; unresolved: string[] } {
  const cleaned = expression
    .replace(/'[^']*'/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/\{%[\s\S]*?%\}/g, " ")
    .replace(/\{\{[\s\S]*?\}\}/g, " ");
  const refs = new Set<string>();
  for (const m of cleaned.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g)) refs.add(m[2]);
  const noDots = cleaned.replace(/[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*/g, " ");
  for (const m of noDots.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) refs.add(m[0]);
  const kw = new Set(
    `select from where group by having order limit union all distinct as on join left right inner outer cross using and or not case when then else end true false null is in between cast round abs greatest least coalesce nullif if multiif count sum avg min max countif sumif avgif uniqexact uniqexactif quantileexact median stddev variance topn over partition rows range unbounded preceding following current row interval day month year hour minute second epoch extract date_trunc todate todatetime formatdatetime datediff dateadd floor ceil assumenotnull isnotnull isnull tostring toint touint tofloat todecimal splitbychar arrayjoin dictgetornull dictget lag lead row_number rank dense_rank first_value last_value nth_value p1m time_grain from_dttm to_dttm filter_values gettype slotted now today age tuple endif`.split(
      /\s+/,
    ),
  );
  const arr = [...refs].filter((r) => !kw.has(r.toLowerCase()));
  return { refs: arr, unresolved: arr.filter((r) => !columns.has(r.toLowerCase())) };
}

function main() {
  ensureDir("reports/phase-01-4");
  const snapshotId = readJson<any>(join(SNAPSHOT_ROOT, "manifest.json"))?.snapshot_id ?? "local-output-baseline";

  const compact: any[] = readJson<any>(join(SNAPSHOT_ROOT, "datasets.compact.json"))?.docs ?? [];
  if (!compact.length) throw new Error("datasets.compact.json не найден — сначала выполните phase 1.4.2 sync");

  // Извлечённые метаданные (columns/metrics) для 12 + новых API datasets
  const metaById = new Map<string, any>();
  const exDir = join(EXTRACT_ROOT, "datasets");
  if (existsSync(exDir)) {
    for (const f of readdirSync(exDir).filter((x) => x.endsWith(".json") && x !== "index.json")) {
      const doc = readJson<any>(join(exDir, f));
      if (doc?.metadata?.id != null) metaById.set(String(doc.metadata.id), doc.metadata);
    }
  }

  const sqlInv: unknown[][] = [[
    "dataset_id", "name", "dialect", "dialect_evidence", "parse_status", "issues", "cte_count", "nested_select_count",
    "physical_table_count", "cte_ref_count", "unknown_source_count", "join_count", "where_count", "group_by_count",
    "aggregate_count", "case_count", "cast_count", "datetime_expr_count", "window_count", "union_count",
    "select_item_count", "jinja_params", "sql_len", "content_hash", "parser_version", "snapshot_id",
  ]];
  const tableInv: unknown[][] = [["dataset_id", "dataset_name", "table_name", "schema", "alias", "kind", "join_type", "occurrences", "on_condition", "snapshot_id"]];
  const columnInv: unknown[][] = [["dataset_id", "dataset_name", "column_name", "type", "is_dttm", "source", "resolved", "note", "snapshot_id"]];
  const metricInv: unknown[][] = [["dataset_id", "dataset_name", "metric_name", "expression", "aggregation", "referenced_columns", "unresolved_refs", "validity", "snapshot_id"]];
  const joinInv: unknown[][] = [["dataset_id", "dataset_name", "source_name", "schema", "alias", "join_type", "on_condition", "snapshot_id"]];
  const issueInv: unknown[][] = [["dataset_id", "dataset_name", "parse_status", "issue", "severity", "snapshot_id"]];

  let parsedCount = 0;
  let errorCount = 0;
  const statusCounts: Record<string, number> = {};
  const dialectCounts: Record<string, number> = {};

  for (const d of compact) {
    const id = String(d.id);
    const sql = String(d.sql ?? "");
    if (!sql.trim()) continue;
    let parsed: ParsedSqlExtended;
    try {
      parsed = parseSqlExtended(sql);
    } catch (e: any) {
      errorCount++;
      statusCounts.ERROR = (statusCounts.ERROR ?? 0) + 1;
      issueInv.push([d.id, d.name, "ERROR", String(e?.message ?? e), "ERROR", snapshotId]);
      continue;
    }
    parsedCount++;
    statusCounts[parsed.parse_status] = (statusCounts[parsed.parse_status] ?? 0) + 1;
    dialectCounts[parsed.dialect] = (dialectCounts[parsed.dialect] ?? 0) + 1;

    const sources = normalizeSources(parsed);
    const physical = sources.filter((s) => s.kind === "table");
    const cteRefs = sources.filter((s) => s.kind === "cte");
    const unknown = sources.filter((s) => s.kind === "unknown" || s.kind === "subquery");

    sqlInv.push([
      d.id, d.name, parsed.dialect, parsed.dialect_evidence.join(";"), parsed.parse_status, parsed.issues.join("; "),
      parsed.ctes.length, parsed.nested_select_count, physical.length, cteRefs.length, unknown.length,
      parsed.joins.length, parsed.whereClauses.length, parsed.groupBy.length, parsed.aggregates.length,
      parsed.case_count, parsed.casts.length, parsed.date_time_expressions.length, parsed.windowExpressions.length,
      parsed.unionCount, parsed.selectItemCount, parsed.jinja_params.join(";"), sql.length, sha256(sql), PARSER_VERSION, snapshotId,
    ]);

    for (const s of sources) {
      tableInv.push([d.id, d.name, s.name, s.schema, s.alias, s.kind, s.join_type, s.occurrences, s.on, snapshotId]);
    }
    for (const j of parsed.joins) {
      joinInv.push([d.id, d.name, j.name, j.schema, j.alias, j.join_type, j.on, snapshotId]);
    }

    const meta = metaById.get(id);
    const columns: any[] = meta?.columns ?? [];
    const colSet = new Set(columns.map((c: any) => String(c.column_name ?? "").toLowerCase()));
    if (columns.length) {
      for (const c of columns) {
        columnInv.push([d.id, d.name, c.column_name, c.type, c.is_dttm, "DATASET_METADATA", true, "", snapshotId]);
      }
    } else {
      columnInv.push([d.id, d.name, "", "", "", "DATASET_METADATA", false, "columns недоступны без detail", snapshotId]);
    }
    // SQL-идентификаторы, не разрешённые в columns (для датасетов с метаданными)
    if (columns.length) {
      const seen = new Set<string>();
      for (const item of parsed.selectItems) {
        for (const m of item.expression.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
          const w = m[0].toLowerCase();
          if (seen.has(w) || colSet.has(w)) continue;
          if (/^(select|from|where|group|order|case|when|then|else|end|as|count|sum|avg|min|max|coalesce|nullif|if|cast|round|abs)$/.test(w)) continue;
          seen.add(w);
          columnInv.push([d.id, d.name, m[0], "", "", "SQL_REFERENCE", false, "не найден в columns", snapshotId]);
        }
      }
    }

    if (meta?.metrics?.length) {
      for (const m of meta.metrics) {
        const { refs, unresolved } = metricRefs(String(m.expression ?? ""), colSet);
        metricInv.push([
          d.id, d.name, m.metric_name, m.expression,
          /(count|sum|avg|min|max|uniqexact|countif|sumif|avgif|quantileexact)/i.test(String(m.expression ?? "")) ? "AGGREGATE_OR_EXPR" : "EXPR",
          refs.join(";"), unresolved.join(";"), unresolved.length ? "PARTIAL_UNRESOLVED_REFS" : "PARSED", snapshotId,
        ]);
      }
    }

    for (const issue of parsed.issues) {
      issueInv.push([d.id, d.name, parsed.parse_status, issue, "WARN", snapshotId]);
    }
  }

  writeAtomic(joinReport("05_sql_inventory.csv"), csv(sqlInv));
  writeAtomic(joinReport("05_table_inventory.csv"), csv(tableInv));
  writeAtomic(joinReport("05_column_inventory.csv"), csv(columnInv));
  writeAtomic(joinReport("05_metric_inventory.csv"), csv(metricInv));
  writeAtomic(joinReport("05_join_inventory.csv"), csv(joinInv));
  writeAtomic(joinReport("05_sql_parse_issues.csv"), csv(issueInv));
  writeJsonAtomic(joinReport("05_sql_parse_index.json"), {
    generated_at: nowIso(),
    snapshot_id: snapshotId,
    parser_version: PARSER_VERSION,
    datasets_with_sql: parsedCount,
    errors: errorCount,
    status_counts: statusCounts,
    dialect_counts: dialectCounts,
    rows: { sql: sqlInv.length - 1, tables: tableInv.length - 1, columns: columnInv.length - 1, metrics: metricInv.length - 1, joins: joinInv.length - 1, issues: issueInv.length - 1 },
  });

  const md: string[] = [];
  md.push("# Фаза 1.4.5 — Расширенный SQL-парсинг");
  md.push("");
  md.push(`Сгенерировано: ${nowIso()}`);
  md.push(`Snapshot: \`${snapshotId}\`; parser: \`${PARSER_VERSION}\`.`);
  md.push("");
  md.push(`Разобрано SQL: **${parsedCount}** (ошибок: ${errorCount}).`);
  md.push("");
  md.push("## Статусы парсинга");
  md.push("");
  md.push("| Статус | Кол-во |");
  md.push("|---|---:|");
  for (const [k, v] of Object.entries(statusCounts)) md.push(`| ${k} | ${v} |`);
  md.push("");
  md.push("## Диалекты (только с доказательством)");
  md.push("");
  md.push("| Диалект | Кол-во |");
  md.push("|---|---:|");
  for (const [k, v] of Object.entries(dialectCounts)) md.push(`| ${k} | ${v} |`);
  md.push("");
  md.push("## Объёмы");
  md.push("");
  md.push("| Артефакт | Строк |");
  md.push("|---|---:|");
  md.push(`| 05_sql_inventory.csv | ${sqlInv.length - 1} |`);
  md.push(`| 05_table_inventory.csv | ${tableInv.length - 1} |`);
  md.push(`| 05_column_inventory.csv | ${columnInv.length - 1} |`);
  md.push(`| 05_metric_inventory.csv | ${metricInv.length - 1} |`);
  md.push(`| 05_join_inventory.csv | ${joinInv.length - 1} |`);
  md.push(`| 05_sql_parse_issues.csv | ${issueInv.length - 1} |`);
  md.push("");
  md.push("Правила: CTE и физические таблицы различаются; aliases не считаются полями; JOIN не считается FK;");
  md.push("неизвестные конструкции помечаются, а не отбрасываются; SQL не исполняется; Jinja не разрешается выполнением.");
  md.push("");
  writeAtomic(joinReport("05_sql_parsing_report.md"), md.join("\n"));

  console.log(JSON.stringify({ parsed: parsedCount, errors: errorCount, status_counts: statusCounts, dialect_counts: dialectCounts, rows: { tables: tableInv.length - 1, columns: columnInv.length - 1, metrics: metricInv.length - 1, joins: joinInv.length - 1, issues: issueInv.length - 1 } }, null, 2));
}

main();
