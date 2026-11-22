/**
 * Этап 1.7 — разовый поиск по каталогу Superset для привязки сущностей к датасетам.
 * Только чтение. Не входит в пайплайн, используется как рабочий инструмент.
 */
import { loadCatalog, findDatasets, findColumns } from "./load";

const cat = loadCatalog();

const queries: Array<{ key: string; terms: string[] }> = [
  { key: "order", terms: ["order", "заказ", "id_order"] },
  { key: "order_item", terms: ["order_item", "orderitem", "позици", "sku", "товар", "product"] },
  { key: "ready", terms: ["time_ready", "ready", "готов"] },
  { key: "assembly", terms: ["assembly", "sbor", "сборк", "collect"] },
  { key: "darkstore", terms: ["darkstore", "dark_store", "даркстор", "tt"] },
  { key: "zone", terms: ["zone", "зона", "geozone", "zone_cluster"] },
  { key: "address", terms: ["address", "адрес", "geo"] },
  { key: "route", terms: ["route", "маршрут", "distance"] },
  { key: "trip", terms: ["trip", "ходк", "id_pool", "pool"] },
  { key: "queue", terms: ["queue", "очеред", "courier_queue"] },
  { key: "shift", terms: ["shift", "смен", "timesheet"] },
  { key: "slot", terms: ["slot", "слот"] },
  { key: "delivery", terms: ["delivery", "достав", "date_delivered"] },
  { key: "cancel", terms: ["cancel", "отмен", "return", "возврат"] },
  { key: "tariff", terms: ["tariff", "тариф"] },
  { key: "accrual", terms: ["accrual", "начислен", "payout", "выплат"] },
  { key: "mentor", terms: ["mentor", "curator", "куратор", "наставник"] },
  { key: "event", terms: ["event", "событи"] },
  { key: "sla", terms: ["sla"] },
  { key: "owner", terms: ["owner", "владел"] },
];

for (const q of queries) {
  const hits = findDatasets(cat, q.terms, { maxHits: 12, includeColumns: true });
  console.log(`\n### ${q.key} (${hits.length})`);
  for (const h of hits) {
    console.log(
      `${h.id} | ${h.priority ?? "-"} | ${h.schema ?? "-"} | ${h.name} | in=${h.matchedIn.join(",")} | cols=${h.columnMatches.slice(0, 4).join(",")}`,
    );
  }
}

console.log("\n### columns: time_ready / ready");
for (const c of findColumns(cat, [/time_ready/i, /^ready/i, /ready_/i], 40)) {
  console.log(`${c.dataset_id} | ${c.dataset_name} | ${c.column} | ${c.type ?? "-"} | ${c.priority ?? "-"}`);
}
