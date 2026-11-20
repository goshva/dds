/**
 * Этап 1.1, задача 4 — уточнение KPI по hr_couriers (5797) и all_couriers_list (7775):
 * полный список aliases из SQL.
 */
import { Database } from "bun:sqlite";
const db = new Database("data/catalog.sqlite", { readonly: true });
for (const id of ["5797","7775","7465","5247","5399"]) {
  const row = db.query(`SELECT payload_json FROM objects WHERE object_type='dataset' AND object_id=?`).get(id) as any;
  const sql = JSON.parse(row.payload_json).sql ?? "";
  const aliases = [...new Set([...sql.matchAll(/\bas\s+([a-zA-Z_][a-zA-Z0-9_"'.]*)/gi)].map(m => m[1].replace(/"/g,"")))];
  console.log("===", id, "aliases (" + aliases.length + "):", aliases.join(", "));
}
