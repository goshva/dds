// Coverage audit of the local metadata catalog: which datasets have columns/metrics rows.
import { readFileSync } from "node:fs";

function readCsv(rel: string): Array<Record<string, string>> {
  const text = readFileSync(rel, "utf8").replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.filter((r) => r.some((v) => v.length)).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = r[i] ?? ""; });
    return o;
  });
}

const inv = JSON.parse(readFileSync("reports/phase-01-6-2/datasets_inventory.json", "utf8").replace(/^\uFEFF/, ""));
const datasets: any[] = Array.isArray(inv) ? inv : inv.datasets;

const colsByDs = new Map<number, number>();
for (const r of readCsv("reports/phase-01-6-2/dataset_columns.csv")) {
  const id = Number(r.dataset_id);
  if (Number.isFinite(id)) colsByDs.set(id, (colsByDs.get(id) ?? 0) + 1);
}
const metByDs = new Map<number, number>();
for (const r of readCsv("reports/phase-01-6-2/dataset_metrics.csv")) {
  const id = Number(r.dataset_id);
  if (Number.isFinite(id)) metByDs.set(id, (metByDs.get(id) ?? 0) + 1);
}

let claimed = 0, actual = 0, mismatched = 0;
const examples: any[] = [];
for (const d of datasets) {
  const id = Number(d.dataset_id);
  const c = colsByDs.get(id) ?? 0;
  if (d.columns_count) claimed++;
  if (c) actual++;
  if (Number(d.columns_count ?? 0) !== c) {
    mismatched++;
    if (examples.length < 15) examples.push({ id, name: d.name, inventory_columns_count: d.columns_count, csv_rows: c, detail_loaded: d.detail_loaded });
  }
}
console.log("inventory rows:", datasets.length);
console.log("datasets with columns_count>0 in inventory:", claimed);
console.log("datasets with rows in dataset_columns.csv:", actual);
console.log("datasets where inventory count != csv rows:", mismatched);
console.log("examples:", JSON.stringify(examples, null, 1));
console.log("total column rows:", [...colsByDs.values()].reduce((a, b) => a + b, 0));
console.log("total metric rows:", [...metByDs.values()].reduce((a, b) => a + b, 0));

// how many datasets have neither
const empty = datasets.filter((d) => !(colsByDs.get(Number(d.dataset_id)) ?? 0));
console.log("datasets with zero column rows:", empty.length, "of", datasets.length);
const byPriority: Record<string, number> = {};
for (const d of empty) byPriority[String(d.priority)] = (byPriority[String(d.priority)] ?? 0) + 1;
console.log("zero-column datasets by priority:", JSON.stringify(byPriority));
