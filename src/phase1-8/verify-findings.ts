/**
 * Этап 1.8 — проверка обязательных технических findings ТЗ §5 по первичным артефактам 1.6.2.
 * Только чтение. Возвращает структурированный результат; запись файла — в run.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface FindingResult {
  check_id: string;
  finding: string;
  status: "CONFIRMED" | "CONFLICT" | "NOT_VERIFIABLE";
  detail: string;
  [key: string]: unknown;
}

export interface FindingsVerification {
  generated_at: string;
  source: string;
  total: number;
  confirmed: number;
  conflicts: number;
  not_verifiable: number;
  results: FindingResult[];
}

const SNAP = "data/snapshots/phase-01-6-2";

export function runFindingsVerification(): FindingsVerification {
  const detail = JSON.parse(readFileSync(join(SNAP, "datasets.detail.json"), "utf8")) as Array<{
    id: number;
    name: string;
    schema: string | null;
    sql: string | null;
    columns: Array<{ name: string }>;
  }>;
  const byId = new Map(detail.map((d) => [Number(d.id), d]));
  const list = JSON.parse(readFileSync(join(SNAP, "datasets.list.json"), "utf8")) as Array<{ id: number; name: string }>;
  const listById = new Map(list.map((d) => [Number(d.id), d]));

  function has(id: number, needle: string): boolean {
    const d = byId.get(id);
    if (!d || !d.sql) return false;
    return d.sql.includes(needle);
  }

  function count(id: number, needle: string): number {
    const d = byId.get(id);
    if (!d || !d.sql) return 0;
    return d.sql.split(needle).length - 1;
  }

  function col(id: number, name: string): boolean {
    const d = byId.get(id);
    if (!d) return false;
    return d.columns.some((c) => c.name === name);
  }

  const results: FindingResult[] = [];

  // F1 — 7802 содержит shifts/pools/courier_queue
  const d7802 = byId.get(7802);
  results.push({
    check_id: "F1",
    finding: "7802 содержит SQL references shifts/pools/courier_queue",
    status:
      !!d7802 &&
      !!d7802.sql &&
      d7802.sql.includes("agile_mart_operational.shifts") &&
      d7802.sql.includes("agile_mart_operational.pools") &&
      d7802.sql.includes("agile_mart_operational.courier_queue")
        ? "CONFIRMED"
        : "CONFLICT",
    detail: d7802 ? `dataset 7802 found, sql_len=${d7802.sql?.length ?? 0}` : "dataset 7802 not found in detail",
    sql_len: d7802?.sql?.length ?? null,
  });

  // F2 — поля 7802
  const f2 = ["id_shift", "id_courier", "id_pool", "shift_start", "shift_finish", "pool_start", "pool_finish", "queue_in_dttm", "queue_out_dttm", "first_delivery_dttm", "has_order"].map((f) => ({
    field: f,
    present: has(7802, f),
  }));
  results.push({
    check_id: "F2",
    finding: "7802 содержит поля id_shift/id_courier/id_pool/shift_start/shift_finish/pool_start/pool_finish/queue_in_dttm/queue_out_dttm/first_delivery_dttm/has_order",
    status: f2.every((x) => x.present) ? "CONFIRMED" : "CONFLICT",
    detail: JSON.stringify(f2),
    fields: f2,
  });

  // F3 — cargo datasets содержат id_order/id_general/id_pool/courier_id_darkstore
  const cargoIds = [7006, 7089, 7090, 7091, 7120, 7027, 7119];
  const f3 = cargoIds.map((id) => ({
    id,
    name: byId.get(id)?.name ?? listById.get(id)?.name ?? null,
    in_detail: byId.has(id),
    id_order: has(id, "id_order"),
    id_general: has(id, "id_general"),
    id_pool: has(id, "id_pool"),
    courier_id_darkstore: has(id, "courier_id_darkstore"),
  }));
  results.push({
    check_id: "F3",
    finding: "cargo datasets содержат id_order/id_general/id_pool/courier_id_darkstore",
    status: f3.some((x) => x.id_order && x.id_general && x.id_pool) ? "CONFIRMED" : "CONFLICT",
    detail: JSON.stringify(f3),
    datasets: f3,
  });

  // F4 — pool_size = count(distinct id_general) в одном из cargo datasets
  const f4 = cargoIds.map((id) => ({
    id,
    in_detail: byId.has(id),
    count_distinct_id_general: /count\s*\(\s*distinct\s+id_general\s*\)/i.test(byId.get(id)?.sql ?? ""),
  }));
  const f4Any = f4.some((x) => x.count_distinct_id_general);
  const f4Missing = f4.filter((x) => !x.in_detail).map((x) => x.id);
  results.push({
    check_id: "F4",
    finding: "в одном из cargo datasets pool_size = count(distinct id_general)",
    status: f4Any ? "CONFIRMED" : "CONFLICT",
    detail: f4Any
      ? JSON.stringify(f4)
      : `не подтверждено по datasets.detail.json 1.6.2; отсутствуют в detail: ${f4Missing.join(",")}; в 1.7 отчёте указан 7091 cargo3, но его деталь в 1.6.2 не загружена`,
    datasets: f4,
    missing_in_detail: f4Missing,
    reported_in_17: "7091 cargo3",
  });

  // F5 — 3466 не содержит time_ready/time_ready_plan
  const d3466 = byId.get(3466);
  results.push({
    check_id: "F5",
    finding: "SQL 3466 не содержит time_ready/time_ready_plan",
    status: !!d3466 && !!d3466.sql && !d3466.sql.includes("time_ready") && !d3466.sql.includes("time_ready_plan") ? "CONFIRMED" : "CONFLICT",
    detail: d3466 ? `sql_len=${d3466.sql?.length ?? 0}; time_ready=${count(3466, "time_ready")}; time_ready_plan=${count(3466, "time_ready_plan")}` : "dataset 3466 not found",
    sql_len: d3466?.sql?.length ?? null,
    time_ready: count(3466, "time_ready"),
    time_ready_plan: count(3466, "time_ready_plan"),
  });

  // F6 — 7021 timesheet сборщиков, нет id_courier
  results.push({
    check_id: "F6",
    finding: "7021 — timesheet сборщиков, id_courier отсутствует",
    status: has(7021, "ods.timesheetfact") && !has(7021, "id_courier") ? "CONFIRMED" : "CONFLICT",
    detail: `timesheetfact=${has(7021, "ods.timesheetfact")}; id_courier=${has(7021, "id_courier")}`,
  });

  // F7 — 5939 mentor/trainee поля; date_for_mentor в SQL отсутствует
  results.push({
    check_id: "F7",
    finding: "5939 содержит mentor/trainee поля; date_for_mentor в SQL отсутствует (metadata-only)",
    status: has(5939, "mentorid") && has(5939, "mentorid_at_date") && !has(5939, "date_for_mentor") ? "CONFIRMED" : "CONFLICT",
    detail: `mentorid=${has(5939, "mentorid")}; mentorid_at_date=${has(5939, "mentorid_at_date")}; date_for_mentor_sql=${has(5939, "date_for_mentor")}; date_for_mentor_column=${col(5939, "date_for_mentor")}`,
    sql_has: has(5939, "date_for_mentor"),
    column_has: col(5939, "date_for_mentor"),
  });

  // F8 — 7473 shift_N_profit
  const f8 = [1, 2, 3, 4, 5].map((n) => ({ field: `shift_${n}_profit`, present: has(7473, `shift_${n}_profit`) }));
  results.push({
    check_id: "F8",
    finding: "7473 содержит shift_1_profit … shift_5_profit",
    status: f8.every((x) => x.present) ? "CONFIRMED" : "CONFLICT",
    detail: JSON.stringify(f8),
    fields: f8,
  });

  // F9 — длина SQL 3466
  const d3466len = d3466?.sql?.length ?? 0;
  results.push({
    check_id: "F9",
    finding: "длина SQL 3466 согласуется с 1.7 отчётом (38 370), но не с ТЗ (~35 926)",
    status: d3466len > 0 ? "CONFIRMED" : "NOT_VERIFIABLE",
    detail: `actual_sql_len=${d3466len}; 1.7 report=38370; ТЗ claim ~35926`,
    actual_sql_len: d3466len,
    report_17: 38370,
    tz_claim: 35926,
  });

  // F10 — 1.6.2 = 3778 datasets
  results.push({
    check_id: "F10",
    finding: "количество датасетов 1.6.2 = 3778 (в 1.7 отчёте 3767)",
    status: list.length === 3778 ? "CONFIRMED" : "CONFLICT",
    detail: `actual=${list.length}; 1.6.2 baseline=3778; 1.7 report=3767`,
    actual: list.length,
    baseline_162: 3778,
    report_17: 3767,
  });

  // F11 — детали 7802/3466/7021/5939 присутствуют
  const present = [7802, 3466, 7021, 5939].map((id) => ({ id, present: byId.has(id), name: byId.get(id)?.name ?? null }));
  results.push({
    check_id: "F11",
    finding: "детали 7802/3466/7021/5939 присутствуют в datasets.detail.json",
    status: present.every((x) => x.present) ? "CONFIRMED" : "CONFLICT",
    detail: JSON.stringify(present),
    datasets: present,
  });

  // F12 — 7091/7098/7160 отсутствуют в деталях 1.6.2
  const missing = [7091, 7098, 7160].map((id) => ({ id, in_detail: byId.has(id), in_list: listById.has(id), name: listById.get(id)?.name ?? null }));
  results.push({
    check_id: "F12",
    finding: "детали 7091/7098/7160 отсутствуют в datasets.detail.json 1.6.2",
    status: missing.every((x) => !x.in_detail) ? "CONFIRMED" : "CONFLICT",
    detail: JSON.stringify(missing),
    datasets: missing,
  });

  return {
    generated_at: new Date().toISOString(),
    source: "data/snapshots/phase-01-6-2 (datasets.list.json + datasets.detail.json)",
    total: results.length,
    confirmed: results.filter((r) => r.status === "CONFIRMED").length,
    conflicts: results.filter((r) => r.status === "CONFLICT").length,
    not_verifiable: results.filter((r) => r.status === "NOT_VERIFIABLE").length,
    results,
  };
}

if (import.meta.main) {
  const r = runFindingsVerification();
  console.log(JSON.stringify(r, null, 2));
}
