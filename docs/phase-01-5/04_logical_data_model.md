# 04. Логическая модель данных

Таблиц: **25**. <ФИО> — проектная; статусы источников указаны в mapping.

## Реестр таблиц

| Таблица | ***REMOVED*** | Зерно | PK | Владелец |
|---|---|---|---|---|
| shops | Reference | 1 строка = одна торговая точка (актуальная версия) | id | Operations |
| addresses | Reference | 1 строка = один нормализованный адрес | id | Geo |
| couriers | Workforce | 1 строка = один курьер | id | Workforce |
| courier_external_ids | Workforce | 1 строка = одно сопоставление внешнего ID с периодом действия | id | Workforce |
| delivery_zones | Geo | 1 строка = одна зона (версия справочника) | id | Geo |
| zone_boundary_versions | Geo | 1 строка = одна версия границы зоны | id | Geo |
| orders | Operations | 1 строка = один заказ | id | Operations |
| order_amount_snapshots | Operations | 1 строка = одна сумма заказа на момент снимка | id | Operations |
| order_status_history | Operations | 1 строка = один переход статуса | id | Operations |
| order_readiness | Operations | 1 строка = одна попытка готовности заказа | id | Operations |
| work_slots | Workforce | 1 строка = один рабочий слот | id | Workforce |
| courier_shifts | Workforce | 1 строка = одна смена курьера | id | Workforce |
| courier_queue_entries | Workforce | 1 строка = один вход курьера в очередь | id | Workforce |
| trips | Delivery | 1 строка = одна ходка | id | Operations |
| trip_orders | Delivery | 1 строка = один заказ в ходке | id | Operations |
| trip_order_membership_history | Delivery | 1 строка = одно действие над составом | id | Operations |
| trip_assignments | Delivery | 1 строка = одно назначение ходки | id | Operations |
| delivery_attempts | Delivery | 1 строка = одна попытка доставки | id | Operations |
| courier_events | Events | 1 строка = одно событие курьера | id | Workforce |
| domain_events | Events | 1 строка = одно доменное событие | id | Architecture |
| tariff_versions | Finance | 1 строка = одна версия тарифа | id | Finance |
| courier_accruals | Finance | 1 строка = одно начисление по попытке доставки | id | Finance |
| accrual_adjustments | Finance | 1 строка = одна корректировка начисления | id | Finance |
| mentorship_assignments | Mentorship | 1 строка = одно назначение наставника новичку | id | Mentorship |
| mentorship_shift_reviews | Mentorship | 1 строка = оценка одной смены новичка | id | Mentorship |

## shops — Торговые точки / дарксторы

- *****REMOVED***:** Reference
- **Назначение:** Справочник торговых точек и дарксторов, к которым привязаны заказы, смены и зоны.
- **Зерно:** 1 строка = одна торговая точка (актуальная версия)
- **Владелец:** Operations
- **Источник Superset:** 4732 (shopno/id_tt/name_tt), 3466/3035 (shopno, name_tt, region_tt)
- **Статусы:** ACTIVE, INACTIVE

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| external_source_id | TEXT | NULL |  |  |  |  |  |
| code | TEXT | NOT NULL |  |  | UNIQUE |  |  |
| name | TEXT | NOT NULL |  |  |  |  |  |
| address_id | UUID | NULL |  | addresses.id |  |  |  |
| timezone | TEXT | NULL |  |  |  | Europe/Moscow |  |
| status | TEXT | NOT NULL |  |  |  | ACTIVE |  |
| valid_from | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| valid_to | TIMESTAMPTZ | NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |
| updated_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## addresses — Адреса

- *****REMOVED***:** Reference
- **Назначение:** Адреса доставки и адреса торговых точек. PII-ограниченный доступ.
- **Зерно:** 1 строка = один нормализованный адрес
- **Владелец:** Geo
- **Источник Superset:** 4732 (geo), 3466/3035 (geo, area_tt — не адрес)
- **TBD:** PII-политика и срок хранения адресов (BD-023)

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| country_code | TEXT | NULL |  |  |  | RU |  |
| region | TEXT | NULL |  |  |  |  |  |
| city | TEXT | NULL |  |  |  |  |  |
| street | TEXT | NULL |  |  |  |  |  |
| house | TEXT | NULL |  |  |  |  |  |
| building | TEXT | NULL |  |  |  |  |  |
| apartment | TEXT | NULL |  |  |  |  |  |
| postal_code | TEXT | NULL |  |  |  |  |  |
| latitude | DOUBLE | NULL |  |  |  |  |  |
| longitude | DOUBLE | NULL |  |  |  |  |  |
| geocode_source | TEXT | NULL |  |  |  |  |  |
| geocode_confidence | NUMERIC | NULL |  |  |  |  |  |
| normalized_hash | TEXT | NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |
| updated_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## couriers — Курьеры

