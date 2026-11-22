/** Поиск датасетов по финансовым, наставническим и geo-терминам. */
import { findDatasets, loadCatalog } from "./load";

const cat = loadCatalog();
const groups: Array<{ label: string; terms: string[] }> = [
  { label: "finance", terms: ["начислен", "accrual", "выплат", "payout", "зарплат", "salary", "earning", "тариф", "tariff", "оплат"] },
  { label: "mentorship", terms: ["mentor", "наставник", "куратор", "curator", "trainee", "стажер", "стажёр", "обучен"] },
  { label: "zone", terms: ["zone", "зона", "geozone", "geo_zone", "район", "district"] },
  { label: "sla", terms: ["sla", "срок доставки", "готовност", "ready"] },
  { label: "queue", terms: ["queue", "очеред", "ожидан", "wait"] },
];

for (const g of groups) {
  const hits = findDatasets(cat, g.terms, { maxHits: 14 });
  console.log(`\n### ${g.label}: ${hits.length}`);
  for (const h of hits) {
    console.log(`  ${h.id} | ${h.name} | prio=${h.priority} | in=${h.matchedIn.join(",")} | cols=${h.columnMatches.slice(0, 6).join(",")}`);
  }
}
