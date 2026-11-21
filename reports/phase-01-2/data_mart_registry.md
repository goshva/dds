# Реестр агрегированных витрин — Этап 1.2

Сгенерировано: 2026-11-21T11:54:53.800Z

Витрины НЕ создаются: это спецификация на основе аудита SQL 12 датасетов.

Всего витрин: 11; показателей: 48; недостающих событий: 17; справочников: 13.

| mart_id | grain | source_datasets | priority | availability |
|---|---|---|---|---|
| dm_courier_orders | 1 строка = заказ (COALESCE(id_general, id_order)); подзаказы id_order сводятся к id_general. | 4732, 7006, 7027, 7119, 7775 | P0 | PARTIAL: заказы и временные этапы доступны; order_ready и зона доставки не подтверждены. |
| dm_courier_ready_queue | 1 строка = заказ в очереди готовности (событие order_ready). | 4732, 7006, 7027, 7119 | P0 | NEEDS_EVENT: подтверждённого события «заказ готов к выдаче» нет; date_status_10 и date_collected — только гипотезы. |
| dm_delivery_zones | 1 строка = зона (zone_id) на дату действия. | 4732, 5797, 7293, 7465, 7473 | P0 | NEEDS_REFERENCE: границы зон, привязка адреса доставки и история изменения границ отсутствуют. area_tt — территория ТТ, не зона. |
| dm_delivery_batches | 1 строка = пакет (batch_key = id_pool_calc или id_pool) на дату. | 7006, 7024, 7027, 7119 | P0 | PARTIAL: состав и размер пула доступны; batch_created/assigned и привязка к зоне не подтверждены. |
| dm_courier_assignments | 1 строка = назначение (order_key или batch_key × courier × assigned_at). | 4732, 7006, 7024, 7027, 7119, 7775 | P0 | PARTIAL: связь заказ↔курьер и факт pickup доступны; события назначения/принятия/отмены отсутствуют. |
| dm_courier_performance | 1 строка = courier × day (агрегация из заказов); сменная гранулярность — только первые смены новичков. | 4732, 7006, 7027, 5797, 7465, 7473, 5247, 5399 | P1 | PARTIAL: заказы по курьеру и HR-агрегаты доступны; полноценных смен нет — только первые 5 смен/14 дней. |
| dm_courier_income | 1 строка = начисление за заказ (accrual_id = order_key + courier + accrual_date). | 7473, 4732 | P1 | NEEDS_REFERENCE + NEEDS_BUSINESS_RULE: нет тарифа за заказ и правила начисления; есть только доход по первым 5 сменам (7473). |
| dm_courier_mentorship | 1 строка = пара (новичок × event_date) с атрибутами наставника/куратора. | 5797, 7465, 7473 | P2 | PARTIAL: куратор/лидер и первые смены доступны; назначение наставника и результат обучения не подтверждены. |
| dm_courier_curator_performance | 1 строка = куратор × период (день/месяц). | 5797, 7465, 7473 | P2 | PARTIAL: name_curator и метрики первых смен есть; единая корпоративная формула удержания и роль куратора не подтверждены. |
| dm_courier_attendance | 1 строка = courier × planned_shift (после появления плана смен). | 5797, 7465, 7473, 5247, 5399 | P1 | NOT_AVAILABLE для плановой/фактической явки; NEEDS_EVENT + NEEDS_REFERENCE. |
| dm_courier_demand_forecast | 1 строка = zone × date × hour. | 4732, 7006, 7027, 5797, 7465, 5247, 5399 | P2 | PARTIAL/NEEDS_BUSINESS_RULE: фактические заказы доступны, прогноз, дефицит и ожидание требуют модели и справочника зон. |

## dm_courier_orders — Заказы курьерской доставки

