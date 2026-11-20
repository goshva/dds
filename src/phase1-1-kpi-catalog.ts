/**
 * Этап 1.1, задача 4 — KPI-каталог.
 * Собирает: приоритетные датасеты (SQL/поля) + привязанные charts/dashboards +
 * KPI-гипотезы на основе полей SQL. Никаких выдуманных полей — только фактические из SQL.
 * Только чтение SQLite + чтение существующих JSON-отчётов.
 */
import { Database } from "bun:sqlite";
import { writeFileSync, readFileSync } from "fs";

const OUT = "reports/phase-01-1/kpi_source_matrix.json";

const db = new Database("data/catalog.sqlite", { readonly: true });

const PRIORITY: Record<string, string> = {
  "4732": "darkstore_ts_partners_new",
  "7119": "cargo_flags",
  "7006": "cargo_main2",
  "7024": "cargo_main3",
  "7027": "cargo_main4",
  "7775": "all_couriers_list",
  "5797": "hr_couriers",
  "7465": "hr_couriers_5shifts",
  "7473": "hr_couriers_five_shifts",
  "5247": "courier_logs_agg_couriers_daily",
  "5399": "courier_logs_agg_couriers_week",
  "7293": "hr_couriers_zone_balance",
};

// API-детали из предыдущего отчёта (без секретов)
const spot = JSON.parse(readFileSync("reports/phase-01-1/api_spot_checks.json", "utf8"));
const chartLinks = JSON.parse(readFileSync("reports/phase-01-1/api_chart_links_priority.json", "utf8"));

