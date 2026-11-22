# 13. План SQL-проверок (готов к запуску)

Запросов в плане: **18**. Ни один не выполнялся: **BLOCK-1** (SQL Lab → HTTP 403).
Каждый запрос предварительно проверен защитой `assertReadOnly` (только SELECT, одна инструкция).
Ошибок защиты: 0.

| ID | Dataset | СУБД | Назначение | BD | Guard |
|---|---|---|---|---|---|
| P-016-001 | 3466 | clickhouse | Заполняемость кандидатов готовности (BD-013) | BD-013, BD-014 | OK |
| P-016-002 | 3466 | clickhouse | Невозможный порядок дат заказа | BD-013, BD-014 | OK |
| P-016-003 | 3466 | clickhouse | Словарь статусов заказа (BD-014) | BD-014 | OK |
| P-016-004 | 3466 | clickhouse | Дубликаты заказа в таймшите | BD-016 | OK |
| P-016-005 | 7802 | postgresql | Зерно смен: id_shift уникален? | BD-017 | OK |
| P-016-006 | 7802 | postgresql | NULL и отрицательные длительности смены | BD-017 | OK |
| P-016-007 | 7802 | postgresql | Структура пула: заказов на пул | BD-003 | OK |
| P-016-008 | 7802 | postgresql | Очередь: заполняемость и порядок времён | BD-004, BD-002 | OK |
| P-016-009 | 7802 | postgresql | Покрытие связи shifts.id_pool ↔ pools.id_pool | BD-003 | OK |
| P-016-010 | 7712 | postgresql | Фотоконтроль: попытки на курьера и день | BD-013 | OK |
| P-016-011 | 7712 | postgresql | Покрытие связи attempt.courier_id ↔ shifts.id_courier по дню | BD-017 | OK |
| P-016-012 | 5939 | clickhouse | Наставничество: заполняемость mentorid и progul | BD-001 | OK |
| P-016-013 | 5939 | clickhouse | Справочник помощников ТТ: зерно и периоды | BD-001 | OK |
| P-016-014 | 7021 | clickhouse | Табель: корректность интервалов | BD-020 | OK |
| P-016-015 | 2339 | mssql | Смысл quantity_batch и orders_assignment | BD-003, BD-006 | OK |
| P-016-016 | 3466 | clickhouse | Покрытие связи таймшит ↔ заказы по id_order | BD-016 | OK |
| P-016-017 | 3466 | clickhouse | Соотношение id_general и id_order (подзаказы) | BD-016 | OK |
| P-016-018 | 7802 | postgresql | Проверка формулы разбивки минут | BD-017 | OK |

## SQL по запросам

### P-016-001 — Заполняемость кандидатов готовности (BD-013)

- dataset: 3466; database_id: 92; СУБД: clickhouse
- ожидаемый результат: Доли заполнения кандидатов; выбрать наиболее полный и стабильный
- связано с: BD-013, BD-014

```sql
SELECT count(*) AS rows, count(date_status_10) AS status10_filled, count(date_set_cell) AS set_cell_filled, count(date_collected) AS collected_filled, count(date_delivered) AS delivered_filled FROM mart_mixed.darkstore_time_sheet
```

### P-016-002 — Невозможный порядок дат заказа

- dataset: 3466; database_id: 92; СУБД: clickhouse
- ожидаемый результат: 0 или объяснимые исключения
- связано с: BD-013, BD-014

```sql
SELECT count(*) AS bad_rows FROM mart_mixed.darkstore_time_sheet WHERE (date_set_cell IS NOT NULL AND date_order IS NOT NULL AND date_set_cell < date_order) OR (date_delivered IS NOT NULL AND date_set_cell IS NOT NULL AND date_delivered < date_set_cell)
```

### P-016-003 — Словарь статусов заказа (BD-014)

- dataset: 3466; database_id: 92; СУБД: clickhouse
- ожидаемый результат: Перечень статусов и частот для словаря
- связано с: BD-014

```sql
SELECT order_status, count(*) AS cnt FROM mart_mixed.darkstore_time_sheet GROUP BY order_status ORDER BY cnt DESC LIMIT 50
```

### P-016-004 — Дубликаты заказа в таймшите

- dataset: 3466; database_id: 92; СУБД: clickhouse
- ожидаемый результат: Определить зерно: заказ или подзаказ
- связано с: BD-016

```sql
SELECT count(*) AS rows, count(DISTINCT id_order) AS orders, count(DISTINCT id_general) AS generals FROM mart_mixed.darkstore_time_sheet
```

### P-016-005 — Зерно смен: id_shift уникален?

- dataset: 7802; database_id: 76; СУБД: postgresql
- ожидаемый результат: rows ≈ shifts (одна строка на смену)
- связано с: BD-017

```sql
SELECT count(*) AS rows, count(DISTINCT id_shift) AS shifts, count(DISTINCT id_courier) AS couriers, min(shift_start) AS min_start, max(shift_finish) AS max_finish FROM agile_mart_operational.shifts
```

### P-016-006 — NULL и отрицательные длительности смены

- dataset: 7802; database_id: 76; СУБД: postgresql
- ожидаемый результат: Отрицательных нет или они объяснены
- связано с: BD-017

```sql
SELECT count(*) AS rows, count(shift_start) AS started, count(shift_finish) AS finished, sum(CASE WHEN shift_finish < shift_start THEN 1 ELSE 0 END) AS negative FROM agile_mart_operational.shifts
```

### P-016-007 — Структура пула: заказов на пул

- dataset: 7802; database_id: 76; СУБД: postgresql
- ожидаемый результат: Заказов больше пулов; размеры 2–5
- связано с: BD-003

