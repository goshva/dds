# Stage 3.2.1 — Реестр бизнес-семантики метрик

Магазин 7745, датасет 3035. Целевая метрика этапа: `qty_orders_delivered` → `delivered_orders_daily`.

Источник определений — каталог метаданных Superset (`reports/phase-01-6-2/dataset_metrics.csv`, поля `verbose_name`, `expression`, `aggregation`) 
и прямая проверка значений в `daily_metrics`. **Каталог не является письменным бизнес-согласованием**, поэтому статус `confirmed` не присвоен ни одной метрике.

## Сводная таблица

| metric_key | business_name | kind | unit | confidence | заблокирована | пригодна как целевая | срезы |
| --- | --- | --- | --- | --- | --- | --- | --- |
| qty_orders_delivered | Доставленные заказы (весь даркстор) | additive | заказы (шт.) | conditional | нет | да | 20403, 20404, 20405, 20623, 20624 |
| qty_orders_declined | Отменённые и невыполненные заказы | additive | заказы (шт.) | conditional | нет | нет | 20403, 20405 |
| qty_orders_in_work | Заказы в работе | additive | заказы (шт.) | unconfirmed | да | нет | 20403, 20405 |
| qty_not_in_slot_all | Заказы вне слота | additive | заказы (шт.) | conditional | нет | нет | 20403, 20404, 20405 |
| share_not_in_slot_all | Доля доставок вне слота | ratio | доля (0..1) | conditional | нет | нет | 20403, 20404, 20405 |
| share_not_in_slot_above_all | Доля просроченных по времени доставок | ratio | доля (0..1) | unconfirmed | нет | нет | 20403, 20404, 20405 |
| share_not_in_slot_under_all | Доля преждевременных доставок | ratio | доля (0..1) | unconfirmed | нет | нет | 20403, 20405 |
| share_delivered_taxi | Доля доставок такси | ratio | доля (0..1) | unconfirmed | нет | нет | 20403, 20404, 20405 |
| share_orders_delivered | Доля заказов даркстора от общего количества | ratio | доля (0..1) | unconfirmed | да | нет | 20403, 20405 |
| sum_without_bonuses | Сумма заказов (по выражению: sum_paid без вычета) | additive | — | unconfirmed | нет | нет | 20403, 20405 |
| sum_with_bonuses | Сумма заказов за вычетом скидки (по выражению) | additive | — | unconfirmed | нет | нет | 20403, 20405 |

## qty_orders_delivered

| Поле | Значение |
| --- | --- |
| business_name | Доставленные заказы (весь даркстор) |
| metric_kind | additive |
| unit | заказы (шт.) |
| numerator | — |
| denominator | — |
| aggregation_rule (внутри дня) | сумма строк по измерениям допустима только при доказанной взаимоисключаемости категорий |
| aggregation_rule (между днями) | сумма по дням — итог за период |
| требует доказательства аддитивности | да |
| source_slices | 20403, 20404, 20405, 20623, 20624 |
| store_scope | даркстор 7745 целиком (в срезе 20624 одна строка на дату) |
| temporal_grain | календарный день (Europe/Moscow) |
| confidence | conditional |
| заблокирована | нет |

**description.** Количество уникальных заказов в статусе «Успешно завершен». Выражение каталога: COUNT(DISTINCT IF(status_name = 'Успешно завершен', COALESCE(id_general, id_order), NULL)). Считаются уникальные идентификаторы заказов, а не операции доставки. Дата отнесения — дата доставки заказа (гранулярность запросов задаётся измерением date_supply).

**restrictions:**

- письменного бизнес-согласования определения нет: подтверждение только каталогом метаданных и данными
- причины отмен и корректировок заказов в наборе отсутствуют
- дата отнесения заказа (доставка/создание/сборка) подтверждена только формулой каталога

**evidence:**

- catalog: COUNT(DISTINCT IF(status_name = 'Успешно завершен', COALESCE(id_general, id_order), NULL))
- data: сумма по 41 дню = 62 739, совпадает во всех пяти срезах
- stage-3.1: 915 наблюдений, 0 NULL, 0 дублей, покрытие 41/41