- *****REMOVED***:** Workforce
- **Назначение:** Операционный профиль курьера: допуск, статус, тип занятости. Без HR-паспортных данных.
- **Зерно:** 1 строка = один курьер
- **Владелец:** Workforce
- **Источник Superset:** 7775 (ID, job_type, id_courier_type), 5797/7465/7473 (id_courier, job_type_name, active, is_blocked)
- **Статусы:** ACTIVE, SUSPENDED, INACTIVE, PENDING
- **TBD:** Мастер-источник идентичности курьера (BD-017)

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| external_hr_id | TEXT | NULL |  |  |  |  |  |
| external_user_id | TEXT | NULL |  |  |  |  |  |
| display_name | TEXT | NULL |  |  |  |  |  |
| courier_type | TEXT | NULL |  |  |  |  |  |
| employment_type | TEXT | NULL |  |  |  |  |  |
| operational_status | TEXT | NOT NULL |  |  |  | PENDING |  |
| is_blocked | BOOLEAN | NOT NULL |  |  |  | false |  |
| hired_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| terminated_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |
| updated_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## courier_external_ids — Внешние идентификаторы курьера

- *****REMOVED***:** Workforce
- **Назначение:** Сопоставление курьера с внешними системами (HR, Superset, мастер-система).
- **Зерно:** 1 строка = одно сопоставление внешнего ID с периодом действия
- **Владелец:** Workforce
- **Источник Superset:** 7775.ID, 4732.id_courier, 7006/7027/7119 id_courier, 5247/5399 courier_id, 5939.mentorid
- **TBD:** Пересекающиеся периоды проверяются транзакционно, если СУБД не поддерживает exclusion constraints

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| courier_id | UUID | NOT NULL |  | couriers.id |  |  |  |
| source_system | TEXT | NOT NULL |  |  |  |  |  |
| external_id | TEXT | NOT NULL |  |  |  |  |  |
| valid_from | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| valid_to | TIMESTAMPTZ | NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## delivery_zones — ***REMOVED*** доставки

- *****REMOVED***:** Geo
- **Назначение:** Постоянные зоны доставки вокруг торговой точки, утверждаемые географическим отделом.
- **Зерно:** 1 строка = одна зона (версия справочника)
- **Владелец:** Geo
- **Источник Superset:** нет прямого источника; zone_cluster/Куст — кластер, не зона доставки
- **Статусы:** DRAFT, ACTIVE, INACTIVE
- **TBD:** Справочник зон создаётся впервые; правила границ — BD по зонам

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| shop_id | UUID | NOT NULL |  | shops.id |  |  |  |
| code | TEXT | NOT NULL |  |  | UNIQUE |  |  |
| name | TEXT | NOT NULL |  |  |  |  |  |
| boundary_type | TEXT | NOT NULL |  |  |  | UNDEFINED |  |
| boundary_geometry | GEOGRAPHY | NULL |  |  |  |  |  |
| status | TEXT | NOT NULL |  |  |  | DRAFT |  |
| approved_by | UUID | NULL |  |  |  |  |  |
| approved_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| valid_from | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| valid_to | TIMESTAMPTZ | NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |
| updated_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## zone_boundary_versions — Версии границ зон

