# 14. Mapping Superset → новая модель

Строк mapping: **60**.
DIRECT: 23; DERIVED: 10; INFERRED: 20; UNKNOWN: 7.

Принципы: Superset read-only; новая БД владеет операционными фактами; SQL JOIN ≠ FK; внешние ID не создают FK по имени; суммы заказа ≠ оплата курьера.

| Домен | Поле | Dataset | Поле источника | Доказательство | Confidence | ***REMOVED*** | Загрузка |
|---|---|---|---|---|---|---|---|
| shops | code | 4732 | shopno | DIRECT | HIGH | shopno числовой; code — строка | YES |
| shops | name | 4732 | name_tt | DIRECT | HIGH | название может меняться | YES |
| shops | external_source_id | 4732 | id_tt | DIRECT | MEDIUM | id_tt nullable | PARTIAL |
| addresses | latitude | 3466 | geo | DERIVED | LOW | geo — строка без разбора; формат не подтверждён | NO |
| addresses | longitude | 3466 | geo | DERIVED | LOW | geo — строка без разбора | NO |
| couriers | external_hr_id | 5797 | id_courier | DIRECT | MEDIUM | HR-контур; id_courier числовой | PARTIAL |
| couriers | courier_type | 7775 | id_courier_type | DERIVED | MEDIUM | требуется справочник типов | PARTIAL |
| couriers | employment_type | 7775 | job_type | DERIVED | MEDIUM | job_type — код | PARTIAL |
| couriers | operational_status | 5797 | active | DERIVED | MEDIUM | active — строка 'Да'/'Нет' | PARTIAL |
| couriers | is_blocked | 5797 | is_blocked | DIRECT | MEDIUM | операционный смысл требует подтверждения | PARTIAL |
| courier_external_ids | external_id | 7775 | ID | DIRECT | MEDIUM | сопоставление с id_courier не доказано | PARTIAL |
| courier_external_ids | external_id | 5939 | mentorid | INFERRED | LOW | mentorid — string; роль не подтверждена | NO |
| delivery_zones | code | — | — | UNKNOWN | LOW | прямого источника зон нет | NO |
| delivery_zones | boundary_geometry | — | — | UNKNOWN | LOW | геометрия отсутствует | NO |
| orders | external_order_id | 4732 | id_order | DIRECT | HIGH | подзаказы; id_general объединяет | YES |
| orders | shop_id | 4732 | shopno | DIRECT | HIGH |  | YES |
| orders | order_created_at | 4732 | date_order | DIRECT | HIGH | используется в SLA-метриках | YES |
| orders | accepted_at | 4732 | date_status_10 | INFERRED | LOW | статус 10 не расшифрован | NO |
| orders | collection_started_at | 4732 | date_collect_start | INFERRED | MEDIUM |  | PARTIAL |
| orders | collected_at | 4732 | date_collected | INFERRED | MEDIUM | не равно готовности | PARTIAL |
| orders | ready_at | 3466 | time_ready | INFERRED | LOW | тип поля не определён; кандидат | NO |
| orders | delivery_started_at | 4732 | date_delivery_start | DIRECT | MEDIUM |  | PARTIAL |
| orders | delivered_at | 4732 | date_delivered | DIRECT | HIGH |  | YES |
| orders | cancelled_at | 4732 | is_canceled | DERIVED | MEDIUM | флаг, не время | PARTIAL |
| orders | returned_at | 4732 | is_returned_store | DERIVED | MEDIUM | флаг, не время | PARTIAL |
| orders | sla_due_at | 4732 | date_supply_untill | DIRECT | MEDIUM | SLA-норматив может приходить из services_sla | PARTIAL |
| orders | order_status | 4732 | order_status | DIRECT | MEDIUM | нет подтверждённого словаря статусов | PARTIAL |
| order_amount_snapshots | amount | 4732 | sum_paid | DIRECT | HIGH | НЕ оплата курьера | YES |
| order_amount_snapshots | amount | 4732 | sum_order | DIRECT | HIGH | НЕ оплата курьера | YES |
| order_status_history | to_status | 4732 | order_status | DERIVED | MEDIUM | история переходов из аналитики ограничена | PARTIAL |
| order_readiness | ready_at | 3466 | time_ready | INFERRED | LOW | кандидат; требует BD-013 | NO |
| courier_shifts | external_shift_id | 7802 | id_shift | DIRECT | MEDIUM | string id смены; универсальность не доказана | PARTIAL |
| courier_shifts | actual_start_at | 7712 | shift_open_time | DIRECT | MEDIUM | открытие смены в другом датасете | PARTIAL |
| courier_shifts | shift_type | 7021 | shift_type | DIRECT | MEDIUM | семантика типов не подтверждена | PARTIAL |
| courier_shifts | is_night_shift | 7021 | is_night_shift | DIRECT | MEDIUM |  | PARTIAL |
| courier_shifts | planned_start_at | 7021 | time_start | INFERRED | LOW | часть смены, не обязательно смена | NO |
| courier_shifts | actual_end_at | 7021 | time_end | INFERRED | LOW | часть смены | NO |
| courier_queue_entries | arrived_at | 3466 | wait_time | INFERRED | LOW | длительность ожидания, не время прибытия | NO |
| courier_queue_entries | queue_sequence | — | — | UNKNOWN | LOW | очереди в источниках нет | NO |
| trips | external_trip_ref | 7006 | id_pool_calc | INFERRED | LOW | id_pool_calc вычисляемый | NO |
| trips | zone_id | — | — | UNKNOWN | LOW | зоны доставки нет | NO |
| trip_orders | order_id | 7006 | id_order | INFERRED | MEDIUM | состав пула выводится косвенно | PARTIAL |
| trip_orders | sequence_no | 7006 | fact_seq | INFERRED | LOW | последовательность внутри пула | NO |
| trip_assignments | courier_id | 7006 | id_courier | DIRECT | MEDIUM | связь заказ↔курьер без события назначения | PARTIAL |
| trip_assignments | assigned_at | 7006 | date_pickuped | INFERRED | LOW | pickup ≠ назначение | NO |
| delivery_attempts | completed_at | 4732 | date_delivered | DIRECT | HIGH |  | YES |
| delivery_attempts | result | 4732 | order_status | DERIVED | MEDIUM | результат выводится из статуса | PARTIAL |
| courier_events | event_type | 5247 | event_name | INFERRED | LOW | словарь событий отсутствует; events_qty ≠ явка | NO |
| courier_events | occurred_at | 5247 | d | INFERRED | LOW | дата, не время события | NO |
| courier_events | event_type | 5939 | progul | INFERRED | MEDIUM | невыход как флаг, не событие | PARTIAL |
| tariff_versions | base_amount | — | — | UNKNOWN | LOW | тарифы не подтверждены | NO |
| courier_accruals | amount | — | — | UNKNOWN | LOW | нет подтверждённого тарифа | NO |
| courier_accruals | amount | 7473 | shift_1_profit | INFERRED | LOW | только первые 5 смен; аналитический ориентир | NO |
| mentorship_assignments | mentor_courier_id | 5939 | mentorid | DIRECT | MEDIUM | string id; роль требует BD-001 | PARTIAL |
| mentorship_assignments | trainee_courier_id | 5939 | person_code | INFERRED | LOW | сопоставление с id_courier не доказано | NO |
| mentorship_assignments | starts_at | 5939 | date_for_mentor | INFERRED | MEDIUM | семантика даты требует подтверждения | PARTIAL |
| mentorship_assignments | planned_ends_at | 5939 | date_for_mentor | DERIVED | LOW | две недели — правило, не поле | NO |
| mentorship_shift_reviews | shift_number | 5939 | shift_rn_trainee | DIRECT | MEDIUM |  | PARTIAL |
| mentorship_shift_reviews | delivery_quality_score | — | — | UNKNOWN | LOW | шкала не согласована | NO |
| mentorship_shift_reviews | shift_id | 7802 | id_shift | INFERRED | LOW | сопоставление смен не доказано | NO |
