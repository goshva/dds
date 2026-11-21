# Аудит SQL 12 утверждённых датасетов — Этап 1.2

Сгенерировано: 2026-11-21T11:54:53.704Z

Утверждённые датасеты: 4732, 5247, 5399, 5797, 7006, 7024, 7027, 7119, 7293, 7465, 7473, 7775.
Отсутствуют detail JSON: нет.
Лишние detail JSON (вне утверждённого набора): нет.

***REMOVED***: наличие поля — не доказательство бизнес-смысла. Статусы: VERIFIED / PROBABLE / UNKNOWN.

## 4732 · darkstore_ts_partners_new

- База/Schema/Kind: `ch_10.0.15.240/default` / `default` / virtual
- SQL: 4897 символов; columns=127, metrics=22, calculated_columns=0
- CTE (0): нет
- Источники: default.darkstore_time_sheet (table); default.services_sla (table, LEFT JOIN); mart.org_unit_actual (table, LEFT JOIN)
- JOIN: 2; WHERE: 1; GROUP BY: 0; оконных выражений: 0; UNION: 0

**Назначение (ВЫВОД):** ***REMOVED***ы и подзаказы darkstore/партнёров: статусы, временные этапы сборки/доставки, суммы заказа, SLA, курьер, пул, ТТ, направление.

**Grain (ГИПОТЕЗА/ВЫВОД):** 1 строка = заказ/подзаказ (id_order); id_general группирует подзаказы, для заказа использовать COALESCE(id_general, id_order).

**Временные поля:**

| Поле | Роль | Статус | Доказательство |
|---|---|---|---|
| date_order | timestamp | VERIFIED | age('minute', date_order, date_status_10); DATEADD(MINUTE,-60,date_supply) в метриках |
| date_supply | deadline | PROBABLE | сравнивается с date_order/date_status_10 как плановое время поставки |
| date_supply_untill | deadline | PROBABLE | сравнение date_status_10/date_delivered > date_supply_untill в метрике qty_not_in_slot_above_all |
| date_delivered | timestamp | VERIFIED | используется в расчётах длительности/просрочки, order_status='Успешно завершен' |
| date_delivery_start | timestamp | PROBABLE | парная метка к date_delivered для delivery_time |
| date_collect_start | timestamp | PROBABLE | старт сборки; collection_time = разница |
| date_collected | timestamp | PROBABLE | завершение сборки по контексту collection_time |
| date_status_10 | timestamp | PROBABLE | используется в age() как контрольная метка статуса 10 |
| date_printed | timestamp | UNKNOWN | в SQL только выбор поля, семантика не подтверждена |
| date_f_status_3_5 | timestamp | UNKNOWN | в SQL только выбор поля |
| date_set_cell | timestamp | UNKNOWN | в SQL только выбор поля |
| date_check_closed | timestamp | UNKNOWN | в SQL только выбор поля |
| date_status | timestamp | UNKNOWN | в SQL только выбор поля |
| date_collected_plan | deadline | PROBABLE | плановая метка сборки (суффикс _plan) |
| date_collect_start_plan | deadline | PROBABLE | плановая метка старта сборки |
| collection_time_all | duration | PROBABLE | сравнивается со sla_collection_time_all |
| delivery_time_all | duration | PROBABLE | длительность доставки |
| collection_time_real_sec | duration | PROBABLE | суффикс _sec, секунды |
| wait_time | duration | PROBABLE | ожидание; единицы не подтверждены |
| wait_time2 | duration | PROBABLE | ожидание; единицы не подтверждены |
| waiting_area_time | duration | UNKNOWN | только выбор поля |
| order_time | unknown | UNKNOWN | не отличить timestamp от duration без источника |
| pay_time | unknown | UNKNOWN | только выбор поля |
| set_cell_time | unknown | UNKNOWN | только выбор поля |

**Ключи:**

