# 05 — Order Lifecycle

**Сгенерировано:** 2026-11-22T15:07:15.503Z

## 1. Сущность Order

- **Grain:** Одна строка на заказ; конкретное зерно не подтверждено.
- **Identity:** id_order, id_general (UNRESOLVED)
- **Статус:** FOUND_IN_SUPERSET_SQL, confidence MEDIUM
- **Решение:** KEEP — Ядро MVP; источник и идентичность требуют подтверждения.

## 2. Атрибуты заказа

| ID | Поле | Тип | Nullable | Статус | Примечание |
| --- | --- | --- | --- | --- | --- |
| ATT-ORDER-001 | order_id | string | UNKNOWN | FOUND_IN_SUPERSET_SQL | Кандидат канонического ключа; id_general — альтернатива. |
| ATT-ORDER-002 | order_status | enum | UNKNOWN | FOUND_IN_SUPERSET_SQL | Список статусов не утверждён. |
| ATT-ORDER-003 | created_at | timestamp | UNKNOWN | FOUND_IN_SUPERSET_SQL | Часовой пояс требует подтверждения. |
| ATT-ORDER-004 | delivered_at | timestamp | UNKNOWN | FOUND_IN_SUPERSET_SQL | Может быть пустым для отменённых. |
| ATT-ORDER-005 | amount | decimal | UNKNOWN | FOUND_IN_SUPERSET_SQL | Не является заработком курьера. |
| ATT-ORDER-006 | paid_amount | decimal | UNKNOWN | FOUND_IN_SUPERSET_SQL | Не является заработком курьера. |

## 3. Бизнес-процессы заказа

| ID | Процесс | Шаги | События | Timestamps | Источник |
| --- | --- | --- | --- | --- | --- |
| PRC-001 | Создание и изменение заказа | Создание заказа → Изменение состава/статуса → Отмена | OrderCreated, OrderUpdated, OrderCancelled | created_at, updated_at | SQL_DEFINITION / BUSINESS_REQUIREMENT |
| PRC-002 | Сборка и переход к готовности | Начало сборки → Сборка → Готовность | AssemblyStarted, AssemblyCompleted, OrderReady | date_collect_start, date_collected, ready_at | SQL_DEFINITION; готовность не подтверждена |
| PRC-008 | Доставка и частичное завершение | Доставка заказа → Фиксация результата → Частичное завершение поездки | OrderDelivered, TripPartiallyCompleted | delivered_at | SQL_DEFINITION + BUSINESS_REQUIREMENT |
| PRC-009 | Отмена и возврат | Отмена → Возврат → Фиксация причины | OrderCancelled, OrderReturned | cancelled_at, returned_at | BUSINESS_REQUIREMENT |

## 4. Подтверждённые события

- Создание заказа, обновление, отмена — бизнес-требование.
- Сборка: `date_collect_start`, `date_collected`, `date_set_cell`, `is_collected` —
  присутствуют в SQL, но семантика этапов не утверждена.
- Доставка: `date_delivered`, `date_pickuped`, `date_supply` — присутствуют в SQL.

## 5. Неразрешённое состояние готовности

`time_ready` и `time_ready_plan` отсутствуют в полном SQL датасета 3466.
Кандидаты `date_set_cell`, `date_f_status_3_5`, `date_collect_start`,
`date_collected`, `date_collected_plan`, `is_collected` не являются
автоматическим эквивалентом бизнес-события «заказ готов к выдаче курьеру».

**Статус:** `BUSINESS_REQUIRED_NOT_FOUND` / `NOT_VERIFIABLE`.
Нельзя утверждать, что события готовности нет в организации; доказано только
отсутствие полей в проверенном SQL.

## 6. SLA и отмены/возвраты

- Пользователь ответил «Нет» на исключение отменённых/возвращённых заказов из SLA.
- Точный расчёт отмен/возвратов требует определения.
- `7119` фильтрует `id_status = 18`, `is_route = true`, последние 14 дней —
  это не универсальная SLA-методика.
- `1970-01-01` — sentinel отсутствия даты.
- Глобальный сдвиг +3 часа не применяется.

## 7. MVP-поля списка заказов

| Поле | RU | Статус | Источник | Примечание |
| --- | --- | --- | --- | --- |
| order_id | Стабильный ID заказа | PARTIAL | EVD-001, EVD-003 | id_order/id_general не разграничены. |
| order_status | Текущий статус | PARTIAL | EVD-014 | Справочник статусов не утверждён. |
| darkstore_id | ТТ | PARTIAL | EVD-001 | Мастер-реестр ТТ не подтверждён. |
| created_at | Основные timestamps | PARTIAL | EVD-001 | Семантика и часовой пояс не подтверждены. |
| trip_id | Связь с поездкой/пулом | PARTIAL | EVD-003 | Pool ≠ Trip не доказано. |
| courier_id | Курьер, если назначен | PARTIAL | EVD-003 | Назначение не подтверждено. |
| zone_id | Зона, если доступна | NOT_FOUND | EVD-009 | Справочник зон не найден. |
| ready_at | Готовность | NOT_FOUND | EVD-001 | time_ready отсутствует в SQL 3466. |
| delivered_at | Факт доставки | PARTIAL | EVD-001 | Семантика не подтверждена. |
| cancelled_at | Отмена | PARTIAL | EVD-014 | Правила SLA не утверждены. |
