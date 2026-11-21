# KPI Source Matrix — 18 показателей операционной модели

Сгенерировано: 2026-11-21T06:01:32.153Z

Источник: полные detail JSON 12 приоритетных датасетов (`output/dataset_details/*.json`).

## Статусы

| Статус | Кол-во |
|---|---:|
| FOUND | 9 |
| PARTIAL | 4 |
| NOT_FOUND | 1 |
| NOT_VERIFIED | 4 |

## Матрица

| # | KPI | Статус | Подтверждённые датасеты | Поля/метрики | Формула/примечание |
|---:|---|---|---|---|---|
| 1 | Объём заказов | FOUND | 4732 darkstore_ts_partners_new; 7006 cargo_main2; 7024 cargo_main3; 7027 cargo_main4 | id_order, id_general, order_status, gettype, qty_orders_all, qty_orders_delivered, qty_orders_declined, id_order, id_pool, gettype, id_pool, gettype, id_order, id_pool, gettype | COUNT(id_order) / COUNT(DISTINCT id_order); группировка по order_status, gettype. |
| 2 | Просрочка заказов (SLA) | FOUND | 4732 darkstore_ts_partners_new; 7006 cargo_main2; 7027 cargo_main4; 7119 cargo_flags | sla_order_time, sla_collection_time_all, sla_delivery_time_all, date_supply_untill, date_status_10, is_late, minutes_late, plan_late_minute, planned_late, sla_order_time, date_supply_until, is_late, fact_minutes_late, plan_late_minute, planned_late, sla_order_time, date_supply_until, is_late | AVG(is_late); AVG(minutes_late); сравнение date_delivered/date_supply_until. |
| 3 | Время доставки | FOUND | 4732 darkstore_ts_partners_new; 7006 cargo_main2; 7024 cargo_main3; 7027 cargo_main4 | date_delivery_start, date_delivered, delivery_time, delivery_time_all, duration_fact, duration_plan, date_pickuped, date_delivered, fact_duration_min, plan_duration_min, date_delivered, fact_duration_min, plan_duration_min, date_pickuped, date_delivered | date_delivered - date_delivery_start; duration_fact; delivery_time. |
| 4 | Время сборки заказа | FOUND | 4732 darkstore_ts_partners_new; 7006 cargo_main2; 7027 cargo_main4 | date_collect_start, date_collected, date_printed, collection_time, collection_time_all, date_collect_start_plan, date_collected_plan, date_collected, date_collected | date_collected - date_collect_start; collection_time. |
| 5 | Суммы заказов (GMV/paid) | FOUND | 4732 darkstore_ts_partners_new | sum_order, sum_paid, sum_paid_disc, sum_paid_sheet, sum_without_bonuses, avg_sum | SUM(sum_order); SUM(sum_paid); SUM(sum_paid_disc). |
| 6 | Маршрутизация: расстояние/время между точками | FOUND | 7006 cargo_main2; 7024 cargo_main3; 7027 cargo_main4 | duration_fact, duration_plan, pickup_minute, pickup_to_courier_minute, arrival_time, plan_arrival_deadline, cluster_id, id_pool, plan_seq, fact_seq, distance, delta_pct, fact_duration_min, plan_duration_min, cluster_id, id_pool, total_pool_distance, fact_duration_min | SUM(distance); SUM(duration_fact); сравнение plan_seq/fact_seq. |
| 7 | Численность / активная база курьеров | FOUND | 7775 all_couriers_list; 5797 hr_couriers; 7465 hr_couriers_5shifts; 7473 hr_couriers_five_shifts | ID, id_courier_type, job_type, Активный, Бан, Тип занятости, Тип курьера, id_courier, active, is_banned, is_blocked, job_type_name, region_name, id_courier, active, is_banned, is_blocked, job_type_name | COUNT(DISTINCT id_courier); фильтры active, is_banned, job_type. |
| 8 | Продуктивность курьера (заказы/дни со сменами) | FOUND | 5797 hr_couriers; 7465 hr_couriers_5shifts; 7473 hr_couriers_five_shifts | cnt_orders, orders_after_hire, days_with_orders, enough_shifts_flg, first_order_date, last_order_date, cnt_orders, enough_shifts_flg, first_order_date, last_order_date, last_order_date, fifth_shift_date, shifts_in_14_days | SUM(cnt_orders); AVG(days_with_orders); доля enough_shifts_flg. |
| 9 | Смены (фактические выходы) | PARTIAL | 7473 hr_couriers_five_shifts; 5797 hr_couriers; 7465 hr_couriers_5shifts | shift_1, shift_2, shift_3, shift_4, shift_5, shifts_in_14_days, fifth_shift_date, fifth_shift_status, days_to_fifth_shift, had_enough_time, shifts_in_first_14d, 5_shifts_in_14d, is_5_shifts_in_14d, has_5_shifts_in_first_14d, enough_shifts_flg, shifts_in_first_14d, 5_shifts_in_14d, is_5_shifts_in_14d | COUNT(shift_*); SUM(shift_*_work_minutes); shifts_in_14_days. |
| 10 | Явка на смену | NOT_VERIFIED | 5247 courier_logs_agg_couriers_daily; 5399 courier_logs_agg_couriers_week | event_name, events_qty, courier_id, d, dey, week_no, event_name, events_qty, courier_id, d, dey, week_no | Не подтверждена; events_qty не является явкой без семантики событий. |
| 11 | Невыходы | NOT_FOUND | 5797 hr_couriers | no_orders_days_streak, pause_days | Не найдено подтверждённого поля невыхода. |
| 12 | 12-часовые смены | PARTIAL | 7473 hr_couriers_five_shifts | shift_1_work_minutes, shift_2_work_minutes, shift_3_work_minutes, shift_4_work_minutes, shift_5_work_minutes | shift_*_work_minutes >= 720; группировка по сменам. |
| 13 | Ходки | NOT_VERIFIED | 7006 cargo_main2; 7027 cargo_main4 | id_pool, id_courier, fact_seq, plan_seq, id_pool, id_courier, fact_seq, plan_seq | Кандидат: COUNT(DISTINCT id_pool) по курьеру; семантика ходки не подтверждена. |
| 14 | Заказы в ходке | NOT_VERIFIED | 7006 cargo_main2; 7027 cargo_main4 | id_order, id_pool, pool_size, fact_seq, id_order, id_pool, pool_size, fact_seq | COUNT(id_order) / COUNT(DISTINCT id_pool); семантика ходки не подтверждена. |
| 15 | Доступный пул заказов | NOT_VERIFIED | 7006 cargo_main2; 7024 cargo_main3; 7027 cargo_main4; 7119 cargo_flags | pool_size, pool_size_text, id_pool, pool_size, id_pool, pool_size, late_orders_cnt_in_pool, max_fact_late_in_pool, sum_fact_late_minutes_in_pool, flag_courier_shortage, id_pool, pool_size, late_orders_cnt_in_pool, max_fact_late_in_pool, sum_fact_late_minutes_in_pool, flag_courier_shortage, id_pool | pool_size; late_orders_cnt_in_pool; flag_courier_shortage. |
| 16 | Простои | PARTIAL | 4732 darkstore_ts_partners_new; 7006 cargo_main2; 7027 cargo_main4 | wait_time, wait_time2, waiting_area_time, collection_time, delivery_time, pickup_minute, pickup_to_courier_minute, duration_plan, duration_fact, minutes_late, flag_wait_orders_with_planlate | wait_time; pickup_minute; pickup_to_courier_minute; flag_wait_orders_with_planlate. |
| 17 | Доход курьера в час | PARTIAL | 7473 hr_couriers_five_shifts | shift_1_profit, shift_2_profit, shift_3_profit, shift_4_profit, shift_5_profit, shift_1_work_minutes, shift_2_work_minutes, shift_3_work_minutes, shift_4_work_minutes, shift_5_work_minutes, thresholds_taken_payments | shift_*_profit / (shift_*_work_minutes / 60). |
| 18 | Удержание курьеров | FOUND | 5797 hr_couriers; 7465 hr_couriers_5shifts; 7473 hr_couriers_five_shifts; 7293 hr_couriers_zone_balance | uvol, date_dismissed, event_hiring, second_hire, repeated_hire, active, enough_shifts_flg, first_order_date, last_order_date, pause_days, no_orders_days_streak, inactivity_zone, zone_changed, zone_transition_type, turnover, attrition, ret_14_d, returns | turnover; attrition; ret_14_d; returns; second_hire; balance_*. |