| Поле | Сущность | Тип | Статус | Доказательство |
|---|---|---|---|---|
| id_order | order | integer | VERIFIED | основной ключ заказа в метриках |
| id_general | order_group | integer | PROBABLE | COALESCE(id_general, id_order) в метриках |
| id_delivery_job | delivery_job | integer | PROBABLE | выбран в SELECT |
| id_courier | courier | integer | PROBABLE | выбран; связь с HR/логами по id_courier |
| courier | courier | string | UNKNOWN | имя/логин курьера, не число |
| shopno | shop | integer | VERIFIED | используется в фильтрах и dict-join |
| id_tt | shop | integer | PROBABLE | id_tt IS NOT NULL в WHERE |
| id_pool | pool | integer | PROBABLE | выбран; пул заказов |
| id_group | cluster | integer | UNKNOWN | только выбор поля |
| id_service | service | integer | VERIFIED | join к services_sla |
| id_sbor | assembly | integer | UNKNOWN | только выбор поля |
| id_partner | partner | integer | PROBABLE | id_partner_type/partner_type используются в метриках |

**Риски:**

- Дубли полей-суффиксов _sheet (date_supply_sheet vs date_supply, date_collected_sheet vs date_collected) — высокий риск выбрать неверный источник.
- Единицы *_time (wait_time, collection_time, delivery_time) не подтверждены: секунды/минуты.
- date_status_10 как «сборка завершена» не подтверждён — только эвристика по age().
- Ключ заказа: id_order/подзаказы и id_general — без правила агрегации возможен двойной счёт.
- sum_order/sum_paid — суммы заказа, НЕ доход курьера.
- Часовой пояс ClickHouse DateTime в SQL явно не задан.
- area_tt — территория ТТ, не зона доставки; зона кластера доступна через mart.org_unit_actual.zone_cluster ("Куст").

**Заметки:**

- WHERE: shopno NOT IN (99888), id_tt IS NOT NULL, опциональный фильтр partner.
- SLA-поля приходят из default.services_sla (sla_collection_time_all, sla_delivery_time_all, sla_order_time, is_express).
- Метрики: qty_orders_all/delivered/declined, share_qty_declined, avg_sum, sum_without_bonuses, qty_not_in_slot_above_all.

## 5247 · courier_logs_agg_couriers_daily

- База/Schema/Kind: `gp_10.0.112.100/dwh` / `agile_mart_techaudit` / virtual
- SQL: 2378 символов; columns=15, metrics=2, calculated_columns=0
- CTE (2): a, week_stats
- Источники: agile_mart_techaudit.courier_events_logs_aggr (table); a (cte); week_stats (cte, JOIN)
- JOIN: 1; WHERE: 0; GROUP BY: 0; оконных выражений: 1; UNION: 0

**Назначение (ВЫВОД):** Агрегированные события курьера по дням (event_name, events_qty) по ТТ/направлению.

**Grain (ГИПОТЕЗА/ВЫВОД):** 1 строка = (week_no, d, Направление, City_tt, shopno, id_tt, name_TT, isDark, event_name, dey, courier_id).

**Временные поля:**

| Поле | Роль | Статус | Доказательство |
|---|---|---|---|
| d | date | VERIFIED | date_trunc('day', d), фильтры d >= NOW() - INTERVAL '7 DAY' |
| week_no | date | PROBABLE | группировка и HAVING COUNT(DISTINCT date_trunc('day', d)) = 7 |
| dey | unknown | UNKNOWN | группировка и фильтр, семантика не подтверждена |

**Ключи:**

| Поле | Сущность | Тип | Статус | Доказательство |
|---|---|---|---|---|
| courier_id | courier | unknown | PROBABLE | группировка, window partition |
| shopno | shop | integer | PROBABLE | фильтр и группировка |
| id_tt | shop | integer | PROBABLE | группировка |
| event_name | event_type | string | PROBABLE | группировка и фильтр; словарь значений отсутствует |

**Риски:**

- events_qty — количество событий, НЕ явка и НЕ смена.
- Семантика event_name не подтверждена: нет справочника событий.
- dey — неизвестное измерение.
- Исключены shopno 10006, 10018, 98715, 99888, 8015, 999 (искажение по этим ТТ).
- Нет прямого ключа заказа/смены.

**Заметки:**

- CTE: a (агрегация событий), week_stats (max_day, days_count).
- Метрики: events_qty = SUM(events_qty); events_daily_otkl_rate.

## 5399 · courier_logs_agg_couriers_week

- База/Schema/Kind: `gp_10.0.112.100/dwh` / `agile_mart_techaudit` / virtual
- SQL: 2889 символов; columns=15, metrics=5, calculated_columns=0
- CTE (3): valid_weeks, a, week_stats
- Источники: agile_mart_techaudit.courier_events_logs_aggr (table); valid_weeks (cte); a (cte); week_stats (cte, JOIN)
- JOIN: 1; WHERE: 0; GROUP BY: 0; оконных выражений: 1; UNION: 0

