import { Database } from "bun:sqlite";
const db = new Database("data/catalog.sqlite", { readonly: true });

// Метод A: json_extract + type="CHART" (как в phase1-1-lineage.ts)
const ddRows = db.query(`
  SELECT object_id, json_extract(payload_json, '$.result.position_json') pj
  FROM objects WHERE object_type='dashboard_detail' AND payload_json IS NOT NULL
`).all() as any[];

let withNodes = 0, refs = 0;
const pairs = new Set<string>();
for (const row of ddRows) {
  if (!row.pj) continue;
  let pos: any; try { pos = JSON.parse(row.pj); } catch { continue; }
  let found = false;
  for (const node of Object.values(pos ?? {})) {
    const n = node as any;
    if (n?.type !== "CHART") continue;
    const cid = String(n?.meta?.chartId ?? "");
    if (!cid) continue;
    refs++; found = true; pairs.add(`${row.object_id}|${cid}`);
  }
  if (found) withNodes++;
}

console.log(JSON.stringify({
  ddRows: ddRows.length,
  pjNonNull: ddRows.filter(r => r.pj).length,
  withNodes,
  refs,
  uniquePairs: pairs.size,
}, null, 2));

db.close();