## qty_orders_declined

| Поле | Значение |
| --- | --- |
| business_name | Отменённые и невыполненные заказы |
| metric_kind | additive |
| unit | заказы (шт.) |
| numerator | — |
| denominator | — |
| aggregation_rule (внутри дня) | сумма строк по измерениям |
| aggregation_rule (между днями) | сумма по дням |
| требует доказательства аддитивности | да |
| source_slices | 20403, 20405 |
| store_scope | даркстор 7745 |
| temporal_grain | календарный день |
| confidence | conditional |
| заблокирована | нет |

**description.** COUNT(DISTINCT IF(status_name IN ('Отменен', 'Не выполнен', 'Вернулся на полки'), COALESCE(id_general, id_order), NULL)). Причины отмен в наборе отсутствуют.

**restrictions:**

- нет разбивки по причинам отмен
- аддитивность разреза по сервисам не подтверждена письменно

**evidence:**

- catalog: COUNT(DISTINCT IF(status_name IN ('Отменен','Не выполнен','Вернулся на полки'), ...))
- stage-3.1: 517 наблюдений, 190 нулей

## qty_orders_in_work

| Поле | Значение |
| --- | --- |
| business_name | Заказы в работе |
| metric_kind | additive |
| unit | заказы (шт.) |
| numerator | — |
| denominator | — |
| aggregation_rule (внутри дня) | сумма строк по измерениям |
| aggregation_rule (между днями) | не агрегируется |
| требует доказательства аддитивности | да |
| source_slices | 20403, 20405 |
| store_scope | даркстор 7745 |
| temporal_grain | календарный день |
| confidence | unconfirmed |
| заблокирована | да — в текущем наборе все 517 значений равны нулю (σ = 0): показатель неинформативен, источник требует проверки |

**description.** COUNT(DISTINCT IF(status_name NOT IN ('Отменен','Не выполнен','Вернулся на полки','Успешно завершен'), ...)) — заказы в промежуточных статусах.

**restrictions:**

- не использовать в аналитике до выяснения причины нулевых значений

**evidence:**

- data: 517 наблюдений, все значения 0
- stage-3.1: статус BLOCKED (постоянный ряд)

## qty_not_in_slot_all

| Поле | Значение |
| --- | --- |
| business_name | Заказы вне слота |
| metric_kind | additive |
| unit | заказы (шт.) |
| numerator | — |
| denominator | — |
| aggregation_rule (внутри дня) | сумма строк по измерениям |
| aggregation_rule (между днями) | сумма по дням |
| требует доказательства аддитивности | да |
| source_slices | 20403, 20404, 20405 |
| store_scope | даркстор 7745 |
| temporal_grain | календарный день |
| confidence | conditional |
| заблокирована | нет |

**description.** COUNT(DISTINCT IF(status_name = 'Успешно завершен' AND IF(gettype IN (0,6), date_collected, date_delivered) NOT BETWEEN date_supply AND date_supply_until, ...)) — доставленные заказы, фактическое время которых вышло за интервал слота.

**restrictions:**

- аддитивность разреза по сервисам не подтверждена письменно

**evidence:**

- catalog: выражение метрики
- stage-3.1: 716 наблюдений, 157 нулей

## share_not_in_slot_all

| Поле | Значение |
| --- | --- |
| business_name | Доля доставок вне слота |
| metric_kind | ratio |
| unit | доля (0..1) |
| numerator | qty_not_in_slot_all |
| denominator | qty_orders_delivered |
| aggregation_rule (внутри дня) | НЕ суммировать; агрегированное отношение = sum(числитель)/sum(знаменатель) |
| aggregation_rule (между днями) | НЕ суммировать; агрегированное отношение = sum(числитель)/sum(знаменатель) |
| требует доказательства аддитивности | нет |
| source_slices | 20403, 20404, 20405 |
| store_scope | даркстор 7745 |
| temporal_grain | календарный день |
| confidence | conditional |
| заблокирована | нет |