**Назначение (ВЫВОД):** Агрегированные события курьера по неделям; неделя засчитывается только при наличии 7 дней.

**Grain (ГИПОТЕЗА/ВЫВОД):** 1 строка = (week_no, d, Направление, City_tt, shopno, id_tt, name_TT, isDark, event_name, dey, courier_id).

**Временные поля:**

| Поле | Роль | Статус | Доказательство |
|---|---|---|---|
| d | date | VERIFIED | date_trunc('week', d), фильтр d |
| week_no | date | VERIFIED | valid_weeks: HAVING COUNT(DISTINCT date_trunc('day', d)) = 7 |
| dey | unknown | UNKNOWN | группировка и фильтр |

**Ключи:**

| Поле | Сущность | Тип | Статус | Доказательство |
|---|---|---|---|---|
| courier_id | courier | unknown | PROBABLE | группировка, window partition |
| shopno | shop | integer | PROBABLE | фильтр и группировка |
| event_name | event_type | string | PROBABLE | группировка; словарь отсутствует |

**Риски:**

- valid_weeks требует ровно 7 дней: неполные недели отбрасываются (потеря данных на границах).
- Метрики events_daily_otkl_rate / _abs ссылаются на max_day_event_qty, sum_events_qty_all_days, count_distinct_day_no — этих колонок в 5399 нет (см. dataset_metrics_inventory.csv, metric_references_missing_columns).
- events_qty — события, не явка.
- dey — неизвестное измерение.

**Заметки:**

- CTE: valid_weeks, a, week_stats.
- Колонки недельные: max_week_event_qty, count_distinct_week_no, sum_events_qty_all_weeks.

## 5797 · hr_couriers

- База/Schema/Kind: `ch_10.0.15.240/default` / `agile_mart_techaudit` / virtual
- SQL: 2246 символов; columns=65, metrics=38, calculated_columns=0
- CTE (0): нет
- Источники: agile_mart_techaudit.hr_delivery (table); dictionaries.dict_tt (table, LEFT JOIN)
- JOIN: 1; WHERE: 1; GROUP BY: 0; оконных выражений: 5; UNION: 0

**Назначение (ВЫВОД):** HR-контур курьеров: активность, найм/увольнение, стаж, продуктивность, зоны, удержание.

**Grain (ГИПОТЕЗА/ВЫВОД):** 1 строка = (id_courier, date) — дневной HR-срез с оконными агрегатами по курьеру и event_date.

**Временные поля:**

| Поле | Роль | Статус | Доказательство |
|---|---|---|---|
| date | date | VERIFIED | WHERE date < today(); окна PARTITION BY id_courier ORDER BY date |
| event_date | date | PROBABLE | дата кадрового события, окна PARTITION BY id_courier, event_date |
| event_hiring | date | PROBABLE | дата найма по названию и HR-контексту |
| date_dismissed | date | PROBABLE | используется в dateDiff('month', event_date, least(coalesce(date_dismissed, today()), date)) |
| first_order_date | date | PROBABLE | первый заказ; используется в метриках новичков |
| last_order_date | date | PROBABLE | последний заказ; выбран |

**Ключи:**

| Поле | Сущность | Тип | Статус | Доказательство |
|---|---|---|---|---|
| id_courier | courier | integer | VERIFIED | окна PARTITION BY id_courier, метрики qty/cnt_new_couriers |
| shopno | shop | integer | VERIFIED | join к dict_tt по shopno |
| event_date | hr_event | date | PROBABLE | часть ключа окна |

**Риски:**

- PII: fio, phone, inn — значения не выгружать.
- active — строка 'Да'/'Нет', не boolean.
- pause_days = pause_days + 30 - 1 — бизнес-правило заказчика, не сырое поле.
- date < today(): сегодняшний день исключён.
- Часть метрик содержит Jinja time_grain (P1M), т.е. зависит от периода в Superset.
- Нет подтверждённой модели смен: enough_shifts_flg/shifts_in_first_14d — только первые 14 дней.

**Заметки:**

- Оконные функции: orders_after_hire, orders_before_dism_total, orders_before_dism, days_with_orders, enough_shifts_flg.
- ***REMOVED***: inactivity_zone, prev_inactivity_zone, zone_changed, zone_transition_type.