- **business_purpose:** Единая основа по заказам: объём, статусы, временные этапы, SLA, суммы заказа, ТТ, курьер, пул.
- **grain:** 1 строка = заказ (COALESCE(id_general, id_order)); подзаказы id_order сводятся к id_general.
- **primary_key:** order_key = COALESCE(id_general, id_order)
- **source_datasets:** 4732, 7006, 7027, 7119, 7775
- **source_tables:** default.darkstore_time_sheet, mart_mixed.darkstore_time, agile_mart_hot_team.order_delivery_base, default.v_couriers
- **join_keys:** order_key, id_courier, shopno/id_tt
- **filters:** 4732: shopno NOT IN (99888), id_tt IS NOT NULL; 7006/7027: status_name='Успешно завершен', delivery_type_group='Курьеры', окно 3 месяца; 7119: id_status=18, is_route=true, окно 14 дней
- **aggregation_period:** день/неделя/месяц
- **metrics:** orders_total, orders_success, orders_cancelled, orders_returned, orders_by_shop, orders_by_zone, orders_by_courier, time_create_to_assembly, assembly_duration, wait_duration, delivery_duration, sla_on_time_rate
- **dimensions:** date, shopno/id_tt, direction, courier_type, id_pool, zone/cluster
- **data_availability:** PARTIAL: заказы и временные этапы доступны; order_ready и зона доставки не подтверждены.
- **confidence:** PROBABLE
- **implementation_priority:** P0

**calculation_rules:**
- orders_total = COUNT(DISTINCT order_key)
- orders_success = COUNT(DISTINCT order_key) WHERE order_status='Успешно завершен'
- delivery_duration = date_delivered - date_delivery_start (4732) или duration_fact (7006/7027)
- sla_on_time_rate = 1 - AVG(is_late) (7006/7027) или доля date_status_10/date_delivered <= date_supply_untill (4732)

**quality_checks:**
- order_key NOT NULL
- нет дублей order_key
- date_delivered >= date_order
- нет отрицательных длительностей
- order_status в допустимом наборе
- согласованность COUNT между 4732 и 7006/7027

**missing_events:** order_ready, order_picked_up

**missing_references:** zone_reference (адрес→зона доставки), status_dictionary

**business_questions:**
- Сколько заказов и какова доля успешных?
- Где нарушается SLA?
- Каково время сборки/ожидания/доставки?

## dm_courier_ready_queue — Очередь готовых заказов

- **business_purpose:** Очередь заказов, готовых к выдаче курьеру, и время ожидания курьера.
- **grain:** 1 строка = заказ в очереди готовности (событие order_ready).
- **primary_key:** order_key + ready_at
- **source_datasets:** 4732, 7006, 7027, 7119
- **source_tables:** default.darkstore_time_sheet, mart_mixed.darkstore_time, agile_mart_hot_team.order_delivery_base
- **join_keys:** order_key, shopno/id_tt, id_courier
- **filters:** успешные заказы; окно 3/14 дней по источнику
- **aggregation_period:** час/день
- **metrics:** queue_size, wait_duration, ready_to_pickup_duration, orders_waiting_over_threshold
- **dimensions:** date, shopno/id_tt, direction, courier_type
- **data_availability:** NEEDS_EVENT: подтверждённого события «заказ готов к выдаче» нет; date_status_10 и date_collected — только гипотезы.
- **confidence:** UNKNOWN
- **implementation_priority:** P0

**calculation_rules:**
- Пока НЕ подтверждено: order_ready. Кандидаты: date_status_10 (4732, PROBABLE), date_collected (4732/7006/7027, PROBABLE).
- wait_duration = date_pickuped - ready_at (после появления order_ready)

**quality_checks:**
- ready_at NOT NULL
- ready_at <= pickup_at
- нет отрицательного wait_duration
- нет дублей order_key+ready_at

**missing_events:** order_ready, order_picked_up

**missing_references:** status_dictionary

**business_questions:**
- Сколько заказов ждут курьера?
- Сколько времени заказ проводит в очереди?

## dm_delivery_zones — Постоянные зоны доставки

