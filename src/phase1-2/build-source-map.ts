/**
 * Этап 1.2, задача №2 — карта источников и связей между 12 датасетами.
 *
 * Read-only: читает output/phase-01-2/audit.json и reports/phase-01-2/dataset_fields_inventory.csv.
 * Пишет:
 *  - reports/phase-01-2/dataset_join_map.csv
 *  - reports/phase-01-2/dataset_join_map.mmd
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const AUDIT = "output/phase-01-2/audit.json";
const FIELDS = "reports/phase-01-2/dataset_fields_inventory.csv";
const OUT_DIR = "reports/phase-01-2";

type KeyEntry = {
  dataset_id: number;
  table_name: string;
  field: string;
  entity: string;
  type: string | null;
  confidence: string;
  evidence: string;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
      continue;
    }
    if (c === '"') q = true;
    else if (c === ",") {
      row.push(f);
      f = "";
    } else if (c === "\n") {
      row.push(f);
      rows.push(row);
      row = [];
      f = "";
    } else if (c !== "\r") f += c;
  }
  if (f.length || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1);
}

function csvCell(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const audit = JSON.parse(readFileSync(AUDIT, "utf8"));
  const fieldRows = parseCsv(readFileSync(FIELDS, "utf8"));
  const fh = fieldRows[0];
  const fIdx = (n: string) => fh.indexOf(n);
  const typeByField = new Map<string, string>();
  for (const r of fieldRows.slice(1)) {
    typeByField.set(`${r[fIdx("dataset_id")]}|${r[fIdx("column_name")]}`, r[fIdx("type")] ?? "");
  }

  const entries: KeyEntry[] = [];
  for (const d of audit.datasets) {
    for (const k of d.notes?.keys ?? []) {
      entries.push({
        dataset_id: d.dataset_id,
        table_name: d.table_name,
        field: k.field,
        entity: k.entity,
        type: k.type ?? typeByField.get(`${d.dataset_id}|${k.field}`) ?? null,
        confidence: k.confidence,
        evidence: k.evidence,
      });
    }
  }

  const joinable = new Set([
    "order",
    "order_group",
    "order_delivery",
    "courier",
    "shop",
    "pool",
    "pool_computed",
    "cluster",
    "zone",
    "hr_event",
    "route",
    "delivery_job",
  ]);

  const rows: unknown[][] = [
    ["source_dataset_id", "source_table", "source_field", "target_dataset_id", "target_table", "target_field", "join_type", "evidence", "confidence", "risks"],
  ];
  const edges = new Map<string, { a: KeyEntry; b: KeyEntry; confidence: string; risks: string[] }>();

  const byEntity = new Map<string, KeyEntry[]>();
  for (const e of entries) {
    if (!joinable.has(e.entity)) continue;
    if (!byEntity.has(e.entity)) byEntity.set(e.entity, []);
    byEntity.get(e.entity)!.push(e);
  }

  const directJoinFields = new Map<string, Set<string>>();
  for (const d of audit.datasets) {
    const s = new Set<string>();
    for (const j of d.parsed.joins ?? []) {
      const on = String(j.on ?? "").toLowerCase();
      for (const m of on.matchAll(/([a-z_][a-z0-9_]*)\s*=\s*([a-z_][a-z0-9_]*)/g)) {
        s.add(`${d.dataset_id}|${m[1]}`);
        s.add(`${d.dataset_id}|${m[2]}`);
      }
    }
    directJoinFields.set(String(d.dataset_id), s);
  }

  for (const [entity, list] of byEntity) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.dataset_id === b.dataset_id) continue;
        const sameName = a.field.toLowerCase() === b.field.toLowerCase();
        const sameType = (a.type ?? "") === (b.type ?? "") || !a.type || !b.type;
        const aDirect = directJoinFields.get(String(a.dataset_id))?.has(`${a.dataset_id}|${a.field.toLowerCase()}`) ?? false;
        const bDirect = directJoinFields.get(String(b.dataset_id))?.has(`${b.dataset_id}|${b.field.toLowerCase()}`) ?? false;
        let confidence = "UNKNOWN";
        if (sameName && sameType && (aDirect || bDirect)) confidence = "VERIFIED";
        else if (sameName && sameType) confidence = "PROBABLE";
        else if (sameName) confidence = "PARTIAL";
        const risks: string[] = [];
        if (!sameName) risks.push(`разные имена полей: ${a.field} vs ${b.field} — нужен mapping`);
        if (!sameType) risks.push(`типы различаются: ${a.type ?? "?"} vs ${b.type ?? "?"}`);
        if (entity === "order" || entity === "courier" || entity === "shop") {
          risks.push("возможна cardinality one-to-many; проверять размножение строк при JOIN");
        }
        const key = `${Math.min(a.dataset_id, b.dataset_id)}|${Math.max(a.dataset_id, b.dataset_id)}|${entity}`;
        edges.set(key, { a, b, confidence, risks });
      }
    }
  }

  for (const { a, b, confidence, risks } of edges.values()) {
    rows.push([
      a.dataset_id,
      a.table_name,
      a.field,
      b.dataset_id,
      b.table_name,
      b.field,
      "LEFT JOIN (suggested)",
      `entity=${a.entity}; ${a.evidence}; ${b.evidence}`,
      confidence,
      risks.join("; "),
    ]);
  }

  writeFileSync(join(OUT_DIR, "dataset_join_map.csv"), rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n", { mode: 0o600 });

  // Mermaid
  const mermaid: string[] = [];
  mermaid.push("graph LR");
  for (const d of audit.datasets) {
    mermaid.push(`  D${d.dataset_id}["${d.dataset_id} ${d.table_name}"]`);
  }
  const seen = new Set<string>();
  for (const { a, b, confidence } of edges.values()) {
    const k = `${a.dataset_id}-${b.dataset_id}-${a.entity}`;
    if (seen.has(k)) continue;
    seen.add(k);
    mermaid.push(`  D${a.dataset_id} -- "${a.entity} / ${confidence}" --> D${b.dataset_id}`);
  }
  writeFileSync(join(OUT_DIR, "dataset_join_map.mmd"), mermaid.join("\n") + "\n", { mode: 0o600 });

  console.log(JSON.stringify({ edges: edges.size, key_entries: entries.length, files: ["dataset_join_map.csv", "dataset_join_map.mmd"] }, null, 2));
}

main();