## 7006 · cargo_main2

- База/Schema/Kind: `gp_10.0.112.100/dwh` / `logs_mart` / virtual
- SQL: 8891 символов; columns=44, metrics=1, calculated_columns=0
- CTE (14): rr, rr_latest, job_cte, job_ranz_by_date, job_res, base, ordered, with_breaks, pooled, numbered, pool_calc_cte, base_with_pool_calc, pool_size_cte, res
- Источники: sandbox.ab_logs_mart_routing_results_v1 (table); rr (cte); ods.v_delivery_job_lines (table); job_cte (cte); job_ranz_by_date (cte); (subquery) (subquery); mart_mixed.darkstore_time (table); rr_latest (cte, INNER JOIN); job_res (cte, LEFT JOIN); base (cte); ordered (cte); with_breaks (cte); pooled (cte); numbered (cte); pool_calc_cte (cte, LEFT JOIN); base_with_pool_calc (cte); pool_size_cte (cte, LEFT JOIN)
- JOIN: 4; WHERE: 0; GROUP BY: 0; оконных выражений: 13; UNION: 0

**Назначение (ВЫВОД):** Логистика cargo_main2: план/факт маршрута, пулы, просрочки, последовательность доставки.

**Grain (ГИПОТЕЗА/ВЫВОД):** 1 строка = заказ (id_order) в успешной курьерской доставке, с атрибутами пула (id_pool_calc).

**Временные поля:**

| Поле | Роль | Статус | Доказательство |
|---|---|---|---|
| calculation_time | timestamp | PROBABLE | r.calculation_time + interval '3 hour' — явный сдвиг TZ |
| arrival_time | timestamp | PROBABLE | план прибытия; сравнение с date_supply_until |
| date_pickuped | timestamp | PROBABLE | факт получения курьером; job_cte |
| date_collected | timestamp | PROBABLE | сборка; pickup_to_courier_minute |
| date_delivered | timestamp | VERIFIED | факт вручения; duration_fact, is_late, фильтр >= now() - 3 months |
| date_supply_until | deadline | PROBABLE | is_late, minutes_late, plan_arrival_deadline |
| prev_date_pickuped | timestamp | PROBABLE | lag(date_pickuped) по пулу |

**Ключи:**

| Поле | Сущность | Тип | Статус | Доказательство |
|---|---|---|---|---|
| id_order | order | integer | VERIFIED | join rr.parcel_id = dt.id_order |
| id_courier | courier | integer | VERIFIED | join rr.courier_id = dt.id_courier |
| id_pool | pool | integer | PROBABLE | ROW_NUMBER() OVER (PARTITION BY id_pool) |
| id_pool_calc | pool_computed | integer | PROBABLE | вычисляется DENSE_RANK по разрывам pickup |
| shopno | shop | integer | PROBABLE | выбран |
| cluster_id | cluster | integer | PROBABLE | из routing_results |

**Риски:**

- calculation_time сдвинут на +3 часа — TZ-риск, нельзя смешивать с другими источниками без нормализации.
- Фильтры: status_name='Успешно завершен', delivery_type_group='Курьеры', id_service NOT IN (3,50,62,86), окно 3 месяца — только успешные курьерские доставки.
- id_pool_calc — вычисляемый пул (разрывы pickup), не равен исходному id_pool.
- id_general = id_order в WHERE — отсекает часть заказов.
- duration_fact/duration_plan в минутах, но plan берётся из duration_from_previous/60 (round).
- pool_size > 6 объединён в '7+'.

**Заметки:**

- CTE: rr, rr_latest, job_cte, job_ranz_by_date, job_res, base, ordered, with_breaks, pooled, numbered, pool_calc_cte, base_with_pool_calc, pool_size_cte, res.

## 7024 · cargo_main3

