# 05. Анализ готовности заказа (3466) и BD-013

## Факты (METADATA)
- Датасет: `darkstore_time_sheet`, virtual, ch_10.0.112.21/default, schema `mart_mixed`, колонок 167, метрик 243, SQL 38370 символов.
- Источники: mart_mixed.darkstore_time_sheet, report.v_org_unit_actual.
- `time_ready` и `time_ready_plan` присутствуют, но **тип не определён** в метаданных Superset.
- `date_status_10` — DateTime64(6); `date_order`, `date_collect_start`, `date_collected`, `date_delivery_start`, `date_delivered` — DateTime64(6).
- ПДн: user_inn, phone, user_code и др. — в отчёты не выгружаются.
- SQL содержит Jinja `filter_values` → прямое выполнение SQL датасета требует параметров.

## Временная последовательность (по наличию полей)
date_order → date_collect_start → date_collected → date_delivery_start → date_delivered.
Готовность (`time_ready`) в этой цепочке не подтверждена фактическими значениями.

## Что НЕ проверено (BLOCK-1)
Доля заполнения time_ready/time_ready_plan; случаи time_ready < date_order и time_ready > date_delivered;
повторные записи заказа; изменение time_ready при обновлении статуса; соотношение time_ready и date_collected;
сопоставление заказов с 4732.

## ***REMOVED*** по BD-013
**Кандидат time_ready опровергнут.** В полном обезличенном SQL датасета 3466 (35 926 символов) **нет ни одного вхождения**
`time_ready` и `time_ready_plan`. Колонки присутствуют в метаданных Superset (с неопределённым типом), но датасет их не формирует —
это устаревшие метаданные. Использовать их как источник готовности нельзя.

Дополнительно: `deadline_sbor` и `last_sbor_touch` — вычисляемые выражения, а не факты:
- `deadline_sbor = date_supply_untill - coalesce(sla_delivery_time_all, 0) * 60`;
- `last_sbor_touch = coalesce(date_set_cell, date_f_status_3_5)`.

`date_status_10` — реальная колонка физической таблицы `mart_mixed.darkstore_time_sheet` (DateTime64(6)), но её семантика
(статус 10) не подтверждена; в 7021 тот же статус относится к заказам сборщиков.

**Итог:** BD-013 = **CONTRADICTED** (техническая гипотеза Этапа 1.5 опровергнута). Источник фактической готовности
в проверенных источниках не найден; готовность должна вводиться новым событием `ORDER_READY` новой операционной системы.
