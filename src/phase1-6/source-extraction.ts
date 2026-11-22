/**
 * Этап 1.6 — извлечение физических источников из обезличенного SQL датасетов
 * и чтение доступной истории запросов Superset (read-only).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
function readJson(p: string): any | null {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

const CTE_RE = /(?:^|,|\()\s*([a-zA-Z_][\w]*)\s+as\s*\(/gi;

function analyze(sql: string) {
  const ctes = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = CTE_RE.exec(sql))) ctes.add(m[1].toLowerCase());
  const refs: Array<{ name: string; count: number; kind: "physical" | "cte" | "unknown" }> = [];
  const counts = new Map<string, number>();
  const re = /\b(?:from|join)\s+([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)?(?:\.[a-zA-Z_][\w]*)?)/gi;
  while ((m = re.exec(sql))) {
    const name = m[1];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const [name, count] of counts) {
    const lower = name.toLowerCase();
    const kind = ctes.has(lower) ? "cte" : name.includes(".") ? "physical" : "unknown";
    refs.push({ name, count, kind });
  }
  return { ctes: [...ctes], refs: refs.sort((a, b) => b.count - a.count) };
}

async function main() {
  const out: any = { generated_at: new Date().toISOString(), datasets: [], query_history: null, errors: [] };

  for (const id of TARGETS) {
    const meta = readJson(join(REPORTS, "evidence", "dataset_metadata", `${id}.json`));
    const sql = meta?.sql_redacted ?? "";
    const a = sql ? analyze(sql) : { ctes: [], refs: [] };
    const physical = (meta?.sql_sources_physical ?? a.refs.filter((r) => r.kind === "physical").map((r) => r.name)) as string[];
    const unknown = (meta?.sql_sources_unknown ?? a.refs.filter((r) => r.kind === "unknown").map((r) => r.name)) as string[];
    out.datasets.push({
      dataset_id: id,
      table_name: meta?.table_name ?? null,
      database: meta?.database ?? null,
      sql_available: Boolean(sql),
      sql_len: meta?.sql_len ?? null,
      ctes: (meta?.sql_ctes ?? a.ctes).slice(0, 40),
      physical_sources: physical.map((name) => ({ name, count: 0, kind: "physical" })),
      unknown_refs: unknown.map((name) => ({ name, count: 0, kind: "unknown" })),
    });
  }

  // история запросов Superset (доступна, count=17)
  const cfg = loadConfig();
  const client = new SqlLabClient(cfg);
  await client.login();
  const qh = await client.get(`/api/v1/query/?q=${encodeURIComponent("(page:0,page_size:50)")}`);
  if (qh.ok && Array.isArray(qh.body?.result)) {
    out.query_history = qh.body.result.map((r: any) => {
      const sql = typeof r.sql === "string" ? redactSql(r.sql) : "";
      const pii = scanPii16(sql);
      return {
        id: r.id,
        status: r.status ?? null,
        rows: r.rows ?? null,
        database_id: r.database?.id ?? null,
        schema: r.schema ?? null,
        executed_on: r.start_time ?? r.changed_on ?? null,
        sql_len: typeof r.sql === "string" ? r.sql.length : 0,
        sql_redacted: pii.length ? null : sql.slice(0, 1500),
      };
    });
  } else {
    out.errors.push(`query history HTTP ${qh.status}`);
  }

  write(join(REPORTS, "evidence", "source_tables.json"), JSON.stringify(out, null, 2));

  const md: string[] = ["# Источники датасетов (из обезличенного SQL)", "", `Сгенерировано: ${out.generated_at}`, ""];
  for (const d of out.datasets) {
    md.push(`## ${d.dataset_id} — ${d.table_name ?? "—"} (${d.database?.name ?? "—"})`);
    md.push("");
    md.push(`- CTE: ${d.ctes.slice(0, 20).join(", ") || "нет"}`);
    md.push(`- физические источники: ${d.physical_sources.map((r: any) => `${r.name} (${r.count})`).join(", ") || "не найдены"}`);
    md.push(`- неклассифицированные ссылки: ${d.unknown_refs.slice(0, 15).map((r: any) => r.name).join(", ") || "нет"}`);
    md.push("");
  }
  md.push(`## История запросов Superset: ${out.query_history?.length ?? 0} записей`);
  md.push("");
  write(join(REPORTS, "evidence", "source_tables.md"), md.join("\n"));

  console.log(JSON.stringify({ datasets: out.datasets.map((d: any) => ({ id: d.dataset_id, physical: d.physical_sources.map((r: any) => r.name) })), query_history: out.query_history?.length ?? 0, errors: out.errors }, null, 2));
}

main();
