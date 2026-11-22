/**
 * Этап 1.6 — расширенный анализ локальных метаданных (без API):
 *  1) полная эффективная схема mart_mixed.darkstore_time_sheet из SQL 3466;
 *  2) поиск кандидатов готовности/очереди/пула/назначения/оплаты в 12 утверждённых датасетах.
 * Read-only, использует локальные артефакты 1.4/1.6.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPORTS = "reports/phase-01-6";
const APPROVED = [4732, 5247, 5399, 5797, 7006, 7024, 7027, 7119, 7293, 7465, 7473, 7775];
const EXT = "data/extracted/phase-01-4/datasets";

const CATEGORIES: Record<string, RegExp> = {
  readiness: /ready|готов|deadline|sbor|collect|printed|set_cell|status_10/i,
  queue: /queue|wait|arriv|очеред|ожидан|waiting_area/i,
  pool_trip: /pool|batch|group|trip|parcel|ходк|route/i,
  assignment: /assign|pickup|pick_up|courier_id|id_courier|delivery_job/i,
  pay: /profit|payout|payment|stake|tariff|тариф|начисл|sum_paid|income/i,
  shift: /shift|смен/i,
  zone: /zone|cluster|куст|area_tt|район|district/i,
};

function write(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
}
function readJson(p: string): any | null {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  } catch {
    return null;
  }
}

function main() {
  const out: any = { generated_at: new Date().toISOString(), darkstore_time_sheet_schema: [], approved_candidates: [], errors: [] };

  // 1) эффективная схема витрины из SQL 3466
  const sqlPath = join(REPORTS, "evidence", "sql_full", "3466.sql");
  if (existsSync(sqlPath)) {
    const sql = readFileSync(sqlPath, "utf8");
    const cols = new Set<string>();
    for (const m of sql.matchAll(/\bdt\.([a-zA-Z_][\w]*)/g)) cols.add(m[1]);
    out.darkstore_time_sheet_schema = [...cols].sort();
    out.darkstore_time_sheet_alias = "dt";
  } else {
    out.errors.push("sql_full/3466.sql отсутствует — сначала выполните sql-forensics.ts");
  }

  // 2) кандидаты в 12 утверждённых датасетах (локальные метаданные 1.4)
  for (const id of APPROVED) {
    const doc = readJson(join(EXT, `${id}.json`));
    if (!doc?.metadata) {
      out.errors.push(`metadata ${id} отсутствует`);
      continue;
    }
    const m = doc.metadata;
    const cols: string[] = (m.columns ?? []).map((c: any) => String(c.column_name));
    const found: Record<string, string[]> = {};
    for (const [cat, re] of Object.entries(CATEGORIES)) {
      const hits = cols.filter((c) => re.test(c));
      if (hits.length) found[cat] = hits;
    }
    out.approved_candidates.push({ dataset_id: id, table: m.table_name, database: m.database, kind: m.kind, columns: cols.length, candidates: found });
  }

  write(join(REPORTS, "evidence", "extended_metadata_scan.json"), JSON.stringify(out, null, 2));

  const lines: string[] = ["# Расширенный анализ метаданных", "", `Сгенерировано: ${out.generated_at}`, ""];
  lines.push(`## Эффективная схема mart_mixed.darkstore_time_sheet (${out.darkstore_time_sheet_schema.length} колонок)`);
  lines.push("");
  lines.push(out.darkstore_time_sheet_schema.map((c: string) => `\`${c}\``).join(", "));
  lines.push("");
  lines.push("## Кандидаты в 12 утверждённых датасетах");
  lines.push("");
  for (const d of out.approved_candidates) {
    lines.push(`### ${d.dataset_id} — ${d.table} (${d.database})`);
    lines.push("");
    for (const [cat, hits] of Object.entries(d.candidates as Record<string, string[]>)) {
      lines.push(`- **${cat}**: ${(hits as string[]).slice(0, 25).join(", ")}`);
    }
    lines.push("");
  }
  if (out.errors.length) {
    lines.push("## Ошибки");
    lines.push("");
    for (const e of out.errors) lines.push(`- ${e}`);
  }
  write(join(REPORTS, "evidence", "extended_metadata_scan.md"), lines.join("\n"));

  console.log(JSON.stringify({
    darkstore_cols: out.darkstore_time_sheet_schema.length,
    approved: out.approved_candidates.map((d: any) => ({ id: d.dataset_id, table: d.table, readiness: (d.candidates.readiness ?? []).length, queue: (d.candidates.queue ?? []).length, pool: (d.candidates.pool_trip ?? []).length, assignment: (d.candidates.assignment ?? []).length, pay: (d.candidates.pay ?? []).length })),
    errors: out.errors,
  }, null, 2));
}

main();