- *****REMOVED***:** Geo
- **Назначение:** История изменений границ для воспроизводимости назначений.
- **Зерно:** 1 строка = одна версия границы зоны
- **Владелец:** Geo
- **Источник Superset:** нет
- **TBD:** Нужна ли полная история границ в MVP (BD-022)

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| zone_id | UUID | NOT NULL |  | delivery_zones.id |  |  |  |
| version | INTEGER | NOT NULL |  |  |  |  |  |
| boundary_geometry | GEOGRAPHY | NOT NULL |  |  |  |  |  |
| change_reason | TEXT | NOT NULL |  |  |  |  |  |
| created_by | UUID | NOT NULL |  |  |  |  |  |
| approved_by | UUID | NULL |  |  |  |  |  |
| valid_from | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| valid_to | TIMESTAMPTZ | NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## orders — ***REMOVED***ы

- *****REMOVED***:** Operations
- **Назначение:** Операционный заказ: жизненный цикл, готовность, доставка, отмена/возврат.
- **Зерно:** 1 строка = один заказ
- **Владелец:** Operations
- **Источник Superset:** 4732 (id_order, id_general, order_status, date_order, date_collected, date_delivered, shopno, id_courier)
- **Статусы:** RECEIVED, ACCEPTED, COLLECTING, COLLECTED, READY, ASSIGNED, IN_DELIVERY, DELIVERED, CANCELLED, RETURNED, EXCEPTION
- **TBD:** ready_at не заполняется из date_status_10/date_collected; источник — BD-013; Точные статусы и переходы — BD-014

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| external_order_id | TEXT | NOT NULL |  |  |  |  |  |
| source_system | TEXT | NOT NULL |  |  |  |  |  |
| shop_id | UUID | NOT NULL |  | shops.id |  |  |  |
| delivery_address_id | UUID | NULL |  | addresses.id |  |  |  |
| customer_reference | TEXT | NULL |  |  |  |  |  |
| order_status | TEXT | NOT NULL |  |  |  | RECEIVED |  |
| priority | TEXT | NULL |  |  |  |  |  |
| order_created_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| accepted_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| collection_started_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| collected_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| ready_at | TIMESTAMPTZ | NULL |  |  |  |  | TBD |
| delivery_started_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| delivered_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| cancelled_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| returned_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| sla_due_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| source_updated_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |
| updated_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## order_amount_snapshots — Снимки сумм заказа

- *****REMOVED***:** Operations
- **Назначение:** Аналитические суммы заказа отдельно от операционного заказа. Не являются оплатой курьера.
- **Зерно:** 1 строка = одна сумма заказа на момент снимка
- **Владелец:** Operations
- **Источник Superset:** 4732 (sum_order, sum_paid, sum_paid_disc)
- **TBD:** Не использовать для расчёта оплаты курьера

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| order_id | UUID | NOT NULL |  | orders.id |  |  |  |
| amount | NUMERIC | NOT NULL |  |  |  |  |  |
| currency | TEXT | NOT NULL |  |  |  | RUB |  |
| amount_type | TEXT | NOT NULL |  |  |  |  |  |
| source_system | TEXT | NOT NULL |  |  |  |  |  |
| captured_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## order_status_history — История статусов заказа

- *****REMOVED***:** Operations
- **Назначение:** Append-only история переходов статуса заказа.
- **Зерно:** 1 строка = один переход статуса
- **Владелец:** Operations
- **Источник Superset:** 4732 order_status/date_status_10; 7006/7027 status_name

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| order_id | UUID | NOT NULL |  | orders.id |  |  |  |
| from_status | TEXT | NULL |  |  |  |  |  |
| to_status | TEXT | NOT NULL |  |  |  |  |  |
| changed_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| changed_by_type | TEXT | NULL |  |  |  |  |  |
| changed_by_id | UUID | NULL |  |  |  |  |  |
| source_system | TEXT | NOT NULL |  |  |  |  |  |
| source_event_id | TEXT | NULL |  |  |  |  |  |
| reason | TEXT | NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## order_readiness — Готовность заказа

- *****REMOVED***:** Operations
- **Назначение:** Подтверждённый факт готовности заказа к передаче курьеру.
- **Зерно:** 1 строка = одна попытка готовности заказа
- **Владелец:** Operations
- **Источник Superset:** кандидат: 3466.time_ready (тип не определён); date_status_10/date_collected — гипотезы
- **Статусы:** CONFIRMED, REVOKED, DISPUTED
- **TBD:** Кто и когда фиксирует готовность — BD-013

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| order_id | UUID | NOT NULL |  | orders.id |  |  |  |
| ready_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| ready_source | TEXT | NOT NULL |  |  |  |  |  |
| ready_actor_type | TEXT | NULL |  |  |  |  |  |
| ready_actor_id | UUID | NULL |  |  |  |  |  |
| confirmation_status | TEXT | NOT NULL |  |  |  | CONFIRMED |  |
| attempt_no | INTEGER | NOT NULL |  |  |  | 1 |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## work_slots — Рабочие слоты

