/** Этап 1.7 — точечная разведка: физические таблицы, ключевые датасеты, колонки. Read-only. */
import { findColumns, loadCatalog } from "./load";

const cat = loadCatalog();
const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();

const tables = [
  "agile_mart_operational.shifts",
  "agile_mart_operational.pools",
  "agile_mart_operational.courier_queue",
  "agile_mart_operational.photo_control_shift_attempt",
  "mart_mixed.darkstore_time_sheet",
  "mart_mixed.darkstore_time",
  "ods.timesheetfact",
  "loyalty_srv03.dbo.webcall_log_ui_period",
  "reports.dbo.ksa_time_vw",
  "reports.dbo.darkstore_time_vw",
  "loyalty03..orders_header",
];

console.log("=== PHYSICAL TABLE SEARCH ===");
for (const t of tables) {
  const hits = cat.datasetsList.filter((d) => lower(d.sql).includes(t));
  console.log(`\n${t}: ${hits.length} datasets`);
  for (const h of hits.slice(0, 10)) {
    const inv = cat.inventoryById.get(Number(h.id));
    console.log(`  ${h.id} | ${h.name} | ${h.schema} | prio=${inv?.priority} | detail=${inv?.detail_loaded}`);
  }
}

console.log("\n=== KEY DATASETS ===");
const ids = [3466, 4732, 5247, 5399, 5797, 7006, 7021, 7024, 7027, 7119, 7293, 7465, 7473, 7775, 7802, 5939, 659, 2637, 7712, 7713, 6831, 6836, 5987, 6679, 7250, 6863];
for (const id of ids) {
  const d = cat.datasetsDetailById.get(id);
  const inv = cat.inventoryById.get(id);
  if (!d) {
    console.log(`  ${id} — NO DETAIL (inv prio=${inv?.priority ?? "?"}, name=${inv?.name ?? "?"})`);
    continue;
  }
  const tablesInSql = tables.filter((t) => lower(d.sql).includes(t));
  console.log(`  ${id} | ${d.name} | ${d.schema} | prio=${inv?.priority} | cols=${d.columns.length} | metrics=${d.metrics.length} | main_dttm=${d.main_dttm_col} | tables=${tablesInSql.join(",") || "-"}`);
}

console.log("\n=== COLUMN KEY SEARCH ===");
const colGroups: Array<{ label: string; res: RegExp[] }> = [
  { label: "shift keys", res: [/^id_shift$/i, /^shift_start$/i, /^shift_finish$/i, /^id_courier$/i, /^id_pool$/i] },
  { label: "queue keys", res: [/queue_in/i, /queue_out/i, /^has_order$/i, /first_delivery/i, /^cluster_id$/i] },
  { label: "arrival", res: [/^arrival_time$/i, /^arrival/i, /^arrived/i] },
  { label: "order status", res: [/^order_status$/i, /^status_name$/i, /^delivery_status$/i, /^status$/i] },
  { label: "finance", res: [/accrual/i, /payout/i, /^sum_order$/i, /^sum_delivered$/i, /^profit/i] },
  { label: "zone", res: [/^zone/i, /^delivery_zone/i, /^cluster/i, /^region_tt$/i] },
  { label: "mentorship", res: [/mentor/i, /trainee/i, /^curator/i] },
];
for (const g of colGroups) {
  const cols = findColumns(cat, g.res, 20);
  console.log(`\n--- ${g.label} (${cols.length}) ---`);
  for (const c of cols) console.log(`  ${c.dataset_id} ${c.dataset_name} :: ${c.column} (${c.type}) prio=${c.priority}`);
}
