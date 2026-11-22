/** Проверка: все ли колонки из EVIDENCE_COLUMNS реально существуют в деталях датасетов. */
import { EVIDENCE_COLUMNS } from "./evidence";
import { loadCatalog } from "./load";

const cat = loadCatalog();
const missing: string[] = [];
for (const [id, col] of EVIDENCE_COLUMNS) {
  const ds = cat.datasetsDetailById.get(id);
  if (!ds) { missing.push(`${id}::${col} :: NO_DATASET`); continue; }
  if (!ds.columns.some((c) => c.name === col)) missing.push(`${id}::${col} :: NO_COLUMN`);
}
console.log("pairs", EVIDENCE_COLUMNS.length, "missing", missing.length);
for (const m of missing) console.log(m);