- **business_purpose:** Справочник зон доставки, привязка ТТ/адресов к зонам и правила закрепления.
- **grain:** 1 строка = зона (zone_id) на дату действия.
- **primary_key:** zone_id + valid_from
- **source_datasets:** 4732, 5797, 7293, 7465, 7473
- **source_tables:** mart.org_unit_actual (zone_cluster), agile_mart_techaudit.hr_delivery (inactivity_zone), agile_mart_techaudit.hr_delivery (zone transitions)
- **join_keys:** shopno/id_tt, id_courier, zone
- **filters:** 7293: zone_changed=1, prev/current zone NOT NULL; 5797/7465/7473: date < today()
- **aggregation_period:** день
- **metrics:** zones_total, orders_by_zone, couriers_by_zone, zone_active_flag
- **dimensions:** zone, zone_order, shopno/id_tt, direction
- **data_availability:** NEEDS_REFERENCE: границы зон, привязка адреса доставки и история изменения границ отсутствуют. area_tt — территория ТТ, не зона.
- **confidence:** UNKNOWN
- **implementation_priority:** P0

**calculation_rules:**
- 4732: zone_cluster из mart.org_unit_actual как «Куст» (кластер орг-единицы, не зона доставки).
- 5797/7465/7473: inactivity_zone — зона бездействия курьера, не зона доставки.
- 7293: zone_from — зона миграции курьеров (Green/Yellow/Orange/Red/Тишина/Lost).
- Адрес доставки → зона: подтверждённой связи нет.

**quality_checks:**
- zone_id NOT NULL
- нет пересечения зон по адресу
- история границ без разрывов

**missing_events:** courier_zone_assigned, courier_zone_changed

**missing_references:** zone_reference (zone_id, name, boundaries), address_to_zone_mapping, tt_to_zone_mapping

**business_questions:**
- Какие постоянные зоны существуют?
- Какие ТТ/адреса входят в зону?

## dm_delivery_batches — Пакеты заказов (ходки/пулы)

- **business_purpose:** Пакеты заказов, собираемые по постоянным зонам, с составом и временем выдачи/завершения.
- **grain:** 1 строка = пакет (batch_key = id_pool_calc или id_pool) на дату.
- **primary_key:** batch_key
- **source_datasets:** 7006, 7024, 7027, 7119
- **source_tables:** mart_mixed.darkstore_time, ods.v_delivery_job_lines, agile_mart_hot_team.order_delivery_base
- **join_keys:** id_pool, id_pool_calc, id_order, id_courier
- **filters:** 7006/7027: успешные курьерские доставки, окно 3 месяца; 7024: courier_type in ('вело','авто'); 7119: id_status=18, is_route=true
- **aggregation_period:** день
- **metrics:** batches_total, orders_per_batch, batch_created_at, batch_assigned_at, batch_pickup_at, batch_completed_at, batch_success_rate, batch_zone
- **dimensions:** date, id_pool/id_pool_calc, shopno, courier_type, cluster_id
- **data_availability:** PARTIAL: состав и размер пула доступны; batch_created/assigned и привязка к зоне не подтверждены.
- **confidence:** PARTIAL
- **implementation_priority:** P0

**calculation_rules:**
- id_pool_calc = DENSE_RANK() по (id_courier, pool_seq), где pool_seq — разрывы date_pickuped (7006/7027).
- pool_size = COUNT(DISTINCT id_order) по id_pool_calc (7006/7024/7027) или uniqExact(id_order) по id_pool (7119).
- Проектное правило «5 заказов в пакете» — ГИПОТЕЗА, в источниках не подтверждено.

**quality_checks:**
- batch_key NOT NULL
- нет пересечения заказов между пакетами
- orders_per_batch > 0
- batch_pickup_at >= batch_created_at
- один заказ в одном пакете

**missing_events:** batch_created, batch_assigned, order_added_to_batch

**missing_references:** zone_reference, batch_rule_reference (правило формирования пакета)

**business_questions:**
- Сколько заказов в пакете?
- Как быстро пакет выдаётся и завершается?

## dm_courier_assignments — Назначения курьеров

