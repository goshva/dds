# 03 — Attribute Catalog

**Сгенерировано:** 2026-11-22T15:07:15.503Z  
**Всего атрибутов:** 60  
**Сущностей с атрибутами:** 31 из 39

## 1. Правила

- `logical_type` — логический тип, не физический.
- `nullable` и `required` не утверждаются без проверки данных; `UNKNOWN` означает,
  что свойство не проверено.
- `source_fields` указывает dataset и поле, где атрибут встречается в SQL.
- PII-классификация: `NONE` — не персональные данные; `POSSIBLE` — возможны;
  `CONFIRMED` — подтверждены. Значения PII не выгружаются.

## 2. Атрибуты по сущностям

### ENT-ORDER — ***REMOVED*** (Order)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-ORDER-001 | order_id | Идентификатор заказа | string | UNKNOWN | id_order | 3466 | EVD-001 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Кандидат канонического ключа; id_general — альтернатива. |
| ATT-ORDER-002 | order_status | Статус заказа | enum | UNKNOWN | status_name | 4732 | EVD-014 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Список статусов не утверждён. |
| ATT-ORDER-003 | created_at | Время создания | timestamp | UNKNOWN | date_order | 3466 | EVD-001 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Часовой пояс требует подтверждения. |
| ATT-ORDER-004 | delivered_at | Время доставки | timestamp | UNKNOWN | date_delivered | 3466 | EVD-001 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Может быть пустым для отменённых. |
| ATT-ORDER-005 | amount | Сумма заказа | decimal | UNKNOWN | sum_order | 3466 | EVD-001 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Не является заработком курьера. |
| ATT-ORDER-006 | paid_amount | Оплаченная сумма | decimal | UNKNOWN | sum_paid | 3466 | EVD-001 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Не является заработком курьера. |

### ENT-DARKSTORE — Даркстор / ТТ (Darkstore)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-DS-001 | shopno | Номер ТТ | string | UNKNOWN | shopno | 3466 | EVD-001 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Кандидат ключа; мастер-ключ не подтверждён. |
| ATT-DS-002 | name | Название ТТ | string | UNKNOWN | name_tt | 3466 | EVD-001 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Может дублироваться. |
| ATT-DS-003 | region | Регион | string | UNKNOWN | region_name | 7036 | EVD-010 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Не зона доставки. |

### ENT-COURIER — Курьер (Courier)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-COURIER-001 | courier_id | Идентификатор курьера | string | UNKNOWN | id_courier | 5797 | EVD-011 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Мастер-идентичность не подтверждена. |
| ATT-COURIER-002 | status | Статус курьера | enum | UNKNOWN | active | 5797 | EVD-011 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Список статусов не утверждён. |
| ATT-COURIER-003 | hired_at | Дата найма | date | UNKNOWN | event_hiring | 5797 | EVD-011 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Может быть датой события. |
| ATT-COURIER-004 | dismissed_at | Дата увольнения | date | UNKNOWN | date_dismissed | 5797 | EVD-011 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Пусто для активных. |

### ENT-DELIVERY — Доставка (Delivery)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-DELIVERY-001 | delivery_id | Идентификатор доставки | string | UNKNOWN | delivery_id | 7119 | EVD-003 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Кандидат; не доказан. |
| ATT-DELIVERY-002 | delivered_at | Время доставки | timestamp | UNKNOWN | date_delivered | 7119 | EVD-003 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Часовой пояс не подтверждён. |
| ATT-DELIVERY-003 | outcome | Исход доставки | enum | UNKNOWN | status_name | 7119 | EVD-003 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Список исходов не утверждён. |

### ENT-TRIP — Поездка (Trip)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-TRIP-001 | trip_id | Идентификатор поездки | string | UNKNOWN | id_pool | 7802 | EVD-002 | INFERRED_FROM_MULTIPLE_SOURCES | LOW | нет | id_pool — кандидат, не доказано равенство Trip. |
| ATT-TRIP-002 | departure_at | Время выезда | timestamp | UNKNOWN | pool_finish | 7802 | EVD-002 | INFERRED_FROM_MULTIPLE_SOURCES | LOW | нет | Семантика pool_finish не подтверждена. |

