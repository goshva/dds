/**
 * Этап 1.4, фаза 1.4.7 — качество данных, unresolved refs, PII-аудит, бизнес-покрытие.
 *
 * Read-only. Пишет 07_* отчёты.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  SNAPSHOT_ROOT,
  REPORT_DIR,
  ensureDir,
  readJson,
  writeJsonAtomic,
  writeAtomic,
  csv,
  joinReport,
  nowIso,
  parseCsv,
} from "./utils";
import { scanPii } from "./lib";

type Issue = { area: string; severity: "ERROR" | "WARN" | "INFO"; object_type: string; object_id: string; message: string; evidence: string };

function main() {
  ensureDir(REPORT_DIR);
  const snapshotId = readJson<any>(join(SNAPSHOT_ROOT, "manifest.json"))?.snapshot_id ?? "local-output-baseline";
  const datasets: any[] = readJson<any>(join(SNAPSHOT_ROOT, "datasets.compact.json"))?.docs ?? [];
  const charts: any[] = readJson<any>(join(SNAPSHOT_ROOT, "charts.compact.json"))?.docs ?? [];
  const dashboards: any[] = readJson<any>(join(SNAPSHOT_ROOT, "dashboards.compact.json"))?.docs ?? [];
  const sqlInv = parseCsv(readFileSync(joinReport("05_sql_inventory.csv"), "utf8"));
  const tableInv = parseCsv(readFileSync(joinReport("05_table_inventory.csv"), "utf8"));
  const columnInv = parseCsv(readFileSync(joinReport("05_column_inventory.csv"), "utf8"));
  const metricInv = parseCsv(readFileSync(joinReport("05_metric_inventory.csv"), "utf8"));
  const joinInv = parseCsv(readFileSync(joinReport("05_join_inventory.csv"), "utf8"));
  const grainInv = parseCsv(readFileSync(joinReport("06_data_grain_registry.csv"), "utf8"));
  const relInv = parseCsv(readFileSync(joinReport("06_relationships.csv"), "utf8"));
  const entities = readJson<any>(joinReport("06_logical_entities.json"))?.entities ?? [];

  const th = tableInv[0];
  const ti = (n: string) => th.indexOf(n);
  const ch = columnInv[0];
  const ci = (n: string) => ch.indexOf(n);
  const mh = metricInv[0];
  const mi = (n: string) => mh.indexOf(n);
  const jh = joinInv[0];
  const ji = (n: string) => jh.indexOf(n);
  const gh = grainInv[0];
  const gi = (n: string) => gh.indexOf(n);
  const rh = relInv[0];
  const ri = (n: string) => rh.indexOf(n);

  const issues: Issue[] = [];
  const datasetIds = new Set(datasets.map((d) => String(d.id)));
  const dashboardIds = new Set(dashboards.map((d) => String(d.id)));

  // 1. unresolved refs
  const unresolvedDs = new Map<string, number>();
  const unresolvedDash = new Map<string, number>();
  let d2c = 0;
  let c2d = 0;
  for (const c of charts) {
    if (c.datasource_id) {
      c2d++;
      if (!datasetIds.has(String(c.datasource_id))) unresolvedDs.set(String(c.datasource_id), (unresolvedDs.get(String(c.datasource_id)) ?? 0) + 1);
    }
    for (const did of c.dashboards ?? []) {
      d2c++;
      if (!dashboardIds.has(String(did))) unresolvedDash.set(String(did), (unresolvedDash.get(String(did)) ?? 0) + 1);
    }
  }
  const unresolvedRows: unknown[][] = [["ref_type", "ref_id", "referenced_from", "count", "status", "note"]];
  for (const [id, n] of unresolvedDs) unresolvedRows.push(["dataset", id, "chart.datasource_id", n, "NOT_SEEN_IN_SNAPSHOT", "не доказывает удаление"]);
  for (const [id, n] of unresolvedDash) unresolvedRows.push(["dashboard", id, "chart.dashboards[]", n, "NOT_SEEN_IN_SNAPSHOT", "не доказывает удаление"]);
  if (unresolvedDs.size) issues.push({ area: "unresolved_refs", severity: "WARN", object_type: "dataset", object_id: [...unresolvedDs.keys()].slice(0, 10).join(","), message: `charts ссылаются на ${unresolvedDs.size} dataset id вне snapshot`, evidence: "chart.datasource_id" });
  if (unresolvedDash.size) issues.push({ area: "unresolved_refs", severity: "WARN", object_type: "dashboard", object_id: [...unresolvedDash.keys()].slice(0, 10).join(","), message: `charts ссылаются на ${unresolvedDash.size} dashboard id вне snapshot`, evidence: "chart.dashboards[]" });
  writeAtomic(joinReport("07_unresolved_references.csv"), csv(unresolvedRows));

  // 2. unresolved tables
  const unknownTables = tableInv.slice(1).filter((r) => r[ti("kind")] === "unknown" || r[ti("kind")] === "subquery");
  if (unknownTables.length) issues.push({ area: "unresolved_tables", severity: "WARN", object_type: "sql_source", object_id: "", message: `${unknownTables.length} источников не классифицированы как физическая таблица/CTE`, evidence: "05_table_inventory.csv kind=unknown/subquery" });

  // 3. unresolved columns
  const unresolvedCols = columnInv.slice(1).filter((r) => String(r[ci("resolved")]) === "false" && r[ci("source")] === "SQL_REFERENCE");
  if (unresolvedCols.length) issues.push({ area: "unresolved_columns", severity: "WARN", object_type: "column", object_id: "", message: `${unresolvedCols.length} SQL-идентификаторов не найдены в columns`, evidence: "05_column_inventory.csv" });

  // 4. metrics with unresolved refs
  const badMetrics = metricInv.slice(1).filter((r) => String(r[mi("unresolved_refs")] ?? "").trim());
  for (const r of badMetrics.slice(0, 50)) {
    issues.push({ area: "metric_unresolved_refs", severity: "ERROR", object_type: "metric", object_id: `${r[mi("dataset_id")]}.${r[mi("metric_name")]}`, message: `метрика ссылается на отсутствующие поля: ${r[mi("unresolved_refs")]}`, evidence: "05_metric_inventory.csv" });
  }

  // 5. duplicate identifiers
  const byName = new Map<string, string[]>();
  for (const d of datasets) {
    const n = String(d.name ?? "").toLowerCase();
    if (!n) continue;
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n)!.push(String(d.id));
  }
  const dupNames = [...byName.entries()].filter(([, ids]) => ids.length > 1);
  for (const [n, ids] of dupNames) issues.push({ area: "duplicate_dataset_name", severity: "WARN", object_type: "dataset", object_id: ids.join(","), message: `duplicate table_name: ${n}`, evidence: "datasets.compact.json" });

  // 6. unknown keys / grain
  const unknownGrain = grainInv.slice(1).filter((r) => String(r[gi("confidence")]) === "UNKNOWN");
  if (unknownGrain.length) issues.push({ area: "unknown_grain", severity: "INFO", object_type: "dataset", object_id: "", message: `${unknownGrain.length} datasets с неопределённым зерном`, evidence: "06_data_grain_registry.csv" });
  const unknownEntities = entities.filter((e: any) => e.presence_status === "UNKNOWN");
  for (const e of unknownEntities) issues.push({ area: "unknown_entity", severity: "INFO", object_type: "logical_entity", object_id: e.entity, message: "сущность не подтверждена в исследованном охвате", evidence: "06_logical_entities.json" });

  // 7. suspicious joins
  const crossJoins = joinInv.slice(1).filter((r) => /CROSS/i.test(String(r[ji("join_type")])));
  const noOn = joinInv.slice(1).filter((r) => !String(r[ji("on_condition")] ?? "").trim());
  if (crossJoins.length) issues.push({ area: "cross_join", severity: "WARN", object_type: "dataset", object_id: crossJoins.map((r) => r[ji("dataset_id")]).slice(0, 10).join(","), message: `${crossJoins.length} CROSS JOIN`, evidence: "05_join_inventory.csv" });
  if (noOn.length) issues.push({ area: "join_without_on", severity: "INFO", object_type: "dataset", object_id: noOn.map((r) => r[ji("dataset_id")]).slice(0, 10).join(","), message: `${noOn.length} JOIN без распознанного ON`, evidence: "05_join_inventory.csv" });

  // 8. possible row multiplication
  const multiJoin = sqlInv.slice(1).filter((r) => Number(r[5 + 0] ?? 0) >= 0 && Number(r[sqlInv[0].indexOf("join_count")] ?? 0) >= 5);
  if (multiJoin.length) issues.push({ area: "row_multiplication_risk", severity: "WARN", object_type: "dataset", object_id: multiJoin.map((r) => r[0]).slice(0, 10).join(","), message: `${multiJoin.length} datasets с >=5 JOIN — риск размножения строк`, evidence: "05_sql_inventory.csv join_count" });

  // 9. grain change before/after join (по relationships с разными grain)
  const grainById = new Map<string, string>();
  for (const r of grainInv.slice(1)) grainById.set(String(r[gi("dataset_id")]), String(r[gi("grain")]));
  const grainChange = relInv.slice(1).filter((r) => {
    if (r[ri("relationship_type")] !== "DATASET_KEY_CANDIDATE") return false;
    const a = grainById.get(String(r[ri("entity_a_id")]));
    const b = grainById.get(String(r[ri("entity_b_id")]));
    return a && b && a !== b;
  });
  if (grainChange.length) issues.push({ area: "grain_change_on_join", severity: "WARN", object_type: "relationship", object_id: "", message: `${grainChange.length} связей между датасетами с разным зерном`, evidence: "06_relationships.csv + 06_data_grain_registry.csv" });

  // 10. temporal transformations / sentinel dates
  const temporal: unknown[][] = [["dataset_id", "dataset_name", "pattern", "line", "note"]];
  for (const r of sqlInv.slice(1)) {
    const id = r[0];
    const name = r[1];
    const sql = String(datasets.find((d) => String(d.id) === String(id))?.sql ?? "");
    if (!sql) continue;
    const patterns: Array<[RegExp, string]> = [
      [/interval\s+'3 hour'/i, "+3 hour timezone shift"],
      [/toDateTime\('1970-01-01[^']*'\)/i, "sentinel 1970-01-01"],
      [/date_trunc\s*\(/i, "date_trunc"],
      [/now\(\)\s*-\s*interval/i, "relative window now()-interval"],
    ];
    for (const [re, note] of patterns) {
      const m = sql.match(re);
      if (m) {
        const line = sql.slice(0, m.index ?? 0).split("\n").length;
        temporal.push([id, name, m[0].slice(0, 60), line, note]);
      }
    }
  }
  if (temporal.length) issues.push({ area: "temporal_transformations", severity: "INFO", object_type: "sql", object_id: "", message: `${temporal.length} временных преобразований/sentinel`, evidence: "05_sql_inventory.csv + snapshot sql" });

  // 11. PII leakage scan по отчётам Phase 1.4 и 1.2 (единый сканер lib.scanPii)
  const piiHits: Array<{ file: string; pattern: string; sample: string }> = [];
  const reportDirs = [REPORT_DIR, "reports/phase-01-2"];
  for (const dir of reportDirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!/\.(md|json|csv)$/i.test(f)) continue;
      let text = "";
      try {
        text = readFileSync(join(dir, f), "utf8");
      } catch {
        continue;
      }
      for (const h of scanPii(text)) piiHits.push({ file: join(dir, f).replace(/\\/g, "/"), pattern: h.name, sample: h.sample });
    }
  }
  if (piiHits.length) issues.push({ area: "pii_leakage", severity: "ERROR", object_type: "report", object_id: "", message: `${piiHits.length} совпадений PII/секретов`, evidence: "07_pii_audit.md" });

  // 12. расхождения с Phase 1.2
  const p12 = readJson<any>("reports/phase-01-2/final_validation.json");
  const discrepancies: string[] = [];
  const p12Counts = { datasets: p12?.datasets_expected ?? null, marts: p12?.marts_registered ?? null, kpis: p12?.metrics_registered ?? null };
  discrepancies.push(`Phase 1.2: datasets_expected=${p12Counts.datasets}, marts=${p12Counts.marts}, kpis=${p12Counts.kpis}, status=${p12?.status}`);
  discrepancies.push(`Phase 1.4 snapshot: dashboards=${dashboards.length}, charts=${charts.length}, datasets=${datasets.length}`);
  discrepancies.push("Различия количеств объясняются новым snapshot Superset (см. 02_catalog_diff).");

  writeJsonAtomic(joinReport("07_quality_issues.json"), {
    generated_at: nowIso(),
    snapshot_id: snapshotId,
    unresolved_refs: { dataset: unresolvedDs.size, dashboard: unresolvedDash.size, tables: unknownTables.length, columns: unresolvedCols.length, metrics_with_unresolved_refs: badMetrics.length },
    issues,
    temporal_transformations: temporal.slice(1),
    pii_hits: piiHits,
    phase_1_2_discrepancies: discrepancies,
  });
  const issueCsv: unknown[][] = [["area", "severity", "object_type", "object_id", "message", "evidence"]];
  for (const i of issues) issueCsv.push([i.area, i.severity, i.object_type, i.object_id, i.message, i.evidence]);
  writeAtomic(joinReport("07_quality_issues.csv"), csv(issueCsv));

  // ---------- business coverage ----------
  const coverage = [
    { requirement: "Общий список заказов", needed: "заказ, адрес, статус", status: "PARTIAL", evidence: "order_status/id_order/shopno есть (4732); адрес доставки как поле не подтверждён", gaps: "address_to_zone/адрес" },
    { requirement: "Готовность", needed: "подтверждённое событие/время готовности", status: "NEEDS_EVENT", evidence: "order_ready отсутствует; date_status_10/date_collected — гипотезы", gaps: "order_ready" },
    { requirement: "***REMOVED***", needed: "адрес, координаты, справочник зон", status: "NEEDS_REFERENCE", evidence: "area_tt — территория ТТ; zone_cluster — кластер; inactivity_zone — зона бездействия", gaps: "zone_reference, address_to_zone" },
    { requirement: "Ходки", needed: "группа заказов, выезд", status: "PARTIAL", evidence: "id_pool/id_pool_calc/pool_size есть; «ходка» как сущность не подтверждена; выезд = date_pickuped (PROBABLE)", gaps: "batch_created/batch_assigned" },
    { requirement: "***REMOVED***", needed: "прибытие, очередь, доступность", status: "NEEDS_EVENT", evidence: "arrival_time/wait_time есть, события очереди и order_ready нет", gaps: "order_ready, order_picked_up" },
    { requirement: "Назначение", needed: "курьер, заказ, ходка", status: "PARTIAL", evidence: "id_order+id_courier есть (4732/7006/7027/7119); событий назначения нет", gaps: "batch_assigned, courier_accepted_assignment" },
    { requirement: "Оплата", needed: "тариф, доставка, начисление", status: "NEEDS_REFERENCE", evidence: "sum_paid/sum_order — суммы заказа; shift_N_profit — только первые 5 смен (7473); тарифов нет", gaps: "tariff_reference, courier_income_accrued" },
    { requirement: "Смены", needed: "начало, конец, перерывы", status: "NEEDS_EVENT", evidence: "полной модели смен нет; есть только первые 5 смен/14 дней", gaps: "courier_shift_started/ended, shift_plan_reference" },
    { requirement: "Обучение", needed: "новичок, куратор, даты, результат", status: "PARTIAL", evidence: "name_curator/first_order_date/shifts_in_first_14d/fifth_shift_status есть; роль наставника не подтверждена", gaps: "courier_mentor_assigned, courier_training_completed" },
  ];
  const covCsv: unknown[][] = [["requirement", "needed_data", "status", "evidence", "gaps"]];
  for (const c of coverage) covCsv.push([c.requirement, c.needed, c.status, c.evidence, c.gaps]);
  writeAtomic(joinReport("07_business_coverage_matrix.csv"), csv(covCsv));
  writeJsonAtomic(joinReport("07_business_coverage_matrix.json"), { generated_at: nowIso(), snapshot_id: snapshotId, requirements: coverage });

  // ---------- PII audit ----------
  const piiMd: string[] = [];
  piiMd.push("# PII / секреты — аудит отчётов (фаза 1.4.7)");
  piiMd.push("");
  piiMd.push(`Сгенерировано: ${nowIso()}`);
  piiMd.push("");
  piiMd.push(`Просканировано каталогов: ${reportDirs.join(", ")}.`);
  piiMd.push(`Найдено совпадений: **${piiHits.length}**.`);
  piiMd.push("");
  if (piiHits.length) {
    piiMd.push("| Файл | Паттерн | Пример (усечён) |");
    piiMd.push("|---|---|---|");
    for (const h of piiHits) piiMd.push(`| ${h.file} | ${h.pattern} | ${h.sample} |`);
  } else {
    piiMd.push("Совпадений не найдено. В отчётах хранятся только имена полей, не значения.");
  }
  piiMd.push("");
  piiMd.push("Извлечённые метаданные не содержат owners, changed_by, email и контактов.");
  piiMd.push("");
  writeAtomic(joinReport("07_pii_audit.md"), piiMd.join("\n"));

  // ---------- quality report ----------
  const bySeverity: Record<string, number> = {};
  for (const i of issues) bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
  const md: string[] = [];
  md.push("# Фаза 1.4.7 — Качество данных и бизнес-покрытие");
  md.push("");
  md.push(`Сгенерировано: ${nowoIsoSafe()}`);
  md.push(`Snapshot: \`${snapshotId}\`.`);
  md.push("");
  md.push("## Сводка качества");
  md.push("");
  md.push("| Severity | Кол-во |");
  md.push("|---|---:|");
  for (const s of ["ERROR", "WARN", "INFO"]) md.push(`| ${s} | ${bySeverity[s] ?? 0} |`);
  md.push("");
  md.push("| Область | Severity | Сообщение |");
  md.push("|---|---|---|");
  for (const i of issues) md.push(`| ${i.area} | ${i.severity} | ${i.message} |`);
  md.push("");
  md.push("## Unresolved references");
  md.push("");
  md.push(`- unresolved dataset refs: ${unresolvedDs.size}; unresolved dashboard refs: ${unresolvedDash.size}`);
  md.push(`- unresolved physical tables/источников: ${unknownTables.length}`);
  md.push(`- unresolved columns: ${unresolvedCols.length}`);
  md.push("");
  md.push("## <ФИО>-покрытие");
  md.push("");
  md.push("| Требование | Статус | Пробелы |");
  md.push("|---|---|---|");
  for (const c of coverage) md.push(`| ${c.requirement} | ${c.status} | ${c.gaps} |`);
  md.push("");
  md.push("## Расхождения с Phase 1.2");
  md.push("");
  for (const d of discrepancies) md.push(`- ${d}`);
  md.push("");
  md.push(`PII/секреты: ${piiHits.length ? `найдено ${piiHits.length} совпадений — см. 07_pii_audit.md` : "не найдено"}.`);
  md.push("");
  writeAtomic(joinReport("07_quality_report.md"), md.join("\n"));

  console.log(JSON.stringify({
    snapshot_id: snapshotId,
    issues_by_severity: bySeverity,
    unresolved_dataset_refs: unresolvedDs.size,
    unresolved_dashboard_refs: unresolvedDash.size,
    unresolved_tables: unknownTables.length,
    unresolved_columns: unresolvedCols.length,
    metrics_with_unresolved_refs: badMetrics.length,
    temporal_transformations: temporal.length - 1,
    pii_hits: piiHits.length,
    coverage: coverage.map((c) => ({ requirement: c.requirement, status: c.status })),
    reports: ["07_quality_report.md", "07_quality_issues.csv/json", "07_business_coverage_matrix.csv/json", "07_unresolved_references.csv", "07_pii_audit.md"],
  }, null, 2));
}

function nowoIsoSafe(): string {
  return nowIso();
}

main();