- **business_purpose:** История назначений заказов/пакетов на курьеров и их принятия/завершения.
- **grain:** 1 строка = назначение (order_key или batch_key × courier × assigned_at).
- **primary_key:** assignment_id (order_key + courier + assigned_at)
- **source_datasets:** 4732, 7006, 7024, 7027, 7119, 7775
- **source_tables:** default.darkstore_time_sheet, mart_mixed.darkstore_time, agile_mart_hot_team.order_delivery_base, ods.v_delivery_job_lines
- **join_keys:** order_key, id_courier, id_pool/id_pool_calc
- **filters:** успешные курьерские доставки; id_courier NOT NULL
- **aggregation_period:** день
- **metrics:** assignments_total, accepted_total, pickup_total, completed_total, cancelled_total, reassigned_total, time_to_accept, time_to_pickup
- **dimensions:** date, courier, shopno, batch, courier_type
- **data_availability:** PARTIAL: связь заказ↔курьер и факт pickup доступны; события назначения/принятия/отмены отсутствуют.
- **confidence:** PROBABLE
- **implementation_priority:** P0

**calculation_rules:**
- Факт получения курьером: date_pickuped (7006/7027/7119, PROBABLE).
- Факт вручения: date_delivered (VERIFIED).
- Назначение/принятие/отмена/повторное назначение как события отсутствуют.

**quality_checks:**
- assignment_id уникален
- courier NOT NULL
- pickup_at >= assigned_at
- нет назначения завершённого заказа
- нет дублей order+courier+time

**missing_events:** batch_assigned, courier_accepted_assignment, order_picked_up, order_cancelled

**missing_references:** cancel_reason_dictionary

**business_questions:**
- Кто и когда получил назначение?
- Сколько назначений отменено/переназначено?

## dm_courier_performance — Производительность курьеров

- **business_purpose:** Производительность курьера: заказы, успешные доставки, рабочие дни, время доставки, SLA, динамика, зоны, новички.
- **grain:** 1 строка = courier × day (агрегация из заказов); сменная гранулярность — только первые смены новичков.
- **primary_key:** courier_id + date
- **source_datasets:** 4732, 7006, 7027, 5797, 7465, 7473, 5247, 5399
- **source_tables:** default.darkstore_time_sheet, mart_mixed.darkstore_time, agile_mart_techaudit.hr_delivery, agile_mart_techaudit.courier_events_logs_aggr
- **join_keys:** id_courier, date, shopno
- **filters:** успешные доставки; HR: date < today(); 5247/5399: окно 7 дней / неделя
- **aggregation_period:** день/неделя/месяц
- **metrics:** orders_per_courier, deliveries_success, working_days, avg_delivery_duration, sla_rate, cancellations, productivity_dynamics, productivity_by_zone, newcomer_productivity
- **dimensions:** courier, date, shopno, zone, courier_type, newcomer_flag
- **data_availability:** PARTIAL: заказы по курьеру и HR-агрегаты доступны; полноценных смен нет — только первые 5 смен/14 дней.
- **confidence:** PROBABLE
- **implementation_priority:** P1

**calculation_rules:**
- orders_per_courier = COUNT(DISTINCT order_key) GROUP BY id_courier, date
- deliveries_success = COUNT(DISTINCT order_key) WHERE order_status='Успешно завершен'
- working_days: 5797 days_with_orders (PROBABLE); 7465/7473 — только первые 5 смен/14 дней
- sla_rate = 1 - AVG(is_late) (7006/7027)

**quality_checks:**
- courier_id NOT NULL
- orders_per_courier >= 0
- нет дублей courier+date
- sum(orders) по курьерам = orders_total
- нет пересечения смен

**missing_events:** courier_shift_started, courier_shift_ended

**missing_references:** shift_plan_reference

**business_questions:**
- Кто самый производительный?
- Как меняется производительность новичков?
- Где SLA хуже?

## dm_courier_income — Доход курьеров

- **business_purpose:** Начисления курьеру за доставку заказов (правило: оплата за заказ).
- **grain:** 1 строка = начисление за заказ (accrual_id = order_key + courier + accrual_date).
- **primary_key:** accrual_id
- **source_datasets:** 7473, 4732
- **source_tables:** agile_mart_techaudit.hr_delivery_five_shifts, default.darkstore_time_sheet
- **join_keys:** id_courier, order_key, event_date/date
- **filters:** 7473: первые 5 смен новичка, event_date >= today()-30 DAY
- **aggregation_period:** день/неделя/месяц
- **metrics:** income_per_order, income_per_hour, income_per_shift, adjustments, payout_status
- **dimensions:** courier, date, zone, delivery_type
- **data_availability:** NEEDS_REFERENCE + NEEDS_BUSINESS_RULE: нет тарифа за заказ и правила начисления; есть только доход по первым 5 сменам (7473).
- **confidence:** UNKNOWN
- **implementation_priority:** P1

