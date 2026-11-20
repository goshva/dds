/**
 * Этап 1.1, задача 4 (вспомогательный) — инвентарь полей 12 приоритетных датасетов.
 *
 * Источник: output/dataset_details/*.json (полные detail JSON).
 * Назначение: дать KPI-каталогу и final-validation проверяемый список фактических
 * имён columns / metrics / calculated_columns без обращения к SQLite.
 *
 * Выход: reports/phase-01-1/kpi_field_inventory.json
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";

const DETAILS_DIR = "output/dataset_details";
const OUT_DIR = "reports/phase-01-1";
const OUT = join(OUT_DIR, "kpi_field_inventory.json");

const PRIORITY_IDS = [4732, 7119, 7006, 7024, 7027, 7775, 5797, 7465, 7473, 5247, 5399, 7293];

const PII_PATTERNS: RegExp[] = [
  /^inn$/i,
  /^инн$/i,
  /^user_inn$/i,
  /^phone$/i,
  /^телефон$/i,
  /^fio$/i,
  /^фио$/i,
  /^name_courier$/i,
  /^курьер$/i,
];

type DatasetInventory = {
  dataset_id: number;
  table_name: string;
  kind: string;
  database: string | null;
  schema: string | null;
  sql_length: number;
  changed_on: string | null;
  columns: string[];
  metrics: string[];
  calculated_columns: string[];
  pii_columns: string[];
  columns_count: number;
  metrics_count: number;
  calculated_columns_count: number;
};

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const datasets: DatasetInventory[] = [];
  const missing: number[] = [];

  const files = readdirSync(DETAILS_DIR).filter((f) => f.endsWith(".json"));
  for (const id of PRIORITY_IDS) {
    const file = join(DETAILS_DIR, `${id}.json`);
    if (!files.includes(`${id}.json`)) {
      missing.push(id);
      continue;
    }
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const res = raw?.result ?? {};
    const columns = Array.isArray(res.columns)
      ? res.columns.map((c: any) => String(c?.column_name ?? c?.name ?? "")).filter(Boolean)
      : [];
    const metrics = Array.isArray(res.metrics)
      ? res.metrics.map((m: any) => String(m?.metric_name ?? m?.name ?? "")).filter(Boolean)
      : [];
    const calculated = Array.isArray(res.calculated_columns)
      ? res.calculated_columns.map((c: any) => String(c?.column_name ?? c?.name ?? "")).filter(Boolean)
      : [];
    const pii = columns.filter((c: string) => PII_PATTERNS.some((re) => re.test(c)));

    datasets.push({
      dataset_id: Number(res.id ?? id),
      table_name: String(res.table_name ?? ""),
      kind: String(res.kind ?? ""),
      database: res.database?.database_name ?? null,
      schema: res.schema ?? null,
      sql_length: typeof res.sql === "string" ? res.sql.length : 0,
      changed_on: res.changed_on ?? null,
      columns,
      metrics,
      calculated_columns: calculated,
      pii_columns: pii,
      columns_count: columns.length,
      metrics_count: metrics.length,
      calculated_columns_count: calculated.length,
    });
  }

  const out = {
    generated_at: new Date().toISOString(),
    source: "output/dataset_details/*.json",
    priority_ids: PRIORITY_IDS,
    missing_ids: missing,
    datasets,
    totals: {
      datasets: datasets.length,
      columns: datasets.reduce((s, d) => s + d.columns_count, 0),
      metrics: datasets.reduce((s, d) => s + d.metrics_count, 0),
      calculated_columns: datasets.reduce((s, d) => s + d.calculated_columns_count, 0),
      pii_columns: datasets.reduce((s, d) => s + d.pii_columns.length, 0),
    },
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2), { mode: 0o600 });

  console.log(
    JSON.stringify(
      {
        written: OUT,
        datasets: datasets.length,
        missing,
        totals: out.totals,
        pii: datasets.filter((d) => d.pii_columns.length > 0).map((d) => ({
          dataset_id: d.dataset_id,
          table_name: d.table_name,
          pii_columns: d.pii_columns,
        })),
      },
      null,
      2,
    ),
  );

  if (missing.length) process.exitCode = 1;
}

main();
