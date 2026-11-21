/**
 * Этап 1.2, задача №1 — полный аудит SQL 12 утверждённых приоритетных датасетов.
 *
 * Read-only: читает output/dataset_details/*.json, не выполняет SQL, не меняет SQLite.
 * Пишет:
 *  - reports/phase-01-2/dataset_sql_inventory.csv
 *  - reports/phase-01-2/dataset_fields_inventory.csv
 *  - reports/phase-01-2/dataset_metrics_inventory.csv
 *  - reports/phase-01-2/dataset_source_tables.csv
 *  - reports/phase-01-2/dataset_audit.md
 *  - output/phase-01-2/audit.json (промежуточный, gitignored)
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { parseSql, classifyFieldName, stripNoise, type ParsedSql } from "./parse-sql";

const DETAILS_DIR = "output/dataset_details";
const REPORT_DIR = "reports/phase-01-2";
const INTERMEDIATE_DIR = "output/phase-01-2";

const APPROVED_IDS = [4732, 5247, 5399, 5797, 7006, 7024, 7027, 7119, 7293, 7465, 7473, 7775];

const SQL_KEYWORDS = new Set(
  `select from where group by having order limit offset union all distinct as on join left right full inner outer cross using and or not case when then else end true false null is in between like ilike cast round abs greatest least coalesce nullif if multiif count sum avg min max countif sumif avgif uniqexact uniqexactif quantileexact median stddev variance topn over partition rows range unbounded preceding following current row interval day month year hour minute second epoch extract date_trunc todate todatetime formatdatetime datediff dateadd floor ceil ceil1 assumeNotNull isNotNull isNull nullIf ifnull toString toInt toUInt toFloat toDecimal splitbychar arrayjoin dictgetornull dictget lag lead row_number rank dense_rank first_value last_value nth_value p1m time_grain from_dttm to_dttm filter_values gettype slotted now today age tuple endif`.split(
    /\s+/,
  ).map((w) => w.toLowerCase()),
);

type TimeSemantic = {
  field: string;
  role: "timestamp" | "deadline" | "duration" | "date" | "unknown";
  status: "VERIFIED" | "PROBABLE" | "UNKNOWN";
  evidence: string;
};

type KeySemantic = {
  field: string;
  entity: string;
  type: string | null;
  confidence: "VERIFIED" | "PROBABLE" | "UNKNOWN";
  evidence: string;
};

type DatasetNote = {
  purpose: string;
  grain: string;
  source_tables: string[];
  joins: string[];
  time_fields: TimeSemantic[];
  keys: KeySemantic[];
  risks: string[];
  notes: string[];
};

const NOTES: Record<number, DatasetNote> = {
  4732: {
    purpose:
      "Заказы и подзаказы darkstore/партнёров: статусы, временные этапы сборки/доставки, суммы заказа, SLA, курьер, пул, ТТ, направление.",
    grain:
      "1 строка = заказ/подзаказ (id_order); id_general группирует подзаказы, для заказа использовать COALESCE(id_general, id_order).",
    source_tables: ["default.darkstore_time_sheet dt", "default.services_sla sla", "mart.org_unit_actual tt", "dictionaries.dict_tt / dict_pomoschniki / dict_email_dostavka (dictGetOrNull)"],
    joins: [
      "LEFT JOIN default.services_sla sla ON dt.id_service = sla.id_service",
      "LEFT JOIN mart.org_unit_actual tt ON tt.org_unit_number = dt.shopno",
    ],
    time_fields: [
      { field: "date_order", role: "timestamp", status: "VERIFIED", evidence: "age('minute', date_order, date_status_10); DATEADD(MINUTE,-60,date_supply) в метриках" },
      { field: "date_supply", role: "deadline", status: "PROBABLE", evidence: "сравнивается с date_order/date_status_10 как плановое время поставки" },
      { field: "date_supply_untill", role: "deadline", status: "PROBABLE", evidence: "сравнение date_status_10/date_delivered > date_supply_untill в метрике qty_not_in_slot_above_all" },
      { field: "date_delivered", role: "timestamp", status: "VERIFIED", evidence: "используется в расчётах длительности/просрочки, order_status='Успешно завершен'" },
      { field: "date_delivery_start", role: "timestamp", status: "PROBABLE", evidence: "парная метка к date_delivered для delivery_time" },
      { field: "date_collect_start", role: "timestamp", status: "PROBABLE", evidence: "старт сборки; collection_time = разница" },
      { field: "date_collected", role: "timestamp", status: "PROBABLE", evidence: "завершение сборки по контексту collection_time" },
      { field: "date_status_10", role: "timestamp", status: "PROBABLE", evidence: "используется в age() как контрольная метка статуса 10" },
      { field: "date_printed", role: "timestamp", status: "UNKNOWN", evidence: "в SQL только выбор поля, семантика не подтверждена" },
      { field: "date_f_status_3_5", role: "timestamp", status: "UNKNOWN", evidence: "в SQL только выбор поля" },
      { field: "date_set_cell", role: "timestamp", status: "UNKNOWN", evidence: "в SQL только выбор поля" },
      { field: "date_check_closed", role: "timestamp", status: "UNKNOWN", evidence: "в SQL только выбор поля" },
      { field: "date_status", role: "timestamp", status: "UNKNOWN", evidence: "в SQL только выбор поля" },
      { field: "date_collected_plan", role: "deadline", status: "PROBABLE", evidence: "плановая метка сборки (суффикс _plan)" },
      { field: "date_collect_start_plan", role: "deadline", status: "PROBABLE", evidence: "плановая метка старта сборки" },
      { field: "collection_time_all", role: "duration", status: "PROBABLE", evidence: "сравнивается со sla_collection_time_all" },
      { field: "delivery_time_all", role: "duration", status: "PROBABLE", evidence: "длительность доставки" },
      { field: "collection_time_real_sec", role: "duration", status: "PROBABLE", evidence: "суффикс _sec, секунды" },
      { field: "wait_time", role: "duration", status: "PROBABLE", evidence: "ожидание; единицы не подтверждены" },
      { field: "wait_time2", role: "duration", status: "PROBABLE", evidence: "ожидание; единицы не подтверждены" },
      { field: "waiting_area_time", role: "duration", status: "UNKNOWN", evidence: "только выбор поля" },
      { field: "order_time", role: "unknown", status: "UNKNOWN", evidence: "не отличить timestamp от duration без источника" },
      { field: "pay_time", role: "unknown", status: "UNKNOWN", evidence: "только выбор поля" },
      { field: "set_cell_time", role: "unknown", status: "UNKNOWN", evidence: "только выбор поля" },
    ],
    keys: [
      { field: "id_order", entity: "order", type: "integer", confidence: "VERIFIED", evidence: "основной ключ заказа в метриках" },
      { field: "id_general", entity: "order_group", type: "integer", confidence: "PROBABLE", evidence: "COALESCE(id_general, id_order) в метриках" },
      { field: "id_delivery_job", entity: "delivery_job", type: "integer", confidence: "PROBABLE", evidence: "выбран в SELECT" },
      { field: "id_courier", entity: "courier", type: "integer", confidence: "PROBABLE", evidence: "выбран; связь с HR/логами по id_courier" },
      { field: "courier", entity: "courier", type: "string", confidence: "UNKNOWN", evidence: "имя/логин курьера, не число" },
      { field: "shopno", entity: "shop", type: "integer", confidence: "VERIFIED", evidence: "используется в фильтрах и dict-join" },
      { field: "id_tt", entity: "shop", type: "integer", confidence: "PROBABLE", evidence: "id_tt IS NOT NULL в WHERE" },
      { field: "id_pool", entity: "pool", type: "integer", confidence: "PROBABLE", evidence: "выбран; пул заказов" },
      { field: "id_group", entity: "cluster", type: "integer", confidence: "UNKNOWN", evidence: "только выбор поля" },
      { field: "id_service", entity: "service", type: "integer", confidence: "VERIFIED", evidence: "join к services_sla" },
      { field: "id_sbor", entity: "assembly", type: "integer", confidence: "UNKNOWN", evidence: "только выбор поля" },
      { field: "id_partner", entity: "partner", type: "integer", confidence: "PROBABLE", evidence: "id_partner_type/partner_type используются в метриках" },
    ],
    risks: [
      "Дубли полей-суффиксов _sheet (date_supply_sheet vs date_supply, date_collected_sheet vs date_collected) — высокий риск выбрать неверный источник.",
      "Единицы *_time (wait_time, collection_time, delivery_time) не подтверждены: секунды/минуты.",
      "date_status_10 как «сборка завершена» не подтверждён — только эвристика по age().",
      "Ключ заказа: id_order/подзаказы и id_general — без правила агрегации возможен двойной счёт.",
      "sum_order/sum_paid — суммы заказа, НЕ доход курьера.",
      "Часовой пояс ClickHouse DateTime в SQL явно не задан.",
      "area_tt — территория ТТ, не зона доставки; зона кластера доступна через mart.org_unit_actual.zone_cluster (\"Куст\").",
    ],
    notes: [
      "WHERE: shopno NOT IN (99888), id_tt IS NOT NULL, опциональный фильтр partner.",
      "SLA-поля приходят из default.services_sla (sla_collection_time_all, sla_delivery_time_all, sla_order_time, is_express).",
      "Метрики: qty_orders_all/delivered/declined, share_qty_declined, avg_sum, sum_without_bonuses, qty_not_in_slot_above_all.",
    ],
  },
  5247: {
    purpose: "Агрегированные события курьера по дням (event_name, events_qty) по ТТ/направлению.",
    grain:
      "1 строка = (week_no, d, Направление, City_tt, shopno, id_tt, name_TT, isDark, event_name, dey, courier_id).",
    source_tables: ["agile_mart_techaudit.courier_events_logs_aggr cevl"],
    joins: [],
    time_fields: [
      { field: "d", role: "date", status: "VERIFIED", evidence: "date_trunc('day', d), фильтры d >= NOW() - INTERVAL '7 DAY'" },
      { field: "week_no", role: "date", status: "PROBABLE", evidence: "группировка и HAVING COUNT(DISTINCT date_trunc('day', d)) = 7" },
      { field: "dey", role: "unknown", status: "UNKNOWN", evidence: "группировка и фильтр, семантика не подтверждена" },
    ],
    keys: [
      { field: "courier_id", entity: "courier", type: "unknown", confidence: "PROBABLE", evidence: "группировка, window partition" },
      { field: "shopno", entity: "shop", type: "integer", confidence: "PROBABLE", evidence: "фильтр и группировка" },
      { field: "id_tt", entity: "shop", type: "integer", confidence: "PROBABLE", evidence: "группировка" },
      { field: "event_name", entity: "event_type", type: "string", confidence: "PROBABLE", evidence: "группировка и фильтр; словарь значений отсутствует" },
    ],
    risks: [
      "events_qty — количество событий, НЕ явка и НЕ смена.",
      "Семантика event_name не подтверждена: нет справочника событий.",
      "dey — неизвестное измерение.",
      "Исключены shopno 10006, 10018, 98715, 99888, 8015, 999 (искажение по этим ТТ).",
      "Нет прямого ключа заказа/смены.",
    ],
    notes: [
      "CTE: a (агрегация событий), week_stats (max_day, days_count).",
      "Метрики: events_qty = SUM(events_qty); events_daily_otkl_rate.",
    ],
  },
  5399: {
    purpose: "Агрегированные события курьера по неделям; неделя засчитывается только при наличии 7 дней.",
    grain: "1 строка = (week_no, d, Направление, City_tt, shopno, id_tt, name_TT, isDark, event_name, dey, courier_id).",
    source_tables: ["agile_mart_techaudit.courier_events_logs_aggr cevl"],
    joins: [],
    time_fields: [
      { field: "d", role: "date", status: "VERIFIED", evidence: "date_trunc('week', d), фильтр d" },
      { field: "week_no", role: "date", status: "VERIFIED", evidence: "valid_weeks: HAVING COUNT(DISTINCT date_trunc('day', d)) = 7" },
      { field: "dey", role: "unknown", status: "UNKNOWN", evidence: "группировка и фильтр" },
    ],
    keys: [
      { field: "courier_id", entity: "courier", type: "unknown", confidence: "PROBABLE", evidence: "группировка, window partition" },
      { field: "shopno", entity: "shop", type: "integer", confidence: "PROBABLE", evidence: "фильтр и группировка" },
      { field: "event_name", entity: "event_type", type: "string", confidence: "PROBABLE", evidence: "группировка; словарь отсутствует" },
    ],
    risks: [
      "valid_weeks требует ровно 7 дней: неполные недели отбрасываются (потеря данных на границах).",
      "Метрики events_daily_otkl_rate / _abs ссылаются на max_day_event_qty, sum_events_qty_all_days, count_distinct_day_no — этих колонок в 5399 нет (см. dataset_metrics_inventory.csv, metric_references_missing_columns).",
      "events_qty — события, не явка.",
      "dey — неизвестное измерение.",
    ],
    notes: [
      "CTE: valid_weeks, a, week_stats.",
      "Колонки недельные: max_week_event_qty, count_distinct_week_no, sum_events_qty_all_weeks.",
    ],
  },
  5797: {
    purpose: "HR-контур курьеров: активность, найм/увольнение, стаж, продуктивность, зоны, удержание.",
    grain: "1 строка = (id_courier, date) — дневной HR-срез с оконными агрегатами по курьеру и event_date.",
    source_tables: ["agile_mart_techaudit.hr_delivery", "dictionaries.dict_tt dt"],
    joins: ["LEFT JOIN dictionaries.dict_tt dt ON toUInt64(assumeNotNull(shopno)) = dt.shopno AND shopno IS NOT NULL"],
    time_fields: [
      { field: "date", role: "date", status: "VERIFIED", evidence: "WHERE date < today(); окна PARTITION BY id_courier ORDER BY date" },
      { field: "event_date", role: "date", status: "PROBABLE", evidence: "дата кадрового события, окна PARTITION BY id_courier, event_date" },
      { field: "event_hiring", role: "date", status: "PROBABLE", evidence: "дата найма по названию и HR-контексту" },
      { field: "date_dismissed", role: "date", status: "PROBABLE", evidence: "используется в dateDiff('month', event_date, least(coalesce(date_dismissed, today()), date))" },
      { field: "first_order_date", role: "date", status: "PROBABLE", evidence: "первый заказ; используется в метриках новичков" },
      { field: "last_order_date", role: "date", status: "PROBABLE", evidence: "последний заказ; выбран" },
    ],
    keys: [
      { field: "id_courier", entity: "courier", type: "integer", confidence: "VERIFIED", evidence: "окна PARTITION BY id_courier, метрики qty/cnt_new_couriers" },
      { field: "shopno", entity: "shop", type: "integer", confidence: "VERIFIED", evidence: "join к dict_tt по shopno" },
      { field: "event_date", entity: "hr_event", type: "date", confidence: "PROBABLE", evidence: "часть ключа окна" },
    ],
    risks: [
      "PII: fio, phone, inn — значения не выгружать.",
      "active — строка 'Да'/'Нет', не boolean.",
      "pause_days = pause_days + 30 - 1 — бизнес-правило заказчика, не сырое поле.",
      "date < today(): сегодняшний день исключён.",
      "Часть метрик содержит Jinja time_grain (P1M), т.е. зависит от периода в Superset.",
      "Нет подтверждённой модели смен: enough_shifts_flg/shifts_in_first_14d — только первые 14 дней.",
    ],
    notes: [
      "Оконные функции: orders_after_hire, orders_before_dism_total, orders_before_dism, days_with_orders, enough_shifts_flg.",
      "Зоны: inactivity_zone, prev_inactivity_zone, zone_changed, zone_transition_type.",
    ],
  },
  7006: {
    purpose: "Логистика cargo_main2: план/факт маршрута, пулы, просрочки, последовательность доставки.",
    grain: "1 строка = заказ (id_order) в успешной курьерской доставке, с атрибутами пула (id_pool_calc).",
    source_tables: [
      "sandbox.ab_logs_mart_routing_results_v1 r",
      "ods.v_delivery_job_lines djl",
      "mart_mixed.darkstore_time dt",
    ],
    joins: [
      "inner join rr_latest rr on rr.parcel_id = dt.id_order and rr.courier_id = dt.id_courier",
      "left join job_res jl on jl.id_parcel = dt.id_order and jl.id_courier = dt.id_courier",
      "left join pool_calc_cte pc on pc.id_order = bs.id_order",
      "left join pool_size_cte ps on ps.id_pool_calc = bs.id_pool_calc",
    ],
    time_fields: [
      { field: "calculation_time", role: "timestamp", status: "PROBABLE", evidence: "r.calculation_time + interval '3 hour' — явный сдвиг TZ" },
      { field: "arrival_time", role: "timestamp", status: "PROBABLE", evidence: "план прибытия; сравнение с date_supply_until" },
      { field: "date_pickuped", role: "timestamp", status: "PROBABLE", evidence: "факт получения курьером; job_cte" },
      { field: "date_collected", role: "timestamp", status: "PROBABLE", evidence: "сборка; pickup_to_courier_minute" },
      { field: "date_delivered", role: "timestamp", status: "VERIFIED", evidence: "факт вручения; duration_fact, is_late, фильтр >= now() - 3 months" },
      { field: "date_supply_until", role: "deadline", status: "PROBABLE", evidence: "is_late, minutes_late, plan_arrival_deadline" },
      { field: "prev_date_pickuped", role: "timestamp", status: "PROBABLE", evidence: "lag(date_pickuped) по пулу" },
    ],
    keys: [
      { field: "id_order", entity: "order", type: "integer", confidence: "VERIFIED", evidence: "join rr.parcel_id = dt.id_order" },
      { field: "id_courier", entity: "courier", type: "integer", confidence: "VERIFIED", evidence: "join rr.courier_id = dt.id_courier" },
      { field: "id_pool", entity: "pool", type: "integer", confidence: "PROBABLE", evidence: "ROW_NUMBER() OVER (PARTITION BY id_pool)" },
      { field: "id_pool_calc", entity: "pool_computed", type: "integer", confidence: "PROBABLE", evidence: "вычисляется DENSE_RANK по разрывам pickup" },
      { field: "shopno", entity: "shop", type: "integer", confidence: "PROBABLE", evidence: "выбран" },
      { field: "cluster_id", entity: "cluster", type: "integer", confidence: "PROBABLE", evidence: "из routing_results" },
    ],
    risks: [
      "calculation_time сдвинут на +3 часа — TZ-риск, нельзя смешивать с другими источниками без нормализации.",
      "Фильтры: status_name='Успешно завершен', delivery_type_group='Курьеры', id_service NOT IN (3,50,62,86), окно 3 месяца — только успешные курьерские доставки.",
      "id_pool_calc — вычисляемый пул (разрывы pickup), не равен исходному id_pool.",
      "id_general = id_order в WHERE — отсекает часть заказов.",
      "duration_fact/duration_plan в минутах, но plan берётся из duration_from_previous/60 (round).",
      "pool_size > 6 объединён в '7+'.",
    ],
    notes: ["CTE: rr, rr_latest, job_cte, job_ranz_by_date, job_res, base, ordered, with_breaks, pooled, numbered, pool_calc_cte, base_with_pool_calc, pool_size_cte, res."],
  },
  7024: {
    purpose: "Логистика cargo_main3: агрегаты по пулам (размер пула, план/факт длительности, дистанция).",
    grain: "1 строка = вычисленный пул (id_pool_calc) с courier_type in ('вело','авто').",
    source_tables: [
      "sandbox.ab_logs_mart_routing_results_v1 r",
      "ods.v_delivery_job_lines djl",
      "mart_mixed.darkstore_time dt",
    ],
    joins: [
      "inner join rr_latest rr on rr.parcel_id = dt.id_order and rr.courier_id = dt.id_courier",
      "left join job_res jl on jl.id_parcel = dt.id_order and jl.id_courier = dt.id_courier",
      "left join pool_calc_cte pc on pc.id_order = bs.id_order",
      "left join pool_size_cte ps on ps.id_pool_calc = bs.id_pool_calc",
    ],
    time_fields: [
      { field: "calculation_time", role: "timestamp", status: "PROBABLE", evidence: "r.calculation_time + interval '3 hour'" },
      { field: "arrival_time", role: "timestamp", status: "PROBABLE", evidence: "max_arrival_time для plan_duration_min" },
      { field: "date_pickuped", role: "timestamp", status: "PROBABLE", evidence: "max_date_pickuped для fact_duration_min" },
      { field: "date_delivered", role: "timestamp", status: "VERIFIED", evidence: "max_date_delivered; фильтр >= now() - 3 months" },
      { field: "date_supply_until", role: "deadline", status: "PROBABLE", evidence: "NOT NULL в WHERE" },
    ],
    keys: [
      { field: "id_pool_calc", entity: "pool_computed", type: "integer", confidence: "PROBABLE", evidence: "GROUP BY id_pool_calc" },
      { field: "id_pool", entity: "pool", type: "integer", confidence: "PROBABLE", evidence: "ROW_NUMBER OVER (PARTITION BY id_pool)" },
      { field: "id_order", entity: "order", type: "integer", confidence: "PROBABLE", evidence: "COUNT(DISTINCT id_order)" },
      { field: "id_courier", entity: "courier", type: "integer", confidence: "PROBABLE", evidence: "PARTITION BY id_courier" },
      { field: "cluster_id", entity: "cluster", type: "integer", confidence: "PROBABLE", evidence: "max(cluster_id)" },
    ],
    risks: [
      "calculation_time +3 часа — TZ-риск.",
      "Только успешные доставки курьерами за 3 месяца.",
      "id_pool_calc вычисляемый; исходный id_pool не выводится.",
      "courier_type фильтруется до вело/авто — пешие/новички исключены.",
      "distance/duration агрегируются max/sum без проверки дублей parcel.",
    ],
    notes: ["CTE: rr, rr_latest, job_cte, job_ranz_by_date, job_res, base, ordered, with_breaks, pooled, numbered, pool_calc_cte, base_with_pool_calc, pool_size_cte, res, agg_pool."],
  },
  7027: {
    purpose: "Логистика cargo_main4: расширенный набор флагов/признаков маршрута, просрочек и пулов.",
    grain: "1 строка = заказ (id_order) с атрибутами пула и флагами.",
    source_tables: [
      "sandbox.ab_logs_mart_routing_results_v1 r",
      "ods.v_delivery_job_lines djl",
      "mart_mixed.darkstore_time dt",
      "CTE-источники: logs_wait, couriers, pool_distance_p90",
    ],
    joins: [
      "inner join rr_latest rr on rr.parcel_id = dt.id_order",
      "left join job_res jl on jl.id_parcel = dt.id_order",
      "left join base dt on dt.id_order = r.parcel_id",
      "left join pool_size_cte ps on ps.id_pool_calc = bs.id_pool_calc",
      "left join pool_distance_p90 d",
      "inner join logs_wait l2 on l1.parcel_id = l2.parcel_id",
    ],
    time_fields: [
      { field: "calculation_time", role: "timestamp", status: "PROBABLE", evidence: "r.calculation_time + interval '3 hour'" },
      { field: "arrival_time", role: "timestamp", status: "PROBABLE", evidence: "plan_arrival_before_deadline, planned_late" },
      { field: "date_pickuped", role: "timestamp", status: "PROBABLE", evidence: "job_cte, max_date_pickuped" },
      { field: "date_collected", role: "timestamp", status: "PROBABLE", evidence: "pickup_to_courier_minute" },
      { field: "date_delivered", role: "timestamp", status: "VERIFIED", evidence: "fact_minutes_late, фильтр" },
      { field: "date_supply_until", role: "deadline", status: "PROBABLE", evidence: "флаги просрочки" },
    ],
    keys: [
      { field: "id_order", entity: "order", type: "integer", confidence: "VERIFIED", evidence: "join по parcel_id" },
      { field: "id_pool", entity: "pool", type: "integer", confidence: "PROBABLE", evidence: "id_pool_ps / pool_size_cte" },
      { field: "id_courier", entity: "courier", type: "integer", confidence: "PROBABLE", evidence: "партиции и join" },
      { field: "cluster_id", entity: "cluster", type: "integer", confidence: "PROBABLE", evidence: "выбран" },
      { field: "id_pool_calc", entity: "pool_computed", type: "integer", confidence: "PROBABLE", evidence: "вычисляемый" },
    ],
    risks: [
      "calculation_time +3 часа — TZ-риск.",
      "Флаги вычисляются эвристиками (p90 дистанции, пороги ожидания) — бизнес-смысл требует подтверждения.",
      "Только успешные доставки курьерами за 3 месяца.",
      "Множество join'ов и оконных функций повышают риск размножения строк.",
    ],
    notes: ["CTE: rr, rr_latest, job_cte, job_ranz_by_date, job_res, darkstore_cte, base, pool_size_cte, pool_distance_p90, pool_distance_flags, logs_wait, couriers, res, add_flags, add_groups."],
  },
  7119: {
    purpose: "Флаги и группировки качества заказов/маршрутов (ClickHouse agile_mart_hot_team): просрочки, нехватка курьеров, дистанция пула, ожидание.",
    grain: "1 строка = заказ (id_order) с набором флагов/групп.",
    source_tables: [
      "agile_mart_hot_team.order_delivery_base dt",
      "agile_mart_hot_team.routing_results_v1 r",
      "CTE-источники: pool_size_cte, pool_distance_p90, logs_wait, logs_wait_nead_deadline, order_cnt_courier, thresholds, couriers",
    ],
    joins: [
      "left join base dt on dt.id_order = r.parcel_id",
      "inner join logs_wait l2 ON l1.parcel_id = l2.parcel_id",
      "left join pool_size_cte ps on ps.id_pool_ps = bs.id_pool",
      "left join parcels_wait pw on pw.parcel_id = bs.id_order",
      "left join courier_lates cl on bs.courier_id_darkstore = cl.courier_id_darkstore",
      "cross join thresholds th",
    ],
    time_fields: [
      { field: "date_order", role: "timestamp", status: "PROBABLE", evidence: "выбран из order_delivery_base" },
      { field: "date_collect_start", role: "timestamp", status: "PROBABLE", evidence: "release_to_first_assignment" },
      { field: "date_collected", role: "timestamp", status: "PROBABLE", evidence: "release_to_first_assignment" },
      { field: "date_delivery_start", role: "timestamp", status: "PROBABLE", evidence: "выбран" },
      { field: "date_delivered", role: "timestamp", status: "VERIFIED", evidence: "date_delivered > now() - INTERVAL 14 DAY" },
      { field: "date_supply_until", role: "deadline", status: "PROBABLE", evidence: "dateDiff с arrival_time/date_delivered" },
      { field: "date_pickuped", role: "timestamp", status: "PROBABLE", evidence: "nullIf(..., toDateTime('1970-01-01')) — 1970 трактуется как NULL" },
      { field: "calculation_time", role: "timestamp", status: "PROBABLE", evidence: "routing_results" },
      { field: "arrival_time", role: "timestamp", status: "PROBABLE", evidence: "plan_arrival_before_deadline, planned_late" },
      { field: "estimated_time", role: "timestamp", status: "UNKNOWN", evidence: "выбран, семантика не подтверждена" },
    ],
    keys: [
      { field: "id_order", entity: "order", type: "integer", confidence: "VERIFIED", evidence: "join parcel_id = id_order" },
      { field: "id_general", entity: "order_group", type: "integer", confidence: "PROBABLE", evidence: "выбран" },
      { field: "id_pool", entity: "pool", type: "integer", confidence: "PROBABLE", evidence: "pool_size_cte GROUP BY id_pool" },
      { field: "id_courier", entity: "courier", type: "string", confidence: "PROBABLE", evidence: "в SQL join base.courier_id_darkstore = courier_lates.courier_id_darkstore; в published columns — id_courier" },
      { field: "courier_type", entity: "courier_type", type: "string", confidence: "PROBABLE", evidence: "выбран" },
      { field: "id_route", entity: "route", type: "integer", confidence: "PROBABLE", evidence: "routing_results" },
      { field: "shopno", entity: "shop", type: "integer", confidence: "PROBABLE", evidence: "выбран" },
    ],
    risks: [
      "Другая БД/кластер (ch_10.0.112.21) — возможна рассинхронизация с gp_10.0.112.100.",
      "date_pickuped: 1970-01-01 приводится к NULL — нельзя использовать как валидное время.",
      "Только id_status = 18, is_route = true, за 14 дней — узкое окно.",
      "cross join thresholds размножает строки, если thresholds > 1 строки.",
      "Флаги завязаны на эвристические пороги (p90, 5 минут и т.д.).",
    ],
    notes: ["Большой набор flag_* и group_*; смысл флагов требует подтверждения владельцем."],
  },
  7293: {
    purpose: "Баланс миграции курьеров между зонами активности (Green/Yellow/Orange/Red/Тишина/Lost) по дням.",
    grain: "1 строка = (date, zone_from) — дневной поток переходов из зоны.",
    source_tables: ["agile_mart_techaudit.hr_delivery"],
    joins: [],
    time_fields: [
      { field: "date", role: "date", status: "VERIFIED", evidence: "WHERE date < today(); GROUP BY date" },
    ],
    keys: [
      { field: "date", entity: "date", type: "date", confidence: "VERIFIED", evidence: "GROUP BY date" },
      { field: "zone", entity: "zone", type: "string", confidence: "PROBABLE", evidence: "zone_from: Green/Yellow/Orange/Red/Тишина/Lost" },
      { field: "id_courier", entity: "courier", type: "integer", confidence: "PROBABLE", evidence: "в CTE transitions, но не в выходе" },
    ],
    risks: [
      "zone — зона бездействия (inactivity_zone), не зона доставки.",
      "positive_pct/negative_pct нормированы на дневной максимум — не абсолютные доли.",
      "Только zone_changed = 1; невозвратные состояния не видны.",
      "date < today(): сегодняшний день исключён.",
    ],
    notes: ["CTE: transitions, zone_flows, daily_max."],
  },
  7465: {
    purpose: "HR-срез по первым 5 сменам (5-shifts): найм, стаж, дни с заказами, зоны, куратор.",
    grain: "1 строка = (id_courier, date) внутри event_date-окна (первые 5 смен).",
    source_tables: ["agile_mart_techaudit.hr_delivery", "dictionaries.dict_tt dt"],
    joins: ["LEFT JOIN dictionaries.dict_tt dt ON toUInt64(assumeNotNull(shopno)) = dt.shopno AND shopno IS NOT NULL"],
    time_fields: [
      { field: "date", role: "date", status: "VERIFIED", evidence: "WHERE date < today(); окна" },
      { field: "event_date", role: "date", status: "VERIFIED", evidence: "WHERE event_date >= today() - INTERVAL 30 DAY AND event_date < today()" },
      { field: "event_hiring", role: "date", status: "PROBABLE", evidence: "дата найма" },
      { field: "date_dismissed", role: "date", status: "PROBABLE", evidence: "dateDiff('month', event_date, least(coalesce(date_dismissed, today()), date))" },
      { field: "first_order_date", role: "date", status: "PROBABLE", evidence: "первый заказ" },
    ],
    keys: [
      { field: "id_courier", entity: "courier", type: "integer", confidence: "VERIFIED", evidence: "окна PARTITION BY id_courier, event_date" },
      { field: "event_date", entity: "hr_event", type: "date", confidence: "VERIFIED", evidence: "фильтр и окна" },
      { field: "shopno", entity: "shop", type: "integer", confidence: "PROBABLE", evidence: "join dict_tt" },
    ],
    risks: [
      "PII: fio, phone.",
      "По умолчанию event_date >= today() - 30 DAY — вне окна данных нет.",
      "enough_shifts_flg и shifts_in_first_14d ограничены первыми 14 днями.",
      "active — строка 'Да'/'Нет'.",
      "Нет подтверждённой полной модели смен.",
    ],
    notes: ["Оконные функции: enough_shifts_flg, last_order_date, day_number, first_value(leader/feature_tt/name_curator)."],
  },
  7473: {
    purpose: "Первые 5 смен новичка: длительность и доход по сменам, пороги, статус пятой смены.",
    grain: "1 строка = (id_courier, event_date) с атрибутами shift_1..shift_5.",
    source_tables: [
      "agile_mart_techaudit.hr_delivery_five_shifts fs",
      "agile_mart_techaudit.hr_delivery (CTE last_order)",
      "dictionaries.dict_tt dt",
    ],
    joins: [
      "left join last_order lo on fs.id_courier = lo.id_courier and fs.event_date = lo.event_date",
      "LEFT JOIN dictionaries.dict_tt dt ON toUInt64(assumeNotNull(fs.shopno)) = dt.shopno",
    ],
    time_fields: [
      { field: "event_date", role: "date", status: "VERIFIED", evidence: "WHERE fs.event_date >= today() - INTERVAL 30 DAY" },
      { field: "fifth_shift_date", role: "date", status: "PROBABLE", evidence: "дата пятой смены" },
      { field: "last_order_date", role: "date", status: "PROBABLE", evidence: "max(date) в CTE last_order" },
    ],
    keys: [
      { field: "id_courier", entity: "courier", type: "integer", confidence: "VERIFIED", evidence: "join last_order по id_courier, event_date" },
      { field: "event_date", entity: "hr_event", type: "date", confidence: "VERIFIED", evidence: "join и фильтр" },
      { field: "shopno", entity: "shop", type: "integer", confidence: "PROBABLE", evidence: "join dict_tt" },
    ],
    risks: [
      "PII: name_courier.",
      "shift_1..shift_5 — не временные метки, а числовые показатели смены (заказы/порог); не путать со временем.",
      "shift_N_work_minutes — минуты работы; shift_N_profit — доход по смене (единственный подтверждённый источник дохода курьера, но только первые 5 смен).",
      "Пороги thresholds_taken/_payments — правила заказчика.",
      "event_date >= today() - 30 DAY по умолчанию.",
    ],
    notes: ["shift_N_profit и shift_N_work_minutes позволяют вычислить доход в час, но только для первых 5 смен новичка."],
  },
  7775: {
    purpose: "Справочник всех курьеров: активность, бан, тип занятости, тип курьера, дата регистрации.",
    grain: "1 строка = курьер (vc.id).",
    source_tables: ["default.v_couriers vc", "default.courier_job_type cjt", "default.v_couriers_payments_courier_types cct"],
    joins: [
      "left join default.courier_job_type cjt on cjt.id = vc.job_type",
      "left join default.v_couriers_payments_courier_types cct on cct.id = vc.id_courier_type",
    ],
    time_fields: [
      { field: "date_add", role: "date", status: "PROBABLE", evidence: "дата регистрации курьера по контексту v_couriers" },
    ],
    keys: [
      { field: "ID", entity: "courier", type: "integer", confidence: "VERIFIED", evidence: "vc.id as \"ID\"" },
      { field: "job_type", entity: "employment_type", type: "integer", confidence: "PROBABLE", evidence: "join cjt.id = vc.job_type, WHERE job_type not in (0,1)" },
      { field: "id_courier_type", entity: "courier_type", type: "integer", confidence: "PROBABLE", evidence: "join cct.id = vc.id_courier_type" },
    ],
    risks: [
      "PII: Курьер (имя), Телефон, ИНН — значения не выгружать.",
      "WHERE job_type not in (0,1) — часть курьеров исключена.",
      "Нет истории изменений: только текущее состояние.",
    ],
    notes: ["\"Активный\" = case active=1, \"Бан\" = case is_blocked=0."],
  },
};

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function csv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

const KNOWN_SCHEMAS = new Set([
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

const SOURCE_KEYWORDS = new Set([
  "date_trunc",
  "now",
  "today",
  "date",
  "timestamp",
  "datetime",
  "unnest",
  "generate_series",
]);

function normalizeSources(parsed: ParsedSql): Array<any> {
  const cteNames = new Set(parsed.ctes.map((c) => c.name.toLowerCase()));
  const out: Array<any> = [];
  for (const s of parsed.sources) {
    const lower = s.name.toLowerCase();
    if (SOURCE_KEYWORDS.has(lower)) continue;
    let kind = s.kind;
    if (cteNames.has(lower)) kind = "cte";
    else if (s.kind === "table" && s.schema && !KNOWN_SCHEMAS.has(s.schema.toLowerCase())) kind = "unknown";
    else if (s.kind === "table" && !s.schema) kind = "unknown";
    out.push({ ...s, kind });
  }
  return out;
}

function extractIdentifiers(expression: string): string[] {
  const cleaned = stripNoise(expression)
    .replace(/'[^']*'/g, " ")
    .replace(/"[^"]*"/g, " ");
  const ids = new Set<string>();
  for (const m of cleaned.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    ids.add(m[2]);
  }
  const withoutDotted = cleaned.replace(/[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*/g, " ");
  for (const m of withoutDotted.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    ids.add(m[0]);
  }
  return [...ids].filter((w) => !SQL_KEYWORDS.has(w.toLowerCase()));
}