**calculation_rules:**
- Подтверждён только shift_N_profit / shift_N_work_minutes (7473) для первых 5 смен новичка.
- income_per_hour = shift_N_profit / (shift_N_work_minutes / 60) — DERIVABLE только для 7473.
- sum_order/sum_paid (4732) — суммы ЗАКАЗА, НЕ доход курьера; формула заработка не выводится.
- Тарифы за заказ, период действия тарифа, корректировки и статус выплаты отсутствуют.

**quality_checks:**
- нет двойного начисления на заказ
- accrual_amount >= 0
- период тарифа покрывает дату заказа
- courier_id NOT NULL

**missing_events:** courier_income_accrued, courier_income_adjusted

**missing_references:** tariff_reference (ставка за заказ, период, зона/тип), payout_status_dictionary

**business_questions:**
- Сколько курьер заработал за период?
- Каков доход в час?
- Как учитываются отмены и возвраты?

## dm_courier_mentorship — Наставничество и адаптация новичков

- **business_purpose:** Связь наставника и новичка, первые смены, результаты адаптации и удержание.
- **grain:** 1 строка = пара (новичок × event_date) с атрибутами наставника/куратора.
- **primary_key:** courier_id + event_date + mentor_id
- **source_datasets:** 5797, 7465, 7473
- **source_tables:** agile_mart_techaudit.hr_delivery, agile_mart_techaudit.hr_delivery_five_shifts
- **join_keys:** id_courier, event_date, shopno
- **filters:** 5797: date < today(); 7465/7473: event_date >= today()-30 DAY
- **aggregation_period:** день/месяц
- **metrics:** newcomers_total, first_shifts_count, newcomer_orders, adaptation_days, mentor_assignment, newcomer_retention
- **dimensions:** courier, event_date, name_curator/leader, shopno, region_name
- **data_availability:** PARTIAL: куратор/лидер и первые смены доступны; назначение наставника и результат обучения не подтверждены.
- **confidence:** PARTIAL
- **implementation_priority:** P2

**calculation_rules:**
- newcomers = COUNT(DISTINCT id_courier) WHERE first_order_date = date (5797/7465).
- curator/leader доступны как name_curator/leader (PROBABLE), но роль «наставник» не подтверждена.
- Адаптация: shifts_in_first_14d, enough_shifts_flg, days_with_orders, fifth_shift_status.

**quality_checks:**
- mentor_id != newcomer_id
- один наставник на пару
- event_date в периоде обучения
- нет дублей пары

**missing_events:** courier_mentor_assigned, courier_training_completed

**missing_references:** mentor_role_reference, training_program_reference

**business_questions:**
- Кто обучал новичка?
- Сколько новичков закрепилось?

## dm_courier_curator_performance — Производительность кураторов

- **business_purpose:** Показатели работы куратора: закреплённые новички, их удержание и продуктивность.
- **grain:** 1 строка = куратор × период (день/месяц).
- **primary_key:** curator_id + period
- **source_datasets:** 5797, 7465, 7473
- **source_tables:** agile_mart_techaudit.hr_delivery, agile_mart_techaudit.hr_delivery_five_shifts
- **join_keys:** name_curator, id_courier, event_date
- **filters:** 5797: date < today(); 7465/7473: event_date >= today()-30 DAY
- **aggregation_period:** месяц
- **metrics:** curator_newcomers, curator_retention_14d, curator_newcomer_orders, curator_avg_adaptation
- **dimensions:** name_curator, region_name, shopno, period
- **data_availability:** PARTIAL: name_curator и метрики первых смен есть; единая корпоративная формула удержания и роль куратора не подтверждены.
- **confidence:** PARTIAL
- **implementation_priority:** P2

