/**
 * Этап 1.6 — SQL-форензика: полный обезличенный SQL датасетов, определения ключевых колонок
 * и фактическое использование колонок физических источников.
 * Read-only GET. Файлы этапов 1.1–1.5 не изменяются.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config";
import { SqlLabClient, redactSql } from "./client";
import { scanPii16 } from "./pii16";

const REPORTS = "reports/phase-01-6";
const TARGETS = [5939, 7802, 7712, 7021, 3466, 2339];
const KEY_COLUMNS: Record<number, string[]> = {
  5939: ["mentorid", "mentorfio", "mentor_at_date", "mentorid_at_date", "mentor_same_tt_date", "enough_shifts_for_mentor", "mentor_in_five", "trainee_shift_in_five", "trainee_shifts_qty", "shift_rn_trainee", "progul", "stake", "date_for_mentor", "person_code", "employee_code", "event_type"],
  7802: ["id_shift", "id_courier", "rn_shift", "rn_shift_pu", "shift_minutes", "wait_minutes", "assembly_minutes", "delivery_minutes", "useless_minutes"],
  7712: ["shift_opened", "shift_open_time", "attempt_n", "attempt_start", "courier_id", "is_attempt"],
  7021: ["shift_type", "is_night_shift", "hours_on_schedule", "has_timesheet", "date_status_10", "user_code", "id_order"],
  3466: ["time_ready", "time_ready_plan", "date_status_10", "date_collected", "date_order", "date_delivered", "date_delivery_start", "deadline_sbor", "is_canceled", "is_returned_store", "id_order", "id_general", "id_pool", "order_status"],
  2339: ["quantity_batch", "orders_assignment", "object_id", "new_value", "old_value", "date_supply", "status_name"],
};

function write(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
}
function esc(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ***REMOVED***ы использования колонки (±120 символов), обезличенные. */
function columnContexts(sql: string, column: string, limit = 4): string[] {
  const out: string[] = [];
  const re = new RegExp(`(?<![\\w.])${esc(column)}(?![\\w])`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) && out.length < limit) {
    const from = Math.max(0, m.index - 120);
    const to = Math.min(sql.length, m.index + column.length + 120);
    out.push(sql.slice(from, to).replace(/\s+/g, " ").trim());
  }
  return out;
}

/** Колонки физического источника, использованные в SQL через его алиас. */
function sourceColumns(sql: string, source: string): { alias: string | null; columns: string[] }[] {
  const results: { alias: string | null; columns: string[] }[] = [];
  const short = source.split(".").pop() ?? source;
  const re = new RegExp(`\\b(?:from|join)\\s+${esc(source)}(?:\\s+(?:as\\s+)?([a-zA-Z_][\\w]*))?`, "gi");
  const aliases = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const next = (m[1] ?? "").toLowerCase();
    if (next && !["on", "where", "join", "left", "right", "inner", "full", "cross", "group", "order", "having", "union", "limit", "select", "and", "or"].includes(next)) aliases.add(m[1]);
  }
  if (aliases.size === 0) aliases.add(short);
  for (const alias of aliases) {
    const cols = new Set<string>();
    const cre = new RegExp(`\\b${esc(alias)}\\.([a-zA-Z_][\\w]*)`, "g");
    let c: RegExpExecArray | null;
    while ((c = cre.exec(sql))) cols.add(c[1]);
    results.push({ alias, columns: [...cols].sort() });
  }
  return results;
}

async function main() {
  const cfg = loadConfig();
  const client = new SqlLabClient(cfg);
  await client.login();

  const out: any = { generated_at: new Date().toISOString(), datasets: [], pii_blocked_sql: [], errors: [] };

  for (const id of TARGETS) {
    const detail = await client.datasetDetail(id);
    const r = detail?.result;
    if (!r) {
      out.errors.push(`dataset ${id}: detail недоступен`);
      continue;
    }
    const full = redactSql(typeof r.sql === "string" ? r.sql : "");
    const pii = scanPii16(full);
    const meta = out.datasets.length;
    const entry: any = {
      dataset_id: id,
      sql_full_len: full.length,
      pii_in_full_sql: pii.map((p) => p.name),
      sql_stored: false,
      sources: [] as any[],
      key_columns: {} as Record<string, string[]>,
    };

    if (pii.length === 0) {
      write(join(REPORTS, "evidence", "sql_full", `${id}.sql`), full);
      entry.sql_stored = true;
      entry.sql_path = `evidence/sql_full/${id}.sql`;
    } else {
      out.pii_blocked_sql.push({ dataset_id: id, patterns: pii.map((p) => p.name) });
    }

    // источники
    const sources: string[] = Array.isArray(r.__sources) ? r.__sources : [];
    const srcList = new Set<string>();
    for (const m of full.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)+)/gi)) srcList.add(m[1]);
    for (const m of full.matchAll(/\b(?:from|join)\s+"([^"]+)"\.([a-zA-Z_][\w]*)/gi)) srcList.add(`${m[1]}.${m[2]}`);
    const cteNames = new Set<string>();
    for (const m of full.matchAll(/(?:^|,|\()\s*([a-zA-Z_][\w]*)\s+as\s*\(/gi)) cteNames.add(m[1].toLowerCase());
    const physical = [...srcList].filter((s) => !cteNames.has(s.split(".").pop()!.toLowerCase()));
    for (const src of physical) entry.sources.push({ name: src, usage: sourceColumns(full, src) });

    // ключевые колонки
    for (const col of KEY_COLUMNS[id] ?? []) entry.key_columns[col] = columnContexts(full, col);

    entry.sources_count = entry.sources.length;
    out.datasets.push(entry);
    void meta;
  }

  write(join(REPORTS, "evidence", "sql_forensics.json"), JSON.stringify(out, null, 2));

  const lines: string[] = ["# SQL-форензика (обезличенный SQL датасетов)", "", `Сгенерировано: ${out.generated_at}`, ""];
  for (const d of out.datasets) {
    lines.push(`## Dataset ${d.dataset_id} (SQL ${d.sql_full_len} символов, сохранён: ${d.sql_stored ? "да" : "нет"})`);
    lines.push("");
    lines.push("### Использование колонок физических источников");
    lines.push("");
    for (const s of d.sources) {
      lines.push(`- **${s.name}**`);
      for (const u of s.usage) lines.push(`  - alias \`${u.alias}\`: ${u.columns.length ? u.columns.join(", ") : "колонки не найдены"}`);
    }
    lines.push("");
    lines.push("### ***REMOVED***ы ключевых колонок");
    lines.push("");
    for (const [col, ctxs] of Object.entries(d.key_columns as Record<string, string[]>)) {
      lines.push(`- **${col}**: ${(ctxs as string[]).length ? "" : "вхождений нет"}`);
      for (const c of (ctxs as string[]).slice(0, 2)) lines.push(`  - \`${c}\``);
    }
    lines.push("");
  }
  write(join(REPORTS, "evidence", "sql_forensics.md"), lines.join("\n"));

  console.log(JSON.stringify({
    datasets: out.datasets.map((d: any) => ({ id: d.dataset_id, sql_len: d.sql_full_len, stored: d.sql_stored, sources: d.sources.map((s: any) => ({ name: s.name, cols: s.usage.reduce((a: number, u: any) => a + u.columns.length, 0) })) })),
    pii_blocked: out.pii_blocked_sql,
    errors: out.errors,
  }, null, 2));
}

main();