### ENT-TRIP-ORDER — Состав поездки (TripOrder)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-TRIPORDER-001 | trip_id | Поездка | string | UNKNOWN | id_pool | 7802 | EVD-002 | INFERRED_FROM_MULTIPLE_SOURCES | LOW | нет | Связь с Trip не подтверждена. |
| ATT-TRIPORDER-002 | order_id | ***REMOVED*** | string | UNKNOWN | id_order | 7802 | EVD-002 | INFERRED_FROM_MULTIPLE_SOURCES | LOW | нет | Состав поездки не подтверждён. |

### ENT-COURIER-ASSIGNMENT — Назначение курьера (CourierAssignment)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-ASSIGN-001 | courier_id | Курьер | string | UNKNOWN | courier_id_darkstore | 7119 | EVD-003 | INFERRED_FROM_MULTIPLE_SOURCES | LOW | нет | Не доказано, что это назначение. |
| ATT-ASSIGN-002 | assigned_at | Время назначения | timestamp | UNKNOWN | date_pickuped | 7006 | EVD-004 | INFERRED_FROM_MULTIPLE_SOURCES | LOW | нет | date_pickuped — кандидат, не доказано. |

### ENT-QUEUE-ENTRY — Запись в очереди (QueueEntry)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-QUEUE-001 | queue_in | Вход в очередь | timestamp | UNKNOWN | queue_in_dttm | 7802 | EVD-002 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Поле присутствует в SQL. |
| ATT-QUEUE-002 | queue_out | Выход из очереди | timestamp | UNKNOWN | queue_out_dttm | 7802 | EVD-002 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Поле присутствует в SQL. |
| ATT-QUEUE-003 | has_order | Получил заказ | boolean | UNKNOWN | has_order | 7802 | EVD-002 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Семантика не подтверждена. |

### ENT-COURIER-SHIFT — ***REMOVED*** курьера (CourierShift)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-SHIFT-001 | shift_id | Идентификатор смены | string | UNKNOWN | id_shift | 7802 | EVD-002 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Поле присутствует в SQL. |
| ATT-SHIFT-002 | shift_start | Начало смены | timestamp | UNKNOWN | shift_start | 7802 | EVD-002 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Поле присутствует в SQL. |
| ATT-SHIFT-003 | shift_finish | Окончание смены | timestamp | UNKNOWN | shift_finish | 7802 | EVD-002 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Поле присутствует в SQL. |

### ENT-SHIFT-BREAK — Перерыв смены (ShiftBreak)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-BREAK-001 | break_start | Начало перерыва | timestamp | UNKNOWN | break_start | 7802 | EVD-002 | NOT_VERIFIABLE | NONE | нет | Отдельная сущность перерыва не подтверждена. |

### ENT-SHIFT-SLOT — Слот смены (ShiftSlot)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-SLOT-001 | slot_id | Идентификатор слота | string | UNKNOWN | slot_id | — | EVD-034 | NOT_VERIFIABLE | NONE | нет | Процесс слотов не определён. |

### ENT-ROUTE — Маршрут (Route)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-ROUTE-001 | route_id | Идентификатор маршрута | string | UNKNOWN | id_route | 7119 | EVD-003 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Поле присутствует; связь с Trip не доказана. |
| ATT-ROUTE-002 | distance | Расстояние | decimal | UNKNOWN | distance | 7024 | EVD-026 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Единицы измерения не подтверждены. |

### ENT-READY-EVENT — Событие готовности (ReadyEvent)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-READY-001 | ready_at | Время готовности | timestamp | UNKNOWN | time_ready | — | EVD-001 | BUSINESS_REQUIRED_NOT_FOUND | NONE | нет | time_ready отсутствует в SQL 3466. |

### ENT-ASSEMBLY-EVENT — Событие сборки (AssemblyEvent)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-ASSEMBLY-001 | assembly_start | Начало сборки | timestamp | UNKNOWN | date_collect_start | 3466 | EVD-001 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Поле присутствует; семантика требует подтверждения. |
| ATT-ASSEMBLY-002 | assembly_end | Окончание сборки | timestamp | UNKNOWN | date_collected | 3466 | EVD-001 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Поле присутствует; семантика требует подтверждения. |

