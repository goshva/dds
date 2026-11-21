/**
 * Этап 1.4 — чистые переиспользуемые функции (без побочных эффектов, тестируемые).
 */
import type { ParsedSqlExtended } from "../phase1-2/parse-sql";

export const KNOWN_SCHEMAS = new Set([
  "default",
  "agile_mart_techaudit",
  "agile_mart_hot_team",
  "sandbox",
  "ods",
  "mart_mixed",
  "mart",
  "dictionaries",
  "logs_mart",
  "dwh",
]);

export const SOURCE_KEYWORDS = new Set(["date_trunc", "now", "today", "date", "timestamp", "datetime", "unnest", "generate_series", "true", "false", "null"]);

export type SourceRow = {
  name: string;
  schema: string | null;
  alias: string | null;
  kind: "table" | "cte" | "subquery" | "unknown";
  join_type: string | null;
  on: string | null;
  occurrences: number;
};

export function normalizeSources(parsed: ParsedSqlExtended): SourceRow[] {
  const cteNames = new Set(parsed.ctes.map((c) => c.name.toLowerCase()));
  const agg = new Map<string, SourceRow>();
  for (const s of parsed.sources) {
    const lower = s.name.toLowerCase();
    if (SOURCE_KEYWORDS.has(lower)) continue;
    let kind: SourceRow["kind"] = s.kind;
    if (cteNames.has(lower)) kind = "cte";
    else if (s.kind === "table" && s.schema && !KNOWN_SCHEMAS.has(s.schema.toLowerCase())) kind = "unknown";
    else if (s.kind === "table" && !s.schema) kind = "unknown";
    const key = `${s.schema ?? ""}.${s.name}|${kind}`;
    if (!agg.has(key)) agg.set(key, { name: s.name, schema: s.schema, alias: s.alias, kind, join_type: s.join_type, on: s.on, occurrences: 0 });
    const e = agg.get(key)!;
    e.occurrences++;
    if (s.join_type) e.join_type = s.join_type;
    if (s.on && !e.on) e.on = s.on;
  }
  return [...agg.values()];
}

/** Безопасное подмножество dataset detail: без owners/changed_by/email и прочих ПДн. */
export function safeDatasetMetadata(res: any): any {
  return {
    id: res?.id ?? null,
    table_name: res?.table_name ?? null,
    kind: res?.kind ?? null,
    schema: res?.schema ?? null,
    database: res?.database?.database_name ?? res?.database_name ?? null,
    description: res?.description ?? null,
    sql: typeof res?.sql === "string" ? res.sql : "",
    sql_len: typeof res?.sql === "string" ? res.sql.length : 0,
    main_dttm_col: res?.main_dttm_col ?? null,
    granularity_sqla: res?.granularity_sqla ?? null,
    changed_on: res?.changed_on ?? null,
    columns: (res?.columns ?? []).map((c: any) => ({
      column_name: c?.column_name ?? null,
      type: c?.type ?? null,
      is_dttm: c?.is_dttm ?? null,
      description: c?.description ?? null,
      verbose_name: c?.verbose_name ?? null,
      expression: c?.expression ?? null,
      filterable: c?.filterable ?? null,
      groupby: c?.groupby ?? null,
      is_active: c?.is_active ?? null,
    })),
    calculated_columns: (res?.calculated_columns ?? []).map((c: any) => ({
      column_name: c?.column_name ?? null,
      expression: c?.expression ?? null,
      verbose_name: c?.verbose_name ?? null,
      description: c?.description ?? null,
    })),
    metrics: (res?.metrics ?? []).map((m: any) => ({
      metric_name: m?.metric_name ?? null,
      expression: m?.expression ?? null,
      metric_type: m?.metric_type ?? null,
      verbose_name: m?.verbose_name ?? null,
      description: m?.description ?? null,
      warning_text: m?.warning_text ?? null,
    })),
  };
}

export function priority(total: number): "P0" | "P1" | "P2" | "OUT_OF_SCOPE" {
  if (total >= 70) return "P0";
  if (total >= 40) return "P1";
  if (total >= 1) return "P2";
  return "OUT_OF_SCOPE";
}

export const GRAIN_OVERRIDES: Record<number, { grain: string; pk: string; status: string; evidence: string }> = {
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

export const ENTITY_PATTERNS: Record<string, RegExp[]> = {
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

export const ENTITY_STATUS_OVERRIDES: Record<string, { status: string; note: string }> = {
  order: { status: "VERIFIED", note: "id_order/id_general используются в SQL joins" },
  order_item: { status: "UNKNOWN", note: "позиции заказа отдельной сущностью не подтверждены" },
  delivery: { status: "VERIFIED", note: "id_delivery_job/date_delivered/parcel_id" },
  shop: { status: "VERIFIED", note: "shopno/id_tt используются в joins и dict" },
  address: { status: "INFERRED", note: "координаты только из routing; адрес доставки как поле не подтверждён" },
  courier: { status: "VERIFIED", note: "id_courier/courier_id используются в joins" },
  assignment: { status: "INFERRED", note: "связь заказ↔курьер есть; события назначения нет" },
  route: { status: "VERIFIED", note: "parcel_id/id_route/cluster_id в routing" },
  shift: { status: "INFERRED", note: "подтверждены только первые 5 смен (7473)" },
  event: { status: "INFERRED", note: "event_name/status/flag_ без словаря" },
  zone: { status: "INFERRED", note: "зона доставки не подтверждена; inactivity_zone ≠ зона доставки" },
  accrual: { status: "UNKNOWN", note: "тарифы и начисления не подтверждены; sum_paid — не доход" },
  mentorship: { status: "INFERRED", note: "name_curator есть; роль наставника не подтверждена" },
};

export const PII_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "phone", re: /\+7[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/ },
  { name: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { name: "inn", re: /(?:inn|инн)["'\s:=]{1,4}\d{10,12}/i },
  { name: "bearer", re: /Bearer\s+[A-Za-z0-9._\-]+/i },
  { name: "password", re: /password\s*[:=]\s*["']?[^"'\s]{4,}/i },
  { name: "pii_field_value", re: /"(phone|inn|инн|телефон|fio|фио|name_courier|Курьер)"\s*:\s*"(?!null|\s*")[^"]{3,}"/ },
];

export function scanPii(text: string): Array<{ name: string; sample: string }> {
  const hits: Array<{ name: string; sample: string }> = [];
  for (const p of PII_PATTERNS) {
    const m = text.match(p.re);
    if (m) hits.push({ name: p.name, sample: m[0].slice(0, 40) });
  }
  return hits;
}