- *****REMOVED***:** Workforce
- **Назначение:** Опциональные слоты бронирования смен.
- **Зерно:** 1 строка = один рабочий слот
- **Владелец:** Workforce
- **Источник Superset:** нет; 7021 hours_on_schedule — плановые часы
- **Статусы:** OPEN, CLOSED, CANCELLED
- **TBD:** Нужны ли слоты или только отметка прибытия — BD-020

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| shop_id | UUID | NOT NULL |  | shops.id |  |  |  |
| starts_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| ends_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| capacity | INTEGER | NULL |  |  |  |  |  |
| status | TEXT | NOT NULL |  |  |  | OPEN |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |
| updated_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## courier_shifts — Смены курьеров

- *****REMOVED***:** Workforce
- **Назначение:** Фактический интервал работы курьера на торговой точке.
- **Зерно:** 1 строка = одна смена курьера
- **Владелец:** Workforce
- **Источник Superset:** 7802 (id_shift, id_courier, dt, shopno, shift_minutes, wait_minutes), 7712 (shift_opened, shift_open_time), 7021 (shift_type, is_night_shift, hours_on_schedule, has_timesheet)
- **Статусы:** PLANNED, STARTED, ON_BREAK, AVAILABLE, COMPLETED, NO_SHOW, CANCELLED
- **TBD:** Фактическая модель смен в реальном времени — новые события; историческая загрузка из 7802 возможна после подтверждения

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| courier_id | UUID | NOT NULL |  | couriers.id |  |  |  |
| shop_id | UUID | NOT NULL |  | shops.id |  |  |  |
| work_slot_id | UUID | NULL |  | work_slots.id |  |  |  |
| external_shift_id | TEXT | NULL |  |  |  |  |  |
| shift_type | TEXT | NULL |  |  |  |  | TBD |
| is_night_shift | BOOLEAN | NULL |  |  |  |  |  |
| planned_start_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| planned_end_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| actual_start_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| actual_end_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| shift_status | TEXT | NOT NULL |  |  |  | PLANNED |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |
| updated_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## courier_queue_entries — ***REMOVED*** курьеров

- *****REMOVED***:** Workforce
- **Назначение:** FIFO-очередь курьеров на торговой точке в рамках смены.
- **Зерно:** 1 строка = один вход курьера в очередь
- **Владелец:** Workforce
- **Источник Superset:** нет прямой очереди; косвенно wait_time/wait_time2/date_for_wait2 (2339, 3466)
- **Статусы:** WAITING, SKIPPED, OFFERED, ASSIGNED, PAUSED, LEFT, CLOSED
- **TBD:** Возврат пропущенного курьера и приоритет — BD-004

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| courier_id | UUID | NOT NULL |  | couriers.id |  |  |  |
| shop_id | UUID | NOT NULL |  | shops.id |  |  |  |
| shift_id | UUID | NOT NULL |  | courier_shifts.id |  |  |  |
| arrived_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| queue_sequence | BIGINT | NOT NULL |  |  |  |  |  |
| queue_status | TEXT | NOT NULL |  |  |  | WAITING |  |
| ready_for_assignment_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| skipped_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| closed_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| skip_reason | TEXT | NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |
| updated_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## trips — Ходки

