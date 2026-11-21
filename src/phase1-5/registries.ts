/**
 * Этап 1.5 — реестры: события, бизнес-решения, mapping Superset→домен, миграции.
 * Только данные; генерация артефактов — в generate.ts.
 */

export type EventSpec = {
  type: string;
  group: "orders" | "zones" | "couriers_shifts" | "trips_assignments" | "finance" | "mentorship";
  aggregate: string;
  payload: string[];
  note?: string;
  idempotency_scope: string;
  source_candidate?: string;
};

const ORDER_EVENTS: EventSpec[] = [
  { type: "ORDER_IMPORTED", group: "orders", aggregate: "order", payload: ["order_id", "external_order_id", "source_system", "shop_id", "order_created_at"], idempotency_scope: "source_system+external_order_id+ORDER_IMPORTED" },
  { type: "ORDER_ACCEPTED", group: "orders", aggregate: "order", payload: ["order_id", "accepted_at", "actor_id"], idempotency_scope: "order_id+ORDER_ACCEPTED" },
  { type: "COLLECTION_STARTED", group: "orders", aggregate: "order", payload: ["order_id", "collection_started_at"], idempotency_scope: "order_id+COLLECTION_STARTED" },
  { type: "COLLECTION_COMPLETED", group: "orders", aggregate: "order", payload: ["order_id", "collected_at"], idempotency_scope: "order_id+COLLECTION_COMPLETED" },
  { type: "ORDER_READY", group: "orders", aggregate: "order", payload: ["order_id", "ready_at", "ready_source", "ready_actor_type", "ready_actor_id"], note: "Критическое событие; в Superset не подтверждено. Кандидат — 3466.time_ready (BD-013).", idempotency_scope: "order_id+ORDER_READY+ready_at", source_candidate: "3466.time_ready" },
  { type: "ORDER_ASSIGNED_TO_TRIP", group: "orders", aggregate: "order", payload: ["order_id", "trip_id", "assigned_at", "actor_id"], idempotency_scope: "order_id+trip_id+ORDER_ASSIGNED_TO_TRIP" },
  { type: "ORDER_REMOVED_FROM_TRIP", group: "orders", aggregate: "order", payload: ["order_id", "trip_id", "removed_at", "reason", "actor_id"], note: "Разрешено только до TRIP_DEPARTED в обычном процессе", idempotency_scope: "order_id+trip_id+removed_at" },
  { type: "ORDER_DELIVERY_STARTED", group: "orders", aggregate: "order", payload: ["order_id", "delivery_started_at", "courier_id", "trip_id"], idempotency_scope: "order_id+ORDER_DELIVERY_STARTED" },
  { type: "ORDER_DELIVERED", group: "orders", aggregate: "order", payload: ["order_id", "delivered_at", "courier_id", "delivery_attempt_id"], note: "Основание начисления", idempotency_scope: "delivery_attempt_id+ORDER_DELIVERED" },
  { type: "ORDER_CANCELLED", group: "orders", aggregate: "order", payload: ["order_id", "cancelled_at", "reason_code"], idempotency_scope: "order_id+ORDER_CANCELLED" },
  { type: "ORDER_RETURNED", group: "orders", aggregate: "order", payload: ["order_id", "returned_at", "reason_code"], idempotency_scope: "order_id+ORDER_RETURNED" },
  { type: "ORDER_STATUS_CORRECTED", group: "orders", aggregate: "order", payload: ["order_id", "from_status", "to_status", "reason", "actor_id"], idempotency_scope: "order_id+ORDER_STATUS_CORRECTED+occurred_at" },
];

const ZONE_EVENTS: EventSpec[] = [
  { type: "ZONE_CREATED", group: "zones", aggregate: "delivery_zone", payload: ["zone_id", "shop_id", "code", "name"], idempotency_scope: "zone_id+ZONE_CREATED" },
  { type: "ZONE_BOUNDARY_PROPOSED", group: "zones", aggregate: "delivery_zone", payload: ["zone_id", "version", "geometry_ref", "author_id"], idempotency_scope: "zone_id+version+PROPOSED" },
  { type: "ZONE_BOUNDARY_APPROVED", group: "zones", aggregate: "delivery_zone", payload: ["zone_id", "version", "approved_by", "approved_at"], idempotency_scope: "zone_id+version+APPROVED" },
  { type: "ZONE_ACTIVATED", group: "zones", aggregate: "delivery_zone", payload: ["zone_id", "valid_from"], idempotency_scope: "zone_id+ACTIVATED+valid_from" },
  { type: "ZONE_DEACTIVATED", group: "zones", aggregate: "delivery_zone", payload: ["zone_id", "valid_to", "reason"], idempotency_scope: "zone_id+DEACTIVATED+valid_to" },
  { type: "ZONE_BOUNDARY_CHANGED", group: "zones", aggregate: "delivery_zone", payload: ["zone_id", "version", "change_reason", "approved_by"], idempotency_scope: "zone_id+version+CHANGED" },
];

const COURIER_EVENTS: EventSpec[] = [
  { type: "COURIER_REGISTERED", group: "couriers_shifts", aggregate: "courier", payload: ["courier_id", "source_system", "external_id"], idempotency_scope: "courier_id+REGISTERED" },
  { type: "COURIER_STATUS_CHANGED", group: "couriers_shifts", aggregate: "courier", payload: ["courier_id", "from_status", "to_status", "reason"], idempotency_scope: "courier_id+STATUS_CHANGED+occurred_at" },
  { type: "SHIFT_PLANNED", group: "couriers_shifts", aggregate: "shift", payload: ["shift_id", "courier_id", "shop_id", "planned_start_at", "planned_end_at"], idempotency_scope: "shift_id+PLANNED" },
  { type: "SHIFT_STARTED", group: "couriers_shifts", aggregate: "shift", payload: ["shift_id", "courier_id", "shop_id", "actual_start_at"], idempotency_scope: "shift_id+STARTED" },
  { type: "COURIER_ARRIVED_AT_SHOP", group: "couriers_shifts", aggregate: "shift", payload: ["shift_id", "courier_id", "shop_id", "arrived_at"], idempotency_scope: "shift_id+ARRIVED" },
  { type: "COURIER_JOINED_QUEUE", group: "couriers_shifts", aggregate: "queue_entry", payload: ["queue_entry_id", "courier_id", "shop_id", "shift_id", "queue_sequence"], idempotency_scope: "queue_entry_id+JOINED" },
  { type: "COURIER_SKIPPED_IN_QUEUE", group: "couriers_shifts", aggregate: "queue_entry", payload: ["queue_entry_id", "skipped_at", "skip_reason"], idempotency_scope: "queue_entry_id+SKIPPED+skipped_at" },
  { type: "COURIER_QUEUE_PAUSED", group: "couriers_shifts", aggregate: "queue_entry", payload: ["queue_entry_id", "paused_at", "reason"], idempotency_scope: "queue_entry_id+PAUSED" },
  { type: "COURIER_QUEUE_RESUMED", group: "couriers_shifts", aggregate: "queue_entry", payload: ["queue_entry_id", "resumed_at"], idempotency_scope: "queue_entry_id+RESUMED" },
  { type: "BREAK_STARTED", group: "couriers_shifts", aggregate: "shift", payload: ["shift_id", "courier_id", "break_started_at"], idempotency_scope: "shift_id+BREAK_STARTED+break_started_at" },
  { type: "BREAK_ENDED", group: "couriers_shifts", aggregate: "shift", payload: ["shift_id", "courier_id", "break_ended_at"], idempotency_scope: "shift_id+BREAK_ENDED+break_ended_at" },
  { type: "COURIER_RETURNED_TO_SHOP", group: "couriers_shifts", aggregate: "shift", payload: ["shift_id", "courier_id", "returned_at"], idempotency_scope: "shift_id+RETURNED+returned_at" },
  { type: "SHIFT_ENDED", group: "couriers_shifts", aggregate: "shift", payload: ["shift_id", "courier_id", "actual_end_at"], idempotency_scope: "shift_id+ENDED" },
  { type: "NO_SHOW_RECORDED", group: "couriers_shifts", aggregate: "shift", payload: ["shift_id", "courier_id", "recorded_at", "reason"], note: "Косвенно подтверждается 5939.progul", idempotency_scope: "shift_id+NO_SHOW", source_candidate: "5939.progul" },
  { type: "COURIER_BLOCKED", group: "couriers_shifts", aggregate: "courier", payload: ["courier_id", "blocked_at", "reason"], idempotency_scope: "courier_id+BLOCKED+blocked_at" },
  { type: "COURIER_UNBLOCKED", group: "couriers_shifts", aggregate: "courier", payload: ["courier_id", "unblocked_at"], idempotency_scope: "courier_id+UNBLOCKED+unblocked_at" },
];