**description.** Отношение заказов вне слота к доставленным заказам: numerator / qty_orders_delivered.

**restrictions:**

- простое среднее дневных долей не является агрегированным отношением

**evidence:**

- catalog: отношение COUNT(... вне слота ...) / NULLIF(COUNT(... Успешно завершен ...), 0)
- data: отношение восстанавливается на 199/199 и 318/318 наблюдений в пределах округления 1e-6 (макс. отклонение 5e-7)

## share_not_in_slot_above_all

| Поле | Значение |
| --- | --- |
| business_name | Доля просроченных по времени доставок |
| metric_kind | ratio |
| unit | доля (0..1) |
| numerator | — |
| denominator | qty_orders_delivered |
| aggregation_rule (внутри дня) | НЕ суммировать; требуется агрегированное отношение |
| aggregation_rule (между днями) | НЕ суммировать; требуется агрегированное отношение |
| требует доказательства аддитивности | нет |
| source_slices | 20403, 20404, 20405 |
| store_scope | даркстор 7745 |
| temporal_grain | календарный день |
| confidence | unconfirmed |
| заблокирована | нет |

**description.** Отношение заказов, доставленных позже date_supply_until, к доставленным заказам.

**restrictions:**

- метрика-числитель (число просроченных заказов) в наборе отсутствует — агрегировать нельзя

**evidence:**

- catalog: числитель COUNT(... > date_supply_until ...)
- data: числителя в daily_metrics нет

## share_not_in_slot_under_all

| Поле | Значение |
| --- | --- |
| business_name | Доля преждевременных доставок |
| metric_kind | ratio |
| unit | доля (0..1) |
| numerator | — |
| denominator | qty_orders_delivered |
| aggregation_rule (внутри дня) | НЕ суммировать; требуется агрегированное отношение |
| aggregation_rule (между днями) | НЕ суммировать; требуется агрегированное отношение |
| требует доказательства аддитивности | нет |
| source_slices | 20403, 20405 |
| store_scope | даркстор 7745 |
| temporal_grain | календарный день |
| confidence | unconfirmed |
| заблокирована | нет |

**description.** Отношение заказов, доставленных раньше date_supply, к доставленным заказам.

**restrictions:**

- метрика-числитель (число преждевременных заказов) в наборе отсутствует

**evidence:**

- catalog: числитель COUNT(... < date_supply ...)
- data: числителя в daily_metrics нет

## share_delivered_taxi

| Поле | Значение |
| --- | --- |
| business_name | Доля доставок такси |
| metric_kind | ratio |
| unit | доля (0..1) |
| numerator | — |
| denominator | qty_orders_delivered |
| aggregation_rule (внутри дня) | НЕ суммировать; требуется агрегированное отношение |
| aggregation_rule (между днями) | НЕ суммировать; требуется агрегированное отношение |
| требует доказательства аддитивности | нет |
| source_slices | 20403, 20404, 20405 |
| store_scope | даркстор 7745 |
| temporal_grain | календарный день |
| confidence | unconfirmed |
| заблокирована | нет |

**description.** Отношение заказов, доставленных такси (delivery_type_group = 'Такси'), к доставленным заказам.

**restrictions:**

- количество доставок такси в наборе отсутствует — агрегировать нельзя

**evidence:**

- catalog: числитель COUNT(DISTINCT IF(... delivery_type_group = 'Такси' ...))
- data: числителя в daily_metrics нет

## share_orders_delivered

| Поле | Значение |
| --- | --- |
| business_name | Доля заказов даркстора от общего количества |
| metric_kind | ratio |
| unit | доля (0..1) |
| numerator | — |
| denominator | — |
| aggregation_rule (внутри дня) | не использовать |
| aggregation_rule (между днями) | не использовать |
| требует доказательства аддитивности | нет |
| source_slices | 20403, 20405 |
| store_scope | даркстор 7745 (знаменатель — вся сеть УЗ) |
| temporal_grain | календарный день |
| confidence | unconfirmed |
| заблокирована | да — в текущем наборе 517 значений равны 1.0 (знаменатель совпадает с числителем), знаменатель «все заказы УЗ» в наборе отсутствует |