- База/Schema/Kind: `gp_10.0.112.100/dwh` / `logs_mart` / virtual
- SQL: 5819 символов; columns=11, metrics=1, calculated_columns=0
- CTE (15): rr, rr_latest, job_cte, job_ranz_by_date, job_res, base, ordered, with_breaks, pooled, numbered, pool_calc_cte, base_with_pool_calc, pool_size_cte, res, agg_pool
- Источники: sandbox.ab_logs_mart_routing_results_v1 (table); rr (cte); ods.v_delivery_job_lines (table); job_cte (cte); job_ranz_by_date (cte); mart_mixed.darkstore_time (table); rr_latest (cte, INNER JOIN); job_res (cte, LEFT JOIN); base (cte); ordered (cte); with_breaks (cte); pooled (cte); numbered (cte); pool_calc_cte (cte, LEFT JOIN); base_with_pool_calc (cte); (subquery) (subquery); pool_size_cte (cte, LEFT JOIN); res (cte); agg_pool (cte)
- JOIN: 4; WHERE: 1; GROUP BY: 0; оконных выражений: 8; UNION: 0

**Назначение (ВЫВОД):** Логистика cargo_main3: агрегаты по пулам (размер пула, план/факт длительности, дистанция).

**Grain (ГИПОТЕЗА/ВЫВОД):** 1 строка = вычисленный пул (id_pool_calc) с courier_type in ('вело','авто').

**Временные поля:**

| Поле | Роль | Статус | Доказательство |
|---|---|---|---|
| calculation_time | timestamp | PROBABLE | r.calculation_time + interval '3 hour' |
| arrival_time | timestamp | PROBABLE | max_arrival_time для plan_duration_min |
| date_pickuped | timestamp | PROBABLE | max_date_pickuped для fact_duration_min |
| date_delivered | timestamp | VERIFIED | max_date_delivered; фильтр >= now() - 3 months |
| date_supply_until | deadline | PROBABLE | NOT NULL в WHERE |

**Ключи:**

| Поле | Сущность | Тип | Статус | Доказательство |
|---|---|---|---|---|
| id_pool_calc | pool_computed | integer | PROBABLE | GROUP BY id_pool_calc |
| id_pool | pool | integer | PROBABLE | ROW_NUMBER OVER (PARTITION BY id_pool) |
| id_order | order | integer | PROBABLE | COUNT(DISTINCT id_order) |
| id_courier | courier | integer | PROBABLE | PARTITION BY id_courier |
| cluster_id | cluster | integer | PROBABLE | max(cluster_id) |

**Риски:**

- calculation_time +3 часа — TZ-риск.
- Только успешные доставки курьерами за 3 месяца.
- id_pool_calc вычисляемый; исходный id_pool не выводится.
- courier_type фильтруется до вело/авто — пешие/новички исключены.
- distance/duration агрегируются max/sum без проверки дублей parcel.

**Заметки:**

- CTE: rr, rr_latest, job_cte, job_ranz_by_date, job_res, base, ordered, with_breaks, pooled, numbered, pool_calc_cte, base_with_pool_calc, pool_size_cte, res, agg_pool.

## 7027 · cargo_main4

- База/Schema/Kind: `gp_10.0.112.100/dwh` / `logs_mart` / virtual
- SQL: 11820 символов; columns=50, metrics=1, calculated_columns=0
- CTE (17): rr, rr_latest, job_cte, job_ranz_by_date, job_res, darkstore_cte, base, pool_size_cte, pool_distance_p90, pool_distance_flags, logs_wait, parcels_wait, couriers, couriers_p90, res, add_flags, add_groups
- Источники: sandbox.ab_logs_mart_routing_results_v1 (table); rr (cte); ods.v_delivery_job_lines (table); job_cte (cte); job_ranz_by_date (cte); mart_mixed.darkstore_time (table); (subquery) (subquery); darkstore_cte (cte); rr_latest (cte, INNER JOIN); job_res (cte, LEFT JOIN); base (cte, LEFT JOIN); pool_size_cte (cte, LEFT JOIN); pool_distance_p90 (cte, LEFT JOIN); logs_wait (cte, INNER JOIN); couriers (cte, LEFT JOIN); ps.max_date_pickuped (unknown); parcels_wait (cte, LEFT JOIN); pool_distance_flags (cte, LEFT JOIN); couriers_p90 (cte, CROSS JOIN); res (cte); add_flags (cte); add_groups (cte)
- JOIN: 10; WHERE: 0; GROUP BY: 0; оконных выражений: 6; UNION: 0

**Назначение (ВЫВОД):** Логистика cargo_main4: расширенный набор флагов/признаков маршрута, просрочек и пулов.

**Grain (ГИПОТЕЗА/ВЫВОД):** 1 строка = заказ (id_order) с атрибутами пула и флагами.

