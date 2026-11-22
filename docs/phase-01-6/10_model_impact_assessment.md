# 10. Влияние на модель данных Этапа 1.5

DDL не изменялся. Ниже — перечень необходимых корректировок (предложение к Этапу 1.7).

| Таблица | Необходимость | Зерно | Ключи | Связи | Изменения | TBD | Удалить/перенести | События |
|---|---|---|---|---|---|---|---|---|
| shops | ПОДТВЕРЖДЕНА | не проверено данными | shopno/id_tt (имена подтверждены) | используется во всех источниках | нет | code vs external_source_id | нет | — |
| addresses | ЧАСТИЧНО | не проверено | нет подтверждённого адресного ключа | geo — строка, не разобрана | добавить geo_source | парсинг geo, PII | нет | — |
| couriers | ПОДТВЕРЖДЕНА | не проверено | id_courier подтверждён как имя, но не как единый ключ | разные идентификаторы в 5939/7021/3466 | усилить courier_external_ids | мастер-источник (BD-017) | нет | COURIER_REGISTERED |
| courier_external_ids | ПОДТВЕРЖДЕНА | не проверено | требуется справочник | MISMATCH типов между источниками | добавить namespace/source_type | правила сопоставления | нет | — |
| delivery_zones | НЕ ПОДТВЕРЖДЕНА ИСТОЧНИКОМ | — | — | нет источника | остаётся новым справочником | границы, утверждение | нет | ZONE_CREATED |
| zone_boundary_versions | ПОД ВОПРОСОМ (BD-022) | — | — | нет источника | возможно отложить | нужна ли версионность | возможен перенос на поздний этап | ZONE_BOUNDARY_CHANGED |
| orders | ПОДТВЕРЖДЕНА | id_order (подтверждено именами, не данными) | id_order + id_general | 3466/2339 key-compatible | уточнить статусы и ready_at | order_status словарь (BD-014), ready_at (BD-013) | нет | ORDER_IMPORTED/ORDER_READY |
| order_amount_snapshots | ПОДТВЕРЖДЕНА | сумма на снимок | order_id | sum_paid/sum_order есть в 3466 | нет | — | нет | — |
| order_status_history | ПОДТВЕРЖДЕНА | переход | order_id | date_status_10 в 3466/7021 | уточнить источник переходов | словарь статусов | нет | ORDER_STATUS_CORRECTED |
| order_readiness | ПОДТВЕРЖДЕНА КАК ПОТРЕБНОСТЬ | попытка готовности | order_id + attempt_no | кандидат time_ready ОПРОВЕРГНУТ (нет в SQL датасета) | ready_source обязателен; готовность вводится новым событием | источник готовности (BD-013 = CONTRADICTED) | нет | ORDER_READY |
| work_slots | НЕ ПОДТВЕРЖДЕНА | — | — | нет источника слотов | вероятно не нужна для MVP | BD-020 | возможен перенос | SHIFT_PLANNED |
| courier_shifts | ПОДТВЕРЖДЕНА | ПОДТВЕРЖДЕНО: одна строка на id_shift (rn_shift=1); физическая таблица shifts | external_shift_id = id_shift; физические поля id_courier, id_pool, shift_start, shift_finish | источник agile_mart_operational.shifts; связь с 7712 по ключу отсутствует | добавить shift_start/shift_finish и разбивку минут (wait/assembly/delivery/useless) | shift_type из 7021 использовать НЕЛЬЗЯ (вычисляется из табеля сборщиков) | shift_type (из 7021) — исключить | SHIFT_STARTED/SHIFT_ENDED |
| courier_queue_entries | ПОДТВЕРЖДЕНА ФИЗИЧЕСКОЙ ТАБЛИЦЕЙ | вход курьера в очередь (queue_in/queue_out) | courier_queue: courier_id, id_shift, queue_in_dttm, queue_out_dttm, has_order; arrival_time (7006/7027/7119) — кандидат в arrived_at | источник agile_mart_operational.courier_queue; arrival_time в 7006/7027/7119 | queue_in_dttm/queue_out_dttm вместо arrived_at/closed_at; has_order как признак | правило возврата (BD-004) | нет | COURIER_JOINED_QUEUE |
| trips | ПОДТВЕРЖДЕНА СХЕМОЙ pools | пул (id_pool) с pool_start/pool_finish | id_pool; shifts.id_pool; id_pool_calc (7006) — вычисляемый; pool_size (7006/7024/7027/7119) | pools(id_pool,id_order,pool_start,pool_finish) — физическая связь пул↔заказ | pool_start/pool_finish вместо formed_at/departed_at; pool_size для контроля 3–5 заказов | соответствие pool ↔ trip (проверка данных) | нет | TRIP_FORMED |
| trip_orders | ПОДТВЕРЖДЕНА СХЕМОЙ pools | заказ в пуле (id_pool × id_order) | id_pool + id_order; pickup_seq (7006/7027/7119) — кандидат в sequence_no | pools.id_order подтверждает состав пула на уровне схемы | pickup_seq как кандидат порядка; quantity_batch не использовать | порядок заказов (sequence_no) не подтверждён | нет | TRIP_ORDER_ADDED |
| trip_order_membership_history | ПОДТВЕРЖДЕНА КАК ПОТРЕБНОСТЬ | действие | trip_id+order_id | источника нет | нет | — | нет | TRIP_ORDER_REMOVED |
| trip_assignments | ПОДТВЕРЖДЕНА КАК ПОТРЕБНОСТЬ | назначение | trip_id+courier_id; date_pickuped (7006/7027/7119) — кандидат в assigned_at; pickup_to_courier_minute | id_courier + date_pickuped в 7006/7027/7119; события назначения в источниках нет | не менять до проверки данных | аварийная отмена (BD-011/012) | нет | TRIP_ASSIGNED |
| delivery_attempts | ПОДТВЕРЖДЕНА | попытка | order_id+attempt_no | date_delivered/date_delivery_start в 3466 | уточнить result | частичная доставка (BD-021) | нет | ORDER_DELIVERED |
| courier_events | ПОДТВЕРЖДЕНА | событие | idempotency_key | источники: photo_control_shift_attempt, courier_queue; словаря событий нет | добавить event_type dictionary | словарь событий | нет | SHIFT_STARTED/BREAK_STARTED |
| domain_events | ПОДТВЕРЖДЕНА КАК АРХИТЕКТУРА | событие | idempotency_key | источника нет (новый журнал) | нет | срок хранения (BD-023) | нет | все |
| tariff_versions | НЕ ПОДТВЕРЖДЕНА ИСТОЧНИКОМ | версия | — | нет тарифных таблиц | остаётся новым справочником | формула (BD-008) | нет | TARIFF_APPROVED |
| courier_accruals | ПОДТВЕРЖДЕНА КАК ПОТРЕБНОСТЬ | начисление на попытку | delivery_attempt_id | источника выплат нет; stake не использовать | нет | формула и подтверждение (BD-008/010) | нет | COURIER_ACCRUAL_CREATED |
| accrual_adjustments | ПОДТВЕРЖДЕНА КАК ПОТРЕБНОСТЬ | корректировка | accrual_id | источника нет | нет | правило возврата (BD-007) | нет | ACCRUAL_ADJUSTED |
| mentorship_assignments | ТРЕБУЕТ УТОЧНЕНИЯ | возможно ТТ × период, а не новичок | mentorid — строка; фильтр mentor_same_tt_date = 1 | источник actual_assistant_tt (справочник помощников ТТ); date_for_mentor НЕ формируется SQL | пересмотреть зерно: возможно (mentor, TT, period); убрать date_for_mentor | кто назначает (BD-001) | date_for_mentor (нет в SQL); возможно разделить на mentor_assignment и trainee_program | MENTORSHIP_ASSIGNED |
| mentorship_shift_reviews | НЕ ПОДТВЕРЖДЕНА | оценка смены | assignment+shift | шкал оценок в источниках нет | нет | шкала и формула | нет | MENTORSHIP_SHIFT_REVIEWED |

## Приоритетные корректировки
1. `courier_shifts`: зерно подтверждено (одна строка на id_shift); физические поля `shift_start`/`shift_finish`; **исключить shift_type из 7021** (вычисляется из табеля сборщиков).
2. `courier_queue_entries`: подтверждена физическая таблица `agile_mart_operational.courier_queue` (queue_in_dttm/queue_out_dttm/has_order).
3. `trips`/`trip_orders`: `agile_mart_operational.pools` содержит `id_pool` и `id_order` — связь пул↔заказ подтверждена на уровне схемы.
4. `order_readiness`: кандидат `time_ready` **опровергнут** (не формируется SQL); готовность — новое событие.
5. `mentorship_assignments`: убрать `date_for_mentor` (нет в SQL); пересмотреть зерно (наставник × ТТ × период).
6. `courier_events`: подтверждены кандидаты-источники (photo_control_shift_attempt, courier_queue), словарь событий отсутствует.
7. `work_slots`, `zone_boundary_versions`: источников нет — возможно отложить.
8. Устаревшие колонки метаданных Superset (`time_ready`, `time_ready_plan`, `date_for_mentor`) — не использовать и не переносить в новую модель.
