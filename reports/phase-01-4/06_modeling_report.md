# Фаза 1.4.6 — Восстановление модели данных

Сгенерировано: 2026-11-21T16:00:12.699Z
Snapshot: `phase-01-4-2026-11-21T15-56-56-676Z`; parser: `phase1-4@1`.

## Физический каталог

- физических таблиц: 436
- всего ссылок dataset→table: 436

Типы колонок и PK/FK/indexes не выдумываются: доступны только те, что даёт SQL/метаданные Superset.

## Логические сущности

| Сущность | Статус | Доказательства (поля) |
|---|---|---|
| order | VERIFIED | 7021.id_order, 7027.id_order, 6836.id_order, 4369.id_order, 6757.id_order, 6831.id_order |
| order_item | UNKNOWN | — |
| delivery | VERIFIED | 6836.id_delivery_job, 6836.id_general, 4369.id_delivery_job, 4369.id_general, 6757.id_delivery_job, 6757.id_general |
| shop | VERIFIED | 7021.id_tt, 7021.shopno, 7027.shopno, 6836.id_tt, 6836.shopno, 1578.ShopNo |
| address | INFERRED | 6836.geo, 4369.geo, 6757.geo, 6831.geo, 4997.geo, 7173.geo |
| courier | VERIFIED | 7027.id_courier, 6836.courier, 6836.id_courier, 1578.id_courier, 4369.courier, 4369.id_courier |
| assignment | INFERRED | 7027.flag_late_first_assignment, 7027.date_pickuped, 7006.date_pickuped, 7089.date_pickuped, 2339.orders_assignment, 7119.date_pickuped |
| route | VERIFIED | 7027.cluster_id, 6836.id_group, 7024.cluster_id, 4369.id_group, 6757.id_group, 6831.id_group |
| shift | INFERRED | 7021.is_night_shift, 7021.shift_type, 5939.enough_shifts_for_mentor, 5939.first_shift_date, 5939.last_shift_date, 5939.shift_rn |
| event | INFERRED | 7027.flag_courier_is_newbie, 7027.flag_courier_shortage, 7027.flag_fact_seq_noteq_plan_by_order, 7027.flag_fact_seq_noteq_plan_for_pool, 7027.flag_is_near_deadline, 7027.flag_late_first_assignment |
| zone | INFERRED | 7465.inactivity_zone, 7465.prev_inactivity_zone, 7465.zone, 7293.zone, 7394.inactivity_zone, 7394.prev_inactivity_zone |
| accrual | UNKNOWN | 6836.sum_paid, 6836.sum_paid_disc, 4369.sum_paid, 4369.sum_paid_disc, 6757.sum_paid_disc, 6757.sum_paid |
| mentorship | INFERRED | 5939.date_for_mentor, 5939.enough_shifts_for_mentor, 5939.mentor_at_date, 5939.mentorfio, 5939.mentorid, 5939.mentorid_at_date |

## Связи

- relationships (dataset-key кандидаты + SQL JOIN): 5717
- JOIN не считается FK; зерно и кардинарность требуют проверки на данных.

## Зерно

- записей в реестре зерна: 3222
- для 12 утверждённых датасетов зерно зафиксировано с доказательствами Phase 1.2; для остальных — INFERRED/UNKNOWN.

## Lineage и ER

- `06_lineage.mmd` — сводная схема dashboard→chart→dataset→SQL→table→column.
- `06_er_model.mmd` — кандидатная ER-модель логических сущностей (статусы подтверждения внутри узлов).
