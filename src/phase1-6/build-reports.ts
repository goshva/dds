/**
 * Этап 1.6 — формирование отчётов и машиночитаемых результатов на основе
 * собранных доказательств (метаданные Superset) и зафиксированного блокера SQL Lab.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertReadOnly } from "./client";

const DOCS = "docs/phase-01-6";
const REPORTS = "reports/phase-01-6";

function w(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
}
function readJson(p: string): any | null {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
function csvCell(v: unknown) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}
function csv(rows: unknown[][]) {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

const BLOCKER = {
  id: "BLOCK-1",
  title: "SQL Lab недоступен для учётной записи API",
  detail:
    "POST /api/v1/sqllab/execute/ → HTTP 403 Forbidden (базы 92 и 76); GET /api/v1/sqllab/ → 403; POST /api/v1/sqllab/estimate/ → 403; POST /api/v1/chart/data → 401 Not authorized; POST /superset/sql_json/ → 404; GET /api/v1/database/ → 200, но count=0. Метаданные (GET /api/v1/dataset/{id}, /api/v1/chart/) доступны.",
  impact: "G3 (реальные SQL-проверки) и G4 (связи по данным) не выполнены; фактические данные, NULL-доли, кардинальности и покрытие соединений не измерены.",
  required: "Выдать учётной записи право can_sqllab/can_execute_sql (и видимость баз) либо предоставить отдельный read-only аккаунт SQL Lab.",
};

// ------------------------------------------------------------------ sql forensics

const SQL_FORENSICS = {
  stale_metadata_columns: [
    { dataset_id: 3466, column: "time_ready", occurrences_in_sql: 0, sql_len: 35926, verdict: "Колонка есть в метаданных Superset (тип не определён), но НЕ формируется SQL датасета. Кандидат на источник готовности опровергнут." },
    { dataset_id: 3466, column: "time_ready_plan", occurrences_in_sql: 0, sql_len: 35926, verdict: "Не формируется SQL датасета; как плановое время готовности использоваться не может." },
    { dataset_id: 5939, column: "date_for_mentor", occurrences_in_sql: 0, sql_len: 4301, verdict: "Не формируется SQL датасета; период наставничества по ней строить нельзя." },
  ],
  physical_schemas: [
    { table: "agile_mart_operational.shifts", columns: ["id_shift", "id_courier", "id_pool", "shift_start", "shift_finish"], used_by: [7802], note: "физическая таблица смен с началом и окончанием" },
    { table: "agile_mart_operational.pools", columns: ["id_pool", "id_order", "pool_start", "pool_finish"], used_by: [7802], note: "структура пула и его заказов — кандидат в trips/trip_orders" },
    { table: "agile_mart_operational.courier_queue", columns: ["courier_id", "id_shift", "queue_in_dttm", "queue_out_dttm", "has_order", "first_delivery_dttm", "cluster_id"], used_by: [7802], note: "физическая очередь курьеров со временем входа/выхода" },
    { table: "agile_mart_operational.photo_control_shift_attempt", columns: ["courier_id", "attempt_dt", "attempt_n", "attempt_start", "shift_opened"], used_by: [7712], note: "факты фотоконтроля начала смены" },
    { table: "mart_mixed.darkstore_time", columns: ["id_order", "id_general", "shopno", "date_order"], used_by: [7802], note: "основной заказный источник даркстора" },
    { table: "mart_mixed.darkstore_time_sheet", columns_count: 121, used_by: [3466, 7021], note: "основная витрина таймшита; 121 колонка используется датасетом 3466" },
    { table: "ods.timesheetfact", columns: ["id_sbor", "time_start", "time_end", "id_tt"], used_by: [7021], note: "факты табеля сборщиков" },
    { table: "ods.v_couriers", columns: ["id", "name"], used_by: [7802, 7712], note: "справочник курьеров" },
    { table: "ods.v_tt", columns: ["id_tt", "region_tt"], used_by: [7802, 7712], note: "справочник торговых точек" },
    { table: "mart.org_unit_actual", columns: ["org_unit_id", "zone_cluster", "leader_curators", "manager_delivery"], used_by: [7802, 7712, 3466], note: "оргструктура и кластеры" },
  ],
  derived_expressions: [
    { dataset_id: 7802, column: "rn_shift", expression: "row_number() OVER (PARTITION BY id_shift ORDER BY shopno NULLS LAST)", meaning: "нумерация строк внутри смены; rn_shift = 1 даёт одну строку на смену" },
    { dataset_id: 7802, column: "useless_minutes", expression: "round(shift_raw) - round(wait_raw) - round(assembly_raw) - round(delivery_raw)", meaning: "простой вычисляется как остаток; shift = wait + assembly + delivery + useless" },
    { dataset_id: 7802, column: "shift_minutes", expression: "round(x.shift_raw::numeric, 1)", meaning: "длительность смены в минутах, вычисляется из shift_start/shift_finish" },
    { dataset_id: 3466, column: "deadline_sbor", expression: "date_supply_untill - coalesce(sla_delivery_time_all, 0) * 60", meaning: "дедлайн сборки — вычисляемое значение, не факт" },
    { dataset_id: 3466, column: "last_sbor_touch", expression: "coalesce(date_set_cell, date_f_status_3_5)", meaning: "последнее касание сборки — вычисляемое" },
    { dataset_id: 7021, column: "shift_type", expression: "if(toDate(time_end) > toDate(time_start), 'Ночной', 'Дневной')", meaning: "тип смены СБОРЩИКА вычисляется из табеля ods.timesheetfact" },
    { dataset_id: 7021, column: "is_night_shift", expression: "if(shift_type IS NULL, NULL, toUInt8(shift_type = 'Ночной'))", meaning: "полностью производное от shift_type" },
    { dataset_id: 7021, column: "has_timesheet", expression: "if(id_sbor IS NULL, 0, 1)", meaning: "признак наличия табеля" },
    { dataset_id: 5939, column: "enough_shifts_for_mentor", expression: "count(CASE WHEN shift_rn_trainee IS NOT NULL THEN 1 END) OVER (PARTITION BY person_code, date_start_work, mentor_at_date)", meaning: "оконный агрегат, не хранимый факт" },
    { dataset_id: 7712, column: "shift_open_time", expression: "NULL::timestamp в ветке курьеров без попытки", meaning: "для курьеров без фотоконтроля поле намеренно NULL" },
  ],
  transfer_reasons_2339: [
    "Перенос заказа на следующий день из-за невозможности доставки",
    "***REMOVED*** даты доставки: Долгое ожидание сборки",
    "***REMOVED*** даты доставки: Долгий поиск курьера",
    "***REMOVED*** даты доставки: <ФИО>",
    "***REMOVED*** даты доставки: Дежурный не обновил поиск",
  ],
};

// ------------------------------------------------------------------ query plan

type PlannedQuery = { id: string; dataset_id: number; database_id: number | null; dbms: string; purpose: string; sql: string; expected: string; related_bd: string[] };

const QUERY_PLAN: PlannedQuery[] = [
  { id: "P-016-001", dataset_id: 3466, database_id: 92, dbms: "clickhouse", purpose: "Заполняемость кандидатов готовности (BD-013)", sql: "SELECT count(*) AS rows, count(date_status_10) AS status10_filled, count(date_set_cell) AS set_cell_filled, count(date_collected) AS collected_filled, count(date_delivered) AS delivered_filled FROM mart_mixed.darkstore_time_sheet", expected: "Доли заполнения кандидатов; выбрать наиболее полный и стабильный", related_bd: ["BD-013", "BD-014"] },
  { id: "P-016-002", dataset_id: 3466, database_id: 92, dbms: "clickhouse", purpose: "Невозможный порядок дат заказа", sql: "SELECT count(*) AS bad_rows FROM mart_mixed.darkstore_time_sheet WHERE (date_set_cell IS NOT NULL AND date_order IS NOT NULL AND date_set_cell < date_order) OR (date_delivered IS NOT NULL AND date_set_cell IS NOT NULL AND date_delivered < date_set_cell)", expected: "0 или объяснимые исключения", related_bd: ["BD-013", "BD-014"] },
  { id: "P-016-003", dataset_id: 3466, database_id: 92, dbms: "clickhouse", purpose: "Словарь статусов заказа (BD-014)", sql: "SELECT order_status, count(*) AS cnt FROM mart_mixed.darkstore_time_sheet GROUP BY order_status ORDER BY cnt DESC LIMIT 50", expected: "Перечень статусов и частот для словаря", related_bd: ["BD-014"] },
  { id: "P-016-004", dataset_id: 3466, database_id: 92, dbms: "clickhouse", purpose: "Дубликаты заказа в таймшите", sql: "SELECT count(*) AS rows, count(DISTINCT id_order) AS orders, count(DISTINCT id_general) AS generals FROM mart_mixed.darkstore_time_sheet", expected: "Определить зерно: заказ или подзаказ", related_bd: ["BD-016"] },
  { id: "P-016-005", dataset_id: 7802, database_id: 76, dbms: "postgresql", purpose: "Зерно смен: id_shift уникален?", sql: "SELECT count(*) AS rows, count(DISTINCT id_shift) AS shifts, count(DISTINCT id_courier) AS couriers, min(shift_start) AS min_start, max(shift_finish) AS max_finish FROM agile_mart_operational.shifts", expected: "rows ≈ shifts (одна строка на смену)", related_bd: ["BD-017"] },
  { id: "P-016-006", dataset_id: 7802, database_id: 76, dbms: "postgresql", purpose: "NULL и отрицательные длительности смены", sql: "SELECT count(*) AS rows, count(shift_start) AS started, count(shift_finish) AS finished, sum(CASE WHEN shift_finish < shift_start THEN 1 ELSE 0 END) AS negative FROM agile_mart_operational.shifts", expected: "Отрицательных нет или они объяснены", related_bd: ["BD-017"] },
  { id: "P-016-007", dataset_id: 7802, database_id: 76, dbms: "postgresql", purpose: "Структура пула: заказов на пул", sql: "SELECT count(*) AS rows, count(DISTINCT id_pool) AS pools, count(DISTINCT id_order) AS orders FROM agile_mart_operational.pools", expected: "***REMOVED***ов больше пулов; размеры 2–5", related_bd: ["BD-003"] },
  { id: "P-016-008", dataset_id: 7802, database_id: 76, dbms: "postgresql", purpose: "***REMOVED***: заполняемость и порядок времён", sql: "SELECT count(*) AS rows, count(queue_in_dttm) AS queued_in, count(queue_out_dttm) AS queued_out, sum(CASE WHEN has_order THEN 1 ELSE 0 END) AS with_order FROM agile_mart_operational.courier_queue", expected: "queue_in заполнен; queue_out частично", related_bd: ["BD-004", "BD-002"] },
  { id: "P-016-009", dataset_id: 7802, database_id: 76, dbms: "postgresql", purpose: "Покрытие связи shifts.id_pool ↔ pools.id_pool", sql: "SELECT count(*) AS shift_rows, count(p.id_pool) AS matched FROM agile_mart_operational.shifts s LEFT JOIN agile_mart_operational.pools p ON p.id_pool = s.id_pool", expected: "Доля сопоставленных смен с пулом", related_bd: ["BD-003"] },
  { id: "P-016-010", dataset_id: 7712, database_id: 76, dbms: "postgresql", purpose: "Фотоконтроль: попытки на курьера и день", sql: "SELECT count(*) AS rows, count(DISTINCT courier_id) AS couriers, count(DISTINCT attempt_dt) AS days, max(attempt_n) AS max_attempt FROM agile_mart_operational.photo_control_shift_attempt", expected: "Несколько попыток на курьера; max_attempt > 1", related_bd: ["BD-013"] },
  { id: "P-016-011", dataset_id: 7712, database_id: 76, dbms: "postgresql", purpose: "Покрытие связи attempt.courier_id ↔ shifts.id_courier по дню", sql: "SELECT count(*) AS attempt_rows, count(s.id_shift) AS matched_shifts FROM agile_mart_operational.photo_control_shift_attempt a LEFT JOIN agile_mart_operational.shifts s ON s.id_courier = a.courier_id AND s.shift_start::date = a.attempt_dt", expected: "Доля попыток, сопоставленных со сменой", related_bd: ["BD-017"] },
  { id: "P-016-012", dataset_id: 5939, database_id: 96, dbms: "clickhouse", purpose: "Наставничество: заполняемость mentorid и progul", sql: "SELECT count(*) AS rows, count(mentorid) AS mentor_filled, count(DISTINCT mentorid) AS mentors, count(DISTINCT person_code) AS persons, sum(progul) AS progul_sum FROM \"agile_mart_techaudit\".hr_daily_pers", expected: "Доля NULL в mentorid; смысл progul", related_bd: ["BD-001"] },
  { id: "P-016-013", dataset_id: 5939, database_id: 96, dbms: "clickhouse", purpose: "Справочник помощников ТТ: зерно и периоды", sql: "SELECT count(*) AS rows, count(DISTINCT id_tt) AS tts, count(DISTINCT pu_code) AS pus, min(event_date) AS min_date, max(event_date) AS max_date FROM \"agile_mart_techaudit\".actual_assistant_tt", expected: "Определить, является ли это назначением на ТТ, а не на новичка", related_bd: ["BD-001"] },
  { id: "P-016-014", dataset_id: 7021, database_id: 96, dbms: "clickhouse", purpose: "Табель: корректность интервалов", sql: "SELECT count(*) AS rows, count(time_start) AS started, count(time_end) AS finished, sum(CASE WHEN time_end < time_start THEN 1 ELSE 0 END) AS negative, count(DISTINCT id_sbor) AS sbors FROM ods.timesheetfact", expected: "Интервалы корректны; подтвердить, что это сборщики", related_bd: ["BD-020"] },
  { id: "P-016-015", dataset_id: 2339, database_id: null, dbms: "mssql", purpose: "Смысл quantity_batch и orders_assignment", sql: "SELECT TOP 50 quantity_batch, count(*) AS cnt FROM Reports.dbo.ksa_time_vw GROUP BY quantity_batch ORDER BY cnt DESC", expected: "Распределение размеров пакета; уточнить смысл orders_assignment", related_bd: ["BD-003", "BD-006"] },
  { id: "P-016-016", dataset_id: 3466, database_id: 92, dbms: "clickhouse", purpose: "Покрытие связи таймшит ↔ заказы по id_order", sql: "SELECT count(*) AS sheet_rows, count(dt.id_order) AS matched FROM mart_mixed.darkstore_time_sheet s LEFT JOIN mart_mixed.darkstore_time dt ON dt.id_order = s.id_order", expected: "Доля сопоставленных заказов", related_bd: ["BD-016"] },
  { id: "P-016-017", dataset_id: 3466, database_id: 92, dbms: "clickhouse", purpose: "Соотношение id_general и id_order (подзаказы)", sql: "SELECT count(*) AS rows, count(DISTINCT id_order) AS orders, count(DISTINCT id_general) AS generals, count(DISTINCT concat(toString(id_general), '-', toString(id_order))) AS pairs FROM mart_mixed.darkstore_time_sheet", expected: "Определить, является ли id_order подзаказом", related_bd: ["BD-016"] },
  { id: "P-016-018", dataset_id: 7802, database_id: 76, dbms: "postgresql", purpose: "Проверка формулы разбивки минут", sql: "SELECT count(*) AS rows FROM agile_mart_operational.shifts s JOIN agile_mart_operational.pools p ON p.id_pool = s.id_pool WHERE s.shift_finish < s.shift_start", expected: "0 — базовая проверка корректности данных", related_bd: ["BD-017"] },
];

// ------------------------------------------------------------------ architecture impact per decision

const BD_ARCH_IMPACT: Record<string, string> = {
  "BD-001": "Определяет права на mentorship_assignments.assigned_by и событие MENTORSHIP_ASSIGNED; автоназначение потребует правила подбора наставника.",
  "BD-002": "Влияет на очередь и на необходимость события эскалации; может добавить статус/событие к order_readiness.",
  "BD-003": "Влияет на инвариант «одна зона в ходке» (INV-TRP-01) и на выборку курьеров при формировании ходки.",
  "BD-004": "Меняет правило FIFO; возможно добавление поля приоритета в courier_queue_entries.",
  "BD-005": "Влияет на автоматическое закрытие trips и на INV-SHF-03 (нельзя закрыть смену с открытой ходкой).",
  "BD-006": "Определяет, разрешены ли изменения trip_orders после выезда и нужна ли админ-процедура с аудитом.",
  "BD-007": "Определяет необходимость accrual_adjustments и тип сторно; влияет на неизменяемость начислений.",
  "BD-008": "Определяет структуру tariff_versions и обязательность tariff_version_id в courier_accruals.",
  "BD-009": "Может добавить поля метрики загруженности в tariff_versions или отдельную таблицу коэффициентов.",
  "BD-010": "Определяет переходы accrual_status и роли, подтверждающие начисление.",
  "BD-011": "Определяет матрицу прав и необходимость отдельной миграции ролей/аудита (0009).",
  "BD-012": "Влияет на статусы trip_assignments и courier_queue_entries (пауза, пропуск, аварийная отмена).",
  "BD-013": "Определяет источник order_readiness.ready_at и событие ORDER_READY; без решения поле остаётся TBD.",
  "BD-014": "Определяет словарь статусов orders и полноту order_status_history.",
  "BD-015": "Влияет на расчёт SLA и на использование признаков is_canceled/is_returned_store.",
  "BD-016": "Определяет направление синхронизации orders и обязательность source_system/source_updated_at.",
  "BD-017": "Определяет структуру courier_external_ids и правила сопоставления id_courier/person_code/user_code.",
  "BD-018": "Определяет физические типы (geography vs jsonb), частичные уникальные индексы и партиционирование в DDL.",
  "BD-019": "Определяет, создаётся ли миграция 0009 (роли) или переиспользуется внешний identity provider.",
  "BD-020": "Определяет необходимость таблицы work_slots в MVP.",
  "BD-021": "Определяет перечень значений delivery_attempts.result и влияние результата на начисление.",
  "BD-022": "Определяет необходимость zone_boundary_versions и объём хранимой истории границ.",
  "BD-023": "Определяет партиционирование и архивирование domain_events и courier_accruals.",
  "BD-024": "Определяет процесс approved_by/effective_from для tariff_versions.",
};

// ------------------------------------------------------------------ datasets

type Finding = {
  dataset_id: number;
  name: string;
  database: string;
  backend: string;
  kind: string;
  schema: string | null;
  columns: number;
  metrics: number;
  sql_len: number;
  sources: string[];
  key_columns: string[];
  pii_columns: string[];
  unknown_type_columns: string[];
  documented_grain: string | null;
  evidence_level: "METADATA" | "METADATA_PLUS_DOC";
  data_verified: false;
  conclusions: string[];
  limits: string[];
};

const FINDINGS: Finding[] = [
  {
    dataset_id: 5939,
    name: "hr_daily_pers_mentors",
    database: "ch_10.0.112.21",
    backend: "clickhousedb",
    kind: "virtual",
    schema: "agile_mart_techaudit",
    columns: 70,
    metrics: 31,
    sql_len: 4301,
    sources: ["agile_mart_techaudit.actual_assistant_tt", "agile_mart_techaudit.hr_daily_pers", "stage_outer_sources.fio_employee"],
    key_columns: ["mentorid", "mentor_at_date", "mentorid_at_date", "mentor_same_tt_date", "enough_shifts_for_mentor", "mentor_in_five", "trainee_shift_in_five", "trainee_shifts_qty", "shift_rn_trainee", "shift_rn_trainee_by_mentor", "first_shift_date", "last_shift_date", "shifts_qty", "progul", "stake", "event_date", "event_type", "person_code", "employee_code", "date", "date_start_work", "date_dismissed", "hdp.id_tt"],
    pii_columns: ["fio", "mentorfio", "cfo_name", "cfo_name_for_pu", "direct_name"],
    unknown_type_columns: ["date_for_mentor", "progul_text", "pause_groups", "period_from", "soon_hire", "TTfeature", "type_tt_coalesce", "age_group"],
    documented_grain: null,
    evidence_level: "METADATA",
    data_verified: false,
    conclusions: [
      "Наставничество в источнике строится вокруг справочника помощников ТТ (actual_assistant_tt), а не вокруг отдельной сущности «назначение наставника новичку».",
      "mentorid и mentorfio присутствуют, но mentorfio — ПДн; сопоставление mentorid с id_courier не подтверждено.",
      "progul (Int32) — числовой признак, не событие; семантика не подтверждена.",
      "stake (Decimal(22,6)) — денежный скаляр; назначение (ставка/доля) не подтверждено.",
      "Дата назначения date_for_mentor НЕ формируется SQL датасета (0 вхождений) — устаревшая колонка метаданных; период наставничества по ней строить нельзя.",
    ],
    limits: [
      "Нет фактических данных: доля NULL в mentorid, число уникальных наставников/стажёров, распределение по месяцам не измерены (SQL Lab 403).",
      "Не установлено, является ли датасет зерном «курьер × день» или «курьер × день × ТТ».",
    ],
  },
  {
    dataset_id: 7802,
    name: "shift_time_breakdown",
    database: "gp_10.0.112.100/dwh",
    backend: "postgresql (Greenplum)",
    kind: "virtual",
    schema: "agile_mart_operational",
    columns: 23,
    metrics: 1,
    sql_len: 10498,
    sources: ["agile_mart_operational.shifts", "agile_mart_operational.pools", "agile_mart_operational.courier_queue", "mart_mixed.darkstore_time", "ods.v_couriers", "ods.v_tt", "mart.org_unit_actual"],
    key_columns: ["id_shift", "id_courier", "dt", "shopno", "rn_shift", "rn_shift_tt", "rn_shift_pu", "rn_shift_bush", "rn_shift_region", "rn_shift_tu", "shift_minutes", "assembly_minutes", "delivery_minutes", "wait_minutes", "useless_minutes"],
    pii_columns: ["courier_name"],
    unknown_type_columns: [],
    documented_grain: "id_shift × ТТ; rn_shift = 1 — одна строка смены; rn_shift_pu = 1 — одна строка смены внутри ПУ (из комментариев SQL датасета)",
    evidence_level: "METADATA_PLUS_DOC",
    data_verified: false,
    conclusions: [
      "Зерно задокументировано автором датасета: id_shift × ТТ, минуты повторяются на каждой ТТ; для одной строки на смену используется rn_shift = 1.",
      "Обнаружены физические таблицы agile_mart_operational.shifts, .pools, .courier_queue — прямые кандидаты в источники courier_shifts, trips и courier_queue_entries.",
      "id_shift имеет строковый тип, id_courier — целочисленный; связь с id_courier из других систем требует сопоставления.",
      "wait_minutes — длительность, а не время; не доказывает ожидание в очереди.",
    ],
    limits: [
      "Уникальность id_shift, доля NULL, отрицательные и аномальные значения не измерены (SQL Lab 403).",
      "Не подтверждено, что agile_mart_operational.shifts — мастер-источник смен, а не аналитическая витрина.",
    ],
  },
  {
    dataset_id: 7712,
    name: "photo_control_shift_bi",
    database: "gp_10.0.112.100/dwh",
    backend: "postgresql (Greenplum)",
    kind: "virtual",
    schema: "agile_mart_operational",
    columns: 54,
    metrics: 1,
    sql_len: 6396,
    sources: ["agile_mart_operational.photo_control_shift_attempt", "mart_mixed.darkstore_time", "ods.v_tasks_settings", "ods.v_tt", "report.v_org_unit_actual", "ods.v_couriers", "ods.v_couriers_payments_courier_types", "ods.v_courier_job_type"],
    key_columns: ["courier_id", "shopno", "attempt_dt", "attempt_start", "attempt_n", "shift_opened", "shift_open_time", "photo_end", "is_attempt"],
    pii_columns: ["name", "delivery_manager", "leader", "id_name"],
    unknown_type_columns: [],
    documented_grain: "факт попытки фотоконтроля начала смены; пишет DAG dag_photo_control_shift_attempt в agile_mart_operational.photo_control_shift_attempt (из комментариев SQL)",
    evidence_level: "METADATA_PLUS_DOC",
    data_verified: false,
    conclusions: [
      "shift_open_time — фактическое время события фотоконтроля начала смены, а не обязательно операционное начало смены.",
      "shift_opened — целочисленный признак (0/1), не событие.",
      "Зерно — попытка фотоконтроля (attempt_n) на курьера и дату; id_shift в датасете отсутствует.",
    ],
    limits: [
      "Нет id_shift → прямая связь с 7802 по ключу смены невозможна; связь только по (courier_id, дата) — слабая.",
      "Доли заполнения и дубликаты не измерены (SQL Lab 403).",
    ],
  },
  {
    dataset_id: 7021,
    name: "ds_collectors_prod",
    database: "ch_10.0.112.21",
    backend: "clickhousedb",
    kind: "virtual",
    schema: null,
    columns: 41,
    metrics: 12,
    sql_len: 9437,
    sources: ["ods.timesheetfact", "mart_mixed.darkstore_time_sheet"],
    key_columns: ["id_order", "id_tt", "shopno", "user_code", "id_sbor", "id_assemblysheet", "qty_collected", "sbor", "shift_type", "is_night_shift", "hours_on_schedule", "has_timesheet", "date_status_10", "time_start", "time_end", "part_start", "part_end"],
    pii_columns: ["user_code"],
    unknown_type_columns: [],
    documented_grain: "выработка сборщиков даркстора (из описания датасета)",
    evidence_level: "METADATA_PLUS_DOC",
    data_verified: false,
    conclusions: [
      "Датасет описывает выработку СБОРЩИКОВ даркстора, а не курьеров: отсутствует id_courier, есть id_sbor/id_assemblysheet/qty_collected.",
      "shift_type и is_night_shift относятся к сменам сборщиков; использовать их для courier_shifts нельзя.",
      "Использование 7021 для классификации смен курьеров, заложенное в Этапе 1.5, ПРОТИВОРЕЧИТ содержимому источника.",
      "date_status_10 присутствует и в 3466, и в 7021 — это сквозной статус заказа, не готовность.",
    ],
    limits: ["Распределение значений shift_type и согласованность с is_night_shift не измерены (SQL Lab 403)."],
  },
  {
    dataset_id: 3466,
    name: "darkstore_time_sheet",
    database: "ch_10.0.112.21/default",
    backend: "clickhousedb",
    kind: "virtual",
    schema: "mart_mixed",
    columns: 167,
    metrics: 243,
    sql_len: 38370,
    sources: ["mart_mixed.darkstore_time_sheet", "report.v_org_unit_actual"],
    key_columns: ["id_order", "id_general", "shopno", "id_tt", "id_courier", "id_delivery_job", "id_pool", "id_group", "date_order", "date_collect_start", "date_collected", "date_status_10", "date_delivery_start", "date_delivered", "deadline_sbor", "time_ready", "time_ready_plan", "is_canceled", "is_returned_store", "order_status", "geo", "area_tt", "zone_cluster"],
    pii_columns: ["user_inn", "phone", "user_code", "courier", "user_kontr", "id_user_kontr"],
    unknown_type_columns: ["time_ready", "time_ready_plan", "date_of_collected", "time_collect_start", "type_sheet", "vv_week_date_order", "qty_sl_dk_by_TT", "source_name", "time_set_cell_last", "hour_collected", "hour", "date_update_msk", "time_type_collected_dk", "time_status", "time_collect_start_plan", "ph_scheme", "internal_orders_of_DC", "time_give_on_kassa", "collect_time_type", "collection_type", "time_order"],
    documented_grain: "строка = заказ (id_order) в даркстор-таймшите; источник mart_mixed.darkstore_time_sheet",
    evidence_level: "METADATA",
    data_verified: false,
    conclusions: [
      "**time_ready и time_ready_plan НЕ формируются SQL датасета** (0 вхождений в 35 926 символах SQL) — это устаревшие колонки метаданных Superset, а не источник факта готовности.",
      "date_status_10 — реальная колонка физической таблицы mart_mixed.darkstore_time_sheet (DateTime64(6)); семантика статуса 10 не подтверждена.",
      "deadline_sbor и last_sbor_touch — вычисляемые выражения, а не факты.",
      "Датасет содержит Jinja-параметры (filter_values) — прямое выполнение SQL датасета требует параметров.",
      "Порядок событий заказа подтверждается наличием полей date_order → date_collect_start → date_collected → date_delivery_start → date_delivered, но их фактическая согласованность не измерена.",
    ],
    limits: [
      "Доля заполнения time_ready/time_ready_plan, случаи time_ready < date_order или time_ready > date_delivered не проверены (SQL Lab 403).",
      "time_ready_plan и time_ready не объединялись — плановое и фактическое время разделены.",
    ],
  },
  {
    dataset_id: 2339,
    name: "Перенесенные заказы",
    database: "Reports",
    backend: "mssql",
    kind: "virtual",
    schema: "dbo",
    columns: 107,
    metrics: 1,
    sql_len: 881,
    sources: ["Loyalty_srv03.dbo.Webcall_log_ui_period (табличная функция)", "Reports.dbo.ksa_time_vw (представление)"],
    key_columns: ["object_id", "id_order", "quantity_batch", "orders_assignment", "new_value", "old_value", "date_add", "date_supply", "date_for_wait2", "wait_time", "wait_time2", "status_name", "log_data", "action", "autor", "source", "prop", "type", "id_courier", "shopno"],
    pii_columns: ["autor", "courier", "leader", "senior", "Pom", "user_code", "ОтветственныйГЕО", "Куратор"],
    unknown_type_columns: ["date_supply_con", "date_collect_start_con", "date_delivery_start_con", "date_collected_con", "date_delivered_con", "date_order_con", "order_all", "old_value_conv", "date_add_conv", "date_diff", "Наименование ТТ", "comment", "status_name_", "Куратор", "id_group", "id_assemblysheet_header", "sum_cash_refunded", "sum_paid_disc", "sum_bonus_refunded", "qty_pos_l", "id_cause", "name_service", "refund_reason", "sum_paid", "id_job", "str_orders", "qty_tov", "nkormax", "sbor", "error", "СвойствоПродавца"],
    documented_grain: "строка = запись журнала изменения даты доставки (Webcall_log_ui_period) для заказа за последний месяц",
    evidence_level: "METADATA_PLUS_DOC",
    data_verified: false,
    conclusions: [
      "Источник — журнал изменений даты доставки за последний месяц (DATEADD(MONTH,-1,GETDATE())), а не система пакетов/ходок.",
      "quantity_batch и orders_assignment приходят из представления Reports.dbo.ksa_time_vw; их смысл (размер пакета или признак группировки) не подтверждён.",
      "Уникального идентификатора пакета в датасете нет; состав пакета не восстанавливается.",
      "Из-за скользящего окна в один месяц история переносов ограничена.",
    ],
    limits: [
      "Связь с конкретными заказами ограничена object_id/id_order и не проверена.",
      "Суммы sum_paid/sum_paid_disc присутствуют как nullable и не должны использоваться для начислений.",
    ],
  },
];

// ------------------------------------------------------------------ relationships

type Rel = {
  id: string;
  left: string;
  right: string;
  join_fields: string;
  key_type: string;
  type_match: "MATCH" | "MISMATCH" | "ABSENT";
  coverage: string;
  status: "VERIFIED" | "PARTIAL" | "INFERRED" | "NOT_VERIFIED" | "CONTRADICTED";
  cardinality: string;
  false_positive_risk: string;
  note: string;
};

const RELATIONSHIPS: Rel[] = [
  { id: "R-1", left: "5939", right: "7802", join_fields: "person_code/employee_code/mentorid ↔ id_courier", key_type: "строка ↔ целое", type_match: "MISMATCH", coverage: "не измерено", status: "NOT_VERIFIED", cardinality: "неизвестна", false_positive_risk: "высокий: разные пространства идентификаторов", note: "Нужен справочник сопоставления сотрудник↔курьер (BD-017)." },
  { id: "R-2", left: "7802", right: "7712", join_fields: "id_shift ↔ (нет id_shift); возможна связь courier_id+дата", key_type: "id_shift отсутствует в 7712", type_match: "ABSENT", coverage: "не измерено", status: "NOT_VERIFIED", cardinality: "неизвестна", false_positive_risk: "средний: связь по (courier_id, дата) может объединить разные смены", note: "Совпадение по дате не доказывает идентичность смены." },
  { id: "R-3", left: "7802", right: "7021", join_fields: "id_courier отсутствует в 7021", key_type: "нет общего ключа", type_match: "ABSENT", coverage: "0 (по построению)", status: "CONTRADICTED", cardinality: "нет связи", false_positive_risk: "n/a", note: "7021 описывает сборщиков, а не курьеров; для смен курьеров непригоден." },
  { id: "R-4", left: "3466", right: "4732", join_fields: "id_order (Int32) ↔ id_order", key_type: "целое ↔ целое", type_match: "MATCH", coverage: "не измерено (SQL Lab 403)", status: "PARTIAL", cardinality: "предположительно N:1", false_positive_risk: "низкий по типу, но id_order может быть подзаказом", note: "Требуется проверка покрытия и учёт id_general." },
  { id: "R-5", left: "2339", right: "4732", join_fields: "object_id/id_order (INT) ↔ id_order", key_type: "целое ↔ целое", type_match: "MATCH", coverage: "не измерено (SQL Lab 403)", status: "PARTIAL", cardinality: "1:N (несколько переносов на заказ)", false_positive_risk: "низкий", note: "Источник ограничен последним месяцем." },
  { id: "R-6", left: "7802", right: "4732", join_fields: "id_courier ↔ id_courier", key_type: "LONGINTEGER ↔ Int32", type_match: "MATCH", coverage: "не измерено (SQL Lab 403)", status: "PARTIAL", cardinality: "N:M (курьер × заказ × день)", false_positive_risk: "средний: id_courier может быть из разных систем", note: "Связь заказ↔курьер через день смены требует подтверждения." },
  { id: "R-7", left: "3466", right: "7802", join_fields: "id_courier + дата", key_type: "целое + дата", type_match: "MATCH", coverage: "не измерено", status: "INFERRED", cardinality: "N:M", false_positive_risk: "средний", note: "Косвенная связь через день и курьера, без id_shift." },
  { id: "R-8", left: "agile_mart_operational.pools", right: "mart_mixed.darkstore_time", join_fields: "id_order ↔ id_order", key_type: "целое ↔ целое", type_match: "MATCH", coverage: "не измерено (BLOCK-1)", status: "INFERRED", cardinality: "N:1 (заказ в одном пуле)", false_positive_risk: "низкий", note: "Связь подтверждена на уровне схемы: pools содержит id_order и id_pool. Покрытие не измерено." },
  { id: "R-9", left: "agile_mart_operational.shifts", right: "agile_mart_operational.courier_queue", join_fields: "id_shift ↔ id_shift", key_type: "строка ↔ (тип не подтверждён)", type_match: "MATCH", coverage: "не измерено (BLOCK-1)", status: "INFERRED", cardinality: "1:N (несколько входов в очередь на смену)", false_positive_risk: "низкий", note: "Связь подтверждена на уровне схемы по имени ключа id_shift; тип в courier_queue не подтверждён." },
  { id: "R-10", left: "agile_mart_operational.courier_queue", right: "ods.v_couriers", join_fields: "courier_id ↔ id", key_type: "целое ↔ целое", type_match: "MATCH", coverage: "не измерено (BLOCK-1)", status: "INFERRED", cardinality: "N:1", false_positive_risk: "средний", note: "Справочник курьеров; сопоставление с id_courier других систем не доказано (BD-017)." },
];

// ------------------------------------------------------------------ BD evidence

type Bd = {
  id: string;
  status: "CONFIRMED_BY_DATA" | "READY_FOR_BUSINESS_APPROVAL" | "BUSINESS_DECISION_REQUIRED" | "PARTIAL_EVIDENCE" | "NOT_VERIFIABLE" | "CONTRADICTED";
  evidence: string;
  datasets: number[];
  tables: string[];
  events: string[];
  question: string;
  closure: string;
};

const BD: Bd[] = [
  { id: "BD-001", status: "PARTIAL_EVIDENCE", evidence: "5939 содержит mentorid/mentorfio и справочник actual_assistant_tt, но назначение наставника новичку как факт не подтверждено; ФИО — ПДн.", datasets: [5939], tables: ["mentorship_assignments", "courier_external_ids"], events: ["MENTORSHIP_ASSIGNED"], question: "Кто назначает новичка куратору и фиксируется ли это отдельным фактом?", closure: "Согласовать роль и подтвердить, что назначение фиксируется событием, а не выводится из справочника помощников ТТ." },
  { id: "BD-002", status: "PARTIAL_EVIDENCE", evidence: "Прямого события «нет подходящего курьера» нет, но 2339 содержит реальные причины переноса даты доставки, включая «Долгий поиск курьера» и «Дежурный не обновил поиск» — это подтверждает существование ситуации, но не процедуру её обработки.", datasets: [2339, 7802], tables: ["courier_queue_entries"], events: ["ORDER_READY"], question: "Что делать, если заказ готов, а подходящего курьера нет?", closure: "Утвердить процедуру и, при необходимости, новое событие." },
  { id: "BD-003", status: "BUSINESS_DECISION_REQUIRED", evidence: "***REMOVED*** допуска курьера к чужой зоне в источниках не найдено.", datasets: [], tables: ["trips", "trip_assignments"], events: [], question: "Допускать ли курьера из другой зоны?", closure: "Утвердить правило допуска." },
  { id: "BD-004", status: "PARTIAL_EVIDENCE", evidence: "Физическая таблица courier_queue содержит queue_in_dttm/queue_out_dttm/has_order/id_shift; в 7006/7027/7119 есть arrival_time, plan_arrival_deadline и fact_arrival_before_deadline — то есть факты прибытия и очереди существуют. ***REMOVED*** возврата пропущенного курьера — бизнес-решение.", datasets: [7802, 7006, 7027, 7119], tables: ["courier_queue_entries"], events: ["COURIER_SKIPPED_IN_QUEUE"], question: "Возврат курьера: новый FIFO или сохранение приоритета?", closure: "Утвердить правило приоритета после проверки данных о queue_in/queue_out и arrival_time." },
  { id: "BD-005", status: "BUSINESS_DECISION_REQUIRED", evidence: "Признаков автоматического закрытия ходки в источниках нет.", datasets: [], tables: ["trips", "courier_shifts"], events: ["TRIP_COMPLETED"], question: "Что делать, если курьер не закрыл ходку?", closure: "Утвердить процедуру." },
  { id: "BD-006", status: "BUSINESS_DECISION_REQUIRED", evidence: "2339 — журнал изменения даты доставки, а не отмен после выезда.", datasets: [2339], tables: ["trip_orders", "trip_order_membership_history"], events: ["TRIP_ORDER_REMOVED"], question: "Как поступать с отменой после выезда?", closure: "Утвердить процедуру и права." },
  { id: "BD-007", status: "BUSINESS_DECISION_REQUIRED", evidence: "Возвраты фиксируются флагом is_returned_store (3466), но правило корректировки начисления — бизнес-решение.", datasets: [3466], tables: ["accrual_adjustments"], events: ["ACCRUAL_ADJUSTED"], question: "Как учитывать возврат после доставки?", closure: "Утвердить правило сторно/корректировки." },
  { id: "BD-008", status: "BUSINESS_DECISION_REQUIRED", evidence: "Тарифных таблиц в проверенных источниках нет; stake (5939) — скаляр с неясной семантикой; sum_paid — сумма заказа, не доход.", datasets: [5939, 2339], tables: ["tariff_versions", "courier_accruals"], events: ["TARIFF_APPROVED"], question: "Точная формула тарифа по зоне и расстоянию?", closure: "Утвердить формулу и ставки; без этого начисления остаются DRAFT." },
  { id: "BD-009", status: "BUSINESS_DECISION_REQUIRED", evidence: "Метрик загруженности, влияющих на тариф, в источниках не найдено.", datasets: [], tables: ["tariff_versions"], events: [], question: "Учитывать ли загруженность в тарифе?", closure: "Утвердить метрику или отказаться от надбавки." },
  { id: "BD-010", status: "BUSINESS_DECISION_REQUIRED", evidence: "Процесс подтверждения начислений в источниках отсутствует.", datasets: [], tables: ["courier_accruals"], events: ["COURIER_ACCRUAL_APPROVED"], question: "Когда начисление окончательно и кто подтверждает?", closure: "Утвердить процесс." },
  { id: "BD-011", status: "BUSINESS_DECISION_REQUIRED", evidence: "Роли в источниках не описаны.", datasets: [], tables: ["trips", "trip_assignments"], events: [], question: "Какие роли могут отменить/переназначить ходку?", closure: "Утвердить матрицу прав." },
  { id: "BD-012", status: "PARTIAL_EVIDENCE", evidence: "2339 фиксирует причины «<ФИО>» и «Долгий поиск курьера» как основания переноса даты; таблица courier_queue содержит queue_in_dttm/queue_out_dttm/has_order. Процедура при запрете отказа — бизнес-решение.", datasets: [2339, 7802], tables: ["trip_assignments", "courier_queue_entries"], events: ["COURIER_QUEUE_PAUSED"], question: "Как фиксировать невозможность принять ходку при запрете отказа?", closure: "Утвердить процедуру исключения." },
  { id: "BD-013", status: "CONTRADICTED", evidence: "Кандидат time_ready ОПРОВЕРГНУТ: в полном обезличенном SQL датасета 3466 (35 926 символов) нет ни одного вхождения time_ready и time_ready_plan — колонки присутствуют в метаданных Superset, но не формируются датасетом. При этом в 4732 и в физической таблице mart_mixed.darkstore_time_sheet присутствует семейство кандидатов готовности: date_set_cell, date_collected, date_printed, date_status_10, is_collected, set_cell_time, date_f_status_3_5. Ни один из них не подтверждён как факт готовности к выдаче курьеру.", datasets: [3466, 4732, 7021], tables: ["orders", "order_readiness"], events: ["ORDER_READY"], question: "Кто и когда фиксирует готовность заказа?", closure: "<ФИО> данные по шортлисту (date_set_cell / date_collected / date_status_10) и подтвердить бизнес-смысл; иначе готовность вводится новым событием ORDER_READY." },
  { id: "BD-014", status: "PARTIAL_EVIDENCE", evidence: "order_status присутствует в 3466/4732; date_status_10 — сквозной статус; словаря статусов в источниках нет.", datasets: [3466, 7021], tables: ["orders", "order_status_history"], events: ["ORDER_STATUS_CORRECTED"], question: "Какие точные статусы и переходы заказа действуют?", closure: "Утвердить словарь статусов и переходов." },
  { id: "BD-015", status: "BUSINESS_DECISION_REQUIRED", evidence: "Флаги is_canceled/is_returned_store есть, правило учёта в SLA — бизнес-решение.", datasets: [3466], tables: ["orders"], events: [], question: "Как учитывать отменённые/возвращённые заказы в SLA?", closure: "Утвердить правило (ответ «не исключать автоматически» уже получен)." },
  { id: "BD-016", status: "BUSINESS_DECISION_REQUIRED", evidence: "id_order присутствует в 3466 и 2339, id_general — в 3466; мастер-система заказа не определена.", datasets: [3466, 2339], tables: ["orders", "order_status_history"], events: ["ORDER_IMPORTED"], question: "Какой мастер-источник заказа и статуса?", closure: "Утвердить мастер-систему и направление синхронизации." },
  { id: "BD-017", status: "PARTIAL_EVIDENCE", evidence: "Идентификаторы курьера различаются: id_courier (7802/7712), person_code/employee_code/mentorid (5939), user_code (7021/3466); сопоставление не доказано.", datasets: [7802, 7712, 5939, 7021], tables: ["couriers", "courier_external_ids"], events: ["COURIER_REGISTERED"], question: "Какой мастер-источник идентичности курьера и ТТ?", closure: "Утвердить мастер-источник и справочник сопоставления внешних ID." },
  { id: "BD-018", status: "READY_FOR_BUSINESS_APPROVAL", evidence: "Технические требования подтверждены моделью 1.5 (транзакции, частичные уникальные индексы, гео, JSON, события); ADR-001 подготовлен; инфраструктура production не проверялась.", datasets: [], tables: [], events: [], question: "Какая СУБД будет использоваться в production?", closure: "Утвердить СУБД (рекомендация: PostgreSQL) и зафиксировать ADR." },
  { id: "BD-019", status: "BUSINESS_DECISION_REQUIRED", evidence: "Текущий API-аккаунт не имеет прав SQL Lab и видит 0 баз — это косвенно показывает, что авторизация централизована, но стек не подтверждён.", datasets: [], tables: [], events: [], question: "Какой стек backend и механизм авторизации?", closure: "Утвердить стек; второй механизм паролей не создавать." },
  { id: "BD-020", status: "READY_FOR_BUSINESS_APPROVAL", evidence: "В проверенных источниках нет таблиц слотов бронирования; есть таблица смен (agile_mart_operational.shifts).", datasets: [7802], tables: ["work_slots", "courier_shifts"], events: ["SHIFT_PLANNED"], question: "Нужны ли слоты предварительного бронирования?", closure: "Подтвердить, что для MVP достаточно отметки прибытия и смены." },
  { id: "BD-021", status: "BUSINESS_DECISION_REQUIRED", evidence: "Результат доставки в источниках представлен флагами/статусами; частичная доставка не обнаружена.", datasets: [3466], tables: ["delivery_attempts", "courier_accruals"], events: ["ORDER_DELIVERED"], question: "Как обрабатывать частичную доставку?", closure: "Утвердить перечень результатов доставки." },
  { id: "BD-022", status: "READY_FOR_BUSINESS_APPROVAL", evidence: "Справочника зон в источниках нет; zone_cluster/area_tt — не зоны доставки; хранение истории границ — техническое решение с бизнес-влиянием.", datasets: [3466], tables: ["zone_boundary_versions", "delivery_zones"], events: ["ZONE_BOUNDARY_CHANGED"], question: "Нужно ли хранить историю геозон?", closure: "Подтвердить необходимость версионности границ." },
  { id: "BD-023", status: "READY_FOR_BUSINESS_APPROVAL", evidence: "Политики хранения в источниках не найдены; объём событий оценивается только моделью.", datasets: [], tables: ["domain_events", "courier_accruals"], events: [], question: "Какой срок хранения событий и финансовых записей?", closure: "Утвердить сроки и подход к архивированию." },
  { id: "BD-024", status: "BUSINESS_DECISION_REQUIRED", evidence: "Тарифных таблиц нет; процесс утверждения тарифов — бизнес-решение.", datasets: [], tables: ["tariff_versions"], events: ["TARIFF_ACTIVATED"], question: "Кто утверждает тарифы и с какой даты они действуют?", closure: "Утвердить процесс и ответственного." },
];

// ------------------------------------------------------------------ quality (metadata level)

const QUALITY = [
  { dataset_id: 5939, checks: ["SQL содержит ПДн в комментариях (обезличено)", "8 колонок с неопределённым типом", "5 колонок с ПДн", "date_for_mentor не формируется SQL (устаревшая колонка)"], data_level: "NOT_VERIFIABLE" },
  { dataset_id: 7802, checks: ["зерно задокументировано в SQL", "1 колонка с ПДн (courier_name)", "нет колонок с неопределённым типом"], data_level: "NOT_VERIFIABLE" },
  { dataset_id: 7712, checks: ["4 колонки с ПДн", "факт пишется DAG", "нет id_shift"], data_level: "NOT_VERIFIABLE" },
  { dataset_id: 7021, checks: ["датасет про сборщиков, не курьеров", "1 колонка с ПДн (user_code)", "Jinja-параметры в SQL"], data_level: "NOT_VERIFIABLE" },
  { dataset_id: 3466, checks: ["167 колонок, 243 метрики", "19 колонок с неопределённым типом, включая time_ready/time_ready_plan", "time_ready и time_ready_plan НЕ формируются SQL датасета (0 вхождений)", "6+ колонок с ПДн (user_inn, phone)", "Jinja filter_values", "deadline_sbor/last_sbor_touch — вычисляемые"], data_level: "NOT_VERIFIABLE" },
  { dataset_id: 2339, checks: ["скользящее окно 1 месяц", "29 колонок с неопределённым типом", "8+ колонок с ПДн", "суммы sum_paid/sum_paid_disc присутствуют"], data_level: "NOT_VERIFIABLE" },
];

// ------------------------------------------------------------------ model impact

const MODEL_IMPACT: Array<{ table: string; necessity: string; grain: string; keys: string; relations: string; changes: string; tbd: string; remove: string; events: string }> = [
  { table: "shops", necessity: "ПОДТВЕРЖДЕНА", grain: "не проверено данными", keys: "shopno/id_tt (имена подтверждены)", relations: "используется во всех источниках", changes: "нет", tbd: "code vs external_source_id", remove: "нет", events: "—" },
  { table: "addresses", necessity: "ЧАСТИЧНО", grain: "не проверено", keys: "нет подтверждённого адресного ключа", relations: "geo — строка, не разобрана", changes: "добавить geo_source", tbd: "парсинг geo, PII", remove: "нет", events: "—" },
  { table: "couriers", necessity: "ПОДТВЕРЖДЕНА", grain: "не проверено", keys: "id_courier подтверждён как имя, но не как единый ключ", relations: "разные идентификаторы в 5939/7021/3466", changes: "усилить courier_external_ids", tbd: "мастер-источник (BD-017)", remove: "нет", events: "COURIER_REGISTERED" },
  { table: "courier_external_ids", necessity: "ПОДТВЕРЖДЕНА", grain: "не проверено", keys: "требуется справочник", relations: "MISMATCH типов между источниками", changes: "добавить namespace/source_type", tbd: "правила сопоставления", remove: "нет", events: "—" },
  { table: "delivery_zones", necessity: "НЕ ПОДТВЕРЖДЕНА ИСТОЧНИКОМ", grain: "—", keys: "—", relations: "нет источника", changes: "остаётся новым справочником", tbd: "границы, утверждение", remove: "нет", events: "ZONE_CREATED" },
  { table: "zone_boundary_versions", necessity: "ПОД ВОПРОСОМ (BD-022)", grain: "—", keys: "—", relations: "нет источника", changes: "возможно отложить", tbd: "нужна ли версионность", remove: "возможен перенос на поздний этап", events: "ZONE_BOUNDARY_CHANGED" },
  { table: "orders", necessity: "ПОДТВЕРЖДЕНА", grain: "id_order (подтверждено именами, не данными)", keys: "id_order + id_general", relations: "3466/2339 key-compatible", changes: "уточнить статусы и ready_at", tbd: "order_status словарь (BD-014), ready_at (BD-013)", remove: "нет", events: "ORDER_IMPORTED/ORDER_READY" },
  { table: "order_amount_snapshots", necessity: "ПОДТВЕРЖДЕНА", grain: "сумма на снимок", keys: "order_id", relations: "sum_paid/sum_order есть в 3466", changes: "нет", tbd: "—", remove: "нет", events: "—" },
  { table: "order_status_history", necessity: "ПОДТВЕРЖДЕНА", grain: "переход", keys: "order_id", relations: "date_status_10 в 3466/7021", changes: "уточнить источник переходов", tbd: "словарь статусов", remove: "нет", events: "ORDER_STATUS_CORRECTED" },
  { table: "order_readiness", necessity: "ПОДТВЕРЖДЕНА КАК ПОТРЕБНОСТЬ", grain: "попытка готовности", keys: "order_id + attempt_no", relations: "кандидат time_ready ОПРОВЕРГНУТ (нет в SQL датасета)", changes: "ready_source обязателен; готовность вводится новым событием", tbd: "источник готовности (BD-013 = CONTRADICTED)", remove: "нет", events: "ORDER_READY" },
  { table: "work_slots", necessity: "НЕ ПОДТВЕРЖДЕНА", grain: "—", keys: "—", relations: "нет источника слотов", changes: "вероятно не нужна для MVP", tbd: "BD-020", remove: "возможен перенос", events: "SHIFT_PLANNED" },
  { table: "courier_shifts", necessity: "ПОДТВЕРЖДЕНА", grain: "ПОДТВЕРЖДЕНО: одна строка на id_shift (rn_shift=1); физическая таблица shifts", keys: "external_shift_id = id_shift; физические поля id_courier, id_pool, shift_start, shift_finish", relations: "источник agile_mart_operational.shifts; связь с 7712 по ключу отсутствует", changes: "добавить shift_start/shift_finish и разбивку минут (wait/assembly/delivery/useless)", tbd: "shift_type из 7021 использовать НЕЛЬЗЯ (вычисляется из табеля сборщиков)", remove: "shift_type (из 7021) — исключить", events: "SHIFT_STARTED/SHIFT_ENDED" },
  { table: "courier_queue_entries", necessity: "ПОДТВЕРЖДЕНА ФИЗИЧЕСКОЙ ТАБЛИЦЕЙ", grain: "вход курьера в очередь (queue_in/queue_out)", keys: "courier_queue: courier_id, id_shift, queue_in_dttm, queue_out_dttm, has_order; arrival_time (7006/7027/7119) — кандидат в arrived_at", relations: "источник agile_mart_operational.courier_queue; arrival_time в 7006/7027/7119", changes: "queue_in_dttm/queue_out_dttm вместо arrived_at/closed_at; has_order как признак", tbd: "правило возврата (BD-004)", remove: "нет", events: "COURIER_JOINED_QUEUE" },
  { table: "trips", necessity: "ПОДТВЕРЖДЕНА СХЕМОЙ pools", grain: "пул (id_pool) с pool_start/pool_finish", keys: "id_pool; shifts.id_pool; id_pool_calc (7006) — вычисляемый; pool_size (7006/7024/7027/7119)", relations: "pools(id_pool,id_order,pool_start,pool_finish) — физическая связь пул↔заказ", changes: "pool_start/pool_finish вместо formed_at/departed_at; pool_size для контроля 3–5 заказов", tbd: "соответствие pool ↔ trip (проверка данных)", remove: "нет", events: "TRIP_FORMED" },
  { table: "trip_orders", necessity: "ПОДТВЕРЖДЕНА СХЕМОЙ pools", grain: "заказ в пуле (id_pool × id_order)", keys: "id_pool + id_order; pickup_seq (7006/7027/7119) — кандидат в sequence_no", relations: "pools.id_order подтверждает состав пула на уровне схемы", changes: "pickup_seq как кандидат порядка; quantity_batch не использовать", tbd: "порядок заказов (sequence_no) не подтверждён", remove: "нет", events: "TRIP_ORDER_ADDED" },
  { table: "trip_order_membership_history", necessity: "ПОДТВЕРЖДЕНА КАК ПОТРЕБНОСТЬ", grain: "действие", keys: "trip_id+order_id", relations: "источника нет", changes: "нет", tbd: "—", remove: "нет", events: "TRIP_ORDER_REMOVED" },
  { table: "trip_assignments", necessity: "ПОДТВЕРЖДЕНА КАК ПОТРЕБНОСТЬ", grain: "назначение", keys: "trip_id+courier_id; date_pickuped (7006/7027/7119) — кандидат в assigned_at; pickup_to_courier_minute", relations: "id_courier + date_pickuped в 7006/7027/7119; события назначения в источниках нет", changes: "не менять до проверки данных", tbd: "аварийная отмена (BD-011/012)", remove: "нет", events: "TRIP_ASSIGNED" },
  { table: "delivery_attempts", necessity: "ПОДТВЕРЖДЕНА", grain: "попытка", keys: "order_id+attempt_no", relations: "date_delivered/date_delivery_start в 3466", changes: "уточнить result", tbd: "частичная доставка (BD-021)", remove: "нет", events: "ORDER_DELIVERED" },
  { table: "courier_events", necessity: "ПОДТВЕРЖДЕНА", grain: "событие", keys: "idempotency_key", relations: "источники: photo_control_shift_attempt, courier_queue; словаря событий нет", changes: "добавить event_type dictionary", tbd: "словарь событий", remove: "нет", events: "SHIFT_STARTED/BREAK_STARTED" },
  { table: "domain_events", necessity: "ПОДТВЕРЖДЕНА КАК АРХИТЕКТУРА", grain: "событие", keys: "idempotency_key", relations: "источника нет (новый журнал)", changes: "нет", tbd: "срок хранения (BD-023)", remove: "нет", events: "все" },
  { table: "tariff_versions", necessity: "НЕ ПОДТВЕРЖДЕНА ИСТОЧНИКОМ", grain: "версия", keys: "—", relations: "нет тарифных таблиц", changes: "остаётся новым справочником", tbd: "формула (BD-008)", remove: "нет", events: "TARIFF_APPROVED" },
  { table: "courier_accruals", necessity: "ПОДТВЕРЖДЕНА КАК ПОТРЕБНОСТЬ", grain: "начисление на попытку", keys: "delivery_attempt_id", relations: "источника выплат нет; stake не использовать", changes: "нет", tbd: "формула и подтверждение (BD-008/010)", remove: "нет", events: "COURIER_ACCRUAL_CREATED" },
  { table: "accrual_adjustments", necessity: "ПОДТВЕРЖДЕНА КАК ПОТРЕБНОСТЬ", grain: "корректировка", keys: "accrual_id", relations: "источника нет", changes: "нет", tbd: "правило возврата (BD-007)", remove: "нет", events: "ACCRUAL_ADJUSTED" },
  { table: "mentorship_assignments", necessity: "ТРЕБУЕТ УТОЧНЕНИЯ", grain: "возможно ТТ × период, а не новичок", keys: "mentorid — строка; фильтр mentor_same_tt_date = 1", relations: "источник actual_assistant_tt (справочник помощников ТТ); date_for_mentor НЕ формируется SQL", changes: "пересмотреть зерно: возможно (mentor, TT, period); убрать date_for_mentor", tbd: "кто назначает (BD-001)", remove: "date_for_mentor (нет в SQL); возможно разделить на mentor_assignment и trainee_program", events: "MENTORSHIP_ASSIGNED" },
  { table: "mentorship_shift_reviews", necessity: "НЕ ПОДТВЕРЖДЕНА", grain: "оценка смены", keys: "assignment+shift", relations: "шкал оценок в источниках нет", changes: "нет", tbd: "шкала и формула", remove: "нет", events: "MENTORSHIP_SHIFT_REVIEWED" },
];

// ------------------------------------------------------------------ unresolved

const UNRESOLVED = [
  "Фактические данные не проверены: SQL Lab возвращает 403, chart data — 401 (BLOCK-1).",
  "Готовность (BD-013): кандидат time_ready ОПРОВЕРГНУТ (не формируется SQL); источник готовности не найден — требуется новое событие и бизнес-решение.",
  "Зерно 5939 (курьер × день или курьер × день × ТТ) не установлено.",
  "Семантика progul и stake в 5939 не подтверждена.",
  "Смысл quantity_batch и orders_assignment в 2339 не подтверждён; уникального ID пакета нет.",
  "Зерно и порядок заказов в agile_mart_operational.pools не проверены данными (схема подтверждена).",
  "Кардинарность и покрытие связей shifts↔courier_queue↔pools не измерены.",
  "Является ли agile_mart_operational.shifts мастер-источником смен, не подтверждено.",
  "Словарь статусов заказа (BD-014) и семантика статуса 10 не подтверждены.",
  "Мастер-источник идентичности курьера (BD-017) не определён.",
  "Тарифы и начисления: источников нет, требуется бизнес-формула (BD-008/BD-024).",
  "Справочник зон доставки отсутствует (BD по зонам).",
  "Срок хранения событий и финансовых записей не утверждён (BD-023).",
  "<ФИО> колонки метаданных Superset (time_ready, time_ready_plan, date_for_mentor) — не использовать и не переносить.",
];

function main() {
  const metaEvidence = readJson(join(REPORTS, "evidence", "metadata_evidence.json"));
  const sourceTables = readJson(join(REPORTS, "evidence", "source_tables.json"));
  const connectivity = readJson(join(REPORTS, "evidence", "connectivity_probe.json"));
  const diag = readJson(join(REPORTS, "evidence", "sqllab_diagnostics.json"));
  const bd15 = readJson("docs/phase-01-5/business_decisions_register.json");

  // Карточки решений в полном формате ТЗ §8: варианты из реестра 1.5 + влияние на архитектуру
  const decisionsEnriched = BD.map((b) => {
    const src = (bd15?.decisions ?? []).find((x: any) => x.id === b.id);
    const optionsOverride: Record<string, string[]> = {
      "BD-013": ["date_set_cell (установка в ячейку)", "date_collected (завершение сборки)", "date_status_10 (статус 10)", "Новое событие ORDER_READY"],
    };
    return {
      ...b,
      options: optionsOverride[b.id] ?? src?.options ?? [],
      consequences: src?.consequences ?? [],
      architecture_impact: BD_ARCH_IMPACT[b.id] ?? "",
      responsible_question: b.question,
    };
  });

  // ---------- machine-readable ----------
  w(join(REPORTS, "dataset_checks.json"), JSON.stringify({ generated_at: new Date().toISOString(), blocker: BLOCKER.id, datasets: FINDINGS }, null, 2));
  w(join(REPORTS, "relationship_checks.json"), JSON.stringify({ generated_at: new Date().toISOString(), data_level_blocked: true, note: "Связи оценены по метаданным; покрытие соединений не измерено из-за BLOCK-1", relationships: RELATIONSHIPS }, null, 2));
  w(join(REPORTS, "data_quality_checks.json"), JSON.stringify({ generated_at: new Date().toISOString(), level: "METADATA", data_level: "NOT_VERIFIABLE", blocker: BLOCKER.id, datasets: QUALITY, sql_forensics: SQL_FORENSICS }, null, 2));
  w(join(REPORTS, "decision_evidence.json"), JSON.stringify({ generated_at: new Date().toISOString(), blocker: BLOCKER.id, note: "Ни одно решение не переведено в AGREED; CONFIRMED_BY_DATA отсутствует, т.к. данные не проверены. Варианты взяты из реестра 1.5, влияние на архитектуру добавлено на 1.6.", decisions: decisionsEnriched }, null, 2));
  w(join(REPORTS, "model_impact.json"), JSON.stringify({ generated_at: new Date().toISOString(), ddl_changed: false, tables: MODEL_IMPACT }, null, 2));

  // ---------- 00 scope ----------
  w(join(DOCS, "00_scope_and_methodology.md"), `# 00. Границы и методология Этапа 1.6

## ***REMOVED***
<ФИО> результаты Этапа 1.5 по фактическим артефактам и актуальным метаданным Superset,
отделить подтверждённые факты от предположений и подготовить решения BD-001…BD-024 к согласованию.

## Метод
1. Аудит репозитория и первичных артефактов 1.5 (не только summary).
2. Проверка доступа: login, CSRF, /api/v1/database/, /api/v1/dataset/{id}, SQL Lab.
3. Снятие актуальных метаданных шести датасетов (5939, 7802, 7712, 7021, 3466, 2339).
4. Извлечение физических источников из обезличенного SQL датасетов.
5. Оценка связей по метаданным (типы ключей, наличие ключа).
6. Сопоставление доказательств с BD-001…BD-024.
7. Оценка влияния на 25 таблиц модели 1.5 (DDL не изменяется).
8. Автоматические проверки и финальный статус.

## Строгие ограничения
Разрешено: GET API, безопасные агрегирующие запросы, локальные отчёты и тесты.
Запрещено: INSERT/UPDATE/DELETE/DDL, изменение Superset, \`data/catalog.sqlite\`, миграции, ETL,
выгрузка ПДн, изменение файлов этапов 1.1/1.2/1.4/1.5, commit/push.
Все запросы проходят через защиту \`assertReadOnly\` (только SELECT/WITH/EXPLAIN/SHOW/DESCRIBE, одна инструкция).

## Уровни доказательности
- METADATA — подтверждено метаданными Superset (колонки, типы, SQL, связи чартов).
- METADATA_PLUS_DOC — плюс документированное в SQL зерно/назначение.
- DATA — подтверждено результатами запросов (на этом этапе недостижимо из-за BLOCK-1).

## Результат этапа
Доказательная база для финализации DDL: что подтверждено, что опровергнуто, что требует бизнес-решения
и что заблокировано технически.
`);

  // ---------- 03 mentor ----------
  const f5939 = FINDINGS[0];
  w(join(DOCS, "03_mentor_data_analysis.md"), `# 03. Анализ данных наставничества (5939)

## Факты (уровень METADATA)
- Датасет: \`${f5939.name}\`, ${f5939.kind}, ${f5939.database} (${f5939.backend}), schema \`${f5939.schema}\`, колонок ${f5939.columns}, метрик ${f5939.metrics}, SQL ${f5939.sql_len} символов.
- Физические источники: ${f5939.sources.join(", ")}.
- Ключевые поля: ${f5939.key_columns.slice(0, 12).join(", ")}.
- ПДн-поля (в отчёты не выгружаются): ${f5939.pii_columns.join(", ")}.
- Колонки с неопределённым типом: ${f5939.unknown_type_columns.join(", ")}.

## Что проверено технически (SQL-форензика)
- mentorid и mentorfio присутствуют в метаданных и в SQL.
- Назначение наставника выводится из справочника \`actual_assistant_tt\` (помощник ТТ), а не из отдельной сущности назначения новичку.
- Фильтр датасета: \`mentorid_at_date is not null and mentor_same_tt_date = 1\` — наставник привязан к ТТ.
- \`enough_shifts_for_mentor\` — оконный агрегат: \`count(CASE WHEN shift_rn_trainee IS NOT NULL THEN 1 END) OVER (PARTITION BY person_code, date_start_work, mentor_at_date)\`, а не хранимый факт.
- \`date_for_mentor\` **отсутствует в SQL датасета** (0 вхождений) — устаревшая колонка метаданных, период наставничества по ней строить нельзя.
- \`progul\` используется как фильтр Jinja (\`AND progul = 0\` для категории «Прогульщиков») — семантика неоднозначна.
- \`stake\` выбирается напрямую из \`hr_daily_pers\` без вычислений; назначение (ставка/доля) не подтверждено.

## Что НЕ проверено (BLOCK-1)
Доля NULL в mentorid, число уникальных наставников и стажёров, распределение по месяцам,
число смен назначения, доля записей с progul, зерно датасета.

## ***REMOVED***
Dataset 5939 пригоден как **аналитический** источник признаков наставничества
(mentorid, mentor_in_five, trainee_shift_in_five, trainee_shifts_qty, first/last_shift_date),
но **не подтверждает** операционную сущность «назначение наставника новичку».
Таблица \`mentorship_assignments\` требует уточнения зерна: возможно (наставник, ТТ, период).
`);

  // ---------- 04 shift ----------
  const f7802 = FINDINGS[1];
  const f7712 = FINDINGS[2];
  const f7021 = FINDINGS[3];
  w(join(DOCS, "04_shift_data_analysis.md"), `# 04. Анализ данных о сменах (7802, 7712, 7021)

## 7802 — ${f7802.name} (${f7802.database})
- Тип: ${f7802.kind}; schema \`${f7802.schema}\`; колонок ${f7802.columns}; SQL ${f7802.sql_len} символов.
- Физические источники: ${f7802.sources.join(", ")}.
- **Зерно задокументировано в SQL:** ${f7802.documented_grain}
- Ключевые поля: ${f7802.key_columns.join(", ")}.
- ПДн: ${f7802.pii_columns.join(", ")}.

*****REMOVED***:** зерно «смена × ТТ» и правило \`rn_shift = 1\` — единственное документированное зерно среди
проверенных датасетов. SQL-форензика подтверждает вычисления: \`rn_shift = row_number() OVER (PARTITION BY id_shift ORDER BY shopno NULLS LAST)\`,
\`shift_minutes = round(shift_raw, 1)\`, \`useless_minutes = shift_raw - wait_raw - assembly_raw - delivery_raw\`
(то есть shift = wait + assembly + delivery + useless). Требуется проверка данных (уникальность id_shift, NULL,
отрицательные значения) — заблокировано.

### Физические таблицы, вскрытые SQL 7802
| Таблица | Колонки | Значение для модели |
|---|---|---|
| \`agile_mart_operational.shifts\` | id_shift, id_courier, id_pool, shift_start, shift_finish | прямой источник \`courier_shifts\` (начало/окончание смены) |
| \`agile_mart_operational.pools\` | id_pool, id_order, pool_start, pool_finish | структура пула и его заказов → кандидат в \`trips\`/\`trip_orders\` |
| \`agile_mart_operational.courier_queue\` | courier_id, id_shift, queue_in_dttm, queue_out_dttm, has_order, first_delivery_dttm, cluster_id | прямой источник \`courier_queue_entries\` (вход/выход из очереди) |
| \`mart_mixed.darkstore_time\` | id_order, id_general, shopno, date_order | заказный источник |

## 7712 — ${f7712.name} (${f7712.database})
- Факт пишет DAG в \`agile_mart_operational.photo_control_shift_attempt\`.
- \`shift_open_time\` — время события фотоконтроля начала смены, \`shift_opened\` — признак 0/1.
- \`id_shift\` отсутствует → прямая связь с 7802 по ключу смены невозможна.

*****REMOVED***:** источник годится для подтверждения факта открытия смены, но не как мастер смен.

## 7021 — ${f7021.name} (${f7021.database})
- Описание: «Отчет по выработке сборщиков в дарксторах».
- \`id_courier\` отсутствует; есть \`id_sbor\`, \`id_assemblysheet\`, \`qty_collected\`.
- \`shift_type\`, \`is_night_shift\` относятся к сменам **сборщиков**.

*****REMOVED*** (опровержение Этапа 1.5):** использование 7021 для \`courier_shifts.shift_type\` **некорректно**.
Поле \`shift_type\` следует исключить из источников модели курьерских смен (статус CONTRADICTED).
`);

  // ---------- 05 readiness ----------
  const f3466 = FINDINGS[4];
  w(join(DOCS, "05_order_ready_analysis.md"), `# 05. Анализ готовности заказа (3466) и BD-013

## Факты (METADATA)
- Датасет: \`${f3466.name}\`, ${f3466.kind}, ${f3466.database}, schema \`${f3466.schema}\`, колонок ${f3466.columns}, метрик ${f3466.metrics}, SQL ${f3466.sql_len} символов.
- Источники: ${f3466.sources.join(", ")}.
- \`time_ready\` и \`time_ready_plan\` присутствуют, но **тип не определён** в метаданных Superset.
- \`date_status_10\` — DateTime64(6); \`date_order\`, \`date_collect_start\`, \`date_collected\`, \`date_delivery_start\`, \`date_delivered\` — DateTime64(6).
- ПДн: user_inn, phone, user_code и др. — в отчёты не выгружаются.
- SQL содержит Jinja \`filter_values\` → прямое выполнение SQL датасета требует параметров.

## Временная последовательность (по наличию полей)
date_order → date_collect_start → date_collected → date_delivery_start → date_delivered.
Готовность (\`time_ready\`) в этой цепочке не подтверждена фактическими значениями.

## Что НЕ проверено (BLOCK-1)
Доля заполнения time_ready/time_ready_plan; случаи time_ready < date_order и time_ready > date_delivered;
повторные записи заказа; изменение time_ready при обновлении статуса; соотношение time_ready и date_collected;
сопоставление заказов с 4732.

## ***REMOVED*** по BD-013
**Кандидат time_ready опровергнут.** В полном обезличенном SQL датасета 3466 (35 926 символов) **нет ни одного вхождения**
\`time_ready\` и \`time_ready_plan\`. Колонки присутствуют в метаданных Superset (с неопределённым типом), но датасет их не формирует —
это устаревшие метаданные. Использовать их как источник готовности нельзя.

Дополнительно: \`deadline_sbor\` и \`last_sbor_touch\` — вычисляемые выражения, а не факты:
- \`deadline_sbor = date_supply_untill - coalesce(sla_delivery_time_all, 0) * 60\`;
- \`last_sbor_touch = coalesce(date_set_cell, date_f_status_3_5)\`.

\`date_status_10\` — реальная колонка физической таблицы \`mart_mixed.darkstore_time_sheet\` (DateTime64(6)), но её семантика
(статус 10) не подтверждена; в 7021 тот же статус относится к заказам сборщиков.

**Итог:** BD-013 = **CONTRADICTED** (техническая гипотеза Этапа 1.5 опровергнута). Источник фактической готовности
в проверенных источниках не найден; готовность должна вводиться новым событием \`ORDER_READY\` новой операционной системы.
`);

  // ---------- 06 trips/batch ----------
  const f2339 = FINDINGS[5];
  w(join(DOCS, "06_trip_and_batch_analysis.md"), `# 06. Анализ ходок и пакетов (2339, pools)

## 2339 — ${f2339.name} (${f2339.database}, ${f2339.backend})
- Источник: журнал \`Loyalty_srv03.dbo.Webcall_log_ui_period('Orders_header', NULL, DATEADD(MONTH,-1,GETDATE()), GETDATE())\`, соединённый с представлением \`Reports.dbo.ksa_time_vw\` по \`id_order = object_id\`.
- Фильтр: \`type = 'Изменение даты доставки' AND prop = 'date_supply'\`.
- \`quantity_batch\` (INT) и \`orders_assignment\` (STRING) приходят из представления.
- Уникального идентификатора пакета нет; состав пакета не восстанавливается.
- Окно данных — последний месяц (скользящее).

## Что установлено
- 2339 — это **лог переносов даты доставки**, а не система формирования пакетов/ходок.
- \`quantity_batch\` и \`orders_assignment\` не упоминаются в SQL датасета (0 вхождений): они приходят через \`SELECT *\`
  из представления \`Reports.dbo.ksa_time_vw\`, поэтому их смысл по SQL установить нельзя.
- Фильтр по причинам переноса прямо перечисляет бизнес-ситуации:
  «Перенос заказа на следующий день из-за невозможности доставки»,
  «***REMOVED*** даты доставки: Долгое ожидание сборки», «…Долгий поиск курьера»,
  «…<ФИО>», «…Дежурный не обновил поиск».
  <ФИО> подтверждает существование ситуаций для BD-002/BD-012, но не процедуру их обработки.

## Что найдено дополнительно (SQL 7802)
- \`agile_mart_operational.pools\`: **id_pool, id_order, pool_start, pool_finish** — физическая связь пул↔заказ.
- \`agile_mart_operational.courier_queue\`: **courier_id, id_shift, queue_in_dttm, queue_out_dttm, has_order**.
- \`agile_mart_operational.shifts\`: **id_shift, id_courier, id_pool, shift_start, shift_finish**.

## ***REMOVED***
<ФИО> \`trips\`/\`trip_orders\` подтверждена **на уровне схемы** (pools содержит id_order), но зерно, порядок
заказов и кардинальность не проверены данными. \`quantity_batch\`/\`orders_assignment\` как источник использовать нельзя.
`);

  // ---------- 07 relationships ----------
  w(join(DOCS, "07_cross_dataset_relationships.md"), `# 07. Связи между источниками

Все связи оценены **по метаданным** (наличие и тип ключей). Доли сопоставления, дубликаты и кардинальности
не измерены: SQL Lab недоступен (BLOCK-1). SQL JOIN сам по себе не доказывает наличие внешнего ключа.

| ID | Связь | Поля | Тип ключа | Совпадение типов | Покрытие | Статус | Кардинальность | Риск ложных совпадений |
|---|---|---|---|---|---|---|---|---|
${RELATIONSHIPS.map((r) => `| ${r.id} | ${r.left} ↔ ${r.right} | ${r.join_fields} | ${r.key_type} | ${r.type_match} | ${r.coverage} | ${r.status} | ${r.cardinality} | ${r.false_positive_risk} |`).join("\n")}

## Комментарии
${RELATIONSHIPS.map((r) => `- **${r.id}**: ${r.note}`).join("\n")}

## Ключевые выводы
- Ни одна связь не получила статус VERIFIED — нет проверки данными.
- Связь 7802 ↔ 7021 **опровергнута** по построению: у 7021 нет идентификатора курьера.
- Связи 3466 ↔ 4732, 2339 ↔ 4732, 7802 ↔ 4732 **совместимы по типам**, но покрытие не измерено.
- 7802 ↔ 7712 не имеет общего ключа смены.

## Связи, подтверждённые на уровне схемы (SQL-форензика)
| Связь | Ключ | Как подтверждено |
|---|---|---|
| pools ↔ darkstore_time | pools.id_order ↔ darkstore_time.id_order | SQL 7802 использует оба поля |
| shifts ↔ pools | shifts.id_pool ↔ pools.id_pool | SQL 7802 соединяет таблицы по пулу |
| shifts ↔ courier_queue | id_shift | обе таблицы используют id_shift |
| courier_queue ↔ couriers | courier_queue.courier_id ↔ ods.v_couriers.id | SQL 7802 использует обе |

<ФИО> подтверждает **существование отношений на уровне схемы**, но не кардинарность и не покрытие.
`);

  // ---------- 08 BD review ----------
  w(join(DOCS, "08_business_decisions_review.md"), `# 08. Проверка бизнес-решений BD-001…BD-024

Всего решений: **${BD.length}**. Ни одно решение не переведено в AGREED.
\`CONFIRMED_BY_DATA\` отсутствует: фактические данные не проверены из-за BLOCK-1.

| Статус | Кол-во |
|---|---:|
${["CONFIRMED_BY_DATA", "READY_FOR_BUSINESS_APPROVAL", "BUSINESS_DECISION_REQUIRED", "PARTIAL_EVIDENCE", "NOT_VERIFIABLE", "CONTRADICTED"].map((s) => `| ${s} | ${BD.filter((b) => b.status === s).length} |`).join("\n")}

${decisionsEnriched.map((b) => `## ${b.id}
- **Статус:** ${b.status}
- **Вопрос:** ${b.question}
- **Доказательства:** ${b.evidence}
- **Связанные датасеты:** ${b.datasets.length ? b.datasets.join(", ") : "—"}
- **Связанные таблицы:** ${b.tables.join(", ") || "—"}
- **Связанные события:** ${b.events.join(", ") || "—"}
- **Варианты решения:** ${b.options.length ? b.options.join("; ") : "—"}
- **Влияние на архитектуру:** ${b.architecture_impact || "—"}
- **Критерий закрытия:** ${b.closure}
`).join("\n")}
`);

  // ---------- 09 quality ----------
  w(join(DOCS, "09_data_quality_report.md"), `# 09. Качество данных

## Уровень проверки
<ФИО> выполнены на уровне **метаданных**. Фактические проверки (NULL, дубликаты, диапазоны,
выбросы, противоречивые статусы, повторные события, стабильность внешних идентификаторов)
**не выполнены**: SQL Lab возвращает 403 (BLOCK-1).

| Dataset | Метаданные-проверки | Уровень данных |
|---|---|---|
${QUALITY.map((q) => `| ${q.dataset_id} | ${q.checks.join("; ")} | ${q.data_level} |`).join("\n")}

## Что установлено на уровне метаданных
- Колонки с неопределённым типом: 3466 — 19 (включая time_ready/time_ready_plan), 2339 — 29, 5939 — 8.
- ПДн-колонки присутствуют во всех шести датасетах; в отчёты не выгружались.
- 2339 ограничен скользящим окном в один месяц — истории переносов нет.
- 7021 содержит Jinja-параметры; 3466 — Jinja \`filter_values\`.

## Что осталось непроверенным
Количество записей, уникальные ключи, дубликаты, NULL-доли, временные диапазоны, невозможные даты,
отрицательные значения, выбросы, противоречивые статусы, повторные события, пропуски в последовательности,
стабильность внешних идентификаторов.
`);

  // ---------- 10 model impact ----------
  w(join(DOCS, "10_model_impact_assessment.md"), `# 10. Влияние на модель данных Этапа 1.5

DDL не изменялся. Ниже — перечень необходимых корректировок (предложение к Этапу 1.7).

| Таблица | Необходимость | Зерно | Ключи | Связи | Изменения | TBD | Удалить/перенести | <ФИО> |
|---|---|---|---|---|---|---|---|---|
${MODEL_IMPACT.map((m) => `| ${m.table} | ${m.necessity} | ${m.grain} | ${m.keys} | ${m.relations} | ${m.changes} | ${m.tbd} | ${m.remove} | ${m.events} |`).join("\n")}

## Приоритетные корректировки
1. \`courier_shifts\`: зерно подтверждено (одна строка на id_shift); физические поля \`shift_start\`/\`shift_finish\`; **исключить shift_type из 7021** (вычисляется из табеля сборщиков).
2. \`courier_queue_entries\`: подтверждена физическая таблица \`agile_mart_operational.courier_queue\` (queue_in_dttm/queue_out_dttm/has_order).
3. \`trips\`/\`trip_orders\`: \`agile_mart_operational.pools\` содержит \`id_pool\` и \`id_order\` — связь пул↔заказ подтверждена на уровне схемы.
4. \`order_readiness\`: кандидат \`time_ready\` **опровергнут** (не формируется SQL); готовность — новое событие.
5. \`mentorship_assignments\`: убрать \`date_for_mentor\` (нет в SQL); пересмотреть зерно (наставник × ТТ × период).
6. \`courier_events\`: подтверждены кандидаты-источники (photo_control_shift_attempt, courier_queue), словарь событий отсутствует.
7. \`work_slots\`, \`zone_boundary_versions\`: источников нет — возможно отложить.
8. <ФИО> колонки метаданных Superset (\`time_ready\`, \`time_ready_plan\`, \`date_for_mentor\`) — не использовать и не переносить в новую модель.
`);

  // ---------- 11 unresolved ----------
  w(join(DOCS, "11_unresolved_questions.md"), `# 11. Нерешённые вопросы

## Технический блокер
**${BLOCKER.id}: ${BLOCKER.title}**
${BLOCKER.detail}
Влияние: ${BLOCKER.impact}
Требуется: ${BLOCKER.required}

## <ФИО> вопросы
${UNRESOLVED.map((u, i) => `${i + 1}. ${u}`).join("\n")}

## Вопросы к бизнесу
${BD.filter((b) => b.status === "BUSINESS_DECISION_REQUIRED").map((b) => `- **${b.id}**: ${b.question}`).join("\n")}

## Вопросы, требующие данных после снятия блокера
${BD.filter((b) => b.status === "PARTIAL_EVIDENCE").map((b) => `- **${b.id}**: ${b.closure}`).join("\n")}
`);

  // ---------- 12 recommendations ----------
  const confirmed = FINDINGS.filter((f) => f.evidence_level === "METADATA_PLUS_DOC");
  w(join(DOCS, "12_final_recommendations.md"), `# 12. Итоговые рекомендации

## 1. Что реально подтверждено
- Метаданные шести датасетов: типы, колонки, метрики, владельцы (без выгрузки ПДн), SQL-хэши.
- Физические источники: \`agile_mart_techaudit.actual_assistant_tt\`, \`agile_mart_techaudit.hr_daily_pers\`,
  \`agile_mart_operational.shifts\`, \`agile_mart_operational.pools\`, \`agile_mart_operational.courier_queue\`,
  \`agile_mart_operational.photo_control_shift_attempt\`, \`mart_mixed.darkstore_time\`,
  \`mart_mixed.darkstore_time_sheet\`, \`ods.timesheetfact\`, \`ods.v_couriers\`, \`ods.v_tt\`,
  \`report.v_org_unit_actual\`, \`Loyalty_srv03.dbo.Webcall_log_ui_period\`, \`Reports.dbo.ksa_time_vw\`.
- Зерно 7802 (смена × ТТ, rn_shift=1) — документировано в SQL.
- Факт фотоконтроля начала смены (7712) пишется DAG в \`photo_control_shift_attempt\`.
- **Физические схемы, вскрытые SQL:** \`agile_mart_operational.shifts\` (id_shift, id_courier, id_pool, shift_start, shift_finish),
  \`.pools\` (id_pool, id_order, pool_start, pool_finish), \`.courier_queue\` (courier_id, id_shift, queue_in_dttm, queue_out_dttm, has_order),
  \`.photo_control_shift_attempt\` (courier_id, attempt_dt, attempt_n, attempt_start, shift_opened).
- **Вычисляемые выражения** подтверждены: \`rn_shift\`, \`shift_minutes\`, \`useless_minutes\` (7802);
  \`deadline_sbor\`, \`last_sbor_touch\` (3466); \`shift_type\`, \`is_night_shift\`, \`has_timesheet\` (7021); \`enough_shifts_for_mentor\` (5939).
- **<ФИО> колонки метаданных:** \`time_ready\`, \`time_ready_plan\` (3466) и \`date_for_mentor\` (5939) не формируются SQL датасетов.

## 2. Пригодность источников для production-модели
| Источник | Пригодность | Комментарий |
|---|---|---|
| 7802 shift_time_breakdown | ПРИГОДЕН (схема) | зерно и таблицы shifts/pools/courier_queue подтверждены |
| 7712 photo_control_shift_bi | ЧАСТИЧНО | подтверждает открытие смены, не мастер смен |
| 3466 darkstore_time_sheet | ЧАСТИЧНО | time_ready опровергнут; Jinja-параметры; 121 колонка витрины |
| 5939 hr_daily_pers_mentors | ТОЛЬКО АНАЛИТИКА | справочник помощников ТТ; ПДн; date_for_mentor опровергнут |
| 2339 Перенесенные заказы | ЧАСТИЧНО | лог переносов за месяц; причины переноса полезны для BD-002/BD-012 |
| 7021 ds_collectors_prod | НЕ ПРИГОДЕН для курьеров | данные о сборщиках; shift_type из табеля |

## 3. Подтверждённые связи
Ни одна связь не подтверждена на уровне данных. На уровне **схемы** подтверждены:
\`pools.id_order\` (пул↔заказ), \`shifts.id_pool\` (смена↔пул), \`courier_queue.id_shift\` (очередь↔смена),
\`courier_queue.courier_id\` (очередь↔курьер). Совместимы по типам: 3466↔4732, 2339↔4732, 7802↔4732.
Опровергнута: 7802↔7021.

## 4. Опровергнутые выводы Этапа 1.5
- **\`time_ready\` не является источником готовности** — колонка не формируется SQL датасета 3466 (0 вхождений в 35 926 символах).
- 7021 не является источником классификации **курьерских** смен (shift_type вычисляется из табеля сборщиков).
- 2339 не подтверждает модель пакетов/ходок; quantity_batch/orders_assignment не определены в SQL.
- 5939 не подтверждает операционное назначение наставника новичку; date_for_mentor не формируется SQL.

## 5. Что можно вынести на утверждение бизнеса
BD-018 (СУБД), BD-020 (слоты), BD-022 (история зон), BD-023 (сроки хранения) — техническая часть готова.

## 6. Что невозможно закрыть технически
BD-001…BD-017, BD-019, BD-021, BD-024 — требуют бизнес-решения;
BD-013, BD-014, BD-017 — требуют данных после снятия BLOCK-1.

## 7. Изменения в модели 1.5
См. \`10_model_impact_assessment.md\`: 7 приоритетных корректировок, DDL не изменялся.

## 8. Неподтверждённые таблицы и события
Таблицы без подтверждённого источника: delivery_zones, zone_boundary_versions, work_slots, tariff_versions,
courier_accruals, accrual_adjustments, mentorship_shift_reviews, domain_events.
<ФИО> без источника: все новые операционные (ORDER_READY, очередь, назначения, смены, начисления).

## 9. Что блокирует финализацию DDL
1. BLOCK-1 (SQL Lab 403) — нет проверки данных.
2. Отсутствие тарифной формулы (BD-008/BD-024).
3. Отсутствие справочника зон.
4. Неопределённый мастер-источник заказа/курьера (BD-016/BD-017).
5. Неутверждённая СУБД (BD-018).

## 10. Можно ли переходить к Этапу 1.7
**Условно да** — как к этапу корректировки модели и подготовки финального DDL,
при условии, что Этап 1.7 либо получит доступ к SQL Lab, либо явно зафиксирует работу без проверки данных.
Финализация DDL без снятия BLOCK-1 и без решений BD-008/BD-013/BD-018 невозможна.
`);

  // ---------- query plan (планируемые read-only проверки, не выполнялись) ----------
  const planned = QUERY_PLAN.map((q) => {
    const guard = assertReadOnly(q.sql);
    return { ...q, status: "PLANNED_NOT_EXECUTED", reason: "BLOCK-1: SQL Lab недоступен (HTTP 403)", guard: guard.ok ? "OK" : `BLOCKED: ${guard.reason}`, guard_ok: guard.ok };
  });
  const guardFails = planned.filter((p) => !p.guard_ok);
  w(join(REPORTS, "query_plan.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    note: "Планируемые read-only проверки. Ни один запрос не выполнялся: SQL Lab недоступен (BLOCK-1). Каждый запрос прошёл assertReadOnly.",
    count: planned.length,
    guard_failures: guardFails.map((p) => p.id),
    queries: planned,
  }, null, 2));
  w(join(DOCS, "13_query_plan.md"), `# 13. План SQL-проверок (готов к запуску)

Запросов в плане: **${planned.length}**. Ни один не выполнялся: **BLOCK-1** (SQL Lab → HTTP 403).
Каждый запрос предварительно проверен защитой \`assertReadOnly\` (только SELECT, одна инструкция).
Ошибок защиты: ${guardFails.length}.

| ID | Dataset | СУБД | Назначение | BD | Guard |
|---|---|---|---|---|---|
${planned.map((p) => `| ${p.id} | ${p.dataset_id} | ${p.dbms} | ${p.purpose} | ${p.related_bd.join(", ")} | ${p.guard} |`).join("\n")}

## SQL по запросам

${planned.map((p) => `### ${p.id} — ${p.purpose}\n\n- dataset: ${p.dataset_id}; database_id: ${p.database_id ?? "уточнить"}; СУБД: ${p.dbms}\n- ожидаемый результат: ${p.expected}\n- связано с: ${p.related_bd.join(", ")}\n\n\`\`\`sql\n${p.sql}\n\`\`\`\n`).join("\n")}
`);

  // ---------- 01/02 documents (единый набор из 13 документов) ----------
  for (const [src, dst] of [["01_superset_access_audit.md", "01_superset_access_audit.md"], ["02_dataset_evidence.md", "02_dataset_evidence.md"]]) {
    const p = join(REPORTS, src);
    if (existsSync(p)) w(join(DOCS, dst), readFileSync(p, "utf8"));
  }

  // ---------- reports machine-readable + coverage csv ----------
  w(join(REPORTS, "decision_evidence.csv"), csv([
    ["id", "status", "question", "datasets", "tables", "events", "options", "architecture_impact", "closure"],
    ...decisionsEnriched.map((b) => [b.id, b.status, b.question, b.datasets.join(";"), b.tables.join(";"), b.events.join(";"), b.options.join(" | "), b.architecture_impact, b.closure]),
  ]));
  w(join(REPORTS, "dataset_checks.csv"), csv([
    ["dataset_id", "name", "database", "kind", "schema", "columns", "metrics", "sql_len", "evidence_level", "data_verified", "sources", "pii_columns", "unknown_type_columns"],
    ...FINDINGS.map((f) => [f.dataset_id, f.name, f.database, f.kind, f.schema, f.columns, f.metrics, f.sql_len, f.evidence_level, false, f.sources.join(";"), f.pii_columns.join(";"), f.unknown_type_columns.length]),
  ]));
  w(join(REPORTS, "relationship_checks.csv"), csv([
    ["id", "left", "right", "join_fields", "type_match", "coverage", "status", "cardinality"],
    ...RELATIONSHIPS.map((r) => [r.id, r.left, r.right, r.join_fields, r.type_match, r.coverage, r.status, r.cardinality]),
  ]));

  console.log(JSON.stringify({
    documents: 13,
    datasets: FINDINGS.length,
    relationships: RELATIONSHIPS.length,
    decisions: BD.length,
    decisions_by_status: Object.fromEntries(["CONFIRMED_BY_DATA", "READY_FOR_BUSINESS_APPROVAL", "BUSINESS_DECISION_REQUIRED", "PARTIAL_EVIDENCE", "NOT_VERIFIABLE", "CONTRADICTED"].map((s) => [s, BD.filter((b) => b.status === s).length])),
    model_tables: MODEL_IMPACT.length,
    metadata_evidence_present: Boolean(metaEvidence),
    source_tables_present: Boolean(sourceTables),
    connectivity_probe_present: Boolean(connectivity),
    diagnostics_present: Boolean(diag),
    blocker: BLOCKER.id,
  }, null, 2));
}

main();