### ENT-DELIVERY-ZONE — Зона доставки (DeliveryZone)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-ZONE-001 | zone_id | Идентификатор зоны | string | UNKNOWN | zone_id | — | EVD-009 | BUSINESS_REQUIRED_NOT_FOUND | NONE | нет | Справочник зон не найден. |
| ATT-ZONE-002 | geometry | Геометрия зоны | geometry | UNKNOWN | — | — | EVD-009 | BUSINESS_REQUIRED_NOT_FOUND | NONE | нет | Полигоны не подтверждены. |

### ENT-ZONE-BOUNDARY — Версия границы зоны (ZoneBoundaryVersion)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-ZB-001 | version_id | Версия границы | string | UNKNOWN | — | — | EVD-009 | DESIGN_PROPOSAL | NONE | нет | <ФИО>ное предложение, не бизнес-требование. |

### ENT-ADDRESS — Адрес (Address)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-ADDR-001 | address_id | Идентификатор адреса | string | UNKNOWN | — | — | EVD-032 | INFERRED_FROM_MULTIPLE_SOURCES | LOW | подтверждено | Адреса — PII; мастер-реестр не подтверждён. |

### ENT-ADDRESS-ZONE — Привязка адреса к зоне (AddressToZoneAssignment)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-AZ-001 | address_id | Адрес | string | UNKNOWN | — | — | EVD-009 | BUSINESS_REQUIRED_NOT_FOUND | NONE | подтверждено | ***REMOVED*** привязки не подтверждено. |

### ENT-ORDER-STATUS — Статус заказа (OrderStatus)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-OSTATUS-001 | status | Статус | enum | UNKNOWN | status_name | 4732 | EVD-014 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Список статусов не утверждён. |
| ATT-OSTATUS-002 | changed_at | Время изменения | timestamp | UNKNOWN | changed_at | 4732 | EVD-014 | NOT_VERIFIABLE | NONE | нет | История переходов не подтверждена. |

### ENT-PHOTO-CONTROL — Попытка фото-контроля (PhotoControlAttempt)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-PHOTO-001 | attempt_id | Идентификатор попытки | string | UNKNOWN | attempt_id | 7712 | EVD-012 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Поле присутствует в SQL. |
| ATT-PHOTO-002 | attempt_at | Время попытки | timestamp | UNKNOWN | attempt_dt | 7712 | EVD-012 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Поле присутствует в SQL. |

### ENT-COURIER-EVENT — Событие приложения курьера (CourierAppEvent)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-CEVENT-001 | event_name | Название события | string | UNKNOWN | event_name | 5247 | EVD-008 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Агрегат, не event store. |
| ATT-CEVENT-002 | events_qty | Количество событий | integer | UNKNOWN | events_qty | 5247 | EVD-008 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Агрегат; не факт явки. |

### ENT-HR-COURIER-STATUS — HR-статус курьера (HrCourierStatus)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-HRSTATUS-001 | status | HR-статус | enum | UNKNOWN | status | 5797 | EVD-011 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | История не подтверждена. |

### ENT-HR-MENTORSHIP — HR-наставничество (HrMentorship)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-MENTOR-001 | mentor_id | Наставник | string | UNKNOWN | mentorid | 5939 | EVD-006 | FOUND_IN_SUPERSET_SQL | MEDIUM | возможно | Курьерская применимость не доказана. |
| ATT-MENTOR-002 | mentor_at_date | Наставник на дату | date | UNKNOWN | mentor_at_date | 5939 | EVD-006 | FOUND_IN_SUPERSET_SQL | MEDIUM | возможно | date_for_mentor — stale metadata. |

### ENT-TARIFF — Тариф (Tariff)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-TARIFF-001 | tariff_id | Идентификатор тарифа | string | UNKNOWN | — | — | EVD-029 | BUSINESS_REQUIRED_NOT_FOUND | NONE | нет | Источник не найден. |
| ATT-TARIFF-002 | formula | Формула | string | UNKNOWN | — | — | EVD-029 | BUSINESS_REQUIRED_NOT_FOUND | NONE | нет | Формула не утверждена. |

