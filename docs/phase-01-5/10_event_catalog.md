# 10. Каталог событий

Событий: **58**. Обязательные поля конверта: event_id, event_type, aggregate_type, aggregate_id, occurred_at, recorded_at, actor_type, actor_id, source_system, source_event_id, correlation_id, causation_id, idempotency_key, schema_version, payload.

## orders

| Событие | Агрегат | Payload | Идемпотентность | Примечание |
|---|---|---|---|---|
| ORDER_IMPORTED | order | order_id, external_order_id, source_system, shop_id, order_created_at | source_system+external_order_id+ORDER_IMPORTED |  |
| ORDER_ACCEPTED | order | order_id, accepted_at, actor_id | order_id+ORDER_ACCEPTED |  |
| COLLECTION_STARTED | order | order_id, collection_started_at | order_id+COLLECTION_STARTED |  |
| COLLECTION_COMPLETED | order | order_id, collected_at | order_id+COLLECTION_COMPLETED |  |
| ORDER_READY | order | order_id, ready_at, ready_source, ready_actor_type, ready_actor_id | order_id+ORDER_READY+ready_at | Критическое событие; в Superset не подтверждено. Кандидат — 3466.time_ready (BD-013). |
| ORDER_ASSIGNED_TO_TRIP | order | order_id, trip_id, assigned_at, actor_id | order_id+trip_id+ORDER_ASSIGNED_TO_TRIP |  |
| ORDER_REMOVED_FROM_TRIP | order | order_id, trip_id, removed_at, reason, actor_id | order_id+trip_id+removed_at | Разрешено только до TRIP_DEPARTED в обычном процессе |
| ORDER_DELIVERY_STARTED | order | order_id, delivery_started_at, courier_id, trip_id | order_id+ORDER_DELIVERY_STARTED |  |
| ORDER_DELIVERED | order | order_id, delivered_at, courier_id, delivery_attempt_id | delivery_attempt_id+ORDER_DELIVERED | Основание начисления |
| ORDER_CANCELLED | order | order_id, cancelled_at, reason_code | order_id+ORDER_CANCELLED |  |
| ORDER_RETURNED | order | order_id, returned_at, reason_code | order_id+ORDER_RETURNED |  |
| ORDER_STATUS_CORRECTED | order | order_id, from_status, to_status, reason, actor_id | order_id+ORDER_STATUS_CORRECTED+occurred_at |  |

## zones

| Событие | Агрегат | Payload | Идемпотентность | Примечание |
|---|---|---|---|---|
| ZONE_CREATED | delivery_zone | zone_id, shop_id, code, name | zone_id+ZONE_CREATED |  |
| ZONE_BOUNDARY_PROPOSED | delivery_zone | zone_id, version, geometry_ref, author_id | zone_id+version+PROPOSED |  |
| ZONE_BOUNDARY_APPROVED | delivery_zone | zone_id, version, approved_by, approved_at | zone_id+version+APPROVED |  |
| ZONE_ACTIVATED | delivery_zone | zone_id, valid_from | zone_id+ACTIVATED+valid_from |  |
| ZONE_DEACTIVATED | delivery_zone | zone_id, valid_to, reason | zone_id+DEACTIVATED+valid_to |  |
| ZONE_BOUNDARY_CHANGED | delivery_zone | zone_id, version, change_reason, approved_by | zone_id+version+CHANGED |  |

## couriers_shifts

| Событие | Агрегат | Payload | Идемпотентность | Примечание |
|---|---|---|---|---|
| COURIER_REGISTERED | courier | courier_id, source_system, external_id | courier_id+REGISTERED |  |
| COURIER_STATUS_CHANGED | courier | courier_id, from_status, to_status, reason | courier_id+STATUS_CHANGED+occurred_at |  |
| SHIFT_PLANNED | shift | shift_id, courier_id, shop_id, planned_start_at, planned_end_at | shift_id+PLANNED |  |
| SHIFT_STARTED | shift | shift_id, courier_id, shop_id, actual_start_at | shift_id+STARTED |  |
| COURIER_ARRIVED_AT_SHOP | shift | shift_id, courier_id, shop_id, arrived_at | shift_id+ARRIVED |  |
| COURIER_JOINED_QUEUE | queue_entry | queue_entry_id, courier_id, shop_id, shift_id, queue_sequence | queue_entry_id+JOINED |  |
| COURIER_SKIPPED_IN_QUEUE | queue_entry | queue_entry_id, skipped_at, skip_reason | queue_entry_id+SKIPPED+skipped_at |  |
| COURIER_QUEUE_PAUSED | queue_entry | queue_entry_id, paused_at, reason | queue_entry_id+PAUSED |  |
| COURIER_QUEUE_RESUMED | queue_entry | queue_entry_id, resumed_at | queue_entry_id+RESUMED |  |
| BREAK_STARTED | shift | shift_id, courier_id, break_started_at | shift_id+BREAK_STARTED+break_started_at |  |
| BREAK_ENDED | shift | shift_id, courier_id, break_ended_at | shift_id+BREAK_ENDED+break_ended_at |  |
| COURIER_RETURNED_TO_SHOP | shift | shift_id, courier_id, returned_at | shift_id+RETURNED+returned_at |  |
| SHIFT_ENDED | shift | shift_id, courier_id, actual_end_at | shift_id+ENDED |  |
| NO_SHOW_RECORDED | shift | shift_id, courier_id, recorded_at, reason | shift_id+NO_SHOW | Косвенно подтверждается 5939.progul |
| COURIER_BLOCKED | courier | courier_id, blocked_at, reason | courier_id+BLOCKED+blocked_at |  |
| COURIER_UNBLOCKED | courier | courier_id, unblocked_at | courier_id+UNBLOCKED+unblocked_at |  |

