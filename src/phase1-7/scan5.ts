/** Этап 1.7 — колонки ключевых датасетов для привязки атрибутов. */
import { loadCatalog } from "./load";

const cat = loadCatalog();
const ids = [4732, 3466, 7006, 7027, 7119, 7024, 7712, 7775, 5247, 5797, 5939, 7802, 7473, 6863, 7293, 659, 5399, 7465, 3035, 2339, 7713, 7763];
for (const id of ids) {
  const d = cat.datasetsDetailById.get(id);
  if (!d) { console.log(`\n### ${id} — NO DETAIL`); continue; }
  const cols = d.columns.map((c) => c.name);
  console.log(`\n### ${id} ${d.name} [${d.schema}] main_dttm=${d.main_dttm_col} cols=${cols.length}`);
  console.log(cols.join(", "));
}