```sql
SELECT count(*) AS rows, count(DISTINCT id_pool) AS pools, count(DISTINCT id_order) AS orders FROM agile_mart_operational.pools
```

### P-016-008 — Очередь: заполняемость и порядок времён

- dataset: 7802; database_id: 76; СУБД: postgresql
- ожидаемый результат: queue_in заполнен; queue_out частично
- связано с: BD-004, BD-002

```sql
SELECT count(*) AS rows, count(queue_in_dttm) AS queued_in, count(queue_out_dttm) AS queued_out, sum(CASE WHEN has_order THEN 1 ELSE 0 END) AS with_order FROM agile_mart_operational.courier_queue
```

### P-016-009 — Покрытие связи shifts.id_pool ↔ pools.id_pool

- dataset: 7802; database_id: 76; СУБД: postgresql
- ожидаемый результат: Доля сопоставленных смен с пулом
- связано с: BD-003

```sql
SELECT count(*) AS shift_rows, count(p.id_pool) AS matched FROM agile_mart_operational.shifts s LEFT JOIN agile_mart_operational.pools p ON p.id_pool = s.id_pool
```

### P-016-010 — Фотоконтроль: попытки на курьера и день

- dataset: 7712; database_id: 76; СУБД: postgresql
- ожидаемый результат: Несколько попыток на курьера; max_attempt > 1
- связано с: BD-013

```sql
SELECT count(*) AS rows, count(DISTINCT courier_id) AS couriers, count(DISTINCT attempt_dt) AS days, max(attempt_n) AS max_attempt FROM agile_mart_operational.photo_control_shift_attempt
```

### P-016-011 — Покрытие связи attempt.courier_id ↔ shifts.id_courier по дню

- dataset: 7712; database_id: 76; СУБД: postgresql
- ожидаемый результат: Доля попыток, сопоставленных со сменой
- связано с: BD-017

```sql
SELECT count(*) AS attempt_rows, count(s.id_shift) AS matched_shifts FROM agile_mart_operational.photo_control_shift_attempt a LEFT JOIN agile_mart_operational.shifts s ON s.id_courier = a.courier_id AND s.shift_start::date = a.attempt_dt
```

### P-016-012 — Наставничество: заполняемость mentorid и progul

- dataset: 5939; database_id: 96; СУБД: clickhouse
- ожидаемый результат: Доля NULL в mentorid; смысл progul
- связано с: BD-001

```sql
SELECT count(*) AS rows, count(mentorid) AS mentor_filled, count(DISTINCT mentorid) AS mentors, count(DISTINCT person_code) AS persons, sum(progul) AS progul_sum FROM "agile_mart_techaudit".hr_daily_pers
```

### P-016-013 — Справочник помощников ТТ: зерно и периоды

- dataset: 5939; database_id: 96; СУБД: clickhouse
- ожидаемый результат: Определить, является ли это назначением на ТТ, а не на новичка
- связано с: BD-001

```sql
SELECT count(*) AS rows, count(DISTINCT id_tt) AS tts, count(DISTINCT pu_code) AS pus, min(event_date) AS min_date, max(event_date) AS max_date FROM "agile_mart_techaudit".actual_assistant_tt
```

### P-016-014 — Табель: корректность интервалов

- dataset: 7021; database_id: 96; СУБД: clickhouse
- ожидаемый результат: Интервалы корректны; подтвердить, что это сборщики
- связано с: BD-020

```sql
SELECT count(*) AS rows, count(time_start) AS started, count(time_end) AS finished, sum(CASE WHEN time_end < time_start THEN 1 ELSE 0 END) AS negative, count(DISTINCT id_sbor) AS sbors FROM ods.timesheetfact
```

### P-016-015 — Смысл quantity_batch и orders_assignment

- dataset: 2339; database_id: уточнить; СУБД: mssql
- ожидаемый результат: Распределение размеров пакета; уточнить смысл orders_assignment
- связано с: BD-003, BD-006

```sql
SELECT TOP 50 quantity_batch, count(*) AS cnt FROM Reports.dbo.ksa_time_vw GROUP BY quantity_batch ORDER BY cnt DESC
```

### P-016-016 — Покрытие связи таймшит ↔ заказы по id_order

- dataset: 3466; database_id: 92; СУБД: clickhouse
- ожидаемый результат: Доля сопоставленных заказов
- связано с: BD-016

```sql
SELECT count(*) AS sheet_rows, count(dt.id_order) AS matched FROM mart_mixed.darkstore_time_sheet s LEFT JOIN mart_mixed.darkstore_time dt ON dt.id_order = s.id_order
```

### P-016-017 — Соотношение id_general и id_order (подзаказы)

- dataset: 3466; database_id: 92; СУБД: clickhouse
- ожидаемый результат: Определить, является ли id_order подзаказом
- связано с: BD-016

```sql
SELECT count(*) AS rows, count(DISTINCT id_order) AS orders, count(DISTINCT id_general) AS generals, count(DISTINCT concat(toString(id_general), '-', toString(id_order))) AS pairs FROM mart_mixed.darkstore_time_sheet
```

### P-016-018 — Проверка формулы разбивки минут

- dataset: 7802; database_id: 76; СУБД: postgresql
- ожидаемый результат: 0 — базовая проверка корректности данных
- связано с: BD-017

```sql
SELECT count(*) AS rows FROM agile_mart_operational.shifts s JOIN agile_mart_operational.pools p ON p.id_pool = s.id_pool WHERE s.shift_finish < s.shift_start
```