**calculation_rules:**
- curator_newcomers = COUNT(DISTINCT id_courier) GROUP BY name_curator
- curator_retention_14d = AVG(enough_shifts_flg) (PROBABLE, только первые 14 дней)

**quality_checks:**
- curator_id NOT NULL
- новичок привязан к одному куратору в периоде
- нет дублей curator+period

**missing_events:** courier_mentor_assigned

**missing_references:** curator_role_reference, curator_org_structure

**business_questions:**
- Какой куратор лучше удерживает новичков?

## dm_courier_attendance — Явка и доступность курьеров

- **business_purpose:** Плановая и фактическая смена, опоздания, невыходы, доступность для назначения.
- **grain:** 1 строка = courier × planned_shift (после появления плана смен).
- **primary_key:** courier_id + planned_shift_start
- **source_datasets:** 5797, 7465, 7473, 5247, 5399
- **source_tables:** agile_mart_techaudit.hr_delivery, agile_mart_techaudit.hr_delivery_five_shifts, agile_mart_techaudit.courier_events_logs_aggr
- **join_keys:** id_courier, date/event_date
- **filters:** 5797: date < today(); 5247/5399: окно 7 дней / полная неделя
- **aggregation_period:** день/неделя/месяц
- **metrics:** planned_shifts, actual_shifts, attendance_rate, late_start, no_show, shift_duration, availability_flag
- **dimensions:** courier, date, shopno, zone
- **data_availability:** NOT_AVAILABLE для плановой/фактической явки; NEEDS_EVENT + NEEDS_REFERENCE.
- **confidence:** UNKNOWN
- **implementation_priority:** P1

**calculation_rules:**
- events_qty (5247/5399) — количество событий, НЕ явка; event_name не расшифрован.
- Подтверждённых событий courier_shift_started/ended нет.
- Косвенно: shifts_in_first_14d / enough_shifts_flg (5797/7465) — только первые 14 дней, только новички.

**quality_checks:**
- planned_shift_start NOT NULL
- actual >= planned
- нет пересечения смен курьера
- no_show без shift_started

**missing_events:** courier_shift_started, courier_shift_ended

**missing_references:** shift_plan_reference (план смен), absence_reason_dictionary

**business_questions:**
- Кто не вышел на смену?
- Какова явка по зонам?

## dm_courier_demand_forecast — Прогноз нагрузки и дефицита курьеров

- **business_purpose:** Прогноз количества заказов, доступных курьеров, дефицита и времени ожидания по зонам.
- **grain:** 1 строка = zone × date × hour.
- **primary_key:** zone_id + forecast_date + hour
- **source_datasets:** 4732, 7006, 7027, 5797, 7465, 5247, 5399
- **source_tables:** default.darkstore_time_sheet, mart_mixed.darkstore_time, agile_mart_techaudit.hr_delivery, agile_mart_techaudit.courier_events_logs_aggr
- **join_keys:** zone, date, shopno
- **filters:** исторические окна 3 месяца / 7 дней / 30 дней
- **aggregation_period:** час/день
- **metrics:** orders_forecast, orders_actual, couriers_available, courier_deficit, zone_load, expected_wait_time
- **dimensions:** zone, date, hour, shopno
- **data_availability:** PARTIAL/NEEDS_BUSINESS_RULE: фактические заказы доступны, прогноз, дефицит и ожидание требуют модели и справочника зон.
- **confidence:** UNKNOWN
- **implementation_priority:** P2

**calculation_rules:**
- orders_actual = COUNT(order_key) GROUP BY zone, date, hour (DERIVABLE после появления zone_reference).
- couriers_available = COUNT(DISTINCT id_courier) по сменам (PARTIAL: смены не подтверждены).
- orders_forecast, courier_deficit, expected_wait_time — NEEDS_BUSINESS_RULE/модель.

**quality_checks:**
- forecast_date >= today
- couriers_available >= 0
- zone_id NOT NULL
- нет дублей zone+date+hour

**missing_events:** нет

**missing_references:** zone_reference, forecast_model_spec, shift_plan_reference

**business_questions:**
- Сколько курьеров нужно в зоне завтра?
- Где будет дефицит?
