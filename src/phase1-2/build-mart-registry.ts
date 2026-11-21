/**
 * Этап 1.2, задача №3 — реестр агрегированных витрин + матрица доступности показателей
 * + реестры недостающих событий/справочников + правила качества + приоритеты.
 *
 * Read-only: не создаёт витрины, не запускает ETL, не меняет SQLite.
 * Проверяет каждую ссылку на поле по reports/phase-01-2/dataset_fields_inventory.csv.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const REPORT_DIR = "reports/phase-01-2";
const FIELDS = join(REPORT_DIR, "dataset_fields_inventory.csv");
const METRICS = join(REPORT_DIR, "dataset_metrics_inventory.csv");
const OUT_JSON = join(REPORT_DIR, "data_mart_registry.json");
const OUT_CSV = join(REPORT_DIR, "data_mart_registry.csv");
const OUT_MD = join(REPORT_DIR, "data_mart_registry.md");
const OUT_FIELDS = join(REPORT_DIR, "data_mart_fields.csv");
const OUT_KPI = join(REPORT_DIR, "kpi_availability_matrix.csv");
const OUT_EVENTS = join(REPORT_DIR, "missing_events_registry.csv");
const OUT_REFS = join(REPORT_DIR, "missing_references_registry.csv");
const OUT_QUALITY = join(REPORT_DIR, "data_quality_rules.md");
const OUT_PRIORITIES = join(REPORT_DIR, "implementation_priorities.md");

const STATUSES = [
  "VERIFIED",
  "PARTIAL",
  "DERIVABLE",
  "NEEDS_EVENT",
  "NEEDS_REFERENCE",
  "NEEDS_BUSINESS_RULE",
  "NOT_AVAILABLE",
  "NOT_CHECKED",
];

type Src = { dataset_id: number; field: string; note?: string };
type Mart = {
  mart_id: string;
  mart_name: string;
  business_purpose: string;
  grain: string;
  primary_key: string;
  source_datasets: number[];
  source_tables: string[];
  join_keys: string[];
  filters: string[];
  aggregation_period: string;
  metrics: string[];
  dimensions: string[];
  calculation_rules: string[];
  data_availability: string;
  confidence: string;
  quality_checks: string[];
  missing_events: string[];
  missing_references: string[];
  business_questions: string[];
  implementation_priority: "P0" | "P1" | "P2";
  source_fields: Src[];
};
type Kpi = {
  kpi_id: string;
  name: string;
  target_mart: string;
  formula: string;
  source_fields: Src[];
  join_keys: string[];
  aggregation_period: string;
  status: string;
  confidence: string;
  limitations: string[];
  needed_events: string[];
  needed_references: string[];
};

const s = (dataset_id: number, field: string, note?: string): Src => ({ dataset_id, field, note });

const MARTS: Mart[] = [
  {
    mart_id: "dm_courier_orders",
    mart_name: "***REMOVED***ы курьерской доставки",
    business_purpose: "Единая основа по заказам: объём, статусы, временные этапы, SLA, суммы заказа, ТТ, курьер, пул.",
    grain: "1 строка = заказ (COALESCE(id_general, id_order)); подзаказы id_order сводятся к id_general.",
    primary_key: "order_key = COALESCE(id_general, id_order)",
    source_datasets: [4732, 7006, 7027, 7119, 7775],
    source_tables: ["default.darkstore_time_sheet", "mart_mixed.darkstore_time", "agile_mart_hot_team.order_delivery_base", "default.v_couriers"],
    join_keys: ["order_key", "id_courier", "shopno/id_tt"],
    filters: ["4732: shopno NOT IN (99888), id_tt IS NOT NULL", "7006/7027: status_name='Успешно завершен', delivery_type_group='Курьеры', окно 3 месяца", "7119: id_status=18, is_route=true, окно 14 дней"],
    aggregation_period: "день/неделя/месяц",
    metrics: ["orders_total", "orders_success", "orders_cancelled", "orders_returned", "orders_by_shop", "orders_by_zone", "orders_by_courier", "time_create_to_assembly", "assembly_duration", "wait_duration", "delivery_duration", "sla_on_time_rate"],
    dimensions: ["date", "shopno/id_tt", "direction", "courier_type", "id_pool", "zone/cluster"],
    calculation_rules: [
      "orders_total = COUNT(DISTINCT order_key)",
      "orders_success = COUNT(DISTINCT order_key) WHERE order_status='Успешно завершен'",
      "delivery_duration = date_delivered - date_delivery_start (4732) или duration_fact (7006/7027)",
      "sla_on_time_rate = 1 - AVG(is_late) (7006/7027) или доля date_status_10/date_delivered <= date_supply_untill (4732)",
    ],
    data_availability: "PARTIAL: заказы и временные этапы доступны; order_ready и зона доставки не подтверждены.",
    confidence: "PROBABLE",
    quality_checks: ["order_key NOT NULL", "нет дублей order_key", "date_delivered >= date_order", "нет отрицательных длительностей", "order_status в допустимом наборе", "согласованность COUNT между 4732 и 7006/7027"],
    missing_events: ["order_ready", "order_picked_up"],
    missing_references: ["zone_reference (адрес→зона доставки)", "status_dictionary"],
    business_questions: ["Сколько заказов и какова доля успешных?", "Где нарушается SLA?", "Каково время сборки/ожидания/доставки?"],
    implementation_priority: "P0",
    source_fields: [
      s(4732, "id_order"), s(4732, "id_general"), s(4732, "order_status"), s(4732, "date_order"), s(4732, "date_supply"),
      s(4732, "date_supply_untill"), s(4732, "date_status_10"), s(4732, "date_delivered"), s(4732, "date_delivery_start"),
      s(4732, "date_collect_start"), s(4732, "date_collected"), s(4732, "collection_time_all"), s(4732, "delivery_time_all"),
      s(4732, "sum_order"), s(4732, "sum_paid"), s(4732, "shopno"), s(4732, "id_tt"), s(4732, "id_courier"), s(4732, "id_pool"),
      s(7006, "id_order"), s(7006, "id_courier"), s(7006, "is_late"), s(7006, "minutes_late"), s(7006, "date_delivered"), s(7006, "date_supply_until"),
      s(7027, "id_order"), s(7027, "id_courier"), s(7027, "is_late"), s(7027, "fact_minutes_late"), s(7027, "date_delivered"),
      s(7119, "id_order"), s(7119, "is_late"), s(7119, "date_delivered"), s(7119, "date_supply_until"),
      s(7775, "ID"), s(7775, "job_type"),
    ],
  },
  {
    mart_id: "dm_courier_ready_queue",
    mart_name: "***REMOVED*** готовых заказов",
    business_purpose: "***REMOVED*** заказов, готовых к выдаче курьеру, и время ожидания курьера.",
    grain: "1 строка = заказ в очереди готовности (событие order_ready).",
    primary_key: "order_key + ready_at",
    source_datasets: [4732, 7006, 7027, 7119],
    source_tables: ["default.darkstore_time_sheet", "mart_mixed.darkstore_time", "agile_mart_hot_team.order_delivery_base"],
    join_keys: ["order_key", "shopno/id_tt", "id_courier"],
    filters: ["успешные заказы", "окно 3/14 дней по источнику"],
    aggregation_period: "час/день",
    metrics: ["queue_size", "wait_duration", "ready_to_pickup_duration", "orders_waiting_over_threshold"],
    dimensions: ["date", "shopno/id_tt", "direction", "courier_type"],
    calculation_rules: [
      "Пока НЕ подтверждено: order_ready. Кандидаты: date_status_10 (4732, PROBABLE), date_collected (4732/7006/7027, PROBABLE).",
      "wait_duration = date_pickuped - ready_at (после появления order_ready)",
    ],
    data_availability: "NEEDS_EVENT: подтверждённого события «заказ готов к выдаче» нет; date_status_10 и date_collected — только гипотезы.",
    confidence: "UNKNOWN",
    quality_checks: ["ready_at NOT NULL", "ready_at <= pickup_at", "нет отрицательного wait_duration", "нет дублей order_key+ready_at"],
    missing_events: ["order_ready", "order_picked_up"],
    missing_references: ["status_dictionary"],
    business_questions: ["Сколько заказов ждут курьера?", "Сколько времени заказ проводит в очереди?"],
    implementation_priority: "P0",
    source_fields: [s(4732, "id_order"), s(4732, "date_status_10", "гипотеза order_ready"), s(4732, "date_collected", "гипотеза order_ready"), s(4732, "shopno"), s(4732, "id_tt"), s(7006, "date_pickuped"), s(7006, "date_collected"), s(7027, "date_pickuped"), s(7027, "date_collected"), s(7119, "date_collected"), s(7119, "date_pickuped")],
  },
  {
    mart_id: "dm_delivery_zones",
    mart_name: "Постоянные зоны доставки",
    business_purpose: "Справочник зон доставки, привязка ТТ/адресов к зонам и правила закрепления.",
    grain: "1 строка = зона (zone_id) на дату действия.",
    primary_key: "zone_id + valid_from",
    source_datasets: [4732, 5797, 7293, 7465, 7473],
    source_tables: ["mart.org_unit_actual (zone_cluster)", "agile_mart_techaudit.hr_delivery (inactivity_zone)", "agile_mart_techaudit.hr_delivery (zone transitions)"],
    join_keys: ["shopno/id_tt", "id_courier", "zone"],
    filters: ["7293: zone_changed=1, prev/current zone NOT NULL", "5797/7465/7473: date < today()"],
    aggregation_period: "день",
    metrics: ["zones_total", "orders_by_zone", "couriers_by_zone", "zone_active_flag"],
    dimensions: ["zone", "zone_order", "shopno/id_tt", "direction"],
    calculation_rules: [
      "4732: zone_cluster из mart.org_unit_actual как «Куст» (кластер орг-единицы, не зона доставки).",
      "5797/7465/7473: inactivity_zone — зона бездействия курьера, не зона доставки.",
      "7293: zone_from — зона миграции курьеров (Green/Yellow/Orange/Red/Тишина/Lost).",
      "Адрес доставки → зона: подтверждённой связи нет.",
    ],
    data_availability: "NEEDS_REFERENCE: границы зон, привязка адреса доставки и история изменения границ отсутствуют. area_tt — территория ТТ, не зона.",
    confidence: "UNKNOWN",
    quality_checks: ["zone_id NOT NULL", "нет пересечения зон по адресу", "история границ без разрывов"],
    missing_events: ["courier_zone_assigned", "courier_zone_changed"],
    missing_references: ["zone_reference (zone_id, name, boundaries)", "address_to_zone_mapping", "tt_to_zone_mapping"],
    business_questions: ["Какие постоянные зоны существуют?", "Какие ТТ/адреса входят в зону?"],
    implementation_priority: "P0",
    source_fields: [s(4732, "shopno"), s(4732, "id_tt"), s(4732, "area_tt", "не зона"), s(5797, "inactivity_zone"), s(5797, "prev_inactivity_zone"), s(7293, "zone"), s(7293, "zone_order"), s(7465, "inactivity_zone"), s(7473, "inactivity_zone_ordered")],
  },
  {
    mart_id: "dm_delivery_batches",
    mart_name: "Пакеты заказов (ходки/пулы)",
    business_purpose: "Пакеты заказов, собираемые по постоянным зонам, с составом и временем выдачи/завершения.",
    grain: "1 строка = пакет (batch_key = id_pool_calc или id_pool) на дату.",
    primary_key: "batch_key",
    source_datasets: [7006, 7024, 7027, 7119],
    source_tables: ["mart_mixed.darkstore_time", "ods.v_delivery_job_lines", "agile_mart_hot_team.order_delivery_base"],
    join_keys: ["id_pool", "id_pool_calc", "id_order", "id_courier"],
    filters: ["7006/7027: успешные курьерские доставки, окно 3 месяца", "7024: courier_type in ('вело','авто')", "7119: id_status=18, is_route=true"],
    aggregation_period: "день",
    metrics: ["batches_total", "orders_per_batch", "batch_created_at", "batch_assigned_at", "batch_pickup_at", "batch_completed_at", "batch_success_rate", "batch_zone"],
    dimensions: ["date", "id_pool/id_pool_calc", "shopno", "courier_type", "cluster_id"],
    calculation_rules: [
      "id_pool_calc = DENSE_RANK() по (id_courier, pool_seq), где pool_seq — разрывы date_pickuped (7006/7027).",
      "pool_size = COUNT(DISTINCT id_order) по id_pool_calc (7006/7024/7027) или uniqExact(id_order) по id_pool (7119).",
      "<ФИО>ное правило «5 заказов в пакете» — ГИПОТЕЗА, в источниках не подтверждено.",
    ],
    data_availability: "PARTIAL: состав и размер пула доступны; batch_created/assigned и привязка к зоне не подтверждены.",
    confidence: "PARTIAL",
    quality_checks: ["batch_key NOT NULL", "нет пересечения заказов между пакетами", "orders_per_batch > 0", "batch_pickup_at >= batch_created_at", "один заказ в одном пакете"],
    missing_events: ["batch_created", "batch_assigned", "order_added_to_batch"],
    missing_references: ["zone_reference", "batch_rule_reference (правило формирования пакета)"],
    business_questions: ["Сколько заказов в пакете?", "Как быстро пакет выдаётся и завершается?"],
    implementation_priority: "P0",
    source_fields: [s(7006, "id_pool"), s(7006, "id_pool_calc"), s(7006, "pool_size"), s(7006, "fact_seq"), s(7006, "plan_seq"), s(7006, "date_pickuped"), s(7006, "date_delivered"), s(7024, "id_pool"), s(7024, "pool_size"), s(7024, "plan_duration_min"), s(7024, "fact_duration_min"), s(7027, "id_pool"), s(7027, "pool_size"), s(7027, "total_pool_distance"), s(7119, "id_pool"), s(7119, "pool_size")],
  },
  {
    mart_id: "dm_courier_assignments",
    mart_name: "Назначения курьеров",
    business_purpose: "История назначений заказов/пакетов на курьеров и их принятия/завершения.",
    grain: "1 строка = назначение (order_key или batch_key × courier × assigned_at).",
    primary_key: "assignment_id (order_key + courier + assigned_at)",
    source_datasets: [4732, 7006, 7024, 7027, 7119, 7775],
    source_tables: ["default.darkstore_time_sheet", "mart_mixed.darkstore_time", "agile_mart_hot_team.order_delivery_base", "ods.v_delivery_job_lines"],
    join_keys: ["order_key", "id_courier", "id_pool/id_pool_calc"],
    filters: ["успешные курьерские доставки", "id_courier NOT NULL"],
    aggregation_period: "день",
    metrics: ["assignments_total", "accepted_total", "pickup_total", "completed_total", "cancelled_total", "reassigned_total", "time_to_accept", "time_to_pickup"],
    dimensions: ["date", "courier", "shopno", "batch", "courier_type"],
    calculation_rules: [
      "Факт получения курьером: date_pickuped (7006/7027/7119, PROBABLE).",
      "Факт вручения: date_delivered (VERIFIED).",
      "Назначение/принятие/отмена/повторное назначение как события отсутствуют.",
    ],
    data_availability: "PARTIAL: связь заказ↔курьер и факт pickup доступны; события назначения/принятия/отмены отсутствуют.",
    confidence: "PROBABLE",
    quality_checks: ["assignment_id уникален", "courier NOT NULL", "pickup_at >= assigned_at", "нет назначения завершённого заказа", "нет дублей order+courier+time"],
    missing_events: ["batch_assigned", "courier_accepted_assignment", "order_picked_up", "order_cancelled"],
    missing_references: ["cancel_reason_dictionary"],
    business_questions: ["Кто и когда получил назначение?", "Сколько назначений отменено/переназначено?"],
    implementation_priority: "P0",
    source_fields: [s(4732, "id_order"), s(4732, "id_courier"), s(4732, "date_delivered"), s(4732, "id_pool"), s(7006, "id_order"), s(7006, "id_courier"), s(7006, "date_pickuped"), s(7024, "date_delivered"), s(7024, "id_pool"), s(7027, "id_order"), s(7027, "id_courier"), s(7027, "date_pickuped"), s(7119, "id_order"), s(7119, "id_courier"), s(7119, "date_pickuped"), s(7775, "ID")],
  },
  {
    mart_id: "dm_courier_performance",
    mart_name: "Производительность курьеров",
    business_purpose: "Производительность курьера: заказы, успешные доставки, рабочие дни, время доставки, SLA, динамика, зоны, новички.",
    grain: "1 строка = courier × day (агрегация из заказов); сменная гранулярность — только первые смены новичков.",
    primary_key: "courier_id + date",
    source_datasets: [4732, 7006, 7027, 5797, 7465, 7473, 5247, 5399],
    source_tables: ["default.darkstore_time_sheet", "mart_mixed.darkstore_time", "agile_mart_techaudit.hr_delivery", "agile_mart_techaudit.courier_events_logs_aggr"],
    join_keys: ["id_courier", "date", "shopno"],
    filters: ["успешные доставки", "HR: date < today()", "5247/5399: окно 7 дней / неделя"],
    aggregation_period: "день/неделя/месяц",
    metrics: ["orders_per_courier", "deliveries_success", "working_days", "avg_delivery_duration", "sla_rate", "cancellations", "productivity_dynamics", "productivity_by_zone", "newcomer_productivity"],
    dimensions: ["courier", "date", "shopno", "zone", "courier_type", "newcomer_flag"],
    calculation_rules: [
      "orders_per_courier = COUNT(DISTINCT order_key) GROUP BY id_courier, date",
      "deliveries_success = COUNT(DISTINCT order_key) WHERE order_status='Успешно завершен'",
      "working_days: 5797 days_with_orders (PROBABLE); 7465/7473 — только первые 5 смен/14 дней",
      "sla_rate = 1 - AVG(is_late) (7006/7027)",
    ],
    data_availability: "PARTIAL: заказы по курьеру и HR-агрегаты доступны; полноценных смен нет — только первые 5 смен/14 дней.",
    confidence: "PROBABLE",
    quality_checks: ["courier_id NOT NULL", "orders_per_courier >= 0", "нет дублей courier+date", "sum(orders) по курьерам = orders_total", "нет пересечения смен"],
    missing_events: ["courier_shift_started", "courier_shift_ended"],
    missing_references: ["shift_plan_reference"],
    business_questions: ["Кто самый производительный?", "Как меняется производительность новичков?", "Где SLA хуже?"],
    implementation_priority: "P1",
    source_fields: [s(4732, "id_courier"), s(4732, "id_order"), s(4732, "date_delivered"), s(7006, "id_courier"), s(7006, "duration_fact"), s(7006, "is_late"), s(7027, "id_courier"), s(7027, "is_late"), s(5797, "id_courier"), s(5797, "cnt_orders"), s(5797, "days_with_orders"), s(5797, "enough_shifts_flg"), s(5797, "first_order_date"), s(7465, "cnt_orders"), s(7465, "enough_shifts_flg"), s(7473, "shift_1"), s(7473, "shifts_in_14_days"), s(7473, "fifth_shift_status"), s(5247, "events_qty", "не смены"), s(5399, "events_qty", "не смены")],
  },
  {
    mart_id: "dm_courier_income",
    mart_name: "Доход курьеров",
    business_purpose: "Начисления курьеру за доставку заказов (правило: оплата за заказ).",
    grain: "1 строка = начисление за заказ (accrual_id = order_key + courier + accrual_date).",
    primary_key: "accrual_id",
    source_datasets: [7473, 4732],
    source_tables: ["agile_mart_techaudit.hr_delivery_five_shifts", "default.darkstore_time_sheet"],
    join_keys: ["id_courier", "order_key", "event_date/date"],
    filters: ["7473: первые 5 смен новичка, event_date >= today()-30 DAY"],
    aggregation_period: "день/неделя/месяц",
    metrics: ["income_per_order", "income_per_hour", "income_per_shift", "adjustments", "payout_status"],
    dimensions: ["courier", "date", "zone", "delivery_type"],
    calculation_rules: [
      "Подтверждён только shift_N_profit / shift_N_work_minutes (7473) для первых 5 смен новичка.",
      "income_per_hour = shift_N_profit / (shift_N_work_minutes / 60) — DERIVABLE только для 7473.",
      "sum_order/sum_paid (4732) — суммы ЗАКАЗА, НЕ доход курьера; формула заработка не выводится.",
      "Тарифы за заказ, период действия тарифа, корректировки и статус выплаты отсутствуют.",
    ],
    data_availability: "NEEDS_REFERENCE + NEEDS_BUSINESS_RULE: нет тарифа за заказ и правила начисления; есть только доход по первым 5 сменам (7473).",
    confidence: "UNKNOWN",
    quality_checks: ["нет двойного начисления на заказ", "accrual_amount >= 0", "период тарифа покрывает дату заказа", "courier_id NOT NULL"],
    missing_events: ["courier_income_accrued", "courier_income_adjusted"],
    missing_references: ["tariff_reference (ставка за заказ, период, зона/тип)", "payout_status_dictionary"],
    business_questions: ["Сколько курьер заработал за период?", "Каков доход в час?", "Как учитываются отмены и возвраты?"],
    implementation_priority: "P1",
    source_fields: [s(7473, "id_courier"), s(7473, "shift_1_profit"), s(7473, "shift_1_work_minutes"), s(7473, "shift_2_profit"), s(7473, "shift_2_work_minutes"), s(7473, "shift_5_profit"), s(7473, "shift_5_work_minutes"), s(7473, "thresholds_taken_payments"), s(4732, "sum_order", "не доход"), s(4732, "sum_paid", "не доход"), s(4732, "id_courier"), s(4732, "id_order")],
  },
  {
    mart_id: "dm_courier_mentorship",
    mart_name: "Наставничество и адаптация новичков",
    business_purpose: "Связь наставника и новичка, первые смены, результаты адаптации и удержание.",
    grain: "1 строка = пара (новичок × event_date) с атрибутами наставника/куратора.",
    primary_key: "courier_id + event_date + mentor_id",
    source_datasets: [5797, 7465, 7473],
    source_tables: ["agile_mart_techaudit.hr_delivery", "agile_mart_techaudit.hr_delivery_five_shifts"],
    join_keys: ["id_courier", "event_date", "shopno"],
    filters: ["5797: date < today()", "7465/7473: event_date >= today()-30 DAY"],
    aggregation_period: "день/месяц",
    metrics: ["newcomers_total", "first_shifts_count", "newcomer_orders", "adaptation_days", "mentor_assignment", "newcomer_retention"],
    dimensions: ["courier", "event_date", "name_curator/leader", "shopno", "region_name"],
    calculation_rules: [
      "newcomers = COUNT(DISTINCT id_courier) WHERE first_order_date = date (5797/7465).",
      "curator/leader доступны как name_curator/leader (PROBABLE), но роль «наставник» не подтверждена.",
      "Адаптация: shifts_in_first_14d, enough_shifts_flg, days_with_orders, fifth_shift_status.",
    ],
    data_availability: "PARTIAL: куратор/лидер и первые смены доступны; назначение наставника и результат обучения не подтверждены.",
    confidence: "PARTIAL",
    quality_checks: ["mentor_id != newcomer_id", "один наставник на пару", "event_date в периоде обучения", "нет дублей пары"],
    missing_events: ["courier_mentor_assigned", "courier_training_completed"],
    missing_references: ["mentor_role_reference", "training_program_reference"],
    business_questions: ["Кто обучал новичка?", "Сколько новичков закрепилось?"],
    implementation_priority: "P2",
    source_fields: [s(5797, "id_courier"), s(5797, "first_order_date"), s(5797, "event_date"), s(5797, "name_curator"), s(5797, "leader"), s(5797, "shifts_in_first_14d"), s(5797, "enough_shifts_flg"), s(5797, "cnt_orders"), s(7465, "id_courier"), s(7465, "first_order_date"), s(7465, "name_curator"), s(7465, "shifts_in_first_14d"), s(7473, "id_courier"), s(7473, "fifth_shift_status"), s(7473, "thresholds_taken"), s(7473, "shifts_in_14_days")],
  },
  {
    mart_id: "dm_courier_curator_performance",
    mart_name: "Производительность кураторов",
    business_purpose: "Показатели работы куратора: закреплённые новички, их удержание и продуктивность.",
    grain: "1 строка = куратор × период (день/месяц).",
    primary_key: "curator_id + period",
    source_datasets: [5797, 7465, 7473],
    source_tables: ["agile_mart_techaudit.hr_delivery", "agile_mart_techaudit.hr_delivery_five_shifts"],
    join_keys: ["name_curator", "id_courier", "event_date"],
    filters: ["5797: date < today()", "7465/7473: event_date >= today()-30 DAY"],
    aggregation_period: "месяц",
    metrics: ["curator_newcomers", "curator_retention_14d", "curator_newcomer_orders", "curator_avg_adaptation"],
    dimensions: ["name_curator", "region_name", "shopno", "period"],
    calculation_rules: [
      "curator_newcomers = COUNT(DISTINCT id_courier) GROUP BY name_curator",
      "curator_retention_14d = AVG(enough_shifts_flg) (PROBABLE, только первые 14 дней)",
    ],
    data_availability: "PARTIAL: name_curator и метрики первых смен есть; единая корпоративная формула удержания и роль куратора не подтверждены.",
    confidence: "PARTIAL",
    quality_checks: ["curator_id NOT NULL", "новичок привязан к одному куратору в периоде", "нет дублей curator+period"],
    missing_events: ["courier_mentor_assigned"],
    missing_references: ["curator_role_reference", "curator_org_structure"],
    business_questions: ["Какой куратор лучше удерживает новичков?"],
    implementation_priority: "P2",
    source_fields: [s(5797, "name_curator"), s(5797, "id_courier"), s(5797, "enough_shifts_flg"), s(5797, "cnt_orders"), s(5797, "event_date"), s(7465, "name_curator"), s(7465, "enough_shifts_flg"), s(7473, "name_curator"), s(7473, "fifth_shift_status")],
  },
  {
    mart_id: "dm_courier_attendance",
    mart_name: "Явка и доступность курьеров",
    business_purpose: "Плановая и фактическая смена, опоздания, невыходы, доступность для назначения.",
    grain: "1 строка = courier × planned_shift (после появления плана смен).",
    primary_key: "courier_id + planned_shift_start",
    source_datasets: [5797, 7465, 7473, 5247, 5399],
    source_tables: ["agile_mart_techaudit.hr_delivery", "agile_mart_techaudit.hr_delivery_five_shifts", "agile_mart_techaudit.courier_events_logs_aggr"],
    join_keys: ["id_courier", "date/event_date"],
    filters: ["5797: date < today()", "5247/5399: окно 7 дней / полная неделя"],
    aggregation_period: "день/неделя/месяц",
    metrics: ["planned_shifts", "actual_shifts", "attendance_rate", "late_start", "no_show", "shift_duration", "availability_flag"],
    dimensions: ["courier", "date", "shopno", "zone"],
    calculation_rules: [
      "events_qty (5247/5399) — количество событий, НЕ явка; event_name не расшифрован.",
      "Подтверждённых событий courier_shift_started/ended нет.",
      "Косвенно: shifts_in_first_14d / enough_shifts_flg (5797/7465) — только первые 14 дней, только новички.",
    ],
    data_availability: "NOT_AVAILABLE для плановой/фактической явки; NEEDS_EVENT + NEEDS_REFERENCE.",
    confidence: "UNKNOWN",
    quality_checks: ["planned_shift_start NOT NULL", "actual >= planned", "нет пересечения смен курьера", "no_show без shift_started"],
    missing_events: ["courier_shift_started", "courier_shift_ended"],
    missing_references: ["shift_plan_reference (план смен)", "absence_reason_dictionary"],
    business_questions: ["Кто не вышел на смену?", "Какова явка по зонам?"],
    implementation_priority: "P1",
    source_fields: [s(5247, "event_name", "не явка"), s(5247, "events_qty", "не явка"), s(5247, "courier_id"), s(5247, "d"), s(5399, "event_name"), s(5399, "events_qty"), s(5399, "week_no"), s(5797, "id_courier"), s(5797, "shifts_in_first_14d"), s(5797, "enough_shifts_flg"), s(5797, "no_orders_days_streak", "не невыход"), s(5797, "pause_days"), s(7465, "shifts_in_first_14d"), s(7473, "shifts_in_14_days"), s(7473, "shift_1_work_minutes")],
  },
  {
    mart_id: "dm_courier_demand_forecast",
    mart_name: "Прогноз нагрузки и дефицита курьеров",
    business_purpose: "Прогноз количества заказов, доступных курьеров, дефицита и времени ожидания по зонам.",
    grain: "1 строка = zone × date × hour.",
    primary_key: "zone_id + forecast_date + hour",
    source_datasets: [4732, 7006, 7027, 5797, 7465, 5247, 5399],
    source_tables: ["default.darkstore_time_sheet", "mart_mixed.darkstore_time", "agile_mart_techaudit.hr_delivery", "agile_mart_techaudit.courier_events_logs_aggr"],
    join_keys: ["zone", "date", "shopno"],
    filters: ["исторические окна 3 месяца / 7 дней / 30 дней"],
    aggregation_period: "час/день",
    metrics: ["orders_forecast", "orders_actual", "couriers_available", "courier_deficit", "zone_load", "expected_wait_time"],
    dimensions: ["zone", "date", "hour", "shopno"],
    calculation_rules: [
      "orders_actual = COUNT(order_key) GROUP BY zone, date, hour (DERIVABLE после появления zone_reference).",
      "couriers_available = COUNT(DISTINCT id_courier) по сменам (PARTIAL: смены не подтверждены).",
      "orders_forecast, courier_deficit, expected_wait_time — NEEDS_BUSINESS_RULE/модель.",
    ],
    data_availability: "PARTIAL/NEEDS_BUSINESS_RULE: фактические заказы доступны, прогноз, дефицит и ожидание требуют модели и справочника зон.",
    confidence: "UNKNOWN",
    quality_checks: ["forecast_date >= today", "couriers_available >= 0", "zone_id NOT NULL", "нет дублей zone+date+hour"],
    missing_events: [],
    missing_references: ["zone_reference", "forecast_model_spec", "shift_plan_reference"],
    business_questions: ["Сколько курьеров нужно в зоне завтра?", "Где будет дефицит?"],
    implementation_priority: "P2",
    source_fields: [s(4732, "id_order"), s(4732, "date_order"), s(4732, "shopno"), s(4732, "id_tt"), s(7006, "id_order"), s(7006, "date_delivered"), s(7027, "id_order"), s(5797, "id_courier"), s(5797, "date"), s(7465, "id_courier"), s(5247, "courier_id", "не смены"), s(5247, "d"), s(5399, "courier_id"), s(5399, "week_no")],
  },
];

const KPIS: Kpi[] = [
  { kpi_id: "orders_total", name: "Количество заказов", target_mart: "dm_courier_orders", formula: "COUNT(DISTINCT COALESCE(id_general, id_order))", source_fields: [s(4732, "id_order"), s(4732, "id_general")], join_keys: [], aggregation_period: "день/неделя/месяц", status: "DERIVABLE", confidence: "HIGH", limitations: ["4732: id_order — подзаказ, id_general — объединённый заказ"], needed_events: [], needed_references: [] },
  { kpi_id: "orders_success", name: "Успешные доставки", target_mart: "dm_courier_orders", formula: "COUNT(DISTINCT order_key) WHERE order_status='Успешно завершен'", source_fields: [s(4732, "id_order"), s(4732, "order_status")], join_keys: [], aggregation_period: "день", status: "VERIFIED", confidence: "HIGH", limitations: [], needed_events: [], needed_references: [] },
  { kpi_id: "orders_cancelled", name: "Отменённые заказы", target_mart: "dm_courier_orders", formula: "COUNT(DISTINCT order_key) WHERE order_status IN ('Отменен','Не выполнен','Вернулся на полки')", source_fields: [s(4732, "order_status"), s(4732, "id_order")], join_keys: [], aggregation_period: "день", status: "VERIFIED", confidence: "HIGH", limitations: ["набор статусов зашит в метрике 4732"], needed_events: [], needed_references: [] },
  { kpi_id: "orders_returned", name: "Возвращённые заказы", target_mart: "dm_courier_orders", formula: "COUNT(DISTINCT order_key) WHERE is_returned_store = true", source_fields: [s(4732, "is_returned_store"), s(4732, "id_order")], join_keys: [], aggregation_period: "день", status: "PARTIAL", confidence: "MEDIUM", limitations: ["is_returned_store не проверен на полноту"], needed_events: ["order_returned"], needed_references: [] },
  { kpi_id: "orders_by_shop", name: "***REMOVED***ы по торговым точкам", target_mart: "dm_courier_orders", formula: "COUNT(DISTINCT order_key) GROUP BY shopno", source_fields: [s(4732, "shopno"), s(4732, "id_order")], join_keys: ["shopno"], aggregation_period: "день", status: "DERIVABLE", confidence: "HIGH", limitations: [], needed_events: [], needed_references: [] },
  { kpi_id: "orders_by_zone", name: "***REMOVED***ы по зонам", target_mart: "dm_courier_orders", formula: "COUNT(DISTINCT order_key) GROUP BY zone_id", source_fields: [s(4732, "id_order")], join_keys: ["zone"], aggregation_period: "день", status: "NEEDS_REFERENCE", confidence: "UNKNOWN", limitations: ["zone_id отсутствует; area_tt — территория ТТ"], needed_events: [], needed_references: ["zone_reference"] },
  { kpi_id: "orders_by_courier", name: "***REMOVED***ы по курьерам", target_mart: "dm_courier_orders", formula: "COUNT(DISTINCT order_key) GROUP BY id_courier", source_fields: [s(4732, "id_courier"), s(4732, "id_order")], join_keys: ["id_courier"], aggregation_period: "день", status: "DERIVABLE", confidence: "HIGH", limitations: [], needed_events: [], needed_references: [] },
  { kpi_id: "time_create_to_assembly", name: "Время от создания до сборки", target_mart: "dm_courier_orders", formula: "date_collect_start - date_order", source_fields: [s(4732, "date_order"), s(4732, "date_collect_start")], join_keys: [], aggregation_period: "день", status: "DERIVABLE", confidence: "MEDIUM", limitations: ["date_collect_start PROBABLE"], needed_events: [], needed_references: [] },
  { kpi_id: "assembly_duration", name: "Время сборки", target_mart: "dm_courier_orders", formula: "date_collected - date_collect_start; collection_time_all", source_fields: [s(4732, "date_collected"), s(4732, "date_collect_start"), s(4732, "collection_time_all")], join_keys: [], aggregation_period: "день", status: "DERIVABLE", confidence: "MEDIUM", limitations: ["единицы collection_time_all не подтверждены"], needed_events: [], needed_references: [] },
  { kpi_id: "wait_duration", name: "Время ожидания", target_mart: "dm_courier_orders", formula: "date_pickuped - ready_at", source_fields: [s(4732, "wait_time"), s(4732, "wait_time2"), s(4732, "date_collected")], join_keys: [], aggregation_period: "день", status: "NEEDS_EVENT", confidence: "UNKNOWN", limitations: ["ready_at не подтверждён; wait_time единицы неизвестны"], needed_events: ["order_ready"], needed_references: [] },
  { kpi_id: "delivery_duration", name: "Время доставки", target_mart: "dm_courier_orders", formula: "date_delivered - date_delivery_start (4732); duration_fact (7006)", source_fields: [s(4732, "date_delivered"), s(4732, "date_delivery_start"), s(7006, "duration_fact")], join_keys: [], aggregation_period: "день", status: "DERIVABLE", confidence: "HIGH", limitations: [], needed_events: [], needed_references: [] },
  { kpi_id: "sla_on_time_rate", name: "Соблюдение SLA", target_mart: "dm_courier_orders", formula: "1 - AVG(is_late); для 4732 — доля date_delivered <= date_supply_untill", source_fields: [s(7006, "is_late"), s(7027, "is_late"), s(4732, "date_delivered"), s(4732, "date_supply_untill")], join_keys: [], aggregation_period: "день", status: "DERIVABLE", confidence: "HIGH", limitations: ["SLA-нормативы 4732 приходят из services_sla"], needed_events: [], needed_references: [] },
  { kpi_id: "order_ready_ts", name: "Момент готовности заказа", target_mart: "dm_courier_ready_queue", formula: "order_ready event timestamp", source_fields: [s(4732, "date_status_10", "гипотеза"), s(4732, "date_collected", "гипотеза")], join_keys: ["order_key"], aggregation_period: "—", status: "NEEDS_EVENT", confidence: "UNKNOWN", limitations: ["date_status_10/date_collected не доказывают готовность к выдаче"], needed_events: ["order_ready"], needed_references: [] },
  { kpi_id: "queue_size", name: "Размер очереди готовых заказов", target_mart: "dm_courier_ready_queue", formula: "COUNT(order_key) WHERE ready_at IS NOT NULL AND pickup_at IS NULL", source_fields: [s(4732, "id_order")], join_keys: ["order_key"], aggregation_period: "час", status: "NEEDS_EVENT", confidence: "UNKNOWN", limitations: [], needed_events: ["order_ready", "order_picked_up"], needed_references: [] },
  { kpi_id: "ready_to_pickup_duration", name: "Время от готовности до получения", target_mart: "dm_courier_ready_queue", formula: "order_picked_up.at - order_ready.at", source_fields: [s(7006, "date_pickuped"), s(4732, "date_collected")], join_keys: ["order_key"], aggregation_period: "день", status: "NEEDS_EVENT", confidence: "UNKNOWN", limitations: ["pickup доступен (PROBABLE), ready — нет"], needed_events: ["order_ready", "order_picked_up"], needed_references: [] },
  { kpi_id: "zones_total", name: "Количество зон", target_mart: "dm_delivery_zones", formula: "COUNT(DISTINCT zone_id)", source_fields: [s(7293, "zone"), s(5797, "inactivity_zone")], join_keys: ["zone"], aggregation_period: "—", status: "NEEDS_REFERENCE", confidence: "UNKNOWN", limitations: ["нет справочника зон доставки; inactivity_zone — зона бездействия"], needed_events: [], needed_references: ["zone_reference"] },
  { kpi_id: "couriers_by_zone", name: "Курьеры по зонам", target_mart: "dm_delivery_zones", formula: "COUNT(DISTINCT id_courier) GROUP BY zone", source_fields: [s(5797, "id_courier"), s(5797, "inactivity_zone")], join_keys: ["id_courier", "zone"], aggregation_period: "день", status: "PARTIAL", confidence: "MEDIUM", limitations: ["зона бездействия ≠ зона доставки"], needed_events: ["courier_zone_assigned"], needed_references: ["zone_reference"] },
  { kpi_id: "batches_total", name: "Количество пакетов", target_mart: "dm_delivery_batches", formula: "COUNT(DISTINCT id_pool_calc) или COUNT(DISTINCT id_pool)", source_fields: [s(7006, "id_pool_calc"), s(7024, "id_pool"), s(7119, "id_pool")], join_keys: ["id_pool", "id_pool_calc"], aggregation_period: "день", status: "PARTIAL", confidence: "MEDIUM", limitations: ["id_pool_calc — вычисляемый; id_pool различается по источникам"], needed_events: ["batch_created"], needed_references: [] },
  { kpi_id: "orders_per_batch", name: "***REMOVED***ов в пакете", target_mart: "dm_delivery_batches", formula: "COUNT(DISTINCT id_order) по пакету", source_fields: [s(7006, "pool_size"), s(7024, "pool_size"), s(7119, "pool_size")], join_keys: ["id_pool", "id_pool_calc"], aggregation_period: "день", status: "DERIVABLE", confidence: "MEDIUM", limitations: ["проектное правило 5 заказов не подтверждено"], needed_events: [], needed_references: ["batch_rule_reference"] },
  { kpi_id: "batch_created_at", name: "Время формирования пакета", target_mart: "dm_delivery_batches", formula: "batch_created event", source_fields: [], join_keys: ["id_pool"], aggregation_period: "—", status: "NEEDS_EVENT", confidence: "UNKNOWN", limitations: [], needed_events: ["batch_created"], needed_references: [] },
  { kpi_id: "batch_assigned_at", name: "Время назначения пакета", target_mart: "dm_delivery_batches", formula: "batch_assigned event", source_fields: [], join_keys: ["id_pool", "id_courier"], aggregation_period: "—", status: "NEEDS_EVENT", confidence: "UNKNOWN", limitations: [], needed_events: ["batch_assigned"], needed_references: [] },
  { kpi_id: "batch_success_rate", name: "Доля успешных заказов в пакете", target_mart: "dm_delivery_batches", formula: "AVG(order_status='Успешно завершен') по пакету", source_fields: [s(7006, "id_order"), s(7006, "id_pool_calc")], join_keys: ["id_pool_calc", "order_key"], aggregation_period: "день", status: "PARTIAL", confidence: "MEDIUM", limitations: ["требуется связь пакета с order_status 4732"], needed_events: [], needed_references: [] },
  { kpi_id: "assignments_total", name: "Количество назначений", target_mart: "dm_courier_assignments", formula: "COUNT(DISTINCT order_key + courier)", source_fields: [s(4732, "id_order"), s(4732, "id_courier")], join_keys: ["order_key", "id_courier"], aggregation_period: "день", status: "PARTIAL", confidence: "MEDIUM", limitations: ["нет события назначения; только факт связи заказ↔курьер"], needed_events: ["batch_assigned", "courier_accepted_assignment"], needed_references: [] },
  { kpi_id: "time_to_pickup", name: "Время до получения заказа курьером", target_mart: "dm_courier_assignments", formula: "date_pickuped - assigned_at", source_fields: [s(7006, "date_pickuped")], join_keys: ["order_key", "id_courier"], aggregation_period: "день", status: "NEEDS_EVENT", confidence: "UNKNOWN", limitations: ["assigned_at отсутствует"], needed_events: ["batch_assigned", "order_picked_up"], needed_references: [] },
  { kpi_id: "reassignments_total", name: "Повторные назначения", target_mart: "dm_courier_assignments", formula: "COUNT(*) WHERE reassigned = true", source_fields: [], join_keys: ["order_key"], aggregation_period: "день", status: "NEEDS_EVENT", confidence: "UNKNOWN", limitations: [], needed_events: ["batch_assigned"], needed_references: ["cancel_reason_dictionary"] },
  { kpi_id: "orders_per_courier", name: "***REMOVED***ы на курьера", target_mart: "dm_courier_performance", formula: "COUNT(DISTINCT order_key) GROUP BY id_courier, date", source_fields: [s(4732, "id_courier"), s(4732, "id_order")], join_keys: ["id_courier", "date"], aggregation_period: "день", status: "DERIVABLE", confidence: "HIGH", limitations: [], needed_events: [], needed_references: [] },
  { kpi_id: "working_days", name: "Количество рабочих дней", target_mart: "dm_courier_performance", formula: "COUNT(DISTINCT date) WHERE cnt_orders > 0", source_fields: [s(5797, "days_with_orders"), s(5797, "date"), s(5797, "cnt_orders")], join_keys: ["id_courier", "date"], aggregation_period: "месяц", status: "PARTIAL", confidence: "MEDIUM", limitations: ["days_with_orders — оконная метрика 5797; полных смен нет"], needed_events: ["courier_shift_started", "courier_shift_ended"], needed_references: [] },
  { kpi_id: "newcomer_productivity", name: "Производительность новичков", target_mart: "dm_courier_performance", formula: "SUM(cnt_orders) / COUNT(DISTINCT id_courier) WHERE first_order_date IS NOT NULL", source_fields: [s(5797, "cnt_orders"), s(5797, "first_order_date"), s(7465, "cnt_orders"), s(7473, "shift_1")], join_keys: ["id_courier", "event_date"], aggregation_period: "14 дней", status: "PARTIAL", confidence: "MEDIUM", limitations: ["только первые 5 смен / 14 дней"], needed_events: [], needed_references: [] },
  { kpi_id: "income_per_order", name: "Доход за заказ", target_mart: "dm_courier_income", formula: "tariff(order, zone, type, date)", source_fields: [], join_keys: ["order_key", "id_courier"], aggregation_period: "день", status: "NEEDS_REFERENCE", confidence: "UNKNOWN", limitations: ["тариф за заказ отсутствует"], needed_events: ["courier_income_accrued"], needed_references: ["tariff_reference"] },
  { kpi_id: "income_per_hour", name: "Доход в час", target_mart: "dm_courier_income", formula: "shift_N_profit / (shift_N_work_minutes / 60)", source_fields: [s(7473, "shift_1_profit"), s(7473, "shift_1_work_minutes"), s(7473, "shift_5_profit"), s(7473, "shift_5_work_minutes")], join_keys: ["id_courier", "event_date"], aggregation_period: "смена", status: "DERIVABLE", confidence: "MEDIUM", limitations: ["только первые 5 смен новичка (7473)"], needed_events: ["courier_income_accrued"], needed_references: ["tariff_reference"] },
  { kpi_id: "payout_status", name: "Статус выплаты", target_mart: "dm_courier_income", formula: "payout status per accrual", source_fields: [], join_keys: ["accrual_id"], aggregation_period: "месяц", status: "NEEDS_EVENT", confidence: "UNKNOWN", limitations: [], needed_events: ["courier_income_accrued", "courier_income_adjusted"], needed_references: ["payout_status_dictionary"] },
  { kpi_id: "newcomers_total", name: "Количество новичков", target_mart: "dm_courier_mentorship", formula: "COUNT(DISTINCT id_courier) WHERE first_order_date = date", source_fields: [s(5797, "id_courier"), s(5797, "first_order_date"), s(5797, "date")], join_keys: ["id_courier", "event_date"], aggregation_period: "месяц", status: "DERIVABLE", confidence: "MEDIUM", limitations: [], needed_events: [], needed_references: [] },
  { kpi_id: "newcomer_retention", name: "Удержание новичков", target_mart: "dm_courier_mentorship", formula: "AVG(enough_shifts_flg); ret_14_d", source_fields: [s(5797, "enough_shifts_flg"), s(5797, "ret_14_d", "метрика"), s(7465, "enough_shifts_flg")], join_keys: ["id_courier", "event_date"], aggregation_period: "14 дней", status: "PARTIAL", confidence: "MEDIUM", limitations: ["определение только первые 14 дней"], needed_events: [], needed_references: ["retention_rule_reference"] },
  { kpi_id: "mentor_assignment", name: "Назначение наставника", target_mart: "dm_courier_mentorship", formula: "mentor_id per newcomer", source_fields: [s(5797, "name_curator"), s(7465, "name_curator")], join_keys: ["id_courier"], aggregation_period: "—", status: "NEEDS_EVENT", confidence: "UNKNOWN", limitations: ["name_curator — куратор, не обязательно наставник"], needed_events: ["courier_mentor_assigned"], needed_references: ["mentor_role_reference"] },
  { kpi_id: "training_completed", name: "Обучение завершено", target_mart: "dm_courier_mentorship", formula: "training_completed event", source_fields: [s(7473, "fifth_shift_status"), s(7473, "thresholds_taken")], join_keys: ["id_courier"], aggregation_period: "—", status: "NEEDS_EVENT", confidence: "UNKNOWN", limitations: [], needed_events: ["courier_training_completed"], needed_references: ["training_program_reference"] },
  { kpi_id: "curator_newcomers", name: "Новички куратора", target_mart: "dm_courier_curator_performance", formula: "COUNT(DISTINCT id_courier) GROUP BY name_curator", source_fields: [s(5797, "name_curator"), s(5797, "id_courier")], join_keys: ["name_curator", "id_courier"], aggregation_period: "месяц", status: "PARTIAL", confidence: "MEDIUM", limitations: ["куратор доступен как имя, id отсутствует"], needed_events: [], needed_references: ["curator_role_reference"] },
  { kpi_id: "curator_retention", name: "Удержание новичков куратора", target_mart: "dm_courier_curator_performance", formula: "AVG(enough_shifts_flg) GROUP BY name_curator", source_fields: [s(5797, "name_curator"), s(5797, "enough_shifts_flg")], join_keys: ["name_curator", "id_courier"], aggregation_period: "14 дней", status: "PARTIAL", confidence: "MEDIUM", limitations: ["определение удержания не подтверждено"], needed_events: [], needed_references: ["retention_rule_reference"] },
  { kpi_id: "planned_shifts", name: "Плановые смены", target_mart: "dm_courier_attendance", formula: "COUNT(planned_shift)", source_fields: [], join_keys: ["id_courier", "date"], aggregation_period: "день", status: "NOT_AVAILABLE", confidence: "UNKNOWN", limitations: ["плана смен нет в 12 источниках"], needed_events: [], needed_references: ["shift_plan_reference"] },
  { kpi_id: "actual_shifts", name: "Фактические смены", target_mart: "dm_courier_attendance", formula: "COUNT(courier_shift_started)", source_fields: [s(7473, "shifts_in_14_days"), s(5797, "shifts_in_first_14d")], join_keys: ["id_courier", "date"], aggregation_period: "день", status: "NEEDS_EVENT", confidence: "UNKNOWN", limitations: ["подтверждены только первые 5 смен/14 дней новичков"], needed_events: ["courier_shift_started", "courier_shift_ended"], needed_references: ["shift_plan_reference"] },
  { kpi_id: "attendance_rate", name: "Явка", target_mart: "dm_courier_attendance", formula: "actual_shifts / planned_shifts", source_fields: [], join_keys: ["id_courier", "date"], aggregation_period: "день", status: "NOT_AVAILABLE", confidence: "UNKNOWN", limitations: ["events_qty — не явка"], needed_events: ["courier_shift_started"], needed_references: ["shift_plan_reference"] },
  { kpi_id: "no_show", name: "Невыходы", target_mart: "dm_courier_attendance", formula: "planned_shifts - actual_shifts", source_fields: [s(5797, "no_orders_days_streak", "не невыход"), s(5797, "pause_days")], join_keys: ["id_courier", "date"], aggregation_period: "день", status: "NOT_AVAILABLE", confidence: "UNKNOWN", limitations: ["подтверждённого поля невыхода нет"], needed_events: ["courier_shift_started"], needed_references: ["shift_plan_reference", "absence_reason_dictionary"] },
  { kpi_id: "shift_duration", name: "Продолжительность смены", target_mart: "dm_courier_attendance", formula: "shift_end - shift_start; shift_N_work_minutes", source_fields: [s(7473, "shift_1_work_minutes"), s(7473, "shift_5_work_minutes")], join_keys: ["id_courier", "event_date"], aggregation_period: "смена", status: "PARTIAL", confidence: "MEDIUM", limitations: ["только первые 5 смен новичка"], needed_events: ["courier_shift_started", "courier_shift_ended"], needed_references: [] },
  { kpi_id: "orders_actual_forecast", name: "Фактическое количество заказов (для прогноза)", target_mart: "dm_courier_demand_forecast", formula: "COUNT(DISTINCT order_key) GROUP BY zone, date, hour", source_fields: [s(4732, "id_order"), s(4732, "date_order")], join_keys: ["zone", "date"], aggregation_period: "час", status: "NEEDS_REFERENCE", confidence: "MEDIUM", limitations: ["нет zone_reference для группировки по зонам"], needed_events: [], needed_references: ["zone_reference"] },
  { kpi_id: "couriers_available", name: "Доступные курьеры", target_mart: "dm_courier_demand_forecast", formula: "COUNT(DISTINCT id_courier) WHERE shift_started", source_fields: [s(5797, "id_courier"), s(5797, "date")], join_keys: ["id_courier", "date"], aggregation_period: "час", status: "NEEDS_EVENT", confidence: "UNKNOWN", limitations: ["смены не подтверждены"], needed_events: ["courier_shift_started", "courier_shift_ended"], needed_references: ["shift_plan_reference"] },
  { kpi_id: "courier_deficit", name: "Дефицит курьеров", target_mart: "dm_courier_demand_forecast", formula: "required_couriers - couriers_available", source_fields: [], join_keys: ["zone", "date"], aggregation_period: "час", status: "NEEDS_BUSINESS_RULE", confidence: "UNKNOWN", limitations: ["требует модели нормирования"], needed_events: [], needed_references: ["forecast_model_spec", "shift_plan_reference"] },
  { kpi_id: "expected_wait_time", name: "Прогнозируемое время ожидания", target_mart: "dm_courier_demand_forecast", formula: "model(queue_load, couriers_available)", source_fields: [s(4732, "wait_time", "не подтверждено")], join_keys: ["zone", "date"], aggregation_period: "час", status: "NEEDS_BUSINESS_RULE", confidence: "UNKNOWN", limitations: ["wait_time единицы/семантика не подтверждены"], needed_events: ["order_ready"], needed_references: ["forecast_model_spec", "zone_reference"] },
  { kpi_id: "events_courier_activity", name: "Событийная активность курьера", target_mart: "dm_courier_performance", formula: "SUM(events_qty)", source_fields: [s(5247, "events_qty"), s(5399, "events_qty")], join_keys: ["courier_id", "d"], aggregation_period: "день/неделя", status: "PARTIAL", confidence: "MEDIUM", limitations: ["events_qty — события, не явка и не смены; event_name не расшифрован"], needed_events: [], needed_references: ["event_dictionary"] },
  { kpi_id: "zone_migration_balance", name: "Баланс миграции курьеров между зонами", target_mart: "dm_delivery_zones", formula: "positive_flow - negative_flow", source_fields: [s(7293, "positive_flow"), s(7293, "negative_flow"), s(7293, "balance"), s(7293, "zone")], join_keys: ["zone", "date"], aggregation_period: "день", status: "DERIVABLE", confidence: "MEDIUM", limitations: ["зона бездействия, не зона доставки"], needed_events: [], needed_references: ["zone_reference"] },
];

type MissingEvent = {
  event_id: string;
  name: string;
  purpose: string;
  payload: string;
  required_fields: string[];
  source: string;
  initiated_by: string;
  fixed_when: string;
  recoverable: string;
};
const EVENTS: MissingEvent[] = [
  { event_id: "order_ready", name: "***REMOVED*** готов к выдаче курьеру", purpose: "Начало очереди готовых заказов и расчёт ожидания", payload: "order_id, shop_id, zone_id, ready_at", required_fields: ["order_id", "shop_id", "zone_id", "ready_at", "source_system"], source: "WMS/сборка заказа (darkstore)", initiated_by: "система сборки/оператор", fixed_when: "в момент завершения сборки и подтверждения готовности", recoverable: "НЕТ: date_status_10/date_collected не доказывают готовность к выдаче" },
  { event_id: "order_added_to_batch", name: "***REMOVED*** добавлен в пакет", purpose: "Состав пакета и правило формирования", payload: "batch_id, order_id, added_at, zone_id", required_fields: ["batch_id", "order_id", "added_at", "zone_id"], source: "операционная система назначения", initiated_by: "диспетчер/автоматика", fixed_when: "при добавлении заказа в пакет", recoverable: "ЧАСТИЧНО: id_pool/id_pool_calc есть, но без события добавления" },
  { event_id: "batch_created", name: "Создан пакет", purpose: "Время формирования и границы пакета", payload: "batch_id, created_at, zone_id, shop_id", required_fields: ["batch_id", "created_at", "zone_id"], source: "операционная система", initiated_by: "автоматика/диспетчер", fixed_when: "при создании пакета", recoverable: "НЕТ: id_pool_calc вычисляется постфактум" },
  { event_id: "batch_assigned", name: "Пакет назначен курьеру", purpose: "Назначения и переработка", payload: "batch_id, courier_id, assigned_at", required_fields: ["batch_id", "courier_id", "assigned_at"], source: "операционная система", initiated_by: "диспетчер/автоматика", fixed_when: "при назначении", recoverable: "НЕТ" },
  { event_id: "courier_accepted_assignment", name: "Курьер принял назначение", purpose: "Время принятия и отказы", payload: "assignment_id, courier_id, accepted_at", required_fields: ["assignment_id", "courier_id", "accepted_at"], source: "мобильное приложение курьера", initiated_by: "курьер", fixed_when: "при принятии", recoverable: "НЕТ" },
  { event_id: "order_picked_up", name: "***REMOVED*** фактически получен курьером", purpose: "Конец ожидания, старт доставки", payload: "order_id, courier_id, picked_up_at", required_fields: ["order_id", "courier_id", "picked_up_at"], source: "мобильное приложение/скан", initiated_by: "курьер", fixed_when: "при получении", recoverable: "ЧАСТИЧНО: date_pickuped (7006/7027/7119, PROBABLE)" },
  { event_id: "order_delivered", name: "Доставка завершена", purpose: "Факт вручения и расчёт SLA", payload: "order_id, courier_id, delivered_at", required_fields: ["order_id", "courier_id", "delivered_at"], source: "мобильное приложение", initiated_by: "курьер", fixed_when: "при вручении", recoverable: "ДА: date_delivered (VERIFIED)" },
  { event_id: "order_cancelled", name: "***REMOVED*** отменён", purpose: "Отмены и причины", payload: "order_id, cancelled_at, reason_code", required_fields: ["order_id", "cancelled_at", "reason_code"], source: "операционная система", initiated_by: "оператор/система", fixed_when: "при отмене", recoverable: "ЧАСТИЧНО: order_status='Отменен'" },
  { event_id: "order_returned", name: "***REMOVED*** возвращён", purpose: "Возвраты на полку", payload: "order_id, returned_at, reason_code", required_fields: ["order_id", "returned_at", "reason_code"], source: "операционная система", initiated_by: "курьер/оператор", fixed_when: "при возврате", recoverable: "ЧАСТИЧНО: is_returned_store, order_status='Вернулся на полки'" },
  { event_id: "courier_shift_started", name: "Курьер начал смену", purpose: "Явка, доступность, производительность за смену", payload: "courier_id, shift_id, started_at, zone_id", required_fields: ["courier_id", "shift_id", "started_at"], source: "мобильное приложение/планирование", initiated_by: "курьер", fixed_when: "при старте смены", recoverable: "НЕТ" },
  { event_id: "courier_shift_ended", name: "Курьер завершил смену", purpose: "Длительность смены, простой", payload: "courier_id, shift_id, ended_at", required_fields: ["courier_id", "shift_id", "ended_at"], source: "мобильное приложение/планирование", initiated_by: "курьер", fixed_when: "при завершении", recoverable: "НЕТ" },
  { event_id: "courier_zone_assigned", name: "Курьер закреплён за зоной", purpose: "***REMOVED*** постоянного закрепления", payload: "courier_id, zone_id, assigned_at", required_fields: ["courier_id", "zone_id", "assigned_at"], source: "операционная система", initiated_by: "диспетчер", fixed_when: "при закреплении", recoverable: "НЕТ: inactivity_zone — не зона доставки" },
  { event_id: "courier_zone_changed", name: "Изменена зона курьера", purpose: "История закрепления", payload: "courier_id, zone_from, zone_to, changed_at", required_fields: ["courier_id", "zone_from", "zone_to", "changed_at"], source: "операционная система", initiated_by: "диспетчер", fixed_when: "при изменении", recoverable: "ЧАСТИЧНО: zone_changed/prev_inactivity_zone (зона бездействия)" },
  { event_id: "courier_mentor_assigned", name: "Назначен наставник", purpose: "Обучение и адаптация", payload: "courier_id, mentor_id, assigned_at", required_fields: ["courier_id", "mentor_id", "assigned_at"], source: "HR/операционная система", initiated_by: "куратор", fixed_when: "при назначении", recoverable: "НЕТ: name_curator ≠ наставник" },
  { event_id: "courier_training_completed", name: "Обучение завершено", purpose: "Результат обучения", payload: "courier_id, program_id, completed_at, result", required_fields: ["courier_id", "program_id", "completed_at", "result"], source: "HR/система обучения", initiated_by: "куратор", fixed_when: "при завершении", recoverable: "НЕТ" },
  { event_id: "courier_income_accrued", name: "Начислен доход за заказ", purpose: "Расчёт дохода по правилу «оплата за заказ»", payload: "accrual_id, courier_id, order_id, amount, tariff_id, accrued_at", required_fields: ["accrual_id", "courier_id", "order_id", "amount", "tariff_id", "accrued_at"], source: "финансовая система", initiated_by: "система начислений", fixed_when: "при завершении доставки/расчётном цикле", recoverable: "НЕТ: тарифов и начислений за заказ нет" },
  { event_id: "courier_income_adjusted", name: "Корректировка начисления", purpose: "Отмены, возвраты, штрафы, доплаты", payload: "adjustment_id, accrual_id, amount, reason_code, adjusted_at", required_fields: ["adjustment_id", "accrual_id", "amount", "reason_code", "adjusted_at"], source: "финансовая система", initiated_by: "финансы/оператор", fixed_when: "при корректировке", recoverable: "НЕТ" },
];

type MissingRef = {
  reference_id: string;
  name: string;
  purpose: string;
  required_fields: string[];
  current_partial_source: string;
  status: string;
  needed_for_marts: string[];
};
const REFERENCES: MissingRef[] = [
  { reference_id: "zone_reference", name: "Справочник постоянных зон доставки", purpose: "Определение зон, границ и привязки адресов/ТТ", required_fields: ["zone_id", "zone_name", "valid_from", "valid_to", "geometry"], current_partial_source: "4732 mart.org_unit_actual.zone_cluster (кластер ТТ); 7293 zone (зона бездействия)", status: "NEEDS_REFERENCE", needed_for_marts: ["dm_delivery_zones", "dm_courier_orders", "dm_delivery_batches", "dm_courier_demand_forecast"] },
  { reference_id: "address_to_zone_mapping", name: "Привязка адреса доставки к зоне", purpose: "Географическая зона заказа", required_fields: ["address_id", "zone_id", "valid_from", "valid_to"], current_partial_source: "нет подтверждённой связи", status: "NEEDS_REFERENCE", needed_for_marts: ["dm_delivery_zones", "dm_courier_orders"] },
  { reference_id: "tariff_reference", name: "Справочник тарифов", purpose: "Ставка за заказ и период действия", required_fields: ["tariff_id", "amount", "zone_id", "delivery_type", "valid_from", "valid_to"], current_partial_source: "7473 shift_N_profit (только первые 5 смен)", status: "NEEDS_REFERENCE", needed_for_marts: ["dm_courier_income"] },
  { reference_id: "shift_plan_reference", name: "План смен", purpose: "Плановая явка и доступность", required_fields: ["courier_id", "shift_id", "planned_start", "planned_end", "zone_id"], current_partial_source: "нет; shifts_in_first_14d/5_shifts — только первые смены новичков", status: "NEEDS_REFERENCE", needed_for_marts: ["dm_courier_attendance", "dm_courier_demand_forecast"] },
  { reference_id: "status_dictionary", name: "Справочник статусов заказа", purpose: "Однозначная трактовка order_status/id_status/status_name", required_fields: ["status_id", "status_name", "description", "is_final"], current_partial_source: "order_status/status_name в 4732/7006/7119 без словаря", status: "NEEDS_REFERENCE", needed_for_marts: ["dm_courier_orders", "dm_courier_ready_queue"] },
  { reference_id: "event_dictionary", name: "Справочник event_name", purpose: "Расшифровка событий курьера (5247/5399)", required_fields: ["event_name", "description", "category"], current_partial_source: "5247/5399 event_name без словаря", status: "NEEDS_REFERENCE", needed_for_marts: ["dm_courier_attendance", "dm_courier_performance"] },
  { reference_id: "batch_rule_reference", name: "***REMOVED*** формирования пакета", purpose: "Формализация «5 заказов», зоны, приоритеты", required_fields: ["rule_id", "max_orders", "zone_scope", "valid_from"], current_partial_source: "проектное правило, в источниках не подтверждено", status: "NEEDS_BUSINESS_RULE", needed_for_marts: ["dm_delivery_batches"] },
  { reference_id: "mentor_role_reference", name: "Справочник наставников", purpose: "Отличие наставника от куратора", required_fields: ["courier_id", "role", "valid_from", "valid_to"], current_partial_source: "5797/7465 name_curator, leader (PROBABLE)", status: "NEEDS_REFERENCE", needed_for_marts: ["dm_courier_mentorship", "dm_courier_curator_performance"] },
  { reference_id: "retention_rule_reference", name: "***REMOVED*** удержания", purpose: "Единое определение удержания/оттока", required_fields: ["rule_id", "window_days", "threshold", "valid_from"], current_partial_source: "5797 ret_14_d/turnover/attrition — частные формулы", status: "NEEDS_BUSINESS_RULE", needed_for_marts: ["dm_courier_mentorship", "dm_courier_curator_performance"] },
  { reference_id: "forecast_model_spec", name: "<ФИО> прогноза нагрузки", purpose: "Прогноз заказов, дефицита и ожидания", required_fields: ["model_id", "features", "horizon", "version"], current_partial_source: "нет", status: "NEEDS_BUSINESS_RULE", needed_for_marts: ["dm_courier_demand_forecast"] },
  { reference_id: "absence_reason_dictionary", name: "Справочник причин невыхода", purpose: "Классификация невыходов", required_fields: ["reason_code", "description"], current_partial_source: "нет", status: "NEEDS_REFERENCE", needed_for_marts: ["dm_courier_attendance"] },
  { reference_id: "cancel_reason_dictionary", name: "Справочник причин отмены", purpose: "Классификация отмен и переназначений", required_fields: ["reason_code", "description"], current_partial_source: "нет", status: "NEEDS_REFERENCE", needed_for_marts: ["dm_courier_assignments"] },
  { reference_id: "payout_status_dictionary", name: "Статусы выплат", purpose: "Жизненный цикл начисления", required_fields: ["status_code", "description"], current_partial_source: "нет", status: "NEEDS_REFERENCE", needed_for_marts: ["dm_courier_income"] },
];

function csvCell(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}
function csv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

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

function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  if (!existsSync(FIELDS)) throw new Error(`missing ${FIELDS}; run audit-datasets.ts first`);
  const fieldRows = parseCsv(readFileSync(FIELDS, "utf8"));
  const fh = fieldRows[0];
  const di = fh.indexOf("dataset_id");
  const ci = fh.indexOf("column_name");
  const available = new Set(fieldRows.slice(1).map((r) => `${r[di]}|${r[ci]}`));
  if (existsSync(METRICS)) {
    const metRows = parseCsv(readFileSync(METRICS, "utf8"));
    const mh = metRows[0];
    const mdi = mh.indexOf("dataset_id");
    const mni = mh.indexOf("metric_name");
    for (const r of metRows.slice(1)) available.add(`${r[mdi]}|${r[mni]}`);
  }

  const evidenceIssues: Array<{ owner: string; dataset_id: number; field: string }> = [];
  const checkSrc = (owner: string, list: Src[]) => {
    for (const x of list) {
      if (!available.has(`${x.dataset_id}|${x.field}`)) evidenceIssues.push({ owner, dataset_id: x.dataset_id, field: x.field });
    }
  };
  for (const m of MARTS) checkSrc(m.mart_id, m.source_fields);
  for (const k of KPIS) checkSrc(k.kpi_id, k.source_fields);

  const statusCounts: Record<string, number> = {};
  for (const k of KPIS) statusCounts[k.status] = (statusCounts[k.status] ?? 0) + 1;

  const registry = {
    generated_at: new Date().toISOString(),
    stage: "1.2",
    source: "аудит SQL 12 утверждённых датасетов + Lineage + KPI Source Matrix; витрины НЕ создаются",
    status_vocabulary: STATUSES,
    totals: {
      marts: MARTS.length,
      kpis: KPIS.length,
      missing_events: EVENTS.length,
      missing_references: REFERENCES.length,
      evidence_issues: evidenceIssues.length,
      status_counts: statusCounts,
    },
    evidence_issues: evidenceIssues,
    marts: MARTS,
    kpis: KPIS,
  };
  writeFileSync(OUT_JSON, JSON.stringify(registry, null, 2), { mode: 0o600 });

  // data_mart_registry.csv
  const martCsv: unknown[][] = [
    ["mart_id", "mart_name", "business_purpose", "grain", "primary_key", "source_datasets", "source_tables", "join_keys", "filters", "aggregation_period", "metrics", "dimensions", "calculation_rules", "data_availability", "confidence", "quality_checks", "missing_events", "missing_references", "business_questions", "implementation_priority"],
  ];
  for (const m of MARTS) {
    martCsv.push([
      m.mart_id, m.mart_name, m.business_purpose, m.grain, m.primary_key,
      m.source_datasets.join(";"), m.source_tables.join(";"), m.join_keys.join(";"), m.filters.join(";"),
      m.aggregation_period, m.metrics.join(";"), m.dimensions.join(";"), m.calculation_rules.join(";"),
      m.data_availability, m.confidence, m.quality_checks.join(";"), m.missing_events.join(";"),
      m.missing_references.join(";"), m.business_questions.join(";"), m.implementation_priority,
    ]);
  }
  writeFileSync(OUT_CSV, csv(martCsv), { mode: 0o600 });

  // data_mart_fields.csv
  const fieldCsv: unknown[][] = [["mart_id", "dataset_id", "field", "note", "evidence_available"]];
  for (const m of MARTS) {
    for (const x of m.source_fields) {
      fieldCsv.push([m.mart_id, x.dataset_id, x.field, x.note ?? "", available.has(`${x.dataset_id}|${x.field}`)]);
    }
  }
  writeFileSync(OUT_FIELDS, csv(fieldCsv), { mode: 0o600 });

  // kpi_availability_matrix.csv
  const kpiCsv: unknown[][] = [
    ["kpi_id", "name", "target_mart", "formula", "source_fields", "sources", "join_keys", "aggregation_period", "status", "confidence", "limitations", "needed_events", "needed_references", "evidence_issues"],
  ];
  for (const k of KPIS) {
    const issues = k.source_fields.filter((x) => !available.has(`${x.dataset_id}|${x.field}`)).map((x) => `${x.dataset_id}.${x.field}`);
    kpiCsv.push([
      k.kpi_id, k.name, k.target_mart, k.formula,
      k.source_fields.map((x) => `${x.dataset_id}.${x.field}`).join(";"),
      [...new Set(k.source_fields.map((x) => x.dataset_id))].join(";"),
      k.join_keys.join(";"), k.aggregation_period, k.status, k.confidence,
      k.limitations.join(";"), k.needed_events.join(";"), k.needed_references.join(";"), issues.join(";"),
    ]);
  }
  writeFileSync(OUT_KPI, csv(kpiCsv), { mode: 0o600 });

  // events / references
  const evCsv: unknown[][] = [["event_id", "name", "purpose", "payload", "required_fields", "source", "initiated_by", "fixed_when", "recoverable_from_current"]];
  for (const e of EVENTS) evCsv.push([e.event_id, e.name, e.purpose, e.payload, e.required_fields.join(";"), e.source, e.initiated_by, e.fixed_when, e.recoverable]);
  writeFileSync(OUT_EVENTS, csv(evCsv), { mode: 0o600 });

  const refCsv: unknown[][] = [["reference_id", "name", "purpose", "required_fields", "current_partial_source", "status", "needed_for_marts"]];
  for (const r of REFERENCES) refCsv.push([r.reference_id, r.name, r.purpose, r.required_fields.join(";"), r.current_partial_source, r.status, r.needed_for_marts.join(";")]);
  writeFileSync(OUT_REFS, csv(refCsv), { mode: 0o600 });

  // data_mart_registry.md
  const md: string[] = [];
  md.push("# Реестр агрегированных витрин — Этап 1.2");
  md.push("");
  md.push(`Сгенерировано: ${registry.generated_at}`);
  md.push("");
  md.push("Витрины НЕ создаются: это спецификация на основе аудита SQL 12 датасетов.");
  md.push("");
  md.push(`Всего витрин: ${MARTS.length}; показателей: ${KPIS.length}; недостающих событий: ${EVENTS.length}; справочников: ${REFERENCES.length}.`);
  md.push("");
  md.push("| mart_id | grain | source_datasets | priority | availability |");
  md.push("|---|---|---|---|---|");
  for (const m of MARTS) md.push(`| ${m.mart_id} | ${m.grain} | ${m.source_datasets.join(", ")} | ${m.implementation_priority} | ${m.data_availability} |`);
  md.push("");
  for (const m of MARTS) {
    md.push(`## ${m.mart_id} — ${m.mart_name}`);
    md.push("");
    md.push(`- **business_purpose:** ${m.business_purpose}`);
    md.push(`- **grain:** ${m.grain}`);
    md.push(`- **primary_key:** ${m.primary_key}`);
    md.push(`- **source_datasets:** ${m.source_datasets.join(", ")}`);
    md.push(`- **source_tables:** ${m.source_tables.join(", ")}`);
    md.push(`- **join_keys:** ${m.join_keys.join(", ")}`);
    md.push(`- **filters:** ${m.filters.join("; ")}`);
    md.push(`- **aggregation_period:** ${m.aggregation_period}`);
    md.push(`- **metrics:** ${m.metrics.join(", ")}`);
    md.push(`- **dimensions:** ${m.dimensions.join(", ")}`);
    md.push(`- **data_availability:** ${m.data_availability}`);
    md.push(`- **confidence:** ${m.confidence}`);
    md.push(`- **implementation_priority:** ${m.implementation_priority}`);
    md.push("");
    md.push("**calculation_rules:**");
    for (const r of m.calculation_rules) md.push(`- ${r}`);
    md.push("");
    md.push("**quality_checks:**");
    for (const r of m.quality_checks) md.push(`- ${r}`);
    md.push("");
    md.push(`**missing_events:** ${m.missing_events.join(", ") || "нет"}`);
    md.push("");
    md.push(`**missing_references:** ${m.missing_references.join(", ") || "нет"}`);
    md.push("");
    md.push("**business_questions:**");
    for (const r of m.business_questions) md.push(`- ${r}`);
    md.push("");
  }
  writeFileSync(OUT_MD, md.join("\n"), { mode: 0o600 });

  // data_quality_rules.md
  const q: string[] = [];
  q.push("# Правила качества будущих витрин — Этап 1.2");
  q.push("");
  q.push("Правила описывают минимальные проверки будущего ETL. ETL на этом этапе НЕ запускается.");
  q.push("");
  q.push("## Общие проверки");
  q.push("");
  q.push("- уникальность первичного ключа витрины;");
  q.push("- отсутствие неожиданных дублей;");
  q.push("- NULL в обязательных полях;");
  q.push("- валидность временных интервалов (start <= end);");
  q.push("- отсутствие отрицательных длительностей;");
  q.push("- допустимые статусы и невозможные переходы;");
  q.push("- контроль потери и размножения строк при JOIN;");
  q.push("- согласованность COUNT заказов между источниками;");
  q.push("- отсутствие пересечения заказов между зонами/пакетами;");
  q.push("- отсутствие двойного начисления дохода.");
  q.push("");
  for (const m of MARTS) {
    q.push(`## ${m.mart_id}`);
    q.push("");
    for (const c of m.quality_checks) q.push(`- ${c}`);
    q.push("");
  }
  writeFileSync(OUT_QUALITY, q.join("\n"), { mode: 0o600 });

  // implementation_priorities.md
  const p: string[] = [];
  p.push("# Приоритеты реализации витрин — Этап 1.2");
  p.push("");
  p.push("| Приоритет | Витрина | Причина | Статус данных |");
  p.push("|---|---|---|---|");
  const reasons: Record<string, string> = {
    dm_courier_orders: "Основа всей системы",
    dm_delivery_zones: "Постоянные зоны и привязка заказов",
    dm_courier_ready_queue: "***REMOVED*** готовых заказов",
    dm_delivery_batches: "Пакеты заказов",
    dm_courier_assignments: "Назначения курьеров",
    dm_courier_performance: "Производительность",
    dm_courier_income: "Оплата за заказ",
    dm_courier_attendance: "Явка и доступность",
    dm_courier_mentorship: "Обучение",
    dm_courier_curator_performance: "Работа кураторов",
    dm_courier_demand_forecast: "Прогноз нагрузки",
  };
  for (const m of [...MARTS].sort((a, b) => a.implementation_priority.localeCompare(b.implementation_priority))) {
    p.push(`| ${m.implementation_priority} | ${m.mart_id} | ${reasons[m.mart_id] ?? ""} | ${m.data_availability} |`);
  }
  p.push("");
  p.push("Приоритеты могут быть скорректированы после появления справочников зон/тарифов и событий смен.");
  p.push("");
  writeFileSync(OUT_PRIORITIES, p.join("\n"), { mode: 0o600 });

  console.log(
    JSON.stringify(
      {
        marts: MARTS.length,
        kpis: KPIS.length,
        events: EVENTS.length,
        references: REFERENCES.length,
        status_counts: statusCounts,
        evidence_issues: evidenceIssues.length,
        files: [
          "data_mart_registry.json",
          "data_mart_registry.csv",
          "data_mart_registry.md",
          "data_mart_fields.csv",
          "kpi_availability_matrix.csv",
          "missing_events_registry.csv",
          "missing_references_registry.csv",
          "data_quality_rules.md",
          "implementation_priorities.md",
        ],
      },
      null,
      2,
    ),
  );

  if (evidenceIssues.length) process.exitCode = 1;
}

main();
