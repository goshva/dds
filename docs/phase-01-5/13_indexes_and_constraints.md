# 13. Индексы и ограничения

## Уникальности

| Таблица | ***REMOVED*** | Тип |
|---|---|---|
| shops | code | UNIQUE (колонка) |
| shops | code | UNIQUE (составной) |
| delivery_zones | code | UNIQUE (колонка) |
| delivery_zones | code | UNIQUE (составной) |
| zone_boundary_versions | zone_id, version | UNIQUE (составной) |
| orders | source_system, external_order_id | UNIQUE (составной) |
| order_readiness | order_id, attempt_no | UNIQUE (составной) |
| courier_queue_entries | shop_id, queue_sequence | UNIQUE (составной) |
| trip_orders | trip_id, sequence_no | UNIQUE (составной) |
| delivery_attempts | order_id, attempt_no | UNIQUE (составной) |
| courier_events | idempotency_key | UNIQUE (составной) |
| domain_events | idempotency_key | UNIQUE (составной) |
| courier_accruals | delivery_attempt_id | UNIQUE (составной) |
| mentorship_shift_reviews | mentorship_assignment_id, shift_id | UNIQUE (составной) |

## Индексы

| Таблица | Колонки | Назначение |
|---|---|---|
| shops | status | поиск/фильтрация |
| addresses | normalized_hash | поиск/фильтрация |
| addresses | latitude, longitude | поиск/фильтрация |
| couriers | operational_status | поиск/фильтрация |
| couriers | is_blocked | поиск/фильтрация |
| couriers | external_hr_id | поиск/фильтрация |
| courier_external_ids | courier_id | поиск/фильтрация |
| courier_external_ids | source_system, external_id | поиск/фильтрация |
| delivery_zones | shop_id | поиск/фильтрация |
| delivery_zones | status | поиск/фильтрация |
| orders | shop_id | поиск/фильтрация |
| orders | order_status | поиск/фильтрация |
| orders | order_created_at | поиск/фильтрация |
| orders | delivery_address_id | поиск/фильтрация |
| order_amount_snapshots | order_id | поиск/фильтрация |
| order_amount_snapshots | order_id, amount_type, captured_at | поиск/фильтрация |
| order_status_history | order_id, changed_at | поиск/фильтрация |
| order_status_history | source_event_id | поиск/фильтрация |
| order_readiness | ready_at | поиск/фильтрация |
| work_slots | shop_id, starts_at | поиск/фильтрация |
| courier_shifts | courier_id, actual_start_at | поиск/фильтрация |
| courier_shifts | shop_id | поиск/фильтрация |
| courier_shifts | shift_status | поиск/фильтрация |
| courier_shifts | external_shift_id | поиск/фильтрация |
| courier_queue_entries | courier_id, queue_status | поиск/фильтрация |
| courier_queue_entries | shift_id | поиск/фильтрация |
| trips | shop_id, trip_status | поиск/фильтрация |
| trips | zone_id | поиск/фильтрация |
| trips | courier_id | поиск/фильтрация |
| trips | departed_at | поиск/фильтрация |
| trip_orders | order_id | поиск/фильтрация |
| trip_orders | trip_id | поиск/фильтрация |
| trip_order_membership_history | trip_id, acted_at | поиск/фильтрация |
| trip_order_membership_history | order_id | поиск/фильтрация |
| trip_assignments | trip_id, assignment_status | поиск/фильтрация |
| trip_assignments | courier_id, assigned_at | поиск/фильтрация |
| delivery_attempts | courier_id, started_at | поиск/фильтрация |
| delivery_attempts | trip_id | поиск/фильтрация |
| courier_events | courier_id, occurred_at | поиск/фильтрация |
| courier_events | event_type | поиск/фильтрация |
| domain_events | aggregate_type, aggregate_id, occurred_at | поиск/фильтрация |
| domain_events | event_type | поиск/фильтрация |
| domain_events | correlation_id | поиск/фильтрация |
| tariff_versions | zone_id, effective_from | поиск/фильтрация |
| tariff_versions | status | поиск/фильтрация |
| courier_accruals | courier_id, earned_at | поиск/фильтрация |
| courier_accruals | accrual_status | поиск/фильтрация |
| accrual_adjustments | accrual_id | поиск/фильтрация |
| mentorship_assignments | trainee_courier_id, status | поиск/фильтрация |
| mentorship_assignments | mentor_courier_id | поиск/фильтрация |

## Частичные уникальные индексы (PostgreSQL)

- `trip_orders (order_id) WHERE removed_at IS NULL` — один активный состав на заказ.
- `trip_assignments (trip_id) WHERE assignment_status IN ('PROPOSED','ACCEPTED','DEPARTED')` — одно активное назначение.
- `courier_queue_entries (shift_id) WHERE queue_status IN ('WAITING','OFFERED','PAUSED')` — один активный вход в очередь.
- `mentorship_assignments (trainee_courier_id) WHERE status = 'ACTIVE'` — одно активное наставничество.

При отсутствии поддержки частичных индексов (SQLite) — транзакционная проверка.
