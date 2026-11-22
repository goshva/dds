/** Этап 1.7 — forensic-проверка ключевых датасетов. Read-only. */
import { loadCatalog } from "./load";

const cat = loadCatalog();
const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();

function snippet(sql: string | null, token: string, before = 120, after = 220): string | null {
  if (!sql) return null;
  const i = lower(sql).indexOf(token.toLowerCase());
  if (i < 0) return null;
  return sql.slice(Math.max(0, i - before), i + after).replace(/\s+/g, " ").trim();
}

const checks: Array<{ id: number; tokens: string[] }> = [
  { id: 7802, tokens: ["row_number", "useless_minutes", "agile_mart_operational.shifts", "agile_mart_operational.pools", "agile_mart_operational.courier_queue", "wait_minutes"] },
  { id: 3466, tokens: ["time_ready", "time_ready_plan", "ready"] },
  { id: 7021, tokens: ["shift_type", "id_courier", "timesheetfact"] },
  { id: 5939, tokens: ["date_for_mentor", "mentorid"] },
  { id: 7473, tokens: ["shift_1_profit", "shift_5_profit", "shift_N_profit"] },
  { id: 2339, tokens: ["webcall_log_ui_period", "date_supply", "date_delivery"] },
  { id: 6863, tokens: ["zone", "cluster"] },
  { id: 7712, tokens: ["photo_control_shift_attempt", "attempt_dt"] },
];

for (const c of checks) {
  const d = cat.datasetsDetailById.get(c.id);
  if (!d) { console.log(`\n### ${c.id} — NO DETAIL`); continue; }
  const inv = cat.inventoryById.get(c.id);
  console.log(`\n### ${c.id} ${d.name} (${d.schema}) prio=${inv?.priority} cols=${d.columns.length} metrics=${d.metrics.length} sqlLen=${(d.sql ?? "").length}`);
  for (const t of c.tokens) {
    const s = snippet(d.sql, t);
    const inSql = lower(d.sql).includes(t.toLowerCase());
    const colNames = d.columns.map((x) => x.name).filter((n) => n.toLowerCase().includes(t.toLowerCase().replace(/[^a-z0-9_]/g, "")));
    console.log(`  [${t}] sql=${inSql ? "YES" : "no"} cols=${colNames.slice(0, 4).join(",") || "-"}`);
    if (s) console.log(`      ...${s.slice(0, 300)}`);
  }
  console.log(`  columns: ${d.columns.map((x) => x.name).slice(0, 40).join(", ")}`);
}
