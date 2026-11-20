/**
 * Этап 1.1, задача 4 — KPI Source Matrix для 18 показателей операционной модели.
 *
 * Источник — только полные detail JSON 12 приоритетных датасетов
 * (output/dataset_details/<id>.json): result.sql, result.columns, result.metrics,
 * result.calculated_columns. SQLite не изменяется.
 *
 * Принципы:
 *  - поля не выдумываются: каждое поле в evidence проверяется по columns/metrics/SQL;
 *  - статус FOUND/PARTIAL/NOT_FOUND/NOT_VERIFIED отражает только подтверждённые данные;
 *  - sum_order не считается доходом курьера, events_qty не считается явкой без семантики;
 *  - PII-поля перечисляются как имена, но их значения не выгружаются.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";

const DETAILS_DIR = "output/dataset_details";
const OUT_DIR = "reports/phase-01-1";
const OUT_JSON = join(OUT_DIR, "kpi_source_matrix.json");
const OUT_MD = join(OUT_DIR, "kpi_source_matrix.md");

const PRIORITY_IDS = [4732, 7119, 7006, 7024, 7027, 7775, 5797, 7465, 7473, 5247, 5399, 7293];

type DatasetInfo = {
  id: number;
  table_name: string;
  kind: string;
  database: string | null;
  schema: string | null;
  sql: string;
  sql_length: number;
  columns: string[];
  metrics: string[];
  calculated_columns: string[];
  pii_columns: string[];
  changed_on: string | null;
};

const PII_PATTERNS: RegExp[] = [
  /^inn$/i,
  /^user_inn$/i,
  /^инн$/i,
  /^phone$/i,
  /^телефон$/i,
  /^fio$/i,
  /^name_courier$/i,
  /^курьер$/i,
  /^email$/i,
  /^passport/i,
  /^snils/i,
  /^birth/i,
];

function findPii(columns: string[]): string[] {
  return columns.filter((c) => PII_PATTERNS.some((re) => re.test(c)));
}

function loadDatasets(): Map<number, DatasetInfo> {
  const map = new Map<number, DatasetInfo>();
  const files = readdirSync(DETAILS_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(DETAILS_DIR, file), "utf8"));
    const res = raw?.result;
    if (!res) continue;
    const id = Number(res.id);
    if (!PRIORITY_IDS.includes(id)) continue;
    const columns = Array.isArray(res.columns)
      ? res.columns.map((c: any) => String(c?.column_name ?? ""))
      : [];
    const metrics = Array.isArray(res.metrics)
      ? res.metrics.map((m: any) => String(m?.metric_name ?? ""))
      : [];
    const calculated_columns = Array.isArray(res.calculated_columns)
      ? res.calculated_columns.map((c: any) => String(c?.column_name ?? ""))
      : [];
    map.set(id, {
      id,
      table_name: String(res.table_name ?? ""),
      kind: String(res.kind ?? ""),
      database: res.database?.database_name ?? res.database_name ?? null,
      schema: res.schema ?? null,
      sql: String(res.sql ?? ""),
      sql_length: typeof res.sql === "string" ? res.sql.length : 0,
      columns,
      metrics,
      calculated_columns,
      pii_columns: findPii(columns),
      changed_on: res.changed_on ?? null,
    });
  }
  return map;
}

type KpiStatus = "FOUND" | "PARTIAL" | "NOT_FOUND" | "NOT_VERIFIED";

type KpiEvidence = {
  dataset_id: number;
  table_name: string;
  fields: string[];
  metrics?: string[];
  note?: string;
};

type KpiDef = {
  id: string;
  name: string;
  declared_status: KpiStatus;
  definition: string;
  formula_hint: string;
  evidence: KpiEvidence[];
  caveats: string[];
};

const KPIS: KpiDef[] = [
  {
    id: "orders_volume",
    name: "Объём заказов",
    declared_status: "FOUND",
    definition: "Количество заказов и их распределение по статусам/типам.",
    formula_hint: "COUNT(id_order) / COUNT(DISTINCT id_order); группировка по order_status, gettype.",
    evidence: [
      {
        dataset_id: 4732,
        table_name: "darkstore_ts_partners_new",
        fields: ["id_order", "id_general", "order_status", "gettype"],
        metrics: ["qty_orders_all", "qty_orders_delivered", "qty_orders_declined"],
        note: "Прямые поля заказа и готовые метрики объёма.",
      },
      {
        dataset_id: 7006,
        table_name: "cargo_main2",
        fields: ["id_order", "id_pool", "gettype"],
        note: "Заказ присутствует в логистическом контуре cargo_main.",
      },
      {
        dataset_id: 7024,
        table_name: "cargo_main3",
        fields: ["id_pool", "gettype"],
        note: "Пул/маршрут; id_order не входит в список колонок.",
      },
      {
        dataset_id: 7027,
        table_name: "cargo_main4",
        fields: ["id_order", "id_pool", "gettype"],
        note: "Заказ присутствует в логистическом контуре cargo_main.",
      },
    ],
    caveats: ["id_order подтверждён не во всех cargo_main*; для 7024 объём заказов напрямую не подтверждён."],
  },
  {
    id: "sla_late",
    name: "Просрочка заказов (SLA)",
    declared_status: "FOUND",
    definition: "Доля заказов с нарушением SLA и величина просрочки.",
    formula_hint: "AVG(is_late); AVG(minutes_late); сравнение date_delivered/date_supply_until.",
    evidence: [
      {
        dataset_id: 4732,
        table_name: "darkstore_ts_partners_new",
        fields: ["sla_order_time", "sla_collection_time_all", "sla_delivery_time_all", "date_supply_untill", "date_status_10"],
        note: "Нормативы SLA и контрольная дата поставки.",
      },
      {
        dataset_id: 7006,
        table_name: "cargo_main2",
        fields: ["is_late", "minutes_late", "plan_late_minute", "planned_late", "sla_order_time", "date_supply_until"],
        note: "Прямые флаги и минуты просрочки.",
      },
      {
        dataset_id: 7027,
        table_name: "cargo_main4",
        fields: ["is_late", "fact_minutes_late", "plan_late_minute", "planned_late", "sla_order_time", "date_supply_until"],
        note: "Прямые флаги и минуты просрочки.",
      },
      {
        dataset_id: 7119,
        table_name: "cargo_flags",
        fields: ["is_late", "fact_minutes_late", "flag_is_near_deadline", "flag_planned_1_minute_late", "sla_order_time"],
        note: "Флаговый контур качества/аномалий.",
      },
    ],
    caveats: ["Семантика sla_order_time едина для 4732 и cargo_main* не подтверждена; формулы могут различаться."],
  },
  {
    id: "delivery_duration",
    name: "Время доставки",
    declared_status: "FOUND",
    definition: "Длительность доставки от старта до вручения.",
    formula_hint: "date_delivered - date_delivery_start; duration_fact; delivery_time.",
    evidence: [
      {
        dataset_id: 4732,
        table_name: "darkstore_ts_partners_new",
        fields: ["date_delivery_start", "date_delivered", "delivery_time", "delivery_time_all"],
        note: "Прямые временные метки и длительность.",
      },
      {
        dataset_id: 7006,
        table_name: "cargo_main2",
        fields: ["duration_fact", "duration_plan", "date_pickuped", "date_delivered"],
        note: "Факт/план длительности.",
      },
      {
        dataset_id: 7024,
        table_name: "cargo_main3",
        fields: ["fact_duration_min", "plan_duration_min", "date_delivered"],
        note: "Факт/план длительности в минутах.",
      },
      {
        dataset_id: 7027,
        table_name: "cargo_main4",
        fields: ["fact_duration_min", "plan_duration_min", "date_pickuped", "date_delivered"],
        note: "Факт/план длительности в минутах.",
      },
    ],
    caveats: ["Единицы измерения (секунды/минуты) различаются между 4732 и cargo_main*; требуется унификация."],
  },
  {
    id: "assembly_duration",
    name: "Время сборки заказа",
    declared_status: "FOUND",
    definition: "Длительность сборки заказа на тёмной/обычной точке.",
    formula_hint: "date_collected - date_collect_start; collection_time.",
    evidence: [
      {
        dataset_id: 4732,
        table_name: "darkstore_ts_partners_new",
        fields: ["date_collect_start", "date_collected", "date_printed", "collection_time", "collection_time_all", "date_collect_start_plan", "date_collected_plan"],
        note: "Прямые метки старта/завершения сборки и план.",
      },
      {
        dataset_id: 7006,
        table_name: "cargo_main2",
        fields: ["date_collected"],
        note: "Только дата сборки; старт сборки не подтверждён.",
      },
      {
        dataset_id: 7027,
        table_name: "cargo_main4",
        fields: ["date_collected"],
        note: "Только дата сборки; старт сборки не подтверждён.",
      },
    ],
    caveats: ["В cargo_main* нет date_collect_start; длительность сборки там не вычисляется без внешнего источника."],
  },
  {
    id: "gmv",
    name: "Суммы заказов (GMV/paid)",
    declared_status: "FOUND",
    definition: "Стоимость заказа и оплаченная сумма.",
    formula_hint: "SUM(sum_order); SUM(sum_paid); SUM(sum_paid_disc).",
    evidence: [
      {
        dataset_id: 4732,
        table_name: "darkstore_ts_partners_new",
        fields: ["sum_order", "sum_paid", "sum_paid_disc", "sum_paid_sheet"],
        metrics: ["sum_without_bonuses", "avg_sum"],
        note: "Прямые суммы заказа и оплаты.",
      },
    ],
    caveats: [
      "sum_order — сумма заказа, а не доход курьера; для дохода курьера использовать 7473 shift_*_profit.",
      "GMV подтверждён только по 4732; в cargo_main* суммы не входят в список колонок.",
    ],
  },
  {
    id: "routing",
    name: "Маршрутизация: расстояние/время между точками",
    declared_status: "FOUND",
    definition: "Параметры маршрута: расстояние, время между точками, порядок объезда.",
    formula_hint: "SUM(distance); SUM(duration_fact); сравнение plan_seq/fact_seq.",
    evidence: [
      {
        dataset_id: 7006,
        table_name: "cargo_main2",
        fields: ["duration_fact", "duration_plan", "pickup_minute", "pickup_to_courier_minute", "arrival_time", "plan_arrival_deadline", "cluster_id", "id_pool", "plan_seq", "fact_seq"],
        note: "Прямые параметры маршрута.",
      },
      {
        dataset_id: 7024,
        table_name: "cargo_main3",
        fields: ["distance", "delta_pct", "fact_duration_min", "plan_duration_min", "cluster_id", "id_pool"],
        note: "Расстояние и отклонение.",
      },
      {
        dataset_id: 7027,
        table_name: "cargo_main4",
        fields: ["total_pool_distance", "fact_duration_min", "plan_duration_min", "arrival_time", "cluster_id", "id_pool", "plan_seq", "fact_seq"],
        note: "Расстояние пула и времена.",
      },
    ],
    caveats: ["Геометрия маршрута (координаты) в detail не подтверждена; distance/duration — агрегаты."],
  },
  {
    id: "headcount",
    name: "Численность / активная база курьеров",
    declared_status: "FOUND",
    definition: "Число курьеров, активных/заблокированных, по типу занятости и зоне.",
    formula_hint: "COUNT(DISTINCT id_courier); фильтры active, is_banned, job_type.",
    evidence: [
      {
        dataset_id: 7775,
        table_name: "all_couriers_list",
        fields: ["ID", "id_courier_type", "job_type", "Активный", "Бан", "Тип занятости", "Тип курьера"],
        note: "Справочник всех курьеров; PII-поля не выгружаются.",
      },
      {
        dataset_id: 5797,
        table_name: "hr_couriers",
        fields: ["id_courier", "active", "is_banned", "is_blocked", "job_type_name", "region_name"],
        note: "HR-контур: активность и блокировки.",
      },
      {
        dataset_id: 7465,
        table_name: "hr_couriers_5shifts",
        fields: ["id_courier", "active", "is_banned", "is_blocked", "job_type_name", "region_name"],
        note: "HR-контур: активность и блокировки.",
      },
      {
        dataset_id: 7473,
        table_name: "hr_couriers_five_shifts",
        fields: ["id_courier", "is_banned", "job_type_name", "region_name"],
        note: "HR-контур пяти смен; поле active отсутствует.",
      },
    ],
    caveats: ["7775 содержит PII (ИНН, телефон); в отчётах используются только имена полей."],
  },
  {
    id: "productivity",
    name: "Продуктивность курьера (заказы/дни со сменами)",
    declared_status: "FOUND",
    definition: "Заказы на курьера и число дней с заказами.",
    formula_hint: "SUM(cnt_orders); AVG(days_with_orders); доля enough_shifts_flg.",
    evidence: [
      {
        dataset_id: 5797,
        table_name: "hr_couriers",
        fields: ["cnt_orders", "orders_after_hire", "days_with_orders", "enough_shifts_flg", "first_order_date", "last_order_date"],
        note: "Прямые агрегаты продуктивности.",
      },
      {
        dataset_id: 7465,
        table_name: "hr_couriers_5shifts",
        fields: ["cnt_orders", "orders_after_hire", "days_with_orders", "enough_shifts_flg", "first_order_date", "last_order_date"],
        note: "Прямые агрегаты продуктивности.",
      },
      {
        dataset_id: 7473,
        table_name: "hr_couriers_five_shifts",
        fields: ["last_order_date", "fifth_shift_date", "shifts_in_14_days"],
        note: "Косвенные признаки продуктивности через даты заказов/смен.",
      },
    ],
    caveats: ["Метрика не учитывает почасовую производительность; для неё нужен доход/часы."],
  },
  {
    id: "shifts",
    name: "Смены (фактические выходы)",
    declared_status: "PARTIAL",
    definition: "Количество и параметры смен курьера.",
    formula_hint: "COUNT(shift_*); SUM(shift_*_work_minutes); shifts_in_14_days.",
    evidence: [
      {
        dataset_id: 7473,
        table_name: "hr_couriers_five_shifts",
        fields: ["shift_1", "shift_2", "shift_3", "shift_4", "shift_5", "shifts_in_14_days", "fifth_shift_date", "fifth_shift_status", "days_to_fifth_shift", "had_enough_time"],
        note: "Пять смен новичка и их атрибуты.",
      },
      {
        dataset_id: 5797,
        table_name: "hr_couriers",
        fields: ["shifts_in_first_14d", "5_shifts_in_14d", "is_5_shifts_in_14d", "has_5_shifts_in_first_14d", "enough_shifts_flg"],
        note: "Признаки смен в первые 14 дней.",
      },
      {
        dataset_id: 7465,
        table_name: "hr_couriers_5shifts",
        fields: ["shifts_in_first_14d", "5_shifts_in_14d", "is_5_shifts_in_14d", "has_5_shifts_in_first_14d", "enough_shifts_flg"],
        note: "Признаки смен в первые 14 дней.",
      },
    ],
    caveats: [
      "Подтверждённая модель смен ограничена первыми 5 сменами новичка (five_shifts) и 14-дневным окном.",
      "Полной таблицы смен/графика по всем курьерам в 12 detail не найдено.",
    ],
  },
  {
    id: "attendance",
    name: "Явка на смену",
    declared_status: "NOT_VERIFIED",
    definition: "Факт выхода курьера на смену относительно плана.",
    formula_hint: "Не подтверждена; events_qty не является явкой без семантики событий.",
    evidence: [
      {
        dataset_id: 5247,
        table_name: "courier_logs_agg_couriers_daily",
        fields: ["event_name", "events_qty", "courier_id", "d", "dey", "week_no"],
        note: "Событийный лог; семантика event_name не подтверждена.",
      },
      {
        dataset_id: 5399,
        table_name: "courier_logs_agg_couriers_week",
        fields: ["event_name", "events_qty", "courier_id", "d", "dey", "week_no"],
        note: "Событийный лог; семантика event_name не подтверждена.",
      },
    ],
    caveats: [
      "events_qty — количество событий, а не явка. Нужна расшифровка event_name и связь с планом смен.",
      "Планового графика смен в 12 detail нет.",
    ],
  },
  {
    id: "no_shows",
    name: "Невыходы",
    declared_status: "NOT_FOUND",
    definition: "Количество/доля невыходов на смену.",
    formula_hint: "Не найдено подтверждённого поля невыхода.",
    evidence: [
      {
        dataset_id: 5797,
        table_name: "hr_couriers",
        fields: ["no_orders_days_streak", "pause_days"],
        note: "Косвенные признаки простоя/паузы, но не невыход.",
      },
    ],
    caveats: ["no_orders_days_streak и pause_days не являются невыходом; статус NOT_FOUND."],
  },
  {
    id: "shifts_12h",
    name: "12-часовые смены",
    declared_status: "PARTIAL",
    definition: "Смены длительностью 12 часов и их доля.",
    formula_hint: "shift_*_work_minutes >= 720; группировка по сменам.",
    evidence: [
      {
        dataset_id: 7473,
        table_name: "hr_couriers_five_shifts",
        fields: ["shift_1_work_minutes", "shift_2_work_minutes", "shift_3_work_minutes", "shift_4_work_minutes", "shift_5_work_minutes"],
        note: "Минуты работы по пяти сменам; 12 часов вычисляются как 720 минут.",
      },
    ],
    caveats: [
      "Порог 720 минут — вычисление, а не сохранённый признак 12-часовой смены.",
      "Модель ограничена первыми 5 сменами новичка.",
    ],
  },
  {
    id: "trips",
    name: "Ходки",
    declared_status: "NOT_VERIFIED",
    definition: "Количество ходок (рейсов) курьера.",
    formula_hint: "Кандидат: COUNT(DISTINCT id_pool) по курьеру; семантика ходки не подтверждена.",
    evidence: [
      {
        dataset_id: 7006,
        table_name: "cargo_main2",
        fields: ["id_pool", "id_courier", "fact_seq", "plan_seq"],
        note: "id_pool — пул/маршрут; прямая связь с понятием «ходка» не подтверждена.",
      },
      {
        dataset_id: 7027,
        table_name: "cargo_main4",
        fields: ["id_pool", "id_courier", "fact_seq", "plan_seq"],
        note: "id_pool — пул/маршрут; прямая связь с понятием «ходка» не подтверждена.",
      },
    ],
    caveats: ["Поля trip/trip_id/ходка в detail не найдены; id_pool нельзя выдавать за ходку без подтверждения."],
  },
  {
    id: "orders_per_trip",
    name: "Заказы в ходке",
    declared_status: "NOT_VERIFIED",
    definition: "Среднее/распределение числа заказов в одной ходке.",
    formula_hint: "COUNT(id_order) / COUNT(DISTINCT id_pool); семантика ходки не подтверждена.",
    evidence: [
      {
        dataset_id: 7006,
        table_name: "cargo_main2",
        fields: ["id_order", "id_pool", "pool_size", "fact_seq"],
        note: "Заказы и пул; pool_size — размер пула.",
      },
      {
        dataset_id: 7027,
        table_name: "cargo_main4",
        fields: ["id_order", "id_pool", "pool_size", "fact_seq"],
        note: "Заказы и пул; pool_size — размер пула.",
      },
    ],
    caveats: ["pool_size — размер пула, а не подтверждённое число заказов в ходке."],
  },
  {
    id: "available_pool",
    name: "Доступный пул заказов",
    declared_status: "NOT_VERIFIED",
    definition: "Объём доступных заказов/пула для назначения курьеру.",
    formula_hint: "pool_size; late_orders_cnt_in_pool; flag_courier_shortage.",
    evidence: [
      {
        dataset_id: 7006,
        table_name: "cargo_main2",
        fields: ["pool_size", "pool_size_text", "flag_courier_shortage", "id_pool"],
        note: "Размер пула и флаг нехватки курьеров.",
      },
      {
        dataset_id: 7024,
        table_name: "cargo_main3",
        fields: ["pool_size", "id_pool"],
        note: "Размер пула.",
      },
      {
        dataset_id: 7027,
        table_name: "cargo_main4",
        fields: ["pool_size", "late_orders_cnt_in_pool", "max_fact_late_in_pool", "sum_fact_late_minutes_in_pool", "flag_courier_shortage", "id_pool"],
        note: "Размер пула и просрочки внутри пула.",
      },
      {
        dataset_id: 7119,
        table_name: "cargo_flags",
        fields: ["pool_size", "late_orders_cnt_in_pool", "max_fact_late_in_pool", "sum_fact_late_minutes_in_pool", "flag_courier_shortage", "id_pool"],
        note: "Флаговый контур пула.",
      },
    ],
    caveats: [
      "pool_size — размер пула, но бизнес-определение «доступного пула заказов» не подтверждено.",
      "Нет полей свободных/неназначенных заказов.",
    ],
  },
  {
    id: "idle_time",
    name: "Простои",
    declared_status: "PARTIAL",
    definition: "Время ожидания/простоя курьера.",
    formula_hint: "wait_time; pickup_minute; pickup_to_courier_minute; flag_wait_orders_with_planlate.",
    evidence: [
      {
        dataset_id: 4732,
        table_name: "darkstore_ts_partners_new",
        fields: ["wait_time", "wait_time2", "waiting_area_time", "collection_time", "delivery_time"],
        note: "Поля ожидания; семантика не подтверждена.",
      },
      {
        dataset_id: 7006,
        table_name: "cargo_main2",
        fields: ["pickup_minute", "pickup_to_courier_minute", "duration_plan", "duration_fact", "minutes_late"],
        note: "Времена ожидания/подачи.",
      },
      {
        dataset_id: 7027,
        table_name: "cargo_main4",
        fields: ["flag_wait_orders_with_planlate", "flag_wait_orders_with_near_deadline"],
        note: "Флаги ожидания заказов.",
      },
    ],
    caveats: ["Нет подтверждённой формулы простоя; wait_time* могут означать разные интервалы."],
  },
  {
    id: "courier_income_per_hour",
    name: "Доход курьера в час",
    declared_status: "PARTIAL",
    definition: "Доход курьера, нормированный на часы работы.",
    formula_hint: "shift_*_profit / (shift_*_work_minutes / 60).",
    evidence: [
      {
        dataset_id: 7473,
        table_name: "hr_couriers_five_shifts",
        fields: ["shift_1_profit", "shift_2_profit", "shift_3_profit", "shift_4_profit", "shift_5_profit", "shift_1_work_minutes", "shift_2_work_minutes", "shift_3_work_minutes", "shift_4_work_minutes", "shift_5_work_minutes", "thresholds_taken_payments"],
        note: "Прибыль и минуты по пяти сменам; доход в час вычисляется.",
      },
    ],
    caveats: [
      "sum_order/sum_paid — суммы заказа, а не доход курьера; для дохода используется shift_*_profit.",
      "Модель ограничена первыми 5 сменами новичка; выплаты/удержания не подтверждены.",
    ],
  },
  {
    id: "retention",
    name: "Удержание курьеров",
    declared_status: "FOUND",
    definition: "Удержание/отток курьеров, возвраты и переходы по зонам.",
    formula_hint: "turnover; attrition; ret_14_d; returns; second_hire; balance_*.",
    evidence: [
      {
        dataset_id: 5797,
        table_name: "hr_couriers",
        fields: ["uvol", "date_dismissed", "event_hiring", "second_hire", "repeated_hire", "active", "enough_shifts_flg", "first_order_date", "last_order_date", "pause_days", "no_orders_days_streak", "inactivity_zone", "zone_changed", "zone_transition_type"],
        metrics: ["turnover", "attrition", "ret_14_d", "returns", "hirings_qty", "dismissal_qty", "newcomers"],
        note: "HR-контур удержания и оттока.",
      },
      {
        dataset_id: 7465,
        table_name: "hr_couriers_5shifts",
        fields: ["uvol", "date_dismissed", "event_hiring", "second_hire", "repeated_hire", "active", "enough_shifts_flg", "first_order_date", "last_order_date", "pause_days", "no_orders_days_streak", "inactivity_zone", "zone_changed", "zone_transition_type"],
        metrics: ["turnover", "attrition", "ret_14_d", "returns", "hirings_qty", "dismissal_qty", "newcomers"],
        note: "HR-контур удержания и оттока.",
      },
      {
        dataset_id: 7473,
        table_name: "hr_couriers_five_shifts",
        fields: ["repeated_hiring", "fifth_shift_status", "had_enough_time", "thresholds_taken", "last_order_date", "inactivity_zone_ordered", "zone_transition_type"],
        metrics: ["turnover", "attrition", "ret_14_d", "returns", "hirings_qty", "dismissal_qty", "newcomers"],
        note: "HR-контур пяти смен.",
      },
      {
        dataset_id: 7293,
        table_name: "hr_couriers_zone_balance",
        fields: ["date", "zone", "zone_order", "positive_flow", "negative_flow", "balance", "positive_pct", "negative_pct"],
        note: "Баланс миграции между зонами.",
      },
    ],
    caveats: ["Метрики turnover/attrition определены в SQL датасета; единая корпоративная формула удержания не подтверждена."],
  },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fieldFound(ds: DatasetInfo, field: string): boolean {
  const f = field.toLowerCase();
  if (ds.columns.some((c) => c.toLowerCase() === f)) return true;
  if (ds.calculated_columns.some((c) => c.toLowerCase() === f)) return true;
  if (ds.metrics.some((m) => m.toLowerCase() === f)) return true;
  // SQL alias/field (boundary-aware, чтобы не ловить подстроки)
  const re = new RegExp(`(^|[^a-zA-Z0-9_])${escapeRegExp(f)}([^a-zA-Z0-9_]|$)`, "i");
  return re.test(ds.sql);
}

function verifyKpi(kpi: KpiDef, datasets: Map<number, DatasetInfo>) {
  const issues: string[] = [];
  const verifiedEvidence: any[] = [];
  for (const ev of kpi.evidence) {
    const ds = datasets.get(ev.dataset_id);
    if (!ds) {
      issues.push(`dataset ${ev.dataset_id} not found in detail JSON`);
      verifiedEvidence.push({ ...ev, verified: false, missing_fields: ev.fields });
      continue;
    }
    const missingFields = ev.fields.filter((f) => !fieldFound(ds, f));
    const missingMetrics = (ev.metrics ?? []).filter((m) => !fieldFound(ds, m));
    const verified = missingFields.length === 0 && missingMetrics.length === 0;
    if (!verified) {
      issues.push(
        `dataset ${ev.dataset_id} (${ds.table_name}): missing fields=[${missingFields.join(", ")}] metrics=[${missingMetrics.join(", ")}]`,
      );
    }
    verifiedEvidence.push({
      ...ev,
      verified,
      missing_fields: missingFields,
      missing_metrics: missingMetrics,
    });
  }
  const status: KpiStatus = issues.length === 0 ? kpi.declared_status : "NOT_VERIFIED";
  return { status, issues, evidence: verifiedEvidence };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const datasets = loadDatasets();
  const missingIds = PRIORITY_IDS.filter((id) => !datasets.has(id));
  if (missingIds.length) {
    console.error(`[KPI] missing detail JSON for priority datasets: ${missingIds.join(", ")}`);
    process.exitCode = 1;
  }

  const kpis = KPIS.map((kpi) => {
    const verified = verifyKpi(kpi, datasets);
    return {
      id: kpi.id,
      name: kpi.name,
      status: verified.status,
      declared_status: kpi.declared_status,
      definition: kpi.definition,
      formula_hint: kpi.formula_hint,
      evidence_verified: verified.issues.length === 0,
      evidence_issues: verified.issues,
      evidence: verified.evidence,
      caveats: kpi.caveats,
    };
  });

  const statusCounts: Record<string, number> = { FOUND: 0, PARTIAL: 0, NOT_FOUND: 0, NOT_VERIFIED: 0 };
  for (const k of kpis) statusCounts[k.status] = (statusCounts[k.status] ?? 0) + 1;

  const datasetRows = [...datasets.values()]
    .sort((a, b) => PRIORITY_IDS.indexOf(a.id) - PRIORITY_IDS.indexOf(b.id))
    .map((ds) => ({
      dataset_id: ds.id,
      table_name: ds.table_name,
      kind: ds.kind,
      database: ds.database,
      schema: ds.schema,
      sql_length: ds.sql_length,
      columns_count: ds.columns.length,
      metrics_count: ds.metrics.length,
      calculated_columns_count: ds.calculated_columns.length,
      changed_on: ds.changed_on,
      pii_columns: ds.pii_columns,
    }));

  const out = {
    generated_at: new Date().toISOString(),
    source: "output/dataset_details/*.json — полные detail 12 приоритетных датасетов (SQL, columns, metrics, calculated_columns)",
    kpi_model: {
      name: "Операционная модель — 18 показателей",
      count: kpis.length,
      statuses: ["FOUND", "PARTIAL", "NOT_FOUND", "NOT_VERIFIED"],
      status_counts: statusCounts,
    },
    datasets: datasetRows,
    kpis,
    limitations: [
      "Матрица отражает только 12 приоритетных датасетов; остальные 3 759 датасетов не проверялись.",
      "Статус FOUND означает наличие подтверждённых полей/метрик, а не согласованную бизнес-формулу.",
      "sum_order/sum_paid — суммы заказа, а не доход курьера.",
      "events_qty — события, а не явка; семантика event_name не подтверждена.",
      "Модель смен ограничена первыми 5 сменами новичка и 14-дневным окном.",
      "Ходки и доступный пул заказов не подтверждены как бизнес-сущности.",
      "PII-поля перечислены как имена; их значения не выгружаются.",
    ],
    pii_note: "PII-поля присутствуют в 4732, 5797, 7465, 7473, 7775; в отчётах используются только имена полей.",
  };

  writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), { mode: 0o600 });

  const md: string[] = [];
  md.push("# KPI Source Matrix — 18 показателей операционной модели");
  md.push("");
  md.push(`Сгенерировано: ${out.generated_at}`);
  md.push("");
  md.push("Источник: полные detail JSON 12 приоритетных датасетов (`output/dataset_details/*.json`).");
  md.push("");
  md.push("## Статусы");
  md.push("");
  md.push("| Статус | Кол-во |");
  md.push("|---|---:|");
  for (const s of ["FOUND", "PARTIAL", "NOT_FOUND", "NOT_VERIFIED"]) {
    md.push(`| ${s} | ${statusCounts[s] ?? 0} |`);
  }
  md.push("");
  md.push("## Матрица");
  md.push("");
  md.push("| # | KPI | Статус | Подтверждённые датасеты | Поля/метрики | Формула/примечание |");
  md.push("|---:|---|---|---|---|---|");
  kpis.forEach((k, i) => {
    const dsList = k.evidence
      .filter((e: any) => e.verified)
      .map((e: any) => `${e.dataset_id} ${e.table_name}`)
      .join("; ");
    const fields = k.evidence
      .filter((e: any) => e.verified)
      .flatMap((e: any) => [...e.fields, ...(e.metrics ?? [])])
      .slice(0, 18)
      .join(", ");
    md.push(`| ${i + 1} | ${k.name} | ${k.status} | ${dsList || "—"} | ${fields || "—"} | ${k.formula_hint} |`);
  });
  md.push("");
  md.push("## Ограничения");
  md.push("");
  for (const l of out.limitations) md.push(`- ${l}`);
  md.push("");
  md.push("## PII");
  md.push("");
  md.push(out.pii_note);
  md.push("");
  md.push("## Проблемы верификации полей");
  md.push("");
  const issues = kpis.filter((k) => !k.evidence_verified);
  if (issues.length === 0) {
    md.push("Все заявленные поля найдены в detail JSON.");
  } else {
    for (const k of issues) {
      md.push(`- **${k.name}** (${k.status}):`);
      for (const issue of k.evidence_issues) md.push(`  - ${issue}`);
    }
  }
  md.push("");

  writeFileSync(OUT_MD, md.join("\n"), { mode: 0o600 });

  console.log(
    JSON.stringify(
      {
        written: [OUT_JSON, OUT_MD],
        kpis: kpis.length,
        status_counts: statusCounts,
        evidence_verified: kpis.filter((k) => k.evidence_verified).length,
        missing_priority_details: missingIds,
      },
      null,
      2,
    ),
  );

  if (missingIds.length || kpis.some((k) => !k.evidence_verified)) process.exitCode = 1;
}

main();