- *****REMOVED***:** Delivery
- **Назначение:** Одна поездка курьера с несколькими заказами одной зоны и одного даркстора.
- **Зерно:** 1 строка = одна ходка
- **Владелец:** Operations
- **Источник Superset:** 7006/7027 id_pool_calc, 7119 id_pool; id_pool_calc вычисляемый; «ходка» как сущность не подтверждена
- **Статусы:** DRAFT, FORMED, ASSIGNED, DEPARTED, IN_PROGRESS, RETURNED, COMPLETED, CANCELLED, EXCEPTION
- **TBD:** Соответствие id_pool_calc ↔ trips не утверждено; Многозадачный режим (две активные ходки) — отдельное решение

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| shop_id | UUID | NOT NULL |  | shops.id |  |  |  |
| zone_id | UUID | NOT NULL |  | delivery_zones.id |  |  |  |
| courier_id | UUID | NULL |  | couriers.id |  |  |  |
| shift_id | UUID | NULL |  | courier_shifts.id |  |  |  |
| external_trip_ref | TEXT | NULL |  |  |  |  |  |
| trip_number | TEXT | NULL |  |  |  |  |  |
| trip_status | TEXT | NOT NULL |  |  |  | DRAFT |  |
| formed_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| assigned_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| departed_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| returned_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| completed_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| created_by | UUID | NOT NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |
| updated_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## trip_orders — Состав ходки

- *****REMOVED***:** Delivery
- **Назначение:** ***REMOVED***ы в ходке и их порядок.
- **Зерно:** 1 строка = один заказ в ходке
- **Владелец:** Operations
- **Источник Superset:** 7006/7027 id_pool + id_order; 2339 quantity_batch (размер пакета)
- **TBD:** Активная уникальность order_id реализуется частичным уникальным индексом/транзакцией

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| trip_id | UUID | NOT NULL |  | trips.id |  |  |  |
| order_id | UUID | NOT NULL |  | orders.id |  |  |  |
| sequence_no | INTEGER | NOT NULL |  |  |  |  |  |
| added_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| added_by | UUID | NOT NULL |  |  |  |  |  |
| removed_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| removed_by | UUID | NULL |  |  |  |  |  |
| removal_reason | TEXT | NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## trip_order_membership_history — История состава ходки

- *****REMOVED***:** Delivery
- **Назначение:** Append-only история добавления/удаления заказов из ходки.
- **Зерно:** 1 строка = одно действие над составом
- **Владелец:** Operations
- **Источник Superset:** нет
- **Статусы:** ADDED, REMOVED

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| trip_id | UUID | NOT NULL |  | trips.id |  |  |  |
| order_id | UUID | NOT NULL |  | orders.id |  |  |  |
| action | TEXT | NOT NULL |  |  |  |  |  |
| acted_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| acted_by | UUID | NOT NULL |  |  |  |  |  |
| reason | TEXT | NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## trip_assignments — Назначения ходок

- *****REMOVED***:** Delivery
- **Назначение:** Назначение ходки курьеру.
- **Зерно:** 1 строка = одно назначение ходки
- **Владелец:** Operations
- **Источник Superset:** 4732/7006/7027/7119 id_order+id_courier; date_pickuped (PROBABLE)
- **Статусы:** PROPOSED, ACCEPTED, CANCELLED, DEPARTED, COMPLETED
- **TBD:** Отказ от назначения запрещён; аварийная отмена — BD-011/BD-012

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| trip_id | UUID | NOT NULL |  | trips.id |  |  |  |
| courier_id | UUID | NOT NULL |  | couriers.id |  |  |  |
| queue_entry_id | UUID | NULL |  | courier_queue_entries.id |  |  |  |
| assigned_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| assigned_by | UUID | NOT NULL |  |  |  |  |  |
| assignment_status | TEXT | NOT NULL |  |  |  | PROPOSED |  |
| cancelled_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| cancel_reason | TEXT | NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## delivery_attempts — Попытки доставки

- *****REMOVED***:** Delivery
- **Назначение:** Попытки доставки заказа с результатом.
- **Зерно:** 1 строка = одна попытка доставки
- **Владелец:** Operations
- **Источник Superset:** 4732 date_delivery_start/date_delivered/is_canceled/is_returned_store; 7006/7027 date_pickuped/date_delivered
- **Статусы:** DELIVERED, FAILED, CANCELLED, RETURNED, PARTIAL, UNKNOWN

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| order_id | UUID | NOT NULL |  | orders.id |  |  |  |
| trip_id | UUID | NULL |  | trips.id |  |  |  |
| courier_id | UUID | NOT NULL |  | couriers.id |  |  |  |
| attempt_no | INTEGER | NOT NULL |  |  |  |  |  |
| started_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| completed_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| result | TEXT | NOT NULL |  |  |  | UNKNOWN |  |
| failure_reason | TEXT | NULL |  |  |  |  |  |
| proof_reference | TEXT | NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## courier_events — <ФИО> курьера