const TRIP_EVENTS: EventSpec[] = [
  { type: "TRIP_FORMED", group: "trips_assignments", aggregate: "trip", payload: ["trip_id", "shop_id", "zone_id", "formed_at", "order_ids"], idempotency_scope: "trip_id+FORMED" },
  { type: "TRIP_ORDER_ADDED", group: "trips_assignments", aggregate: "trip", payload: ["trip_id", "order_id", "sequence_no", "added_by"], idempotency_scope: "trip_id+order_id+ADDED" },
  { type: "TRIP_ORDER_REMOVED", group: "trips_assignments", aggregate: "trip", payload: ["trip_id", "order_id", "removed_by", "reason"], idempotency_scope: "trip_id+order_id+REMOVED+occurred_at" },
  { type: "TRIP_ASSIGNED", group: "trips_assignments", aggregate: "trip", payload: ["trip_id", "courier_id", "queue_entry_id", "assigned_at", "assigned_by"], idempotency_scope: "trip_id+ASSIGNED" },
  { type: "TRIP_ASSIGNMENT_CANCELLED", group: "trips_assignments", aggregate: "trip", payload: ["trip_id", "courier_id", "cancelled_at", "cancel_reason", "actor_id"], idempotency_scope: "trip_id+ASSIGNMENT_CANCELLED+occurred_at" },
  { type: "TRIP_DEPARTED", group: "trips_assignments", aggregate: "trip", payload: ["trip_id", "departed_at"], idempotency_scope: "trip_id+DEPARTED" },
  { type: "TRIP_RETURNED", group: "trips_assignments", aggregate: "trip", payload: ["trip_id", "returned_at"], idempotency_scope: "trip_id+RETURNED" },
  { type: "TRIP_COMPLETED", group: "trips_assignments", aggregate: "trip", payload: ["trip_id", "completed_at"], idempotency_scope: "trip_id+COMPLETED" },
  { type: "TRIP_CANCELLED", group: "trips_assignments", aggregate: "trip", payload: ["trip_id", "cancelled_at", "reason"], idempotency_scope: "trip_id+CANCELLED" },
  { type: "TRIP_EXCEPTION_RECORDED", group: "trips_assignments", aggregate: "trip", payload: ["trip_id", "exception_type", "reason", "actor_id"], idempotency_scope: "trip_id+EXCEPTION+occurred_at" },
];

const FINANCE_EVENTS: EventSpec[] = [
  { type: "TARIFF_DRAFTED", group: "finance", aggregate: "tariff", payload: ["tariff_version_id", "name", "base_amount", "currency", "author_id"], idempotency_scope: "tariff_version_id+DRAFTED" },
  { type: "TARIFF_APPROVED", group: "finance", aggregate: "tariff", payload: ["tariff_version_id", "approved_by", "approved_at"], idempotency_scope: "tariff_version_id+APPROVED" },
  { type: "TARIFF_ACTIVATED", group: "finance", aggregate: "tariff", payload: ["tariff_version_id", "effective_from"], idempotency_scope: "tariff_version_id+ACTIVATED+effective_from" },
  { type: "COURIER_ACCRUAL_CREATED", group: "finance", aggregate: "accrual", payload: ["accrual_id", "courier_id", "order_id", "delivery_attempt_id", "tariff_version_id", "amount", "currency", "earned_at"], note: "Создаётся после подтверждённого ORDER_DELIVERED, не от суммы заказа", idempotency_scope: "delivery_attempt_id+ACCRUAL_CREATED" },
  { type: "COURIER_ACCRUAL_APPROVED", group: "finance", aggregate: "accrual", payload: ["accrual_id", "approved_by", "approved_at"], idempotency_scope: "accrual_id+APPROVED" },
  { type: "COURIER_ACCRUAL_REVERSED", group: "finance", aggregate: "accrual", payload: ["accrual_id", "reversed_at", "reason", "actor_id"], idempotency_scope: "accrual_id+REVERSED+occurred_at" },
  { type: "COURIER_ACCRUAL_PAID", group: "finance", aggregate: "accrual", payload: ["accrual_id", "paid_at", "payment_ref"], idempotency_scope: "accrual_id+PAID" },
  { type: "ACCRUAL_ADJUSTED", group: "finance", aggregate: "accrual", payload: ["accrual_id", "adjustment_id", "adjustment_type", "amount_delta", "reason", "approved_by"], idempotency_scope: "adjustment_id+ADJUSTED" },
];