function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(INTERMEDIATE_DIR, { recursive: true });

  const files = readdirSync(DETAILS_DIR).filter((f) => f.endsWith(".json"));
  const presentIds = files.map((f) => Number(f.replace(".json", "")));
  const missing = APPROVED_IDS.filter((id) => !presentIds.includes(id));
  const extra = presentIds.filter((id) => !APPROVED_IDS.includes(id));

  const sqlInventory: unknown[][] = [
    ["dataset_id", "table_name", "database", "schema", "kind", "sql_length", "cte_count", "cte_names", "union_count", "select_item_count", "computed_select_items", "source_table_count", "source_tables", "cte_ref_count", "unknown_sources", "join_count", "join_types", "where_count", "group_by_count", "having_count", "order_by_count", "limit", "window_count", "parse_uncertain", "uncertainties"],
  ];
  const fieldsInventory: unknown[][] = [
    ["dataset_id", "table_name", "column_name", "type", "is_dttm", "verbose_name", "description", "is_key_candidate", "key_entity", "is_time_candidate", "time_role", "time_status", "time_evidence", "is_pii", "filterable", "groupby", "is_active"],
  ];
  const metricsInventory: unknown[][] = [
    ["dataset_id", "table_name", "metric_name", "metric_type", "expression", "verbose_name", "description", "has_aggregate", "has_window", "referenced_identifiers", "missing_column_references"],
  ];
  const sourceTables: unknown[][] = [
    ["dataset_id", "table_name", "source_name", "source_schema", "source_alias", "source_kind", "join_type", "on_condition", "occurrences"],
  ];

  const auditJson: any[] = [];

  for (const id of APPROVED_IDS) {
    const file = join(DETAILS_DIR, `${id}.json`);
    if (!existsSync(file)) continue;
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const res = raw?.result ?? {};
    const sql = String(res.sql ?? "");
    const parsed: ParsedSql = parseSql(sql);
    const columns: any[] = Array.isArray(res.columns) ? res.columns : [];
    const metrics: any[] = Array.isArray(res.metrics) ? res.metrics : [];
    const calculated: any[] = Array.isArray(res.calculated_columns) ? res.calculated_columns : [];
    const columnNames = new Set(columns.map((c) => String(c.column_name)));
    const note = NOTES[id];

    const timeMap = new Map<string, TimeSemantic>();
    for (const t of note?.time_fields ?? []) timeMap.set(t.field.toLowerCase(), t);
    const keyMap = new Map<string, KeySemantic>();
    for (const k of note?.keys ?? []) keyMap.set(k.field.toLowerCase(), k);

    // field inventory
    for (const c of columns) {
      const name = String(c.column_name);
      const cls = classifyFieldName(name);
      const sem = timeMap.get(name.toLowerCase());
      fieldsInventory.push([
        id,
        res.table_name,
        name,
        c.type ?? null,
        c.is_dttm ?? null,
        c.verbose_name ?? null,
        c.description ?? null,
        cls.isKeyCandidate,
        cls.keyEntity,
        cls.isTimeCandidate,
        sem?.role ?? (cls.isTimeCandidate ? "unknown" : null),
        sem?.status ?? (cls.isTimeCandidate ? "UNKNOWN" : "NOT_TIME"),
        sem?.evidence ?? null,
        cls.isPiiCandidate,
        c.filterable ?? null,
        c.groupby ?? null,
        c.is_active ?? null,
      ]);
    }
    for (const c of calculated) {
      const name = String(c.column_name ?? "");
      const cls = classifyFieldName(name);
      fieldsInventory.push([
        id,
        res.table_name,
        name,
        c.type ?? null,
        null,
        c.verbose_name ?? null,
        c.description ?? null,
        cls.isKeyCandidate,
        cls.keyEntity,
        cls.isTimeCandidate,
        null,
        "NOT_TIME",
        `calculated_column: ${c.expression ?? ""}`,
        cls.isPiiCandidate,
        null,
        null,
        null,
      ]);
    }

    // metrics inventory
    for (const m of metrics) {
      const expression = String(m.expression ?? "");
      const ids = extractIdentifiers(expression);
      const presentAsColumn = (x: string) =>
        columnNames.has(x) ||
        [...columnNames].some((c) => c.endsWith(`.${x}`)) ||
        calculated.some((c) => String(c.column_name) === x || String(c.column_name).endsWith(`.${x}`));
      const missingRefs = ids.filter((x) => !presentAsColumn(x));
      metricsInventory.push([
        id,
        res.table_name,
        m.metric_name ?? null,
        m.metric_type ?? null,
        expression,
        m.verbose_name ?? null,
        m.description ?? null,
        /(^|[^A-Za-z0-9_])(COUNT|SUM|AVG|MIN|MAX|UNIQEXACT|COUNTIF|SUMIF|AVGIF|QUANTILE)/i.test(expression),
        /OVER\s*\(/i.test(expression),
        ids.join(";"),
        missingRefs.join(";"),
      ]);
    }

    // source tables (unique by name+schema+kind); CTE-ссылки помечаются kind=cte
    const normSources = normalizeSources(parsed);
    const sourceKey = (s: any) => `${s.schema ?? ""}.${s.name}|${s.kind}`;
    const sourceAgg = new Map<string, any>();
    for (const s of normSources) {
      const k = sourceKey(s);
      if (!sourceAgg.has(k)) sourceAgg.set(k, { ...s, occurrences: 0, join_types: new Set<string>() });
      const e = sourceAgg.get(k);
      e.occurrences++;
      if (s.join_type) e.join_types.add(s.join_type);
    }
    const realTables = [...sourceAgg.values()].filter((s) => s.kind === "table");
    const cteRefs = [...sourceAgg.values()].filter((s) => s.kind === "cte");
    const unknownSources = [...sourceAgg.values()].filter((s) => s.kind === "unknown" || s.kind === "subquery");
    for (const s of sourceAgg.values()) {
      sourceTables.push([
        id,
        res.table_name,
        s.name,
        s.schema,
        s.alias,
        s.kind,
        [...s.join_types].join(";") || null,
        s.on ?? null,
        s.occurrences,
      ]);
    }

    sqlInventory.push([
      id,
      res.table_name,
      res.database?.database_name ?? res.database_name ?? null,
      res.schema ?? null,
      res.kind ?? null,
      sql.length,
      parsed.ctes.length,
      parsed.ctes.map((c) => c.name).join(";"),
      parsed.unionCount,
      parsed.selectItemCount,
      parsed.selectItems.filter((s) => s.isComputed).length,
      realTables.length,
      realTables.map((s) => `${s.schema ? s.schema + "." : ""}${s.name}`).join(";"),
      cteRefs.length,
      unknownSources.map((s) => `${s.schema ? s.schema + "." : ""}${s.name}`).join(";"),
      parsed.joins.length,
      [...new Set(parsed.joins.map((j) => j.join_type))].join(";"),
      parsed.whereClauses.length,
      parsed.groupBy.length,
      parsed.having.length,
      parsed.orderBy.length,
      parsed.limit,
      parsed.windowExpressions.length,
      parsed.parseUncertain,
      parsed.uncertainties.join("; "),
    ]);

    auditJson.push({
      dataset_id: id,
      table_name: res.table_name,
      database: res.database?.database_name ?? res.database_name ?? null,
      schema: res.schema ?? null,
      kind: res.kind ?? null,
      sql_length: sql.length,
      parsed: {
        ctes: parsed.ctes.map((c) => c.name),
        sources: [...sourceAgg.values()].map((s) => ({
          name: s.name,
          schema: s.schema,
          alias: s.alias,
          kind: s.kind,
          join_types: [...s.join_types],
          on: s.on,
          occurrences: s.occurrences,
        })),
        joins: parsed.joins.map((j) => ({ name: j.name, schema: j.schema, alias: j.alias, join_type: j.join_type, on: j.on })),
        select_item_count: parsed.selectItemCount,
        computed_select_items: parsed.selectItems.filter((s) => s.isComputed).length,
        where: parsed.whereClauses,
        group_by: parsed.groupBy,
        having: parsed.having,
        window_expressions: parsed.windowExpressions.length,
        union_count: parsed.unionCount,
        parse_uncertain: parsed.parseUncertain,
        uncertainties: parsed.uncertainties,
      },
      columns_count: columns.length,
      metrics_count: metrics.length,
      calculated_columns_count: calculated.length,
      notes: note ?? null,
    });
  }

  writeFileSync(join(REPORT_DIR, "dataset_sql_inventory.csv"), csv(sqlInventory), { mode: 0o600 });
  writeFileSync(join(REPORT_DIR, "dataset_fields_inventory.csv"), csv(fieldsInventory), { mode: 0o600 });
  writeFileSync(join(REPORT_DIR, "dataset_metrics_inventory.csv"), csv(metricsInventory), { mode: 0o600 });
  writeFileSync(join(REPORT_DIR, "dataset_source_tables.csv"), csv(sourceTables), { mode: 0o600 });
  writeFileSync(join(INTERMEDIATE_DIR, "audit.json"), JSON.stringify({ approved_ids: APPROVED_IDS, missing, extra, datasets: auditJson }, null, 2), { mode: 0o600 });

  // --- dataset_audit.md ---
  const md: string[] = [];
  md.push("# Аудит SQL 12 утверждённых датасетов — Этап 1.2");
  md.push("");
  md.push(`Сгенерировано: ${new Date().toISOString()}`);
  md.push("");
  md.push(`Утверждённые датасеты: ${APPROVED_IDS.join(", ")}.`);
  md.push(`Отсутствуют detail JSON: ${missing.length ? missing.join(", ") : "нет"}.`);
  md.push(`Лишние detail JSON (вне утверждённого набора): ${extra.length ? extra.join(", ") : "нет"}.`);
  md.push("");
  md.push("Правило: наличие поля — не доказательство бизнес-смысла. Статусы: VERIFIED / PROBABLE / UNKNOWN.");
  md.push("");
  for (const d of auditJson) {
    const notes = NOTES[d.dataset_id];
    md.push(`## ${d.dataset_id} · ${d.table_name}`);
    md.push("");
    md.push(`- База/Schema/Kind: \`${d.database ?? "—"}\` / \`${d.schema ?? "—"}\` / ${d.kind ?? "—"}`);
    md.push(`- SQL: ${d.sql_length} символов; columns=${d.columns_count}, metrics=${d.metrics_count}, calculated_columns=${d.calculated_columns_count}`);
    md.push(`- CTE (${d.parsed.ctes.length}): ${d.parsed.ctes.join(", ") || "нет"}`);
    md.push(`- Источники: ${d.parsed.sources.map((s: any) => `${s.schema ? s.schema + "." : ""}${s.name} (${s.kind}${s.join_types.length ? ", " + s.join_types.join("/") : ""})`).join("; ") || "нет"}`);
    md.push(`- JOIN: ${d.parsed.joins.length}; WHERE: ${d.parsed.where.length}; GROUP BY: ${d.parsed.group_by.length}; оконных выражений: ${d.parsed.window_expressions}; UNION: ${d.parsed.union_count}`);
    if (d.parsed.parse_uncertain) md.push(`- ⚠ Парсер неоднозначен: ${d.parsed.uncertainties.join("; ")}`);
    md.push("");
    if (notes) {
      md.push(`**Назначение (ВЫВОД):** ${notes.purpose}`);
      md.push("");
      md.push(`**Grain (ГИПОТЕЗА/ВЫВОД):** ${notes.grain}`);
      md.push("");
      md.push("**Временные поля:**");
      md.push("");
      md.push("| Поле | Роль | Статус | Доказательство |");
      md.push("|---|---|---|---|");
      for (const t of notes.time_fields) {
        md.push(`| ${t.field} | ${t.role} | ${t.status} | ${t.evidence} |`);
      }
      md.push("");
      md.push("**Ключи:**");
      md.push("");
      md.push("| Поле | Сущность | Тип | Статус | Доказательство |");
      md.push("|---|---|---|---|---|");
      for (const k of notes.keys) {
        md.push(`| ${k.field} | ${k.entity} | ${k.type ?? "—"} | ${k.confidence} | ${k.evidence} |`);
      }
      md.push("");
      md.push("**Риски:**");
      md.push("");
      for (const r of notes.risks) md.push(`- ${r}`);
      md.push("");
      md.push("**Заметки:**");
      md.push("");
      for (const n of notes.notes) md.push(`- ${n}`);
      md.push("");
    }
  }
  writeFileSync(join(REPORT_DIR, "dataset_audit.md"), md.join("\n"), { mode: 0o600 });

  console.log(
    JSON.stringify(
      {
        approved_ids: APPROVED_IDS,
        audited: auditJson.length,
        missing,
        extra,
        fields_rows: fieldsInventory.length - 1,
        metrics_rows: metricsInventory.length - 1,
        source_rows: sourceTables.length - 1,
        files: [
          "dataset_sql_inventory.csv",
          "dataset_fields_inventory.csv",
          "dataset_metrics_inventory.csv",
          "dataset_source_tables.csv",
          "dataset_audit.md",
        ],
      },
      null,
      2,
    ),
  );

  if (missing.length || extra.length) process.exitCode = 1;
}

main();