## trips_assignments

| Событие | Агрегат | Payload | Идемпотентность | Примечание |
|---|---|---|---|---|
| TRIP_FORMED | trip | trip_id, shop_id, zone_id, formed_at, order_ids | trip_id+FORMED |  |
| TRIP_ORDER_ADDED | trip | trip_id, order_id, sequence_no, added_by | trip_id+order_id+ADDED |  |
| TRIP_ORDER_REMOVED | trip | trip_id, order_id, removed_by, reason | trip_id+order_id+REMOVED+occurred_at |  |
| TRIP_ASSIGNED | trip | trip_id, courier_id, queue_entry_id, assigned_at, assigned_by | trip_id+ASSIGNED |  |
| TRIP_ASSIGNMENT_CANCELLED | trip | trip_id, courier_id, cancelled_at, cancel_reason, actor_id | trip_id+ASSIGNMENT_CANCELLED+occurred_at |  |
| TRIP_DEPARTED | trip | trip_id, departed_at | trip_id+DEPARTED |  |
| TRIP_RETURNED | trip | trip_id, returned_at | trip_id+RETURNED |  |
| TRIP_COMPLETED | trip | trip_id, completed_at | trip_id+COMPLETED |  |
| TRIP_CANCELLED | trip | trip_id, cancelled_at, reason | trip_id+CANCELLED |  |
| TRIP_EXCEPTION_RECORDED | trip | trip_id, exception_type, reason, actor_id | trip_id+EXCEPTION+occurred_at |  |

## finance

| Событие | Агрегат | Payload | Идемпотентность | Примечание |
|---|---|---|---|---|
| TARIFF_DRAFTED | tariff | tariff_version_id, name, base_amount, currency, author_id | tariff_version_id+DRAFTED |  |
| TARIFF_APPROVED | tariff | tariff_version_id, approved_by, approved_at | tariff_version_id+APPROVED |  |
| TARIFF_ACTIVATED | tariff | tariff_version_id, effective_from | tariff_version_id+ACTIVATED+effective_from |  |
| COURIER_ACCRUAL_CREATED | accrual | accrual_id, courier_id, order_id, delivery_attempt_id, tariff_version_id, amount, currency, earned_at | delivery_attempt_id+ACCRUAL_CREATED | Создаётся после подтверждённого ORDER_DELIVERED, не от суммы заказа |
| COURIER_ACCRUAL_APPROVED | accrual | accrual_id, approved_by, approved_at | accrual_id+APPROVED |  |
| COURIER_ACCRUAL_REVERSED | accrual | accrual_id, reversed_at, reason, actor_id | accrual_id+REVERSED+occurred_at |  |
| COURIER_ACCRUAL_PAID | accrual | accrual_id, paid_at, payment_ref | accrual_id+PAID |  |
| ACCRUAL_ADJUSTED | accrual | accrual_id, adjustment_id, adjustment_type, amount_delta, reason, approved_by | adjustment_id+ADJUSTED |  |

## mentorship

| Событие | Агрегат | Payload | Идемпотентность | Примечание |
|---|---|---|---|---|
| MENTORSHIP_ASSIGNED | mentorship | mentorship_id, mentor_courier_id, trainee_courier_id, starts_at, planned_ends_at, assigned_by | mentorship_id+ASSIGNED |  |
| MENTORSHIP_STARTED | mentorship | mentorship_id, started_at | mentorship_id+STARTED |  |
| MENTORSHIP_SHIFT_REVIEWED | mentorship | mentorship_id, shift_id, shift_number, delivery_quality_score, rules_compliance_score, reviewed_by | mentorship_id+shift_id+REVIEWED |  |
| MENTORSHIP_COMPLETED | mentorship | mentorship_id, completed_at, confirmed_by | mentorship_id+COMPLETED |  |
| MENTORSHIP_EXTENDED | mentorship | mentorship_id, new_planned_ends_at, reason, actor_id | mentorship_id+EXTENDED+new_planned_ends_at |  |
| MENTORSHIP_CANCELLED | mentorship | mentorship_id, cancelled_at, reason, actor_id | mentorship_id+CANCELLED |  |

## Правила

- Append-only; повторная доставка не повторяет бизнес-эффект (idempotency_key).
- `occurred_at` ≠ `recorded_at`; поздние события сохраняют оба времени.
- Ошибки не удаляются — компенсирующее событие.
- Payload валидируется JSON Schema; версия схемы обязательна.