const MENTORSHIP_EVENTS: EventSpec[] = [
  { type: "MENTORSHIP_ASSIGNED", group: "mentorship", aggregate: "mentorship", payload: ["mentorship_id", "mentor_courier_id", "trainee_courier_id", "starts_at", "planned_ends_at", "assigned_by"], idempotency_scope: "mentorship_id+ASSIGNED", source_candidate: "5939.mentorid" },
  { type: "MENTORSHIP_STARTED", group: "mentorship", aggregate: "mentorship", payload: ["mentorship_id", "started_at"], idempotency_scope: "mentorship_id+STARTED" },
  { type: "MENTORSHIP_SHIFT_REVIEWED", group: "mentorship", aggregate: "mentorship", payload: ["mentorship_id", "shift_id", "shift_number", "delivery_quality_score", "rules_compliance_score", "reviewed_by"], idempotency_scope: "mentorship_id+shift_id+REVIEWED", source_candidate: "5939.trainee_shift_in_five" },
  { type: "MENTORSHIP_COMPLETED", group: "mentorship", aggregate: "mentorship", payload: ["mentorship_id", "completed_at", "confirmed_by"], idempotency_scope: "mentorship_id+COMPLETED" },
  { type: "MENTORSHIP_EXTENDED", group: "mentorship", aggregate: "mentorship", payload: ["mentorship_id", "new_planned_ends_at", "reason", "actor_id"], idempotency_scope: "mentorship_id+EXTENDED+new_planned_ends_at" },
  { type: "MENTORSHIP_CANCELLED", group: "mentorship", aggregate: "mentorship", payload: ["mentorship_id", "cancelled_at", "reason", "actor_id"], idempotency_scope: "mentorship_id+CANCELLED" },
];

export const EVENTS: EventSpec[] = [...ORDER_EVENTS, ...ZONE_EVENTS, ...COURIER_EVENTS, ...TRIP_EVENTS, ...FINANCE_EVENTS, ...MENTORSHIP_EVENTS];

export const EVENT_ENVELOPE_FIELDS = [
  "event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "recorded_at",
  "actor_type", "actor_id", "source_system", "source_event_id", "correlation_id", "causation_id",
  "idempotency_key", "schema_version", "payload",
];

// ---------------------------------------------------------------------------------------

export type BusinessDecision = {
  id: string;
  question: string;
  why: string;
  owner: string;
  impact: string;
  required_decision: string;
  options: string[];
  consequences: string[];
  status: "OPEN";
  affects: string[];
};

const D = (
  id: string, question: string, why: string, impact: string, required_decision: string,
  options: string[], consequences: string[], affects: string[],
): BusinessDecision => ({ id, question, why, owner: "TBD", impact, required_decision, options, consequences, status: "OPEN", affects });

export const BUSINESS_DECISIONS: BusinessDecision[] = [
  D("BD-001", "Кто назначает новичка куратору?", "Назначение и права", "mentorship_assignments.assigned_by", "Утвердить роль", ["Куратор", "Операционный менеджер", "HR", "Автоматически по ТТ"], ["Меняются права и аудит", "Автоназначение требует правил подбора"], ["mentorship_assignments"]),
  D("BD-002", "Что делать, если заказ готов, но подходящего курьера нет?", "***REMOVED*** и исключения", "order_readiness/queues", "Утвердить процедуру исключения", ["Ожидание без лимита", "Эскалация менеджеру", "Отмена заказа"], ["Влияет на SLA и очередь", "Может требовать нового события"], ["orders", "courier_queue_entries"]),
  D("BD-003", "Что считать подходящим курьером при отсутствии в своей зоне?", "Допуск к назначению", "trip_assignments", "Утвердить правило допуска", ["Только своя зона", "Соседняя зона", "Любая зона ТТ"], ["Влияет на правило одной зоны в ходке"], ["trips", "trip_assignments"]),
  D("BD-004", "Возврат курьера: новый FIFO или сохранение приоритета?", "***REMOVED***", "courier_queue_entries.queue_sequence", "Утвердить правило", ["Новый FIFO", "Сохранить приоритет", "Гибрид"], ["Влияет на справедливость и нагрузку"], ["courier_queue_entries"]),
  D("BD-005", "Что делать, если курьер не вернулся/не закрыл ходку?", "Контроль незавершённых поездок", "trips.trip_status", "Утвердить процедуру", ["Автозакрытие по таймауту", "Эскалация куратору", "Ручное закрытие"], ["Влияет на начисления и аудит"], ["trips", "courier_shifts"]),
  D("BD-006", "Как поступать с отменой после выезда?", "История ходки и оплата", "trip_orders/trip_order_membership_history", "Утвердить процедуру", ["Запрет", "Административная корректировка с аудитом"], ["Требует отдельного права и причины"], ["trip_orders", "trip_order_membership_history"]),
  D("BD-007", "Как учитывать возврат после успешной доставки?", "Корректировка начисления", "accrual_adjustments", "Утвердить правило", ["Сторно начисления", "Корректировка", "Не менять"], ["Влияет на финансовую историю"], ["courier_accruals", "accrual_adjustments"]),
  D("BD-008", "Точная формула тарифа по зоне и расстоянию?", "Расчёт оплаты", "tariff_versions", "Утвердить формулу и ставки", ["Фикс за заказ", "Зона+расстояние", "Комбинированная"], ["Без формулы начисления не создаются"], ["tariff_versions", "courier_accruals"]),
  D("BD-009", "Как измеряется загруженность и влияет ли она на тариф?", "Переменная часть оплаты", "tariff_versions", "Утвердить метрику", ["По числу активных курьеров", "По очереди", "Не учитывать"], ["Может менять тариф динамически"], ["tariff_versions"]),
  D("BD-010", "Когда начисление окончательно и кто подтверждает?", "Финансовый статус", "courier_accruals.accrual_status", "Утвердить процесс", ["Автоподтверждение", "Финансы", "Руководитель"], ["Влияет на статусы и выплаты"], ["courier_accruals"]),
  D("BD-011", "Какие роли, кроме куратора, могут отменить/переназначить ходку?", "Доступы и аудит", "roles/audit", "Утвердить роли", ["Только куратор", "Куратор+менеджер", "Диспетчер (если утверждён)"], ["Влияет на модель прав"], ["trips", "trip_assignments"]),
  D("BD-012", "Как фиксировать невозможность принять ходку, если отказ запрещён?", "Исключительные ситуации", "trip_assignments", "Утвердить процедуру", ["Пауза очереди", "Пропуск", "Аварийная отмена"], ["Может требовать новых статусов"], ["trip_assignments", "courier_queue_entries"]),
  D("BD-013", "Кто и когда отмечает готовность заказа?", "Событие ORDER_READY", "order_readiness.ready_at", "Утвердить источник и ответственного", ["3466.time_ready", "date_status_10", "date_collected", "Новое событие"], ["ready_at остаётся TBD до решения"], ["orders", "order_readiness"]),
  D("BD-014", "Какие точные статусы и переходы заказа действуют?", "Жизненный цикл", "orders.order_status", "Утвердить перечень", ["<ФИО>ный перечень", "Статусы источника", "Гибрид"], ["Влияет на историю и отчёты"], ["orders", "order_status_history"]),
  D("BD-015", "Как учитывать отменённые и возвращённые заказы в SLA?", "Отчётность", "orders/sla", "Утвердить правило", ["Включать", "Отдельная группа", "Исключать с оговоркой"], ["Ответ «не исключать автоматически» уже получен"], ["orders"]),
  D("BD-016", "Какой источник — мастер-источник заказа и его статуса?", "Интеграция", "orders.source_system", "Утвердить мастер-систему", ["Текущая система заказов", "Новая ОС", "Гибрид"], ["Определяет направление синхронизации"], ["orders", "order_status_history"]),
  D("BD-017", "Какой мастер-источник идентичности курьера и ТТ?", "Сопоставление", "couriers/courier_external_ids/shops", "Утвердить мастер-источник", ["HR", "<ФИО> система", "Superset как read-only"], ["Определяет mapping внешних ID"], ["couriers", "courier_external_ids", "shops"]),
  D("BD-018", "Какая СУБД будет использоваться в production?", "Физическая схема", "DDL/типы", "Утвердить СУБД", ["PostgreSQL", "SQLite (прототип)", "Другая"], ["Рекомендация: PostgreSQL; ADR-001"], ["all"]),
  D("BD-019", "Какой стек backend и механизм авторизации?", "Реализация", "auth/roles", "Утвердить стек", ["Существующий identity provider", "Новый"], ["Пароли самостоятельно не создаются"], ["users/roles"]),
  D("BD-020", "Нужны ли слоты предварительного бронирования или только отметка прибытия?", "Смены/очередь", "work_slots", "Утвердить", ["Только отметка прибытия", "Слоты"], ["work_slots опционален"], ["work_slots", "courier_shifts"]),
  D("BD-021", "Как обрабатывать неполную/частичную доставку?", "Оплата и статусы", "delivery_attempts.result", "Утвердить", ["PARTIAL как отдельный результат", "Только DELIVERED/FAILED"], ["Влияет на начисление"], ["delivery_attempts", "courier_accruals"]),
  D("BD-022", "Нужно ли хранить историю геозон для воспроизведения назначений?", "Аудит и аналитика", "zone_boundary_versions", "Утвердить", ["Да", "Только текущая"], ["Влияет на объём и аудит"], ["zone_boundary_versions"]),
  D("BD-023", "Какой срок хранения событий и финансовых записей?", "Архивирование", "retention policy", "Утвердить", ["1 год", "3 года", "5 лет"], ["Влияет на партиционирование"], ["domain_events", "courier_accruals"]),
  D("BD-024", "Кто утверждает тарифы и с какой даты они действуют?", "Управление тарифами", "tariff_versions.approved_by/effective_from", "Утвердить процесс", ["Финансы", "Операционный директор", "Коллегиально"], ["Без утверждения тарифы в DRAFT"], ["tariff_versions"]),
];