**Временные поля:**

| Поле | Роль | Статус | Доказательство |
|---|---|---|---|
| calculation_time | timestamp | PROBABLE | r.calculation_time + interval '3 hour' |
| arrival_time | timestamp | PROBABLE | plan_arrival_before_deadline, planned_late |
| date_pickuped | timestamp | PROBABLE | job_cte, max_date_pickuped |
| date_collected | timestamp | PROBABLE | pickup_to_courier_minute |
| date_delivered | timestamp | VERIFIED | fact_minutes_late, фильтр |
| date_supply_until | deadline | PROBABLE | флаги просрочки |

**Ключи:**

| Поле | Сущность | Тип | Статус | Доказательство |
|---|---|---|---|---|
| id_order | order | integer | VERIFIED | join по parcel_id |
| id_pool | pool | integer | PROBABLE | id_pool_ps / pool_size_cte |
| id_courier | courier | integer | PROBABLE | партиции и join |
| cluster_id | cluster | integer | PROBABLE | выбран |
| id_pool_calc | pool_computed | integer | PROBABLE | вычисляемый |

**Риски:**

- calculation_time +3 часа — TZ-риск.
- Флаги вычисляются эвристиками (p90 дистанции, пороги ожидания) — бизнес-смысл требует подтверждения.
- Только успешные доставки курьерами за 3 месяца.
- Множество join'ов и оконных функций повышают риск размножения строк.

**Заметки:**

- CTE: rr, rr_latest, job_cte, job_ranz_by_date, job_res, darkstore_cte, base, pool_size_cte, pool_distance_p90, pool_distance_flags, logs_wait, couriers, res, add_flags, add_groups.

## 7119 · cargo_flags

- База/Schema/Kind: `ch_10.0.112.21` / `—` / virtual
- SQL: 15282 символов; columns=55, metrics=1, calculated_columns=0
- CTE (14): base, pool_size_cte, pool_distance_p90, pool_distance_flags, logs_wait, parcels_wait, logs_wait_nead_deadline, parcels_wait_nead_deadline, order_cnt_courier, thresholds, courier_lates, res, add_flags, add_groups
- Источники: agile_mart_hot_team.order_delivery_base (table); base (cte, LEFT JOIN); pool_size_cte (cte, LEFT JOIN); pool_distance_p90 (cte, LEFT JOIN); agile_mart_hot_team.routing_results_v1 (table); logs_wait (cte); logs_wait_nead_deadline (cte); order_cnt_courier (cte); parcels_wait (cte, LEFT JOIN); parcels_wait_nead_deadline (cte, LEFT JOIN); courier_lates (cte, LEFT JOIN); pool_distance_flags (cte, LEFT JOIN); thresholds (cte, CROSS JOIN); res (cte); add_flags (cte); add_groups (cte)
- JOIN: 9; WHERE: 0; GROUP BY: 0; оконных выражений: 10; UNION: 0

**Назначение (ВЫВОД):** Флаги и группировки качества заказов/маршрутов (ClickHouse agile_mart_hot_team): просрочки, нехватка курьеров, дистанция пула, ожидание.

**Grain (ГИПОТЕЗА/ВЫВОД):** 1 строка = заказ (id_order) с набором флагов/групп.

**Временные поля:**

| Поле | Роль | Статус | Доказательство |
|---|---|---|---|
| date_order | timestamp | PROBABLE | выбран из order_delivery_base |
| date_collect_start | timestamp | PROBABLE | release_to_first_assignment |
| date_collected | timestamp | PROBABLE | release_to_first_assignment |
| date_delivery_start | timestamp | PROBABLE | выбран |
| date_delivered | timestamp | VERIFIED | date_delivered > now() - INTERVAL 14 DAY |
| date_supply_until | deadline | PROBABLE | dateDiff с arrival_time/date_delivered |
| date_pickuped | timestamp | PROBABLE | nullIf(..., toDateTime('1970-01-01')) — 1970 трактуется как NULL |
| calculation_time | timestamp | PROBABLE | routing_results |
| arrival_time | timestamp | PROBABLE | plan_arrival_before_deadline, planned_late |
| estimated_time | timestamp | UNKNOWN | выбран, семантика не подтверждена |

**Ключи:**