### ENT-COURIER-ACCRUAL — Начисление курьеру (CourierAccrual)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-ACCRUAL-001 | accrual_id | Идентификатор начисления | string | UNKNOWN | — | — | EVD-018 | BUSINESS_REQUIRED_NOT_FOUND | NONE | нет | Ledger не найден. |
| ATT-ACCRUAL-002 | amount | Сумма | decimal | UNKNOWN | — | — | EVD-018 | BUSINESS_REQUIRED_NOT_FOUND | NONE | нет | Формула не утверждена. |

### ENT-PAYOUT — Выплата (Payout)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-PAYOUT-001 | payout_id | Идентификатор выплаты | string | UNKNOWN | — | — | EVD-028 | NOT_FOUND_IN_SUPERSET | NONE | нет | Источник не найден. |

### ENT-SLA-METRIC — Метрика SLA (SlaMetric)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-SLA-001 | sla_interval | Интервал SLA | interval | UNKNOWN | sla_interval | 4732 | EVD-038 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Формула не утверждена. |
| ATT-SLA-002 | compliance | Соблюдение SLA | boolean | UNKNOWN | sla_compliance | 7119 | EVD-038 | FOUND_IN_SUPERSET_SQL | MEDIUM | нет | Исключения не утверждены. |

### ENT-BUSINESS-EVENT — <ФИО>-событие (BusinessEvent)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-BEVENT-001 | event_id | Идентификатор события | string | UNKNOWN | — | — | EVD-037 | NOT_VERIFIABLE | NONE | нет | Единый event log не найден. |

### ENT-TRIP-COMPOSITION-CHANGE — Изменение состава поездки (TripCompositionChange)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-TCC-001 | change_id | Идентификатор изменения | string | UNKNOWN | — | — | EVD-016 | BUSINESS_REQUIRED_NOT_FOUND | NONE | нет | История изменений не найдена. |

### ENT-SOURCE-SYSTEM — Система-источник (SourceSystem)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-SRC-001 | system_code | Код системы | string | UNKNOWN | — | — | EVD-021 | INFERRED_FROM_MULTIPLE_SOURCES | LOW | нет | Конкретные системы не подтверждены. |

### ENT-EVIDENCE-REFERENCE — Ссылка на evidence (DataEvidenceReference)

| ID | Поле | RU | Логический тип | Nullable | Source field | Dataset | Evidence | Статус | Confidence | PII | Примечание |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATT-EVD-001 | evidence_id | Идентификатор evidence | string | NO | — | — | EVD-021 | DESIGN_PROPOSAL | HIGH | нет | Технический реестр этапа. |


## 3. Сущности без подтверждённых атрибутов

| ID | Сущность | Статус | ***REMOVED*** | Примечание |
| --- | --- | --- | --- | --- |
| ENT-ORDER-ITEM | OrderItem | BUSINESS_REQUIRED_NOT_FOUND | NEEDS_EVIDENCE | Не путать с заказом; не выводить из SUM/COUNT. |
| ENT-POOL | Pool | FOUND_IN_SUPERSET_SQL | KEEP | pool_size и pickup_seq — кандидаты, не доказанная семантика. |
| ENT-QUEUE-EVENT | QueueEvent | BUSINESS_REQUIRED_NOT_FOUND | NEW | Не выводить из QueueEntry автоматически. |
| ENT-MENTORSHIP-ASSESSMENT | MentorshipAssessment | BUSINESS_REQUIRED_NOT_FOUND | NEW | Не путать с HR-профилем. |
| ENT-ACCRUAL-LINE | AccrualLine | DESIGN_PROPOSAL | NEW | Не выдавать за подтверждённую сущность. |
| ENT-PAYOUT-LINE | PayoutLine | DESIGN_PROPOSAL | NEW | Не выдавать за подтверждённую сущность. |
| ENT-TARIFF-VERSION | TariffVersion | BUSINESS_REQUIRED_NOT_FOUND | NEW | Формула и владелец версии не утверждены. |
| ENT-TARIFF-RULE | TariffRule | BUSINESS_REQUIRED_NOT_FOUND | NEW | Не путать с shift_N_profit: это не тарифная модель. |

Для этих сущностей источник атрибутов не найден или сущность является проектным
предложением. <ФИО> не означает, что атрибутов нет в организации; это означает,
что они не подтверждены в проверенном охвате.
