# 07 — Queue & Shift Lifecycle

**Сгенерировано:** 2026-11-22T15:07:15.503Z

## 1. Очередь

Бизнес-правила:

1. Курьер назначается после прибытия в ТТ и входа в очередь.
2. Очередь FIFO.
3. Если курьер не готов при вызове — его пропускают и вызывают следующего.
4. Отказ от предложенной поездки не допускается.
5. Максимальное ожидание не утверждено.
6. Нужно учитывать начало/окончание смены, перерыв и возвращение.
7. Поведение пропущенного курьера при возвращении в очередь не определено.

## 2. Смены

- Смена — временной интервал.
- Есть план одного slot system, но booking vs check-in не выяснено.
- No-show thresholds не утверждены.
- `ShiftSlot` — lifecycle unresolved; не подтверждён как booking entity.

## 3. Сущности

| ID | Имя | Слой | Статус | Confidence | Grain |
| --- | --- | --- | --- | --- | --- |
| ENT-QUEUE-ENTRY | QueueEntry | BOTH | FOUND_IN_SUPERSET_SQL | MEDIUM | Одна строка на вход; не подтверждено. |
| ENT-COURIER-SHIFT | CourierShift | BOTH | FOUND_IN_SUPERSET_SQL | MEDIUM | Одна строка на смену; не подтверждено. |
| ENT-SHIFT-BREAK | ShiftBreak | TARGET_LOGICAL | BUSINESS_REQUIRED_NOT_FOUND | NONE | Одна строка на перерыв. |
| ENT-SHIFT-SLOT | ShiftSlot | TARGET_LOGICAL | NOT_VERIFIABLE | NONE | Одна строка на слот. |
| ENT-COURIER | Courier | BOTH | FOUND_IN_SUPERSET_SQL | MEDIUM | Одна строка на курьера; мастер-идентичность не подтверждена. |

## 4. Процессы

| ID | Процесс | Шаги | События | Timestamps | Источник |
| --- | --- | --- | --- | --- | --- |
| PRC-006 | Очередь: вход, FIFO, вызов, пропуск | Вход в очередь → Ожидание → Вызов → Пропуск → Возврат | QueueEntered, CourierCalled, CourierSkipped, QueueReturned | queue_in_dttm, queue_out_dttm | SQL_DEFINITION + BUSINESS_REQUIREMENT |
| PRC-010 | Смена, перерыв, возврат | Начало смены → Перерыв → Окончание смены → Возврат в очередь | ShiftStarted, BreakStarted, ShiftEnded | shift_start, shift_finish | SQL_DEFINITION |

## 5. SQL-наблюдение 7802

`7802 shift_time_breakdown` ссылается на:

- `agile_mart_operational.shifts` — `id_shift`, `id_courier`, `shift_start`, `shift_finish`;
- `agile_mart_operational.pools` — `id_pool`, `pool_start`, `pool_finish`;
- `agile_mart_operational.courier_queue` — `courier_id`, `queue_in_dttm`, `queue_out_dttm`, `first_delivery_dttm`, `has_order`.

`wait_iv` строится от `queue_in_dttm` до `first_delivery_dttm`, `assembly_iv` —
от `first_delivery_dttm` до `queue_out_dttm`. `wait_minutes` — вычисляемый интервал,
а не подтверждённое бизнес-время ожидания.

## 6. Неутверждённые правила

- FIFO: порядок при равных timestamp и tie-breaker не определены.
- Пропуск и повторный вход: событийная модель не подтверждена.
- No-show: пороги и последствия не утверждены.
- Перерыв: длительность, влияние на очередь и оплату не подтверждены.
- Booking vs check-in: не выяснено.
- Максимальное ожидание: не утверждено.