| Поле | Сущность | Тип | Статус | Доказательство |
|---|---|---|---|---|
| id_order | order | integer | VERIFIED | join parcel_id = id_order |
| id_general | order_group | integer | PROBABLE | выбран |
| id_pool | pool | integer | PROBABLE | pool_size_cte GROUP BY id_pool |
| id_courier | courier | string | PROBABLE | в SQL join base.courier_id_darkstore = courier_lates.courier_id_darkstore; в published columns — id_courier |
| courier_type | courier_type | string | PROBABLE | выбран |
| id_route | route | integer | PROBABLE | routing_results |
| shopno | shop | integer | PROBABLE | выбран |

**Риски:**

- Другая БД/кластер (ch_10.0.112.21) — возможна рассинхронизация с gp_10.0.112.100.
- date_pickuped: 1970-01-01 приводится к NULL — нельзя использовать как валидное время.
- Только id_status = 18, is_route = true, за 14 дней — узкое окно.
- cross join thresholds размножает строки, если thresholds > 1 строки.
- Флаги завязаны на эвристические пороги (p90, 5 минут и т.д.).

**Заметки:**

- Большой набор flag_* и group_*; смысл флагов требует подтверждения владельцем.

## 7293 · hr_couriers_zone_balance

- База/Schema/Kind: `ch_10.0.15.240/default` / `—` / virtual
- SQL: 1515 символов; columns=8, metrics=1, calculated_columns=0
- CTE (3): transitions, zone_flows, daily_max
- Источники: agile_mart_techaudit.hr_delivery (table); transitions (cte); zone_flows (cte); daily_max (cte, LEFT JOIN)
- JOIN: 1; WHERE: 0; GROUP BY: 0; оконных выражений: 0; UNION: 0

**Назначение (ВЫВОД):** Баланс миграции курьеров между зонами активности (Green/Yellow/Orange/Red/Тишина/Lost) по дням.

**Grain (ГИПОТЕЗА/ВЫВОД):** 1 строка = (date, zone_from) — дневной поток переходов из зоны.

**Временные поля:**

| Поле | Роль | Статус | Доказательство |
|---|---|---|---|
| date | date | VERIFIED | WHERE date < today(); GROUP BY date |

**Ключи:**

| Поле | Сущность | Тип | Статус | Доказательство |
|---|---|---|---|---|
| date | date | date | VERIFIED | GROUP BY date |
| zone | zone | string | PROBABLE | zone_from: Green/Yellow/Orange/Red/Тишина/Lost |
| id_courier | courier | integer | PROBABLE | в CTE transitions, но не в выходе |

**Риски:**

- zone — зона бездействия (inactivity_zone), не зона доставки.
- positive_pct/negative_pct нормированы на дневной максимум — не абсолютные доли.
- Только zone_changed = 1; невозвратные состояния не видны.
- date < today(): сегодняшний день исключён.

**Заметки:**

- CTE: transitions, zone_flows, daily_max.

## 7465 · hr_couriers_5shifts

- База/Schema/Kind: `ch_10.0.15.240/default` / `agile_mart_techaudit` / virtual
- SQL: 2331 символов; columns=59, metrics=38, calculated_columns=0
- CTE (0): нет
- Источники: agile_mart_techaudit.hr_delivery (table); dictionaries.dict_tt (table, LEFT JOIN)
- JOIN: 1; WHERE: 1; GROUP BY: 0; оконных выражений: 7; UNION: 0

**Назначение (ВЫВОД):** HR-срез по первым 5 сменам (5-shifts): найм, стаж, дни с заказами, зоны, куратор.

**Grain (ГИПОТЕЗА/ВЫВОД):** 1 строка = (id_courier, date) внутри event_date-окна (первые 5 смен).

**Временные поля:**

| Поле | Роль | Статус | Доказательство |
|---|---|---|---|
| date | date | VERIFIED | WHERE date < today(); окна |
| event_date | date | VERIFIED | WHERE event_date >= today() - INTERVAL 30 DAY AND event_date < today() |
| event_hiring | date | PROBABLE | дата найма |
| date_dismissed | date | PROBABLE | dateDiff('month', event_date, least(coalesce(date_dismissed, today()), date)) |
| first_order_date | date | PROBABLE | первый заказ |

**Ключи:**

| Поле | Сущность | Тип | Статус | Доказательство |
|---|---|---|---|---|
| id_courier | courier | integer | VERIFIED | окна PARTITION BY id_courier, event_date |
| event_date | hr_event | date | VERIFIED | фильтр и окна |
| shopno | shop | integer | PROBABLE | join dict_tt |