## Ограничения

- Evidence и статусы KPI основаны на 12 приоритетных dataset details; полный каталог (3 776) используется только для контекстного скана SQL.
- Статус FOUND означает наличие подтверждённых полей/метрик, а не согласованную бизнес-формулу.
- sum_order/sum_paid — суммы заказа, а не доход курьера.
- events_qty — события, а не явка; семантика event_name не подтверждена.
- Модель смен ограничена первыми 5 сменами новичка и 14-дневным окном.
- Ходки и доступный пул заказов не подтверждены как бизнес-сущности.
- PII-поля перечислены как имена; их значения не выгружаются.

## PII

PII-поля присутствуют в 4732, 5797, 7465, 7473, 7775; в отчётах используются только имена полей.

## Полный каталог (контекст)

- datasets_total: 3776
- datasets_with_sql: 3220
- priority_present: 12/12
- priority_missing: нет
- sql_length_mismatches: нет

Кандидаты по SQL полного каталога (контекст; статусы не повышаются):

| KPI | candidate_datasets |
|---|---:|
| Объём заказов | 502 |
| Просрочка заказов (SLA) | 152 |
| Время доставки | 192 |
| Время сборки заказа | 230 |
| Суммы заказов (GMV/paid) | 77 |
| Маршрутизация: расстояние/время между точками | 56 |
| Численность / активная база курьеров | 701 |
| Продуктивность курьера (заказы/дни со сменами) | 44 |
| Смены (фактические выходы) | 9 |
| Явка на смену | 431 |
| Невыходы | 23 |
| 12-часовые смены | 1 |
| Ходки | 222 |
| Заказы в ходке | 449 |
| Доступный пул заказов | 49 |
| Простои | 79 |
| Доход курьера в час | 1 |
| Удержание курьеров | 1252 |

## Проблемы верификации полей

Все заявленные поля найдены в detail JSON.