// ---------------------------------------------------------------------------------------

export type MappingRow = {
  domain_table: string;
  domain_column: string;
  superset_dataset: number | null;
  superset_table: string | null;
  superset_field: string | null;
  evidence: "DIRECT" | "DERIVED" | "INFERRED" | "UNKNOWN";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  limitation: string;
  usable_for_initial_load: "YES" | "PARTIAL" | "NO";
  needs: string;
};

const M = (
  t: string, c: string, ds: number | null, st: string | null, f: string | null,
  e: MappingRow["evidence"], conf: MappingRow["confidence"], lim: string, usable: MappingRow["usable_for_initial_load"], needs: string,
): MappingRow => ({ domain_table: t, domain_column: c, superset_dataset: ds, superset_table: st, superset_field: f, evidence: e, confidence: conf, limitation: lim, usable_for_initial_load: usable, needs });

export const MAPPING: MappingRow[] = [
  M("shops", "code", 4732, "default.darkstore_time_sheet", "shopno", "DIRECT", "HIGH", "shopno числовой; code — строка", "YES", ""),
  M("shops", "name", 4732, "default.darkstore_time_sheet", "name_tt", "DIRECT", "HIGH", "название может меняться", "YES", ""),
  M("shops", "external_source_id", 4732, "default.darkstore_time_sheet", "id_tt", "DIRECT", "MEDIUM", "id_tt nullable", "PARTIAL", ""),
  M("addresses", "latitude", 3466, "darkstore_time_sheet", "geo", "DERIVED", "LOW", "geo — строка без разбора; формат не подтверждён", "NO", "BD по геоданным"),
  M("addresses", "longitude", 3466, "darkstore_time_sheet", "geo", "DERIVED", "LOW", "geo — строка без разбора", "NO", "BD по геоданным"),
  M("couriers", "external_hr_id", 5797, "agile_mart_techaudit.hr_delivery", "id_courier", "DIRECT", "MEDIUM", "HR-контур; id_courier числовой", "PARTIAL", "BD-017"),
  M("couriers", "courier_type", 7775, "default.v_couriers", "id_courier_type", "DERIVED", "MEDIUM", "требуется справочник типов", "PARTIAL", "справочник"),
  M("couriers", "employment_type", 7775, "default.v_couriers", "job_type", "DERIVED", "MEDIUM", "job_type — код", "PARTIAL", "справочник"),
  M("couriers", "operational_status", 5797, "agile_mart_techaudit.hr_delivery", "active", "DERIVED", "MEDIUM", "active — строка 'Да'/'Нет'", "PARTIAL", "BD-017"),
  M("couriers", "is_blocked", 5797, "agile_mart_techaudit.hr_delivery", "is_blocked", "DIRECT", "MEDIUM", "операционный смысл требует подтверждения", "PARTIAL", ""),
  M("courier_external_ids", "external_id", 7775, "default.v_couriers", "ID", "DIRECT", "MEDIUM", "сопоставление с id_courier не доказано", "PARTIAL", "BD-017"),
  M("courier_external_ids", "external_id", 5939, "hr_daily_pers_mentors", "mentorid", "INFERRED", "LOW", "mentorid — string; роль не подтверждена", "NO", "BD-001"),
  M("delivery_zones", "code", null, null, null, "UNKNOWN", "LOW", "прямого источника зон нет", "NO", "создать справочник"),
  M("delivery_zones", "boundary_geometry", null, null, null, "UNKNOWN", "LOW", "геометрия отсутствует", "NO", "Geo-отдел"),
  M("orders", "external_order_id", 4732, "default.darkstore_time_sheet", "id_order", "DIRECT", "HIGH", "подзаказы; id_general объединяет", "YES", "BD-016"),
  M("orders", "shop_id", 4732, "default.darkstore_time_sheet", "shopno", "DIRECT", "HIGH", "", "YES", ""),
  M("orders", "order_created_at", 4732, "default.darkstore_time_sheet", "date_order", "DIRECT", "HIGH", "используется в SLA-метриках", "YES", ""),
  M("orders", "accepted_at", 4732, "default.darkstore_time_sheet", "date_status_10", "INFERRED", "LOW", "статус 10 не расшифрован", "NO", "BD-014"),
  M("orders", "collection_started_at", 4732, "default.darkstore_time_sheet", "date_collect_start", "INFERRED", "MEDIUM", "", "PARTIAL", ""),
  M("orders", "collected_at", 4732, "default.darkstore_time_sheet", "date_collected", "INFERRED", "MEDIUM", "не равно готовности", "PARTIAL", "BD-013"),
  M("orders", "ready_at", 3466, "darkstore_time_sheet", "time_ready", "INFERRED", "LOW", "тип поля не определён; кандидат", "NO", "BD-013"),
  M("orders", "delivery_started_at", 4732, "default.darkstore_time_sheet", "date_delivery_start", "DIRECT", "MEDIUM", "", "PARTIAL", ""),
  M("orders", "delivered_at", 4732, "default.darkstore_time_sheet", "date_delivered", "DIRECT", "HIGH", "", "YES", ""),
  M("orders", "cancelled_at", 4732, "default.darkstore_time_sheet", "is_canceled", "DERIVED", "MEDIUM", "флаг, не время", "PARTIAL", "BD-014"),
  M("orders", "returned_at", 4732, "default.darkstore_time_sheet", "is_returned_store", "DERIVED", "MEDIUM", "флаг, не время", "PARTIAL", "BD-014"),
  M("orders", "sla_due_at", 4732, "default.darkstore_time_sheet", "date_supply_untill", "DIRECT", "MEDIUM", "SLA-норматив может приходить из services_sla", "PARTIAL", "документ SLA"),
  M("orders", "order_status", 4732, "default.darkstore_time_sheet", "order_status", "DIRECT", "MEDIUM", "нет подтверждённого словаря статусов", "PARTIAL", "BD-014"),
  M("order_amount_snapshots", "amount", 4732, "default.darkstore_time_sheet", "sum_paid", "DIRECT", "HIGH", "НЕ оплата курьера", "YES", "аналитика"),
  M("order_amount_snapshots", "amount", 4732, "default.darkstore_time_sheet", "sum_order", "DIRECT", "HIGH", "НЕ оплата курьера", "YES", "аналитика"),
  M("order_status_history", "to_status", 4732, "default.darkstore_time_sheet", "order_status", "DERIVED", "MEDIUM", "история переходов из аналитики ограничена", "PARTIAL", "BD-014"),
  M("order_readiness", "ready_at", 3466, "darkstore_time_sheet", "time_ready", "INFERRED", "LOW", "кандидат; требует BD-013", "NO", "BD-013"),
  M("courier_shifts", "external_shift_id", 7802, "shift_time_breakdown", "id_shift", "DIRECT", "MEDIUM", "string id смены; универсальность не доказана", "PARTIAL", "подтверждение"),
  M("courier_shifts", "actual_start_at", 7712, null, "shift_open_time", "DIRECT", "MEDIUM", "открытие смены в другом датасете", "PARTIAL", "сопоставление"),
  M("courier_shifts", "shift_type", 7021, null, "shift_type", "DIRECT", "MEDIUM", "семантика типов не подтверждена", "PARTIAL", "справочник"),
  M("courier_shifts", "is_night_shift", 7021, null, "is_night_shift", "DIRECT", "MEDIUM", "", "PARTIAL", ""),
  M("courier_shifts", "planned_start_at", 7021, null, "time_start", "INFERRED", "LOW", "часть смены, не обязательно смена", "NO", "подтверждение"),
  M("courier_shifts", "actual_end_at", 7021, null, "time_end", "INFERRED", "LOW", "часть смены", "NO", "подтверждение"),
  M("courier_queue_entries", "arrived_at", 3466, "darkstore_time_sheet", "wait_time", "INFERRED", "LOW", "длительность ожидания, не время прибытия", "NO", "новое событие"),
  M("courier_queue_entries", "queue_sequence", null, null, null, "UNKNOWN", "LOW", "очереди в источниках нет", "NO", "новое событие"),
  M("trips", "external_trip_ref", 7006, "mart_mixed.darkstore_time", "id_pool_calc", "INFERRED", "LOW", "id_pool_calc вычисляемый", "NO", "подтверждение"),
  M("trips", "zone_id", null, null, null, "UNKNOWN", "LOW", "зоны доставки нет", "NO", "справочник зон"),
  M("trip_orders", "order_id", 7006, "mart_mixed.darkstore_time", "id_order", "INFERRED", "MEDIUM", "состав пула выводится косвенно", "PARTIAL", "подтверждение"),
  M("trip_orders", "sequence_no", 7006, "mart_mixed.darkstore_time", "fact_seq", "INFERRED", "LOW", "последовательность внутри пула", "NO", "подтверждение"),
  M("trip_assignments", "courier_id", 7006, "mart_mixed.darkstore_time", "id_courier", "DIRECT", "MEDIUM", "связь заказ↔курьер без события назначения", "PARTIAL", "новое событие"),
  M("trip_assignments", "assigned_at", 7006, "mart_mixed.darkstore_time", "date_pickuped", "INFERRED", "LOW", "pickup ≠ назначение", "NO", "новое событие"),
  M("delivery_attempts", "completed_at", 4732, "default.darkstore_time_sheet", "date_delivered", "DIRECT", "HIGH", "", "YES", ""),
  M("delivery_attempts", "result", 4732, "default.darkstore_time_sheet", "order_status", "DERIVED", "MEDIUM", "результат выводится из статуса", "PARTIAL", "BD-014"),
  M("courier_events", "event_type", 5247, "agile_mart_techaudit.courier_events_logs_aggr", "event_name", "INFERRED", "LOW", "словарь событий отсутствует; events_qty ≠ явка", "NO", "словарь событий"),
  M("courier_events", "occurred_at", 5247, "agile_mart_techaudit.courier_events_logs_aggr", "d", "INFERRED", "LOW", "дата, не время события", "NO", "новое событие"),
  M("courier_events", "event_type", 5939, "hr_daily_pers_mentors", "progul", "INFERRED", "MEDIUM", "невыход как флаг, не событие", "PARTIAL", "новое событие"),
  M("tariff_versions", "base_amount", null, null, null, "UNKNOWN", "LOW", "тарифы не подтверждены", "NO", "BD-008/BD-024"),
  M("courier_accruals", "amount", null, null, null, "UNKNOWN", "LOW", "нет подтверждённого тарифа", "NO", "BD-008"),
  M("courier_accruals", "amount", 7473, "agile_mart_techaudit.hr_delivery_five_shifts", "shift_1_profit", "INFERRED", "LOW", "только первые 5 смен; аналитический ориентир", "NO", "BD-008"),
  M("mentorship_assignments", "mentor_courier_id", 5939, "hr_daily_pers_mentors", "mentorid", "DIRECT", "MEDIUM", "string id; роль требует BD-001", "PARTIAL", "BD-001"),
  M("mentorship_assignments", "trainee_courier_id", 5939, "hr_daily_pers_mentors", "person_code", "INFERRED", "LOW", "сопоставление с id_courier не доказано", "NO", "BD-001"),
  M("mentorship_assignments", "starts_at", 5939, "hr_daily_pers_mentors", "date_for_mentor", "INFERRED", "MEDIUM", "семантика даты требует подтверждения", "PARTIAL", "подтверждение"),
  M("mentorship_assignments", "planned_ends_at", 5939, "hr_daily_pers_mentors", "date_for_mentor", "DERIVED", "LOW", "две недели — правило, не поле", "NO", "правило"),
  M("mentorship_shift_reviews", "shift_number", 5939, "hr_daily_pers_mentors", "shift_rn_trainee", "DIRECT", "MEDIUM", "", "PARTIAL", ""),
  M("mentorship_shift_reviews", "delivery_quality_score", null, null, null, "UNKNOWN", "LOW", "шкала не согласована", "NO", "правило"),
  M("mentorship_shift_reviews", "shift_id", 7802, "shift_time_breakdown", "id_shift", "INFERRED", "LOW", "сопоставление смен не доказано", "NO", "подтверждение"),
];

