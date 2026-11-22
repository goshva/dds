# 02 — Entity Catalog

**Сгенерировано:** 2026-11-22T15:07:15.503Z  
**Всего сущностей:** 39

## 1. Сводка по контекстам

| Контекст | Имя | Сущностей | Есть evidence | Нет источника / не проверяемо |
| --- | --- | --- | --- | --- |
| CTX-ORDER | Заказы и доставка | 6 | 4 | 2 |
| CTX-DARKSTORE | Дарксторы и ТТ | 2 | 2 | 0 |
| CTX-COURIER | Курьеры, смены, очередь, поездки | 11 | 4 | 4 |
| CTX-GEO | География и зоны | 5 | 1 | 3 |
| CTX-FINANCE | Финансы курьеров | 7 | 0 | 7 |
| CTX-HR | Наставничество и HR | 3 | 2 | 1 |
| CTX-ANALYTICS | Аналитика и SLA | 2 | 2 | 0 |
| CTX-SHARED | Общие и аудит | 3 | 0 | 2 |

## 2. Каталог сущностей

| ID | Имя | RU | Слой | Контекст | Grain | Кандидаты ключа | Статус ключа | Статус | Confidence | Решение | PII |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ENT-ORDER | Order | Заказ | BOTH | CTX-ORDER | Одна строка на заказ; конкретное зерно не подтверждено. | id_order, id_general | UNRESOLVED | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | нет |
| ENT-ORDER-ITEM | OrderItem | Строка заказа | TARGET_LOGICAL | CTX-ORDER | Одна строка на позицию заказа; не подтверждено. | order_item_id | UNRESOLVED | BUSINESS_REQUIRED_NOT_FOUND | NONE | NEEDS_EVIDENCE | нет |
| ENT-DARKSTORE | Darkstore | Даркстор / ТТ | BOTH | CTX-DARKSTORE | Одна строка на ТТ; мастер-ключ не подтверждён. | shopno, id_tt | UNRESOLVED | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | нет |
| ENT-COURIER | Courier | Курьер | BOTH | CTX-COURIER | Одна строка на курьера; мастер-идентичность не подтверждена. | id_courier, employee_code | UNRESOLVED | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | подтверждено |
| ENT-DELIVERY | Delivery | Доставка | BOTH | CTX-ORDER | Одна строка на доставку заказа; не подтверждено. | delivery_id, order_id | UNRESOLVED | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | нет |
| ENT-TRIP | Trip | Поездка | TARGET_LOGICAL | CTX-COURIER | Одна строка на поездку; не подтверждено. | trip_id | UNRESOLVED | INFERRED_FROM_MULTIPLE_SOURCES | MEDIUM | KEEP | нет |
| ENT-POOL | Pool | Пул | OBSERVED_SOURCE | CTX-COURIER | Одна строка на pool; не подтверждено. | id_pool | CANDIDATE | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | нет |
| ENT-TRIP-ORDER | TripOrder | Состав поездки | TARGET_LOGICAL | CTX-COURIER | Одна строка на пару поездка-заказ; история изменений. | trip_id, order_id | UNRESOLVED | INFERRED_FROM_MULTIPLE_SOURCES | LOW | NEW | нет |
| ENT-COURIER-ASSIGNMENT | CourierAssignment | Назначение курьера | TARGET_LOGICAL | CTX-COURIER | Одна строка на назначение; не подтверждено. | assignment_id | UNRESOLVED | INFERRED_FROM_MULTIPLE_SOURCES | LOW | NEW | нет |
| ENT-QUEUE-ENTRY | QueueEntry | Запись в очереди | BOTH | CTX-COURIER | Одна строка на вход; не подтверждено. | queue_id, courier_id, queue_in_dttm | UNRESOLVED | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | нет |
| ENT-QUEUE-EVENT | QueueEvent | Событие очереди | TARGET_LOGICAL | CTX-COURIER | Одна строка на событие. | event_id | UNRESOLVED | BUSINESS_REQUIRED_NOT_FOUND | NONE | NEW | нет |
| ENT-COURIER-SHIFT | CourierShift | Смена курьера | BOTH | CTX-COURIER | Одна строка на смену; не подтверждено. | id_shift, id_courier, shift_start | UNRESOLVED | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | нет |
| ENT-SHIFT-BREAK | ShiftBreak | Перерыв смены | TARGET_LOGICAL | CTX-COURIER | Одна строка на перерыв. | break_id | UNRESOLVED | BUSINESS_REQUIRED_NOT_FOUND | NONE | NEW | нет |
| ENT-SHIFT-SLOT | ShiftSlot | Слот смены | TARGET_LOGICAL | CTX-COURIER | Одна строка на слот. | slot_id | UNRESOLVED | NOT_VERIFIABLE | NONE | DEFER | нет |
| ENT-ROUTE | Route | Маршрут | BOTH | CTX-GEO | Одна строка на маршрут; не подтверждено. | route_id | UNRESOLVED | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | нет |
| ENT-READY-EVENT | ReadyEvent | Событие готовности | TARGET_LOGICAL | CTX-ORDER | Одна строка на заказ/событие. | ready_event_id | UNRESOLVED | BUSINESS_REQUIRED_NOT_FOUND | NONE | NEEDS_EVIDENCE | нет |
| ENT-ASSEMBLY-EVENT | AssemblyEvent | Событие сборки | OBSERVED_SOURCE | CTX-ORDER | Одна строка на событие; не подтверждено. | assembly_event_id | UNRESOLVED | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | нет |
| ENT-DELIVERY-ZONE | DeliveryZone | Зона доставки | TARGET_LOGICAL | CTX-GEO | Одна строка на зону; версии границ. | zone_id | UNRESOLVED | BUSINESS_REQUIRED_NOT_FOUND | NONE | KEEP | нет |
| ENT-ZONE-BOUNDARY | ZoneBoundaryVersion | Версия границы зоны | TARGET_LOGICAL | CTX-GEO | Одна строка на версию. | boundary_version_id | UNRESOLVED | DESIGN_PROPOSAL | NONE | NEW | нет |
| ENT-ADDRESS | Address | Адрес | TARGET_LOGICAL | CTX-GEO | Одна строка на адрес. | address_id | UNRESOLVED | INFERRED_FROM_MULTIPLE_SOURCES | LOW | KEEP | подтверждено |
| ENT-ADDRESS-ZONE | AddressToZoneAssignment | Привязка адреса к зоне | TARGET_LOGICAL | CTX-GEO | Одна строка на адрес/зону. | address_id, zone_id | UNRESOLVED | BUSINESS_REQUIRED_NOT_FOUND | NONE | NEW | подтверждено |
| ENT-ORDER-STATUS | OrderStatus | Статус заказа | OBSERVED_SOURCE | CTX-ORDER | Одна строка на заказ/переход. | order_id, status, changed_at | UNRESOLVED | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | нет |
| ENT-PHOTO-CONTROL | PhotoControlAttempt | Попытка фото-контроля | OBSERVED_SOURCE | CTX-DARKSTORE | Одна строка на попытку. | attempt_id | CANDIDATE | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | нет |
| ENT-COURIER-EVENT | CourierAppEvent | Событие приложения курьера | OBSERVED_SOURCE | CTX-ANALYTICS | Агрегат по дню/курьеру; не event store. | event_name, courier_id, d | CANDIDATE | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | нет |
| ENT-HR-COURIER-STATUS | HrCourierStatus | HR-статус курьера | OBSERVED_SOURCE | CTX-HR | Одна строка на курьера/изменение. | id_courier, changed_at | UNRESOLVED | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | подтверждено |
| ENT-HR-MENTORSHIP | HrMentorship | HR-наставничество | OBSERVED_SOURCE | CTX-HR | Одна строка на назначение; не подтверждено. | mentor_id, trainee_id, start_date | UNRESOLVED | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | подтверждено |
| ENT-MENTORSHIP-ASSESSMENT | MentorshipAssessment | Оценка наставничества | TARGET_LOGICAL | CTX-HR | Одна строка на оценку. | assessment_id | UNRESOLVED | BUSINESS_REQUIRED_NOT_FOUND | NONE | NEW | возможно |
| ENT-TARIFF | Tariff | Тариф | TARGET_LOGICAL | CTX-FINANCE | Одна строка на тариф; версии. | tariff_id | UNRESOLVED | BUSINESS_REQUIRED_NOT_FOUND | NONE | KEEP | нет |
| ENT-COURIER-ACCRUAL | CourierAccrual | Начисление курьеру | TARGET_LOGICAL | CTX-FINANCE | Одна строка на начисление; не подтверждено. | accrual_id | UNRESOLVED | BUSINESS_REQUIRED_NOT_FOUND | NONE | KEEP | возможно |
| ENT-ACCRUAL-LINE | AccrualLine | Строка начисления | TARGET_LOGICAL | CTX-FINANCE | Одна строка на компонент начисления. | accrual_line_id | UNRESOLVED | DESIGN_PROPOSAL | NONE | NEW | нет |
| ENT-PAYOUT | Payout | Выплата | TARGET_LOGICAL | CTX-FINANCE | Одна строка на выплату/период. | payout_id | UNRESOLVED | NOT_FOUND_IN_SUPERSET | NONE | KEEP | возможно |
| ENT-PAYOUT-LINE | PayoutLine | Строка выплаты | TARGET_LOGICAL | CTX-FINANCE | Одна строка на компонент выплаты. | payout_line_id | UNRESOLVED | DESIGN_PROPOSAL | NONE | NEW | нет |
| ENT-SLA-METRIC | SlaMetric | Метрика SLA | OBSERVED_SOURCE | CTX-ANALYTICS | Одна строка на заказ/интервал. | order_id, sla_interval | UNRESOLVED | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | нет |
| ENT-BUSINESS-EVENT | BusinessEvent | Бизнес-событие | TARGET_LOGICAL | CTX-SHARED | Одна строка на событие. | event_id | UNRESOLVED | NOT_VERIFIABLE | NONE | DEFER | возможно |
| ENT-TRIP-COMPOSITION-CHANGE | TripCompositionChange | Изменение состава поездки | TARGET_LOGICAL | CTX-COURIER | Одна строка на изменение. | change_id | UNRESOLVED | BUSINESS_REQUIRED_NOT_FOUND | NONE | NEW | нет |
| ENT-SOURCE-SYSTEM | SourceSystem | Система-источник | TARGET_LOGICAL | CTX-SHARED | Одна строка на систему. | system_code | CANDIDATE | INFERRED_FROM_MULTIPLE_SOURCES | LOW | NEW | нет |
| ENT-EVIDENCE-REFERENCE | DataEvidenceReference | Ссылка на evidence | TARGET_LOGICAL | CTX-SHARED | Одна строка на evidence. | evidence_id | CANDIDATE | DESIGN_PROPOSAL | HIGH | NEW | нет |
| ENT-TARIFF-VERSION | TariffVersion | Версия тарифа | TARGET_LOGICAL | CTX-FINANCE | Одна строка на версию тарифа. | tariff_version_id | UNRESOLVED | BUSINESS_REQUIRED_NOT_FOUND | NONE | NEW | нет |
| ENT-TARIFF-RULE | TariffRule | Правило тарифа | TARGET_LOGICAL | CTX-FINANCE | Одна строка на правило версии тарифа. | tariff_rule_id | UNRESOLVED | BUSINESS_REQUIRED_NOT_FOUND | NONE | NEW | нет |

