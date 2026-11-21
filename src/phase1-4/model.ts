/**
 * Этап 1.4, фаза 1.4.6 — восстановление модели данных:
 * физический каталог, логические сущности, связи, зерно, lineage/ER-схемы.
 *
 * Read-only. Пишет 06_* отчёты.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyFieldName } from "../phase1-2/parse-sql";
import { ENTITY_STATUS_OVERRIDES } from "./lib";
import {
  SNAPSHOT_ROOT,
  EXTRACT_ROOT,
  ensureDir,
  readJson,
  writeJsonAtomic,
  writeAtomic,
  csv,
  joinReport,
  nowIso,
  parseCsv,
} from "./utils";

const PARSER_VERSION = "phase1-4@1";

type PhysicalRow = { database: string | null; schema: string | null; table: string; datasets: Set<string>; occurrences: number; kinds: Set<string>; join_types: Set<string> };

const GRAIN_OVERRIDES: Record<number, { grain: string; pk: string; status: string; evidence: string }> = {
  4732: { grain: "1 строка = заказ/подзаказ (id_order); объединённый заказ = COALESCE(id_general, id_order)", pk: "COALESCE(id_general, id_order)", status: "INFERRED", evidence: "Phase 1.2 dataset_audit.md" },
  5247: { grain: "1 строка = (week_no, d, Направление, City_tt, shopno, id_tt, name_TT, isDark, event_name, dey, courier_id)", pk: "составной GROUP BY", status: "VERIFIED", evidence: "SQL GROUP BY" },
  5399: { grain: "1 строка = (week_no, d, Направление, City_tt, shopno, id_tt, name_TT, isDark, event_name, dey, courier_id)", pk: "составной GROUP BY", status: "VERIFIED", evidence: "SQL GROUP BY" },
  5797: { grain: "1 строка = (id_courier, date)", pk: "id_courier + date", status: "INFERRED", evidence: "оконные функции PARTITION BY id_courier ORDER BY date" },
  7006: { grain: "1 строка = заказ (id_order) с атрибутами пула", pk: "id_order", status: "INFERRED", evidence: "SQL join dt.id_order; Phase 1.2 audit" },
  7024: { grain: "1 строка = вычисленный пул (id_pool_calc)", pk: "id_pool_calc", status: "VERIFIED", evidence: "SQL GROUP BY id_pool_calc" },
  7027: { grain: "1 строка = заказ (id_order) с флагами", pk: "id_order", status: "INFERRED", evidence: "SQL join по parcel_id/id_order" },
  7119: { grain: "1 строка = заказ (id_order) с флагами", pk: "id_order", status: "INFERRED", evidence: "SQL base по order_delivery_base" },
  7293: { grain: "1 строка = (date, zone_from)", pk: "date + zone", status: "VERIFIED", evidence: "SQL GROUP BY date, zone_from" },
  7465: { grain: "1 строка = (id_courier, date) в окне event_date", pk: "id_courier + date", status: "INFERRED", evidence: "оконные функции + event_date" },
  7473: { grain: "1 строка = (id_courier, event_date)", pk: "id_courier + event_date", status: "INFERRED", evidence: "SQL join fs.id_courier=lo.id_courier, event_date" },
  7775: { grain: "1 строка = курьер (vc.id)", pk: "ID", status: "INFERRED", evidence: "select from default.v_couriers" },
};

const ENTITY_PATTERNS: Record<string, RegExp[]> = {
  order: [/^id_order$/, /^order_id$/, /^id_general$/],
  order_item: [/order_item/, /position_id/, /item_id/, /^id_position$/],
  delivery: [/^id_delivery_job$/, /^date_delivered$/, /delivery_time/, /^id_parcel$/],
  shop: [/^shopno$/, /^id_tt$/],
  address: [/address/, /^geo$/, /latitude/, /longitude/],
  courier: [/^id_courier$/, /^courier_id$/, /^courier$/],
  assignment: [/assignment/, /^assigned/, /^date_pickuped$/],
  route: [/^parcel_id$/, /^id_route$/, /route/, /^cluster_id$/],
  shift: [/shift/],
  event: [/event/, /^status/, /flag_/],
  zone: [/zone/],
  accrual: [/profit/, /income/, /payout/, /sum_paid/, /tariff/],
  mentorship: [/curator/, /mentor/, /trainee/, /newcomer/, /five_shifts/, /5shifts/],
};

function main() {
  ensureDir("reports/phase-01-4");
  const snapshotId = readJson<any>(join(SNAPSHOT_ROOT, "manifest.json"))?.snapshot_id ?? "local-output-baseline";
  const sqlInv = parseCsv(readFileSync(joinReport("05_sql_inventory.csv"), "utf8"));
  const tableInv = parseCsv(readFileSync(joinReport("05_table_inventory.csv"), "utf8"));
  const columnInv = parseCsv(readFileSync(joinReport("05_column_inventory.csv"), "utf8"));
  const metricInv = parseCsv(readFileSync(joinReport("05_metric_inventory.csv"), "utf8"));
  const joinInv = parseCsv(readFileSync(joinReport("05_join_inventory.csv"), "utf8"));

  const th = tableInv[0];
  const ti = (n: string) => th.indexOf(n);
  const ch = columnInv[0];
  const ci = (n: string) => ch.indexOf(n);
  const jh = joinInv[0];
  const ji = (n: string) => jh.indexOf(n);
  const sh = sqlInv[0];
  const si = (n: string) => sh.indexOf(n);
  const mh = metricInv[0];
  const mi = (n: string) => mh.indexOf(n);

  // ---------- 06_physical_catalog ----------
  const physical = new Map<string, PhysicalRow>();
  for (const r of tableInv.slice(1)) {
    const kind = r[ti("kind")];
    if (kind !== "table") continue;
    const schema = r[ti("schema")] || null;
    const table = r[ti("table_name")];
    const key = `${schema ?? ""}.${table}`;
    if (!physical.has(key)) physical.set(key, { database: null, schema, table, datasets: new Set(), occurrences: 0, kinds: new Set(), join_types: new Set() });
    const e = physical.get(key)!;
    e.datasets.add(String(r[ti("dataset_id")]));
    e.occurrences += Number(r[ti("occurrences")] ?? 0) || 1;
    e.kinds.add(kind);
    if (r[ti("join_type")]) e.join_types.add(r[ti("join_type")]);
  }
  const databaseByDataset = new Map<string, string>();
  for (const r of sqlInv.slice(1)) {
    const id = String(r[si("dataset_id")]);
    const db = r[si("database")];
    if (db) databaseByDataset.set(id, db);
  }
  const physicalRows: unknown[][] = [["database", "schema", "table", "datasets_using", "dataset_ids", "occurrences", "join_types", "status", "evidence", "snapshot_id"]];
  const physicalJson: any[] = [];
  for (const e of [...physical.values()].sort((a, b) => b.datasets.size - a.datasets.size || a.table.localeCompare(b.table))) {
    const db = [...e.datasets].map((id) => databaseByDataset.get(id)).find(Boolean) ?? null;
    const status = e.schema ? "VERIFIED" : "INFERRED";
    const row = {
      database: db, schema: e.schema, table: e.table,
      datasets_using: e.datasets.size, dataset_ids: [...e.datasets].sort((a, b) => Number(a) - Number(b)),
      occurrences: e.occurrences, join_types: [...e.join_types],
      status, evidence: `${e.datasets.size} dataset SQL ссылается на таблицу`, snapshot_id: snapshotId,
    };
    physicalRows.push([row.database, row.schema, row.table, row.datasets_using, row.dataset_ids.join(";"), row.occurrences, row.join_types.join(";"), row.status, row.evidence, row.snapshot_id]);
    physicalJson.push(row);
  }
  writeAtomic(joinReport("06_physical_catalog.csv"), csv(physicalRows));
  writeJsonAtomic(joinReport("06_physical_catalog.json"), { generated_at: nowIso(), snapshot_id: snapshotId, tables: physicalJson });

  // ---------- 06_logical_entities ----------
  const entityEvidence = new Map<string, Array<{ dataset_id: string; field: string; entity: string | null; source: string }>>();
  const seenField = new Set<string>();
  for (const r of columnInv.slice(1)) {
    const dsId = String(r[ci("dataset_id")]);
    const field = String(r[ci("column_name")] ?? "");
    if (!field || r[ci("source")] !== "DATASET_METADATA") continue;
    const key = `${dsId}|${field}`;
    if (seenField.has(key)) continue;
    seenField.add(key);
    const cls = classifyFieldName(field);
    if (!cls.isKeyCandidate || !cls.keyEntity) continue;
    if (!entityEvidence.has(cls.keyEntity)) entityEvidence.set(cls.keyEntity, []);
    entityEvidence.get(cls.keyEntity)!.push({ dataset_id: dsId, field, entity: cls.keyEntity, source: "classifyFieldName" });
  }
  // entity mapping: keyEntity -> logical entity
  const entityMap: Array<{ entity: string; from: string[] }> = [
    { entity: "order", from: ["order", "order_delivery"] },
    { entity: "order_item", from: [] },
    { entity: "delivery", from: ["order_delivery"] },
    { entity: "shop", from: ["shop"] },
    { entity: "address", from: [] },
    { entity: "courier", from: ["courier"] },
    { entity: "assignment", from: [] },
    { entity: "route", from: ["route", "cluster"] },
    { entity: "shift", from: [] },
    { entity: "event", from: [] },
    { entity: "zone", from: ["zone"] },
    { entity: "accrual", from: [] },
    { entity: "mentorship", from: [] },
  ];
  const entityRows: unknown[][] = [["entity", "presence_status", "evidence_fields", "datasets", "notes", "snapshot_id"]];
  const entityJson: any[] = [];
  for (const m of entityMap) {
    const ev: Array<{ dataset_id: string; field: string }> = [];
    for (const f of m.from) for (const e of entityEvidence.get(f) ?? []) ev.push({ dataset_id: e.dataset_id, field: e.field });
    // дополнительные эвристики по именам полей из patterns
    const extra: string[] = [];
    for (const [dsId, fields] of (() => {
      const map = new Map<string, Set<string>>();
      for (const r of columnInv.slice(1)) {
        if (r[ci("source")] !== "DATASET_METADATA") continue;
        const id = String(r[ci("dataset_id")]);
        if (!map.has(id)) map.set(id, new Set());
        map.get(id)!.add(String(r[ci("column_name")] ?? "").toLowerCase());
      }
      return map;
    })()) {
      for (const re of ENTITY_PATTERNS[m.entity] ?? []) {
        for (const f of fields) if (re.test(f)) extra.push(`${dsId}.${f}`);
      }
    }
    const allEvidence = [...new Set([...ev.map((e) => `${e.dataset_id}.${e.field}`), ...extra])];
    const override = ENTITY_STATUS_OVERRIDES[m.entity];
    const status = override?.status ?? (allEvidence.length >= 3 ? "VERIFIED" : allEvidence.length > 0 ? "INFERRED" : "UNKNOWN");
    const notes = override?.note ?? "";
    entityRows.push([m.entity, status, allEvidence.slice(0, 20).join(";"), [...new Set(allEvidence.map((x) => x.split(".")[0]))].join(";"), notes, snapshotId]);
    entityJson.push({ entity: m.entity, presence_status: status, evidence_fields: allEvidence.slice(0, 50), datasets: [...new Set(allEvidence.map((x) => x.split(".")[0]))], notes });
  }
  writeAtomic(joinReport("06_logical_entities.csv"), csv(entityRows));
  writeJsonAtomic(joinReport("06_logical_entities.json"), { generated_at: nowIso(), snapshot_id: snapshotId, entities: entityJson });

  // ---------- 06_relationships ----------
  const relRows: unknown[][] = [["relationship_type", "entity_a_type", "entity_a_id", "entity_a_field", "entity_b_type", "entity_b_id", "entity_b_field", "join_type", "evidence", "confidence", "risks", "snapshot_id"]];
  const relJson: any[] = [];
  const prevJoin = join("reports", "phase-01-2", "dataset_join_map.csv");
  if (existsSync(prevJoin)) {
    const pj = parseCsv(readFileSync(prevJoin, "utf8"));
    const ph = pj[0];
    const pi = (n: string) => ph.indexOf(n);
    for (const r of pj.slice(1)) {
      const row = {
        relationship_type: "DATASET_KEY_CANDIDATE",
        entity_a_type: "dataset", entity_a_id: r[pi("source_dataset_id")], entity_a_field: r[pi("source_field")],
        entity_b_type: "dataset", entity_b_id: r[pi("target_dataset_id")], entity_b_field: r[pi("target_field")],
        join_type: r[pi("join_type")], evidence: r[pi("evidence")], confidence: r[pi("confidence")], risks: r[pi("risks")],
        snapshot_id: snapshotId, provenance: "phase-01-2 dataset_join_map.csv",
      };
      relRows.push([row.relationship_type, row.entity_a_type, row.entity_a_id, row.entity_a_field, row.entity_b_type, row.entity_b_id, row.entity_b_field, row.join_type, row.evidence, row.confidence, row.risks, row.snapshot_id]);
      relJson.push(row);
    }
  }
  for (const r of joinInv.slice(1)) {
    const row = {
      relationship_type: "SQL_JOIN_IN_DATASET",
      entity_a_type: "dataset", entity_a_id: r[ji("dataset_id")], entity_a_field: r[ji("source_name")],
      entity_b_type: "sql_source", entity_b_id: r[ji("source_name")], entity_b_field: r[ji("on_condition")],
      join_type: r[ji("join_type")], evidence: `JOIN ON ${r[ji("on_condition")] ?? ""}`, confidence: r[ji("on_condition")] ? "INFERRED" : "UNKNOWN",
      risks: r[ji("on_condition")] ? "" : "JOIN без ON/условие не распознано", snapshot_id: snapshotId, provenance: "phase-01-4 05_join_inventory.csv",
    };
    relRows.push([row.relationship_type, row.entity_a_type, row.entity_a_id, row.entity_a_field, row.entity_b_type, row.entity_b_id, row.entity_b_field, row.join_type, row.evidence, row.confidence, row.risks, row.snapshot_id]);
    relJson.push(row);
  }
  writeAtomic(joinReport("06_relationships.csv"), csv(relRows));
  writeJsonAtomic(joinReport("06_relationships.json"), { generated_at: nowIso(), snapshot_id: snapshotId, relationships: relJson });

  // ---------- 06_data_grain_registry ----------
  const grainRows: unknown[][] = [["dataset_id", "dataset_name", "grain", "primary_key_candidate", "time_interval", "history", "duplicate_risk", "confidence", "evidence", "snapshot_id"]];
  const grainJson: any[] = [];
  const sqlById = new Map<string, any>();
  for (const r of sqlInv.slice(1)) sqlById.set(String(r[si("dataset_id")]), r);
  const groupByByDataset = new Map<string, string>();
  for (const [id, r] of sqlById) groupByByDataset.set(id, String(r[si("group_by_count")] ?? "0"));
  const nameById = new Map<string, string>();
  for (const r of tableInv.slice(1)) nameById.set(String(r[ti("dataset_id")]), String(r[ti("dataset_name")] ?? ""));
  for (const r of columnInv.slice(1)) if (r[ci("dataset_name")]) nameById.set(String(r[ci("dataset_id")]), String(r[ci("dataset_name")]));
  const allIds = [...new Set([...sqlById.keys(), ...nameById.keys()])];
  for (const id of allIds) {
    const ov = GRAIN_OVERRIDES[Number(id)];
    const sqlRow = sqlById.get(id);
    const grain = ov?.grain ?? (Number(groupByByDataset.get(id) ?? 0) > 0 ? `1 строка = комбинация GROUP BY (${sqlRow?.[si("group_by_count")]} групп)` : "UNKNOWN");
    const pk = ov?.pk ?? (Number(groupByByDataset.get(id) ?? 0) > 0 ? "составной GROUP BY" : "UNKNOWN");
    const status = ov?.status ?? (Number(groupByByDataset.get(id) ?? 0) > 0 ? "INFERRED" : "UNKNOWN");
    const evidence = ov?.evidence ?? (Number(groupByByDataset.get(id) ?? 0) > 0 ? "SQL GROUP BY" : "нет доказательства");
    const row = { dataset_id: Number(id), dataset_name: nameById.get(id) ?? null, grain, primary_key_candidate: pk, time_interval: "по временным полям датасета", history: "UNKNOWN", duplicate_risk: Number(groupByByDataset.get(id) ?? 0) > 0 ? "LOW" : "UNKNOWN", confidence: status, evidence, snapshot_id: snapshotId };
    grainRows.push([row.dataset_id, row.dataset_name, row.grain, row.primary_key_candidate, row.time_interval, row.history, row.duplicate_risk, row.confidence, row.evidence, row.snapshot_id]);
    grainJson.push(row);
  }
  writeAtomic(joinReport("06_data_grain_registry.csv"), csv(grainRows));
  writeJsonAtomic(joinReport("06_data_grain_registry.json"), { generated_at: nowIso(), snapshot_id: snapshotId, grains: grainJson });

  // ---------- lineage.mmd (сводная) ----------
  const charts: any[] = readJson<any>(join(SNAPSHOT_ROOT, "charts.compact.json"))?.docs ?? [];
  const dashboards: any[] = readJson<any>(join(SNAPSHOT_ROOT, "dashboards.compact.json"))?.docs ?? [];
  const datasets: any[] = readJson<any>(join(SNAPSHOT_ROOT, "datasets.compact.json"))?.docs ?? [];
  const datasetIds = new Set(datasets.map((d) => String(d.id)));
  const dashboardIds = new Set(dashboards.map((d) => String(d.id)));
  let d2c = 0;
  let c2d = 0;
  let unresolvedDash = new Set<string>();
  let unresolvedDs = new Set<string>();
  for (const c of charts) {
    if (c.datasource_id) {
      c2d++;
      if (!datasetIds.has(String(c.datasource_id))) unresolvedDs.add(String(c.datasource_id));
    }
    for (const did of c.dashboards ?? []) {
      d2c++;
      if (!dashboardIds.has(String(did))) unresolvedDash.add(String(did));
    }
  }
  const lineageMmd: string[] = [];
  lineageMmd.push("graph LR");
  lineageMmd.push(`  DASH["dashboards: ${dashboards.length}"] --> CH["charts: ${charts.length}"]`);
  lineageMmd.push(`  CH --> DS["datasets: ${datasets.length}"]`);
  lineageMmd.push(`  DASH -- "${d2c} dashboard→chart refs (${unresolvedDash.size} unresolved)" --> CH`);
  lineageMmd.push(`  CH -- "${c2d} chart→dataset refs (${unresolvedDs.size} unresolved)" --> DS`);
  lineageMmd.push(`  DS --> SQL["SQL definitions: ${sqlInv.length - 1} parsed"]`);
  lineageMmd.push(`  SQL --> TBL["physical tables: ${physical.size}"]`);
  lineageMmd.push(`  SQL --> COL["columns/refs: ${columnInv.length - 1}"]`);
  writeAtomic(joinReport("06_lineage.mmd"), lineageMmd.join("\n") + "\n");

  // ---------- er_model.mmd ----------
  const er: string[] = [];
  er.push("erDiagram");
  for (const e of entityJson) {
    er.push(`  ${e.entity.toUpperCase()} {`);
    er.push(`    string presence_status "${e.presence_status}"`);
    er.push(`    string evidence "${(e.evidence_fields ?? []).slice(0, 3).join(", ").replace(/"/g, "'")}"`);
    er.push("  }");
  }
  const erEdges = [
    "ORDER ||--o{ ORDER_ITEM : \"не подтверждено\"",
    "ORDER ||--o{ DELIVERY : \"id_order/parcel_id (INFERRED)\"",
    "SHOP ||--o{ ORDER : \"shopno (VERIFIED)\"",
    "COURIER ||--o{ DELIVERY : \"id_courier (INFERRED)\"",
    "DELIVERY }o--|| ROUTE : \"parcel_id/id_route (INFERRED)\"",
    "COURIER ||--o{ SHIFT : \"не подтверждено\"",
    "ZONE ||--o{ ORDER : \"зона не подтверждена\"",
    "COURIER ||--o{ ACCRUAL : \"тариф не подтверждён\"",
    "MENTORSHIP }o--|| COURIER : \"name_curator (INFERRED)\"",
  ];
  for (const e of erEdges) er.push(`  ${e}`);
  writeAtomic(joinReport("06_er_model.mmd"), er.join("\n") + "\n");

  // ---------- modeling report ----------
  const md: string[] = [];
  md.push("# Фаза 1.4.6 — Восстановление модели данных");
  md.push("");
  md.push(`Сгенерировано: ${nowIso()}`);
  md.push(`Snapshot: \`${snapshotId}\`; parser: \`${PARSER_VERSION}\`.`);
  md.push("");
  md.push("## Физический каталог");
  md.push("");
  md.push(`- физических таблиц: ${physical.size}`);
  md.push(`- всего ссылок dataset→table: ${physicalRows.length - 1}`);
  md.push("");
  md.push("Типы колонок и PK/FK/indexes не выдумываются: доступны только те, что даёт SQL/метаданные Superset.");
  md.push("");
  md.push("## Логические сущности");
  md.push("");
  md.push("| Сущность | Статус | Доказательства (поля) |");
  md.push("|---|---|---|");
  for (const e of entityJson) md.push(`| ${e.entity} | ${e.presence_status} | ${(e.evidence_fields ?? []).slice(0, 6).join(", ") || "—"} |`);
  md.push("");
  md.push("## Связи");
  md.push("");
  md.push(`- relationships (dataset-key кандидаты + SQL JOIN): ${relRows.length - 1}`);
  md.push(`- JOIN не считается FK; зерно и кардинарность требуют проверки на данных.`);
  md.push("");
  md.push("## Зерно");
  md.push("");
  md.push(`- записей в реестре зерна: ${grainRows.length - 1}`);
  md.push(`- для 12 утверждённых датасетов зерно зафиксировано с доказательствами Phase 1.2; для остальных — INFERRED/UNKNOWN.`);
  md.push("");
  md.push("## Lineage и ER");
  md.push("");
  md.push("- `06_lineage.mmd` — сводная схема dashboard→chart→dataset→SQL→table→column.");
  md.push("- `06_er_model.mmd` — кандидатная ER-модель логических сущностей (статусы подтверждения внутри узлов).");
  md.push("");
  writeAtomic(joinReport("06_modeling_report.md"), md.join("\n"));

  console.log(JSON.stringify({
    physical_tables: physical.size,
    entities: entityJson.map((e) => ({ entity: e.entity, status: e.presence_status })),
    relationships: relRows.length - 1,
    grains: grainRows.length - 1,
    lineage: { d2c, c2d, unresolved_dashboard_refs: unresolvedDash.size, unresolved_dataset_refs: unresolvedDs.size },
    reports: ["06_physical_catalog.csv/json", "06_logical_entities.csv/json", "06_relationships.csv/json", "06_data_grain_registry.csv/json", "06_lineage.mmd", "06_er_model.mmd", "06_modeling_report.md"],
  }, null, 2));
}

main();