export type MigrationStep = {
  id: string;
  name: string;
  purpose: string;
  tables: string[];
  depends_on: string[];
  rollback: string;
  checks_before: string[];
  checks_after: string[];
  risk: string;
};

export const MIGRATIONS: MigrationStep[] = [
  { id: "0001", name: "core_reference", purpose: "Магазины, адреса, курьеры, внешние ID", tables: ["shops", "addresses", "couriers", "courier_external_ids"], depends_on: [], rollback: "DROP новых таблиц (пустые)", checks_before: ["выбрана СУБД", "согласованы PK"], checks_after: ["PK/FK валидны", "уникальность code и (source_system,external_id)"], risk: "низкий" },
  { id: "0002", name: "orders", purpose: "***REMOVED***ы, суммы, история статусов, готовность", tables: ["orders", "order_amount_snapshots", "order_status_history", "order_readiness"], depends_on: ["0001"], rollback: "DROP новых таблиц", checks_before: ["0001 применена"], checks_after: ["уникальность (source_system,external_order_id)"], risk: "средний (объём)" },
  { id: "0003", name: "geo_zones", purpose: "***REMOVED*** и версии границ", tables: ["delivery_zones", "zone_boundary_versions"], depends_on: ["0001"], rollback: "DROP новых таблиц", checks_before: ["согласованы правила зон"], checks_after: ["активная зона принадлежит одной ТТ"], risk: "низкий (данных нет)" },
  { id: "0004", name: "shifts_queue", purpose: "Слоты (опц.), смены, очередь", tables: ["work_slots", "courier_shifts", "courier_queue_entries"], depends_on: ["0001"], rollback: "DROP новых таблиц", checks_before: ["BD-020"], checks_after: ["queue_sequence уникален в ТТ"], risk: "средний" },
  { id: "0005", name: "trips_assignments", purpose: "Ходки, состав, история состава, назначения", tables: ["trips", "trip_orders", "trip_order_membership_history", "trip_assignments"], depends_on: ["0002", "0003", "0004"], rollback: "DROP новых таблиц", checks_before: ["0003/0004 применены"], checks_after: ["частичные уникальные индексы созданы"], risk: "высокий (конкурентность)" },
  { id: "0006", name: "delivery_events", purpose: "Попытки доставки, события курьера и доменные", tables: ["delivery_attempts", "courier_events", "domain_events"], depends_on: ["0002", "0005"], rollback: "DROP новых таблиц", checks_before: ["0005 применена"], checks_after: ["уникальность idempotency_key"], risk: "средний (объём)" },
  { id: "0007", name: "tariffs_accruals", purpose: "Тарифы, начисления, корректировки", tables: ["tariff_versions", "courier_accruals", "accrual_adjustments"], depends_on: ["0006"], rollback: "компенсирующие записи; DROP только пустых таблиц", checks_before: ["BD-008/BD-024"], checks_after: ["уникальность delivery_attempt_id в начислениях"], risk: "высокий (финансы)" },
  { id: "0008", name: "mentorship", purpose: "Назначения наставника и оценки смен", tables: ["mentorship_assignments", "mentorship_shift_reviews"], depends_on: ["0004", "0001"], rollback: "DROP новых таблиц", checks_before: ["BD-001"], checks_after: ["mentor != trainee", "одно активное назначение"], risk: "низкий" },
  { id: "0009", name: "access_audit", purpose: "Роли/права, если auth не переиспользуется", tables: [], depends_on: ["0001"], rollback: "DROP новых объектов", checks_before: ["BD-019"], checks_after: ["роли описаны"], risk: "средний" },
  { id: "0010", name: "indexes_constraints", purpose: "Дополнительные индексы, уникальности, ограничения", tables: [], depends_on: ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008"], rollback: "DROP INDEX/CONSTRAINT", checks_before: ["все таблицы созданы"], checks_after: ["индексы созданы, план запросов проверен"], risk: "средний (блокировки)" },
];

// ---------------------------------------------------------------------------------------

export type BusinessRule = { id: string; area: string; statement: string; status: "AGREED" | "TBD"; source: string };

export const BUSINESS_RULES: BusinessRule[] = [
  { id: "BR-ORD-01", area: "orders", statement: "MVP начинается с общего списка заказов", status: "AGREED", source: "ТЗ 2.1" },
  { id: "BR-ORD-02", area: "orders", statement: "Готовность заказа фиксируется отдельным фактом/событием", status: "AGREED", source: "ТЗ 2.1" },
  { id: "BR-ORD-03", area: "orders", statement: "Конкретный триггер готовности закрепляется регламентом", status: "TBD", source: "ТЗ 2.1 (BD-013)" },
  { id: "BR-ORD-04", area: "orders", statement: "Времена сборки/доставки утверждены заказчиком; новые SLA не придумывать", status: "AGREED", source: "ТЗ 2.1" },
  { id: "BR-ORD-05", area: "orders", statement: "Отменённые/возвращённые заказы не исключаются из SLA автоматически", status: "AGREED", source: "ТЗ 2.1 (BD-015)" },
  { id: "BR-ZON-01", area: "zones", statement: "Одна зона — одна торговая точка и территория вокруг неё", status: "AGREED", source: "ТЗ 2.2" },
  { id: "BR-ZON-02", area: "zones", statement: "Границы определяются плотностью заказов, расстояниями и временем доставки", status: "AGREED", source: "ТЗ 2.2" },
  { id: "BR-ZON-03", area: "zones", statement: "Окончательные границы утверждает географический отдел", status: "AGREED", source: "ТЗ 2.2" },
  { id: "BR-ZON-04", area: "zones", statement: "Адрес на границе относится к зоне с минимальным временем доставки", status: "AGREED", source: "ТЗ 2.2" },
  { id: "BR-TRP-01", area: "trips", statement: "***REMOVED*** — одна поездка курьера с несколькими заказами", status: "AGREED", source: "ТЗ 2.3" },
  { id: "BR-TRP-02", area: "trips", statement: "Целевой размер ходки 3–5 заказов, но не жёсткое ограничение БД", status: "AGREED", source: "ТЗ 2.3" },
  { id: "BR-TRP-03", area: "trips", statement: "Допустима ходка из двух заказов", status: "AGREED", source: "ТЗ 2.3" },
  { id: "BR-TRP-04", area: "trips", statement: "При более пяти готовых заказов выбор по времени готовности, срочности и кратчайшему пути", status: "AGREED", source: "ТЗ 2.3" },
  { id: "BR-TRP-05", area: "trips", statement: "После выезда состав ходки не меняется", status: "AGREED", source: "ТЗ 2.3" },
  { id: "BR-TRP-06", area: "trips", statement: "Одна ходка содержит заказы только одной зоны", status: "AGREED", source: "ТЗ 2.3" },
  { id: "BR-TRP-07", area: "trips", statement: "Ручная корректировка состава — только куратор", status: "AGREED", source: "ТЗ 2.3/2.7" },
  { id: "BR-QUE-01", area: "queue", statement: "Назначение только после прибытия и отметки в очереди", status: "AGREED", source: "ТЗ 2.4" },
  { id: "BR-QUE-02", area: "queue", statement: "FIFO: кто раньше пришёл, тот раньше получает заказы", status: "AGREED", source: "ТЗ 2.4" },
  { id: "BR-QUE-03", area: "queue", statement: "Неготового курьера пропускают", status: "AGREED", source: "ТЗ 2.4" },
  { id: "BR-QUE-04", area: "queue", statement: "Отказ от предложенной ходки не допускается", status: "AGREED", source: "ТЗ 2.4 (BD-012)" },
  { id: "BR-QUE-05", area: "queue", statement: "Предельного лимита ожидания нет", status: "AGREED", source: "ТЗ 2.4" },
  { id: "BR-QUE-06", area: "queue", statement: "***REMOVED*** возврата пропущенного курьера не определено", status: "TBD", source: "ТЗ 2.4 (BD-004)" },
  { id: "BR-PAY-01", area: "finance", statement: "Оплачивается каждый доставленный заказ", status: "AGREED", source: "ТЗ 2.5" },
  { id: "BR-PAY-02", area: "finance", statement: "Оплата зависит от зоны и расстояния", status: "AGREED", source: "ТЗ 2.5" },
  { id: "BR-PAY-03", area: "finance", statement: "Начисление после доставки каждого заказа", status: "AGREED", source: "ТЗ 2.5" },
  { id: "BR-PAY-04", area: "finance", statement: "При отмене одного заказа в ходке оплачиваются только доставленные", status: "AGREED", source: "ТЗ 2.5" },
  { id: "BR-PAY-05", area: "finance", statement: "Штрафов/наказаний нет; простой включён в стоимость заказа", status: "AGREED", source: "ТЗ 2.5" },
  { id: "BR-PAY-06", area: "finance", statement: "Формула надбавки за загруженность не утверждена", status: "TBD", source: "ТЗ 2.5 (BD-009)" },
  { id: "BR-PAY-07", area: "finance", statement: "Первые пять смен — аналитический ориентир, не универсальный тариф", status: "AGREED", source: "ТЗ 2.5" },
  { id: "BR-MEN-01", area: "mentorship", statement: "Куратор и наставник — одна роль", status: "AGREED", source: "ТЗ 2.6" },
  { id: "BR-MEN-02", area: "mentorship", statement: "Период сопровождения новичка — две недели", status: "AGREED", source: "ТЗ 2.6" },
  { id: "BR-MEN-03", area: "mentorship", statement: "Куратор подтверждает успешное обучение", status: "AGREED", source: "ТЗ 2.6" },
  { id: "BR-MEN-04", area: "mentorship", statement: "Качество оценивается по первым пяти сменам, качеству доставки и соблюдению правил", status: "AGREED", source: "ТЗ 2.6" },
  { id: "BR-MEN-05", area: "mentorship", statement: "Без ограничения числа новичков на куратора; блокирующий лимит не вводить", status: "AGREED", source: "ТЗ 2.6" },
  { id: "BR-MEN-06", area: "mentorship", statement: "Кто назначает новичка куратору — не выбрано", status: "TBD", source: "ТЗ 2.6 (BD-001)" },
  { id: "BR-MEN-07", area: "mentorship", statement: "Условия отрицательного результата/продления не определены", status: "TBD", source: "ТЗ 2.6" },
  { id: "BR-MGT-01", area: "management", statement: "Автоматически сформированную ходку вручную меняет только куратор", status: "AGREED", source: "ТЗ 2.7" },
  { id: "BR-MGT-02", area: "management", statement: "Если заказ готов, а курьера нет — ответ не выбран", status: "TBD", source: "ТЗ 2.7 (BD-002)" },
  { id: "BR-MGT-03", area: "management", statement: "Ключевые показатели MVP: ожидание, готовность→доставка, доставки на курьера, соблюдение сроков", status: "AGREED", source: "ТЗ 2.7" },
  { id: "BR-MGT-04", area: "management", statement: "Критические изменения видны сразу; некритичные KPI обновляются несколько раз в день", status: "AGREED", source: "ТЗ 2.7" },
];

export type GlossaryEntry = { term: string; definition: string; status: string; note: string };

export const GLOSSARY: GlossaryEntry[] = [
  { term: "***REMOVED***", definition: "Единица доставки от торговой точки до адреса; в операционной модели — строка orders", status: "AGREED", note: "В Superset id_order может быть подзаказом; id_general объединяет" },
  { term: "***REMOVED*** готов", definition: "Подтверждённый факт готовности заказа к передаче курьеру (ORDER_READY)", status: "TBD", note: "Источник готовности — BD-013; time_ready — кандидат" },
  { term: "Зона доставки", definition: "Территория вокруг торговой точки, утверждённая географическим отделом", status: "NEW", note: "В Superset справочника зон нет" },
  { term: "***REMOVED***", definition: "Одна поездка курьера с несколькими заказами одной зоны", status: "AGREED", note: "В Superset соответствие не подтверждено" },
  { term: "***REMOVED***", definition: "FIFO-последовательность курьеров, ожидающих назначение на ТТ", status: "AGREED", note: "В Superset очереди нет; новое событие" },
  { term: "Назначение", definition: "Связывание ходки с курьером", status: "AGREED", note: "Отказ запрещён; аварийная отмена — BD-011/BD-012" },
  { term: "***REMOVED***", definition: "Интервал фактической работы курьера на торговой точке", status: "PARTIAL", note: "Исторически подтверждается 7802/7021/7712; реальное время — новые события" },
  { term: "Доставка", definition: "Успешное вручение заказа (ORDER_DELIVERED)", status: "AGREED", note: "Основание начисления" },
  { term: "Начисление", definition: "Запись о доходе курьера за доставленный заказ", status: "NEW", note: "Тариф не утверждён; sum_paid не использовать" },
  { term: "Куратор", definition: "Наставник новичка; одна роль", status: "AGREED", note: "В источниках name_curator/mentorid" },
  { term: "Торговая точка (ТТ)", definition: "Даркстор/магазин, к которому привязаны заказы, смены и зоны", status: "AGREED", note: "shopno/id_tt" },
  { term: "Адрес доставки", definition: "Адрес получателя заказа", status: "PII", note: "Доступ ограничен; координаты могут отсутствовать" },
  { term: "Домен", definition: "Логический контекст модели (Operations, Geo, Workforce, Delivery, Finance, Mentorship)", status: "AGREED", note: "" },
  { term: "Событие", definition: "Append-only запись о факте с occurred_at и recorded_at", status: "AGREED", note: "Идемпотентность по idempotency_key" },
];

export type PiiPolicy = { id: string; subject: string; policy: string; roles: string };

export const PII_POLICY: PiiPolicy[] = [
  { id: "PII-01", subject: "Адрес доставки", policy: "Виден только ролям, участвующим в доставке; выгрузки ограничены", roles: "COURIER, CURATOR, OPERATIONS_MANAGER, GEO_MANAGER" },
  { id: "PII-02", subject: "ФИО курьера", policy: "Хранить display_name; HR-поля отделены от операционного контура", roles: "HR, OPERATIONS_MANAGER" },
  { id: "PII-03", subject: "Телефон/ИНН курьера", policy: "Не переносить в новую модель без основания; в отчёты и fixtures не включать", roles: "HR (ограниченно)" },
  { id: "PII-04", subject: "mentorfio", policy: "Не переносить в отчёты; сопоставлять по mentorid", roles: "Mentorship" },
  { id: "PII-05", subject: "customer_reference", policy: "Псевдоним/внешняя ссылка вместо ФИО", roles: "Operations" },
  { id: "PII-06", subject: "Финансовые начисления", policy: "Доступ только уполномоченным ролям", roles: "FINANCE, OPERATIONS_MANAGER" },
  { id: "PII-07", subject: "Логи и события payload", policy: "Не хранить секреты и лишние ПДн; payload валидируется схемой", roles: "ALL" },
  { id: "PII-08", subject: "Fixtures и тесты", policy: "Только синтетические данные", roles: "DEV" },
  { id: "PII-09", subject: "Экспорт", policy: "Учитывать роль пользователя и назначение выгрузки", roles: "ADMIN" },
  { id: "PII-10", subject: "Секреты", policy: "Не попадают в логи, отчёты и репозиторий", roles: "ALL" },
];

export type SourceOfTruth = { attribute: string; table: string; source_of_truth: string; owner: string; sync: string; note: string };

export const SOURCE_OF_TRUTH: SourceOfTruth[] = [
  { attribute: "order lifecycle / status", table: "orders", source_of_truth: "EXTERNAL_MASTER (BD-016)", owner: "Operations", sync: "события/импорт", note: "Superset — аналитика, не мастер" },
  { attribute: "order ready_at", table: "orders/order_readiness", source_of_truth: "NEW_OPERATIONAL", owner: "Operations", sync: "ORDER_READY", note: "BD-013; кандидат time_ready" },
  { attribute: "delivery_address", table: "orders/addresses", source_of_truth: "EXTERNAL_MASTER", owner: "Operations", sync: "импорт", note: "PII" },
  { attribute: "shop code/name", table: "shops", source_of_truth: "REFERENCE", owner: "Operations", sync: "справочник", note: "Superset shopno/name_tt — начальный источник" },
  { attribute: "delivery zones", table: "delivery_zones", source_of_truth: "REFERENCE", owner: "Geo", sync: "утверждение", note: "новый справочник" },
  { attribute: "zone boundary version", table: "zone_boundary_versions", source_of_truth: "REFERENCE", owner: "Geo", sync: "утверждение", note: "BD-022" },
  { attribute: "courier identity", table: "couriers", source_of_truth: "EXTERNAL_MASTER (BD-017)", owner: "Workforce", sync: "HR/identity", note: "" },
  { attribute: "courier operational status", table: "couriers", source_of_truth: "NEW_OPERATIONAL", owner: "Workforce", sync: "события", note: "" },
  { attribute: "shift actual interval", table: "courier_shifts", source_of_truth: "NEW_OPERATIONAL", owner: "Workforce", sync: "SHIFT_STARTED/ENDED", note: "исторически 7802/7021/7712" },
  { attribute: "queue position", table: "courier_queue_entries", source_of_truth: "NEW_OPERATIONAL", owner: "Workforce", sync: "COURIER_JOINED_QUEUE", note: "FIFO" },
  { attribute: "trip composition", table: "trip_orders", source_of_truth: "NEW_OPERATIONAL", owner: "Operations", sync: "TRIP_ORDER_ADDED/REMOVED", note: "после DEPARTED неизменяемо" },
  { attribute: "trip assignment", table: "trip_assignments", source_of_truth: "NEW_OPERATIONAL", owner: "Operations", sync: "TRIP_ASSIGNED", note: "" },
  { attribute: "delivery result", table: "delivery_attempts", source_of_truth: "NEW_OPERATIONAL", owner: "Operations", sync: "ORDER_DELIVERED/FAILED", note: "исторически date_delivered" },
  { attribute: "tariff", table: "tariff_versions", source_of_truth: "REFERENCE (FINANCE)", owner: "Finance", sync: "утверждение", note: "BD-008/BD-024" },
  { attribute: "accrual amount", table: "courier_accruals", source_of_truth: "NEW_OPERATIONAL", owner: "Finance", sync: "расчёт после ORDER_DELIVERED", note: "не из sum_paid" },
  { attribute: "accrual adjustment", table: "accrual_adjustments", source_of_truth: "NEW_OPERATIONAL", owner: "Finance", sync: "корректировка", note: "BD-007" },
  { attribute: "mentorship pair", table: "mentorship_assignments", source_of_truth: "NEW_OPERATIONAL", owner: "Mentorship", sync: "MENTORSHIP_ASSIGNED", note: "исторически 5939.mentorid" },
  { attribute: "trainee shift review", table: "mentorship_shift_reviews", source_of_truth: "NEW_OPERATIONAL", owner: "Mentorship", sync: "MENTORSHIP_SHIFT_REVIEWED", note: "шкала не согласована" },
  { attribute: "events journal", table: "domain_events", source_of_truth: "NEW_OPERATIONAL", owner: "Architecture", sync: "append-only", note: "" },
  { attribute: "order amounts", table: "order_amount_snapshots", source_of_truth: "SUPERSET (ANALYTICS)", owner: "Analytics", sync: "периодически", note: "не оплата курьера" },
  { attribute: "event dictionary", table: "—", source_of_truth: "REFERENCE", owner: "Operations", sync: "справочник", note: "для 5247/5399 event_name" },
  { attribute: "status dictionary", table: "—", source_of_truth: "REFERENCE", owner: "Operations", sync: "справочник", note: "BD-014" },
  { attribute: "roles/permissions", table: "—", source_of_truth: "EXTERNAL (AUTH)", owner: "Architecture", sync: "identity provider", note: "BD-019; не создавать пароли" },
];