## 3. Ограничения и примечания

| ID | Сущность | Примечание |
| --- | --- | --- |
| ENT-ORDER | Order | id_order и id_general могут быть разными уровнями; не объединять без проверки. |
| ENT-ORDER-ITEM | OrderItem | Не путать с заказом; не выводить из SUM/COUNT. |
| ENT-DARKSTORE | Darkstore | shopno и id_tt могут быть разными ключами. |
| ENT-COURIER | Courier | fio, phone, inn — PII; в отчётах только маскирование. |
| ENT-DELIVERY | Delivery | Не смешивать с OrderStatus. |
| ENT-TRIP | Trip | Не переименовывать Pool в Trip без подтверждения Operations. |
| ENT-POOL | Pool | pool_size и pickup_seq — кандидаты, не доказанная семантика. |
| ENT-TRIP-ORDER | TripOrder | История изменений — обязательное требование, источник отсутствует. |
| ENT-COURIER-ASSIGNMENT | CourierAssignment | courier_id_darkstore — кандидат, не доказанное назначение. |
| ENT-QUEUE-ENTRY | QueueEntry | queue_in_dttm / queue_out_dttm / has_order — кандидаты. |
| ENT-QUEUE-EVENT | QueueEvent | Не выводить из QueueEntry автоматически. |
| ENT-COURIER-SHIFT | CourierShift | Не использовать shift_type из 7021. |
| ENT-SHIFT-BREAK | ShiftBreak | Не выводить из разницы timestamp без подтверждения. |
| ENT-SHIFT-SLOT | ShiftSlot | Не смешивать со сменой. |
| ENT-ROUTE | Route | Route ≠ Trip; не объединять. |
| ENT-READY-EVENT | ReadyEvent | Не подменять date_set_cell или is_collected без подтверждения. |
| ENT-ASSEMBLY-EVENT | AssemblyEvent | Не равна готовности. |
| ENT-DELIVERY-ZONE | DeliveryZone | zone_cluster, inactivity_zone, cluster — разные понятия. |
| ENT-ZONE-BOUNDARY | ZoneBoundaryVersion | Не выдавать за бизнес-требование. |
| ENT-ADDRESS | Address | PII: адреса не выгружать. |
| ENT-ADDRESS-ZONE | AddressToZoneAssignment | Не путать с Address. |
| ENT-ORDER-STATUS | OrderStatus | Не смешивать с Delivery. |
| ENT-PHOTO-CONTROL | PhotoControlAttempt | Не смешивать со сменой. |
| ENT-COURIER-EVENT | CourierAppEvent | events_qty ≠ факт явки. |
| ENT-HR-COURIER-STATUS | HrCourierStatus | PII: ФИО, телефон. |
| ENT-HR-MENTORSHIP | HrMentorship | date_for_mentor — stale metadata. |
| ENT-MENTORSHIP-ASSESSMENT | MentorshipAssessment | Не путать с HR-профилем. |
| ENT-TARIFF | Tariff | shift_N_profit — не тариф. |
| ENT-COURIER-ACCRUAL | CourierAccrual | sum_order / sum_paid — не заработок. |
| ENT-ACCRUAL-LINE | AccrualLine | Не выдавать за подтверждённую сущность. |
| ENT-PAYOUT | Payout | Не смешивать с accrual. |
| ENT-PAYOUT-LINE | PayoutLine | Не выдавать за подтверждённую сущность. |
| ENT-SLA-METRIC | SlaMetric | Не исключать отмены/возвраты без решения. |
| ENT-BUSINESS-EVENT | BusinessEvent | Не выдавать за подтверждённую сущность. |
| ENT-TRIP-COMPOSITION-CHANGE | TripCompositionChange | Не путать с TripOrder. |
| ENT-SOURCE-SYSTEM | SourceSystem | Не выдавать за подтверждённую сущность. |
| ENT-EVIDENCE-REFERENCE | DataEvidenceReference | Не включать в бизнес-модель как доменную сущность. |
| ENT-TARIFF-VERSION | TariffVersion | Формула и владелец версии не утверждены. |
| ENT-TARIFF-RULE | TariffRule | Не путать с shift_N_profit: это не тарифная модель. |

## 4. Правила чтения статусов

- `FOUND_IN_SUPERSET_SQL` / `FOUND_IN_SUPERSET_METADATA` / `FOUND_IN_FILTER_VALUES` /
  `FOUND_AS_SQL_DERIVED` — присутствие в артефактах Superset, не в данных.
- `INFERRED_FROM_MULTIPLE_SOURCES` — вывод по нескольким признакам, не подтверждение.
- `BUSINESS_REQUIRED_NOT_FOUND` — бизнес-требование есть, источник не найден.
- `NOT_FOUND_IN_SUPERSET` — не найдено в проверенном охвате Superset.
- `NOT_VERIFIABLE` — нельзя проверить без доступа к данным.
- `DESIGN_PROPOSAL` — проектное предложение, не бизнес-требование.
- `CONTRADICTED` — противоречие между источниками зафиксировано.

Ни одна сущность не помечена `VERIFIED`: фактическая выборка строк не выполнялась.