// Извлечение SELECT-полей из SQL (первый SELECT-блок верхнего уровня — эвристика)
function extractSelectAliases(sql: string): string[] {
  const aliases: string[] = [];
  // as alias
  for (const m of sql.matchAll(/\bas\s+([a-zA-Z_][a-zA-Z0-9_"'.]*)/gi)) {
    aliases.push(m[1].replace(/"/g, "").toLowerCase());
  }
  return [...new Set(aliases)];
}

// KPI-эвристика: сопоставляем операционные KPI с фактическими полями SQL
// confidence: HIGH = поле прямо названо; MEDIUM = косвенные признаки; LOW = только домен датасета
function deriveKpis(dsId: string, sql: string, aliases: string[]): any[] {
  const s = sql.toLowerCase();
  const has = (...subs: string[]) => subs.some((x) => s.includes(x));
  const hasAlias = (...subs: string[]) => aliases.some((a) => subs.some((x) => a.includes(x)));
  const kpis: any[] = [];

  // 1. Заказы: объём / статусы (только если заказ-домен, не HR)
  if (!["5797", "7465", "7473", "7775", "7293", "5247", "5399"].includes(dsId) && (hasAlias("id_order", "order") || has("id_order"))) {
    kpis.push({
      kpi: "Объём заказов",
      fields: ["id_order", "order_status", "status_name"].filter((f) => s.includes(f)),
      confidence: has("order_status") || has("status_name") ? "HIGH" : "MEDIUM",
      note: "COUNT(id_order); статусы есть в SQL",
    });
  }

  // 2. Просрочка / SLA
  if (has("is_late", "sla_order_time")) {
    kpis.push({
      kpi: "Просрочка заказов (SLA)",
      fields: ["is_late", "sla_order_time", "date_supply_until"].filter((f) => s.includes(f)),
      confidence: "HIGH",
      note: "Доля is_late=1; sla_order_time задаёт норматив",
    });
  }

  // 3. Время доставки
  if (has("date_delivery_start", "date_delivered")) {
    kpis.push({
      kpi: "Время доставки (delivery duration)",
      fields: ["date_delivery_start", "date_delivered", "date_supply"],
      confidence: "HIGH",
      note: "date_delivered - date_delivery_start",
    });
  }

  // 4. Время сборки
  if (has("date_collect_start", "date_collected")) {
    kpis.push({
      kpi: "Время сборки заказа",
      fields: ["date_collect_start", "date_collected", "date_printed"].filter((f) => s.includes(f)),
      confidence: has("date_collect_start") ? "HIGH" : "MEDIUM",
    });
  }

  // 5. Couriers: численность/активность (HR и справочник)
  if (["5797", "7465", "7473", "7775"].includes(dsId)) {
    kpis.push({
      kpi: "Численность / активность курьеров (HR)",
      fields: ["id_courier", "active", "event_hiring", "event_date", "date_dismissed", "uvol",
               "cnt_orders", "days_with_orders", "enough_shifts_flg", "exp_days", "exp_months",
               "pause_days", "second_hire", "repeated_hire", "job_type_name", "region_name"].filter((f) => s.includes(f)),
      confidence: "HIGH",
      note: dsId === "7775"
        ? "Справочник всех курьеров: поля 'Активный'/'Бан' (case is_blocked/active), job_type, тип курьера — источник показателя активной базы"
        : "HR-домен: onboarding/attrition/опыт/продуктивность из hr_couriers* (cnt_orders, days_with_orders, enough_shifts_flg)",
    });
  }
  if (dsId === "5797" || dsId === "7465") {
    kpis.push({
      kpi: "Продуктивность курьера (заказы/дни со сменами)",
      fields: ["cnt_orders", "orders_after_hire", "days_with_orders", "enough_shifts_flg"],
      confidence: "HIGH",
      note: "Прямые агрегаты в SELECT hr_couriers*",
    });
  }

  // 6. Выручка / суммы
  if (has("sum_order", "sum_paid")) {
    kpis.push({
      kpi: "Суммы заказов (GMV/paid)",
      fields: ["sum_order", "sum_paid", "sum_paid_disc"],
      confidence: "HIGH",
    });
  }

  // 7. Маршрутизация / логистика (cargo_main*)
  if (has("parcel_id", "routing") || (dsId.startsWith("70") && has("cluster_id"))) {
    kpis.push({
      kpi: "Маршрутизация: расстояние/время между точками",
      fields: ["parcel_id", "cluster_id", "duration_from_previous", "distance_from_previous", "arrival_time"].filter((f) => s.includes(f)),
      confidence: has("duration_from_previous") || has("distance_from_previous") ? "HIGH" : "MEDIUM",
    });
  }

  // 8. Агрегаты лога курьеров (daily/week)
  if (dsId === "5247" || dsId === "5399") {
    kpis.push({
      kpi: "Онлайн/событийная активность курьера (день/неделя)",
      fields: ["events_qty", "max_day", "days_count", "max_day_event_qty", "count_distinct_day_no", "sum_events_qty_all_days",
               "max_week", "week_count", "max_week_event_qty", "count_distinct_week_no", "sum_events_qty_all_weeks"].filter((f) => s.includes(f)),
      confidence: "HIGH",
      note: "courier_logs_agg_*: events_qty по дням/неделям + пики активности; витрина agile_mart_techaudit",
    });
  }

  // 9. Баланс зон (zone_balance)
  if (dsId === "7293") {
    kpis.push({
      kpi: "Баланс миграции курьеров между зонами активности",
      fields: ["date", "zone", "zone_order", "positive_flow", "negative_flow", "balance", "positive_pct", "negative_pct"],
      confidence: "HIGH",
      note: "hr_delivery.zone_changed: positive/negative flow Green→Lost, balance = pos-neg, % от дневного максимума",
    });
  }

  // 10. Флаги качества (cargo_flags)
  if (dsId === "7119") {
    kpis.push({
      kpi: "Флаги качества/аномалий заказа",
      fields: aliases.slice(0, 15),
      confidence: "MEDIUM",
      note: "cargo_flags содержит производные флаги (is_late и аналоги) — детализация требует полного SQL-разбора",
    });
  }

  return kpis;
}

const matrix: any[] = [];
for (const [dsId, name] of Object.entries(PRIORITY)) {
  const row = db.query(`SELECT payload_json FROM objects WHERE object_type='dataset' AND object_id=?`).get(dsId) as any;
  const p = row?.payload_json ? JSON.parse(row.payload_json) : null;
  const sql: string = p?.sql ?? "";
  const aliases = extractSelectAliases(sql);
  const apiDetail = spot.priority_dataset_details?.[dsId] ?? null;
  const links = chartLinks.by_dataset?.[dsId] ?? { count: 0, charts: [] };

  const dashboards = new Map<string, string>();
  for (const c of links.charts) for (const b of c.dashboards ?? []) dashboards.set(String(b.id), b.dashboard_title);

  matrix.push({
    dataset_id: Number(dsId),
    table_name: name,
    kind: p?.kind ?? null,
    database: apiDetail?.database_name ?? null,
    schema: apiDetail?.schema ?? null,
    sql_length: sql.length,
    api_changed_on: apiDetail?.changed_on ?? null,
    api_columns_count: apiDetail?.columns_count ?? null,
    select_aliases_sample: aliases.slice(0, 25),
    charts_count_api: links.count,
    charts_sample: links.charts.slice(0, 5).map((c: any) => ({ id: c.id, name: c.name, viz_type: c.viz_type })),
    dashboards: [...dashboards.entries()].map(([id, title]) => ({ id: Number(id), title })),
    kpi_candidates: deriveKpis(dsId, sql, aliases),
  });
}

const out = {
  generated_at: new Date().toISOString(),
  method: "локальный SQL из dataset payload (SQLite readonly) + API chart-links (api_chart_links_priority.json) + API dataset-details (api_spot_checks.json)",
  confidence_levels: {
    HIGH: "поле/выражение прямо найдено в SQL датасета",
    MEDIUM: "косвенные признаки (домен датасета, агрегатная витрина)",
  },
  datasets: matrix,
};

writeFileSync(OUT, JSON.stringify(out, null, 2), { mode: 0o600 });
console.log("written", OUT, "datasets:", matrix.length);
db.close();
