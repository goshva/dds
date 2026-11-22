# ANALYST_BRIEF — доступные значения и источники Superset (Этап 1.6.2)

Сформировано: 2026-11-22T09:54:14.933Z. Режим: read-only, без обхода RBAC.

## 1. Что доступно

- Датасетов в каталоге: **3778** (P0 — 12, P1 — 659, P2 — 2637).
- Детальные метаданные загружены по **671** датасетам (P0+P1).
- Чартов: **19928**; дашбордов: **332**; фильтров дашбордов: **3264**.
- Колонок в P0/P1: **17216**; колонок с фактическими значениями из фильтров: **2028**.
- SQL Lab и chart data API: **недоступны** (403/401). Значения из реальных выборок не получены.

## 2. Происхождение значений

| Класс | Что означает | Сколько |
|---|---|---:|
| ACTUAL_VALUES | Результаты запросов к данным | 0 |
| FILTER_VALUES | Значения по умолчанию фильтров дашбордов | 650 |
| SQL_DERIVED | Литералы из определений чартов и SQL | 2028 |
| METADATA_ONLY | Только описание колонок и типов | 17216 |
| NOT_AVAILABLE | Значения получить нельзя | 16577 |

## 3. Статусы и категории, найденные в определениях фильтров

| Датасет | Колонка | Значения | Источник |
|---|---|---|---|
| 4732 | partner_type | Цветы | chart_data |
| 5797 | zone_transition_type | Возврат в Green | chart_data |
| 7006 | pickup_minute | 20 | chart_data |
| 7006 | pickup_seq | 2, 12 | chart_data |
| 7006 | pickup_to_courier_minute | 15 | chart_data |
| 7024 | courier_type | вело, авто | chart_data |
| 3035 | is_paid | false, true | chart_data |
| 3035 | date_collected | DATETIME("today") : DATEADD(DATETIME("today"), 1, day), DATETIME("today") : DATEADD(DATETIME("tomorrow"), -1, second) | chart_data |
| 3035 | date_delivered | DATETIME("today") : DATEADD(DATETIME("tomorrow"), -1, second), DATEADD(DATETIME("now"), -7, day) : now, DATEADD(DATETIME("2026-04-17T00:00:00"), -7, day) : 2026-04-17T00:00:00, today :, 2026-01-01 : today, DATEADD(DATETIME("2026-04-14T00:00:00"), -7, day) : 2026-04-14T00:00:00, dateadd(datetime('today'), -7, day) : datetime('tomorrow') | chart_data |
| 3035 | gettype | 6 | chart_data |
| 3035 | id_partner_type | 2, 1 | chart_data |
| 3035 | courier_type | <ФИО>, <ФИО>, <ФИО> Курьер, Автономный мобильный Авто курьер, Автономный мобильный Вело курьер, <ФИО>, Ночной авто курьер | chart_data |
| 3035 | delivery_type | ЗиЗ-12, ЗиЗ-11, ЗиЗ-20, ЗиЗ-10, ЗиЗ-13, ЗиЗ-06, ЗиЗ-21, ЗиЗ-01, <ФИО>.Доставка, Достависта | chart_data |
| 3035 | delivery_type_group | Курьеры, Такси | chart_data |
| 3035 | partner_type | <ФИО> | chart_data |
| 3035 | delivery_type_incl_out | <ФИО>, Курьеры ВкусВилл, <ФИО> определен, Такси | chart_data |
| 3035 | type_service | ГОРОД, Город экспресс | chart_data |
| 3466 | date_collected_sheet | Last week | chart_data |
| 3466 | type_sheet | Партнеры | chart_data |
| 3466 | is_collected | true | chart_data |
| 3466 | id_pse_type | 1, 11 | chart_data |
| 3466 | date_collect_start | today : tomorrow | chart_data |
| 3466 | date_collected | DATETIME("today") : DATEADD(DATETIME("tomorrow"), -1, second), today : tomorrow, DATETIME("today") : DATEADD(DATEADD(DATETIME("today"), 1, day), -1, second), 2024-02-27 : 2024-02-28, Last week | chart_data |
| 3466 | collection_time | 60 | chart_data |
| 3466 | order_status | Отменен | chart_data |
| 3466 | pse_type | ДаркКитчен | chart_data |
| 3466 | is_canceled | false | chart_data |
| 3466 | is_collection_overdue | true | chart_data |
| 5799 | pse_type | ДаркКитчен | dataset_sql |
| 5799 | date_collected | DATETIME("today") : DATEADD(DATETIME("tomorrow"), -1, second), DATETIME("YESTERDAY") : DATETIME("TODAY") | chart_data |
| 7712 | is_attempt | 1 | chart_data |
| 4373 | state | Error, Success | chart_data |
| 4565 | collection_device_type | УТ | dataset_sql |
| 5438 | date_delivered | DATETIME("today") : DATEADD(DATETIME("tomorrow"), -1, second) | chart_data |
| 5438 | date_delivered_double | DATETIME("today") : DATEADD(DATETIME("tomorrow"), -1, second) | chart_data |
| 5438 | delivery_type_group | Курьеры, Такси | chart_data |
| 5888 | darkkitchen_flag | да | chart_data |
| 5888 | time_collected | DATETIME("today") : DATETIME("tomorrow"), DATETIME("today") : DATEADD(DATEADD(DATETIME("today"), 1, day), -1, second), DATETIME("today") : DATEADD(DATETIME("tomorrow"), -1, second) | chart_data |
| 7713 | is_attempt | 1 | chart_data |
| 2338 | date_status | DATETIME("today") : DATEADD(DATEADD(DATETIME("today"), 1, day), -1, second) | chart_data |
| 2724 | date_collected | today : tomorrow | chart_data |
| 3406 | date_collected | 2024-01-30T00:00:00 : 2024-01-30T23:59:59, 2024-01-29T00:00:00 : 2024-01-29T23:59:59 | chart_data |
| 3406 | Not_collected | 1 | chart_data |
| 3406 | not_collected_before_work | 1 | chart_data |
| 3406 | not_collected_before_work_slot | 1 | chart_data |
| 4240 | order_status | Успешно завершен | chart_data |
| 4547 | delivery_type_group | Курьеры, Такси | dataset_sql |
| 4778 | delivery_type_group | Курьеры, Такси | dataset_sql |
| 5232 | date_collected | dateadd(datetime("now"), 1, hour) : dateadd(datetime("now"), 3, hour) | chart_data |
| 5964 | order_status | Успешно завершен | dataset_sql |
| 5964 | pse_type | ДаркКитчен | dataset_sql |
| 6757 | pse_type | ДаркКитчен | dataset_sql |
| 6786 | today_flag | neutral | chart_data |
| 6836 | pse_type | ДаркКитчен | dataset_sql |
| 6964 | service_free_problem_type | замедление, ускорение | chart_data |
| 7021 | date_collected | 2026-05-18 00:00:00 : 2026-05-19 23:59:59.999 | chart_data |
| 7021 | order_status | Успешно завершен | dataset_sql |
| 7021 | shift_type | Ночной | dataset_sql |
| 7173 | pse_type | ДаркКитчен | chart_data |
| 7174 | pse_type | ДаркКитчен | chart_data |

## 4. Связи-кандидаты

Всего кандидатов: **274**, подтверждённых по данным: **0**.
Совпадение имени колонки не является доказательством FK; кардинальность не измерена.

## 5. Ограничения

- Нет фактических значений: SQL Lab 403, chart data 401, `/api/v1/database/` возвращает 0 баз.
- Все значения из фильтров — это литералы, заданные авторами чартов/дашбордов, а не статистика данных.
- Частоты отражают число определений, где встречается значение, а не частоту в данных.
- PII-колонки не извлекались; фиксировался только факт наличия поля.

## 6. Что нужно проверить при появлении доступа

1. Фактические значения статусов заказов и их распределение.
2. Заполняемость кандидатов готовности (`date_set_cell`, `date_collected`, `date_printed`, `date_status_10`, `is_collected`).
3. Зерно и уникальность `id_shift` в 7802 и исходной таблице.
4. Размеры пулов и повторное назначение заказов.
5. Покрытие и кардинальность связей shifts↔pools, attempts↔shifts, sheet↔darkstore_time.