- *****REMOVED***:** Events
- **Назначение:** Append-only события курьера/смены.
- **Зерно:** 1 строка = одно событие курьера
- **Владелец:** Workforce
- **Источник Superset:** 5247/5399 event_name/events_qty; 5939 progul (невыход); 7712 shift_opened

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| courier_id | UUID | NOT NULL |  | couriers.id |  |  |  |
| shift_id | UUID | NULL |  | courier_shifts.id |  |  |  |
| shop_id | UUID | NULL |  | shops.id |  |  |  |
| event_type | TEXT | NOT NULL |  |  |  |  |  |
| occurred_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| recorded_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |
| actor_type | TEXT | NULL |  |  |  |  |  |
| actor_id | UUID | NULL |  |  |  |  |  |
| source_system | TEXT | NOT NULL |  |  |  |  |  |
| source_event_id | TEXT | NULL |  |  |  |  |  |
| payload | JSONB | NOT NULL |  |  |  | '{}'::jsonb |  |
| idempotency_key | TEXT | NOT NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## domain_events — Журнал доменных событий

- *****REMOVED***:** Events
- **Назначение:** Общий append-only журнал событий всех агрегатов.
- **Зерно:** 1 строка = одно доменное событие
- **Владелец:** Architecture
- **Источник Superset:** нет

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| aggregate_type | TEXT | NOT NULL |  |  |  |  |  |
| aggregate_id | TEXT | NOT NULL |  |  |  |  |  |
| event_type | TEXT | NOT NULL |  |  |  |  |  |
| event_version | INTEGER | NOT NULL |  |  |  | 1 |  |
| occurred_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| recorded_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |
| actor_type | TEXT | NULL |  |  |  |  |  |
| actor_id | UUID | NULL |  |  |  |  |  |
| source_system | TEXT | NULL |  |  |  |  |  |
| source_event_id | TEXT | NULL |  |  |  |  |  |
| correlation_id | TEXT | NULL |  |  |  |  |  |
| causation_id | TEXT | NULL |  |  |  |  |  |
| idempotency_key | TEXT | NOT NULL |  |  |  |  |  |
| payload | JSONB | NOT NULL |  |  |  | '{}'::jsonb |  |
| schema_version | TEXT | NOT NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## tariff_versions — Версии тарифов

- *****REMOVED***:** Finance
- **Назначение:** Версионируемые тарифы оплаты за доставленный заказ.
- **Зерно:** 1 строка = одна версия тарифа
- **Владелец:** Finance
- **Источник Superset:** 7473 shift_N_profit/shift_N_work_minutes — аналитический ориентир, не тариф
- **Статусы:** DRAFT, APPROVED, ACTIVE, RETIRED
- **TBD:** Формула тарифа по зоне и расстоянию — BD-008; Действующие суммы не создаются до утверждения

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| name | TEXT | NOT NULL |  |  |  |  |  |
| zone_id | UUID | NULL |  | delivery_zones.id |  |  |  |
| shop_id | UUID | NULL |  | shops.id |  |  |  |
| distance_from_m | INTEGER | NULL |  |  |  |  |  |
| distance_to_m | INTEGER | NULL |  |  |  |  |  |
| order_type | TEXT | NULL |  |  |  |  |  |
| base_amount | NUMERIC | NOT NULL |  |  |  |  |  |
| currency | TEXT | NOT NULL |  |  |  | RUB |  |
| effective_from | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| effective_to | TIMESTAMPTZ | NULL |  |  |  |  |  |
| approved_by | UUID | NULL |  |  |  |  |  |
| approved_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| status | TEXT | NOT NULL |  |  |  | DRAFT |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## courier_accruals — Начисления курьерам