**Риски:**

- PII: fio, phone.
- По умолчанию event_date >= today() - 30 DAY — вне окна данных нет.
- enough_shifts_flg и shifts_in_first_14d ограничены первыми 14 днями.
- active — строка 'Да'/'Нет'.
- Нет подтверждённой полной модели смен.

**Заметки:**

- Оконные функции: enough_shifts_flg, last_order_date, day_number, first_value(leader/feature_tt/name_curator).

## 7473 · hr_couriers_five_shifts

- База/Schema/Kind: `ch_10.0.15.240/default` / `agile_mart_techaudit` / virtual
- SQL: 2772 символов; columns=54, metrics=38, calculated_columns=0
- CTE (1): last_order
- Источники: agile_mart_techaudit.hr_delivery (table); agile_mart_techaudit.hr_delivery_five_shifts (table); last_order (cte, LEFT JOIN); dictionaries.dict_tt (table, LEFT JOIN)
- JOIN: 2; WHERE: 1; GROUP BY: 0; оконных выражений: 0; UNION: 0

**Назначение (ВЫВОД):** Первые 5 смен новичка: длительность и доход по сменам, пороги, статус пятой смены.

**Grain (ГИПОТЕЗА/ВЫВОД):** 1 строка = (id_courier, event_date) с атрибутами shift_1..shift_5.

**Временные поля:**

| Поле | Роль | Статус | Доказательство |
|---|---|---|---|
| event_date | date | VERIFIED | WHERE fs.event_date >= today() - INTERVAL 30 DAY |
| fifth_shift_date | date | PROBABLE | дата пятой смены |
| last_order_date | date | PROBABLE | max(date) в CTE last_order |

**Ключи:**

| Поле | Сущность | Тип | Статус | Доказательство |
|---|---|---|---|---|
| id_courier | courier | integer | VERIFIED | join last_order по id_courier, event_date |
| event_date | hr_event | date | VERIFIED | join и фильтр |
| shopno | shop | integer | PROBABLE | join dict_tt |

**Риски:**

- PII: name_courier.
- shift_1..shift_5 — не временные метки, а числовые показатели смены (заказы/порог); не путать со временем.
- shift_N_work_minutes — минуты работы; shift_N_profit — доход по смене (единственный подтверждённый источник дохода курьера, но только первые 5 смен).
- Пороги thresholds_taken/_payments — правила заказчика.
- event_date >= today() - 30 DAY по умолчанию.

**Заметки:**

- shift_N_profit и shift_N_work_minutes позволяют вычислить доход в час, но только для первых 5 смен новичка.

## 7775 · all_couriers_list

- База/Schema/Kind: `ch_10.0.15.240/default` / `—` / virtual
- SQL: 600 символов; columns=11, metrics=1, calculated_columns=0
- CTE (0): нет
- Источники: default.v_couriers (table); default.courier_job_type (table, LEFT JOIN); default.v_couriers_payments_courier_types (table, LEFT JOIN)
- JOIN: 2; WHERE: 1; GROUP BY: 0; оконных выражений: 0; UNION: 0

**Назначение (ВЫВОД):** Справочник всех курьеров: активность, бан, тип занятости, тип курьера, дата регистрации.

**Grain (ГИПОТЕЗА/ВЫВОД):** 1 строка = курьер (vc.id).

**Временные поля:**

| Поле | Роль | Статус | Доказательство |
|---|---|---|---|
| date_add | date | PROBABLE | дата регистрации курьера по контексту v_couriers |

**Ключи:**

| Поле | Сущность | Тип | Статус | Доказательство |
|---|---|---|---|---|
| ID | courier | integer | VERIFIED | vc.id as "ID" |
| job_type | employment_type | integer | PROBABLE | join cjt.id = vc.job_type, WHERE job_type not in (0,1) |
| id_courier_type | courier_type | integer | PROBABLE | join cct.id = vc.id_courier_type |

**Риски:**

- PII: Курьер (имя), Телефон, ИНН — значения не выгружать.
- WHERE job_type not in (0,1) — часть курьеров исключена.
- Нет истории изменений: только текущее состояние.

**Заметки:**

- "Активный" = case active=1, "Бан" = case is_blocked=0.