**description.** Отношение доставленных заказов даркстора к общему количеству заказов УЗ (feature_tt = 'ДаркСтор').

**restrictions:**

- не использовать в аналитике

**evidence:**

- data: 517 наблюдений, все значения 1.0
- stage-3.1: статус BLOCKED (постоянный ряд и неподтверждённый знаменатель)

## sum_without_bonuses

| Поле | Значение |
| --- | --- |
| business_name | Сумма заказов (по выражению: sum_paid без вычета) |
| metric_kind | additive |
| unit | — |
| numerator | — |
| denominator | — |
| aggregation_rule (внутри дня) | сумма строк по измерениям |
| aggregation_rule (между днями) | сумма по дням |
| требует доказательства аддитивности | да |
| source_slices | 20403, 20405 |
| store_scope | даркстор 7745 |
| temporal_grain | календарный день |
| confidence | unconfirmed |
| заблокирована | нет |

**description.** SUM(IF(status_name = 'Успешно завершен', COALESCE(sum_paid, 0), NULL)). Каталог описывает как «Сумма (ДС + баллы)». Название метрики и описание противоречат друг другу.

**restrictions:**

- единица измерения (рубли или копейки) не подтверждена
- имя метрики противоречит каталожному описанию
- не использовать как денежный факт до согласования

**evidence:**

- catalog: SUM(IF(status_name = 'Успешно завершен', COALESCE(sum_paid, 0), NULL)), verbose_name = 'Сумма (ДС + баллы) (УЗ)'

## sum_with_bonuses

| Поле | Значение |
| --- | --- |
| business_name | Сумма заказов за вычетом скидки (по выражению) |
| metric_kind | additive |
| unit | — |
| numerator | — |
| denominator | — |
| aggregation_rule (внутри дня) | сумма строк по измерениям |
| aggregation_rule (между днями) | сумма по дням |
| требует доказательства аддитивности | да |
| source_slices | 20403, 20405 |
| store_scope | даркстор 7745 |
| temporal_grain | календарный день |
| confidence | unconfirmed |
| заблокирована | нет |

**description.** SUM(IF(status_name = 'Успешно завершен', COALESCE(sum_paid, 0) - COALESCE(sum_paid_disc, 0), NULL)). Каталог описывает как «Сумма (только ДС)». Название метрики и описание противоречат друг другу.

**restrictions:**

- единица измерения не подтверждена
- имя метрики противоречит каталожному описанию
- не использовать как денежный факт до согласования

**evidence:**

- catalog: SUM(IF(status_name = 'Успешно завершен', COALESCE(sum_paid,0) - COALESCE(sum_paid_disc,0), NULL)), verbose_name = 'Сумма (только ДС) (УЗ)'

## Правила агрегации и обработки особых значений

| Ситуация | Правило |
| --- | --- |
| агрегация по измерениям | только при доказанной взаимоисключаемости и полноте категорий; иначе значение берётся из среза с одной строкой на дату |
| агрегация по датам | additive — сумма по дням как итог периода; ratio — только sum(числитель)/sum(знаменатель) |
| несколько строк на дату | не суммируются автоматически: это нарушение инварианта канонического набора |
| NULL | не заменяется нулём; строка не попадает в канонический ряд, фиксируется ошибка |
| пустое значение | обрабатывается как NULL (в текущем наборе таких строк нет) |
| ноль | сохраняется как значение источника (ноль — подтверждённое отсутствие заказов) |
| отрицательное значение | фиксируется как ошибка, набор не строится |
| дробное значение | сохраняется как есть, статус качества понижается до conditional, фиксируется finding |
| дублирование источника | обнаруживается по ключу (дата + измерения); набор не строится |