- *****REMOVED***:** Finance
- **Назначение:** Начисление за доставленный заказ с основанием расчёта.
- **Зерно:** 1 строка = одно начисление по попытке доставки
- **Владелец:** Finance
- **Источник Superset:** нет подтверждённого тарифа; sum_paid не использовать
- **Статусы:** PENDING, APPROVED, REVERSED, PAID, ON_HOLD
- **TBD:** Когда начисление окончательно и кто подтверждает — BD-010

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| courier_id | UUID | NOT NULL |  | couriers.id |  |  |  |
| order_id | UUID | NOT NULL |  | orders.id |  |  |  |
| delivery_attempt_id | UUID | NOT NULL |  | delivery_attempts.id |  |  |  |
| trip_id | UUID | NULL |  | trips.id |  |  |  |
| tariff_version_id | UUID | NULL |  | tariff_versions.id |  |  |  |
| calculation_basis | JSONB | NULL |  |  |  |  |  |
| amount | NUMERIC | NOT NULL |  |  |  |  |  |
| currency | TEXT | NOT NULL |  |  |  | RUB |  |
| accrual_status | TEXT | NOT NULL |  |  |  | PENDING |  |
| earned_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| approved_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| paid_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |
| updated_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## accrual_adjustments — Корректировки начислений

- *****REMOVED***:** Finance
- **Назначение:** Отдельные записи корректировок; исходное начисление не изменяется.
- **Зерно:** 1 строка = одна корректировка начисления
- **Владелец:** Finance
- **Источник Superset:** нет
- **Статусы:** REVERSAL, CORRECTION, MANUAL_ADJUSTMENT

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| accrual_id | UUID | NOT NULL |  | courier_accruals.id |  |  |  |
| adjustment_type | TEXT | NOT NULL |  |  |  |  |  |
| amount_delta | NUMERIC | NOT NULL |  |  |  |  |  |
| reason | TEXT | NOT NULL |  |  |  |  |  |
| approved_by | UUID | NOT NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## mentorship_assignments — Назначения наставника

- *****REMOVED***:** Mentorship
- **Назначение:** Куратор (наставник) и новичок с плановым сроком обучения.
- **Зерно:** 1 строка = одно назначение наставника новичку
- **Владелец:** Mentorship
- **Источник Superset:** 5939 mentorid/mentorfio/mentor_at_date/mentor_same_tt_date/enough_shifts_for_mentor/trainee_shift_in_five
- **Статусы:** ACTIVE, COMPLETED, EXTENDED, CANCELLED
- **TBD:** Кто назначает новичка куратору — BD-001; Условия отрицательного результата/продления не определены

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| mentor_courier_id | UUID | NOT NULL |  | couriers.id |  |  |  |
| trainee_courier_id | UUID | NOT NULL |  | couriers.id |  |  |  |
| assigned_by | UUID | NULL |  |  |  |  |  |
| starts_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| planned_ends_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
| actual_ends_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| status | TEXT | NOT NULL |  |  |  | ACTIVE |  |
| completion_confirmed_by | UUID | NULL |  |  |  |  |  |
| completion_confirmed_at | TIMESTAMPTZ | NULL |  |  |  |  |  |
| created_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |
| updated_at | TIMESTAMPTZ | NOT NULL |  |  |  | now() |  |

## mentorship_shift_reviews — Оценки смен новичка

- *****REMOVED***:** Mentorship
- **Назначение:** Оценка первых смен новичка куратором.
- **Зерно:** 1 строка = оценка одной смены новичка
- **Владелец:** Mentorship
- **Источник Superset:** 7473 shift_N/shift_N_profit/shift_N_work_minutes; 5939 shift_rn_trainee
- **TBD:** Шкала и формула успеха требуют согласования

| Поле | Тип | Null | PK | FK | Unique | Default | TBD |
|---|---|---|---|---|---|---|---|
| id | UUID | NULL | PK |  |  |  |  |
| mentorship_assignment_id | UUID | NOT NULL |  | mentorship_assignments.id |  |  |  |
| shift_id | UUID | NOT NULL |  | courier_shifts.id |  |  |  |
| shift_number | INTEGER | NOT NULL |  |  |  |  |  |
| delivery_quality_score | NUMERIC | NULL |  |  |  |  |  |
| rules_compliance_score | NUMERIC | NULL |  |  |  |  |  |
| review_comment | TEXT | NULL |  |  |  |  |  |
| reviewed_by | UUID | NOT NULL |  |  |  |  |  |
| reviewed_at | TIMESTAMPTZ | NOT NULL |  |  |  |  |  |
