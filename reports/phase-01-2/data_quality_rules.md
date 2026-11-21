# Правила качества будущих витрин — Этап 1.2

Правила описывают минимальные проверки будущего ETL. ETL на этом этапе НЕ запускается.

## Общие проверки

- уникальность первичного ключа витрины;
- отсутствие неожиданных дублей;
- NULL в обязательных полях;
- валидность временных интервалов (start <= end);
- отсутствие отрицательных длительностей;
- допустимые статусы и невозможные переходы;
- контроль потери и размножения строк при JOIN;
- согласованность COUNT заказов между источниками;
- отсутствие пересечения заказов между зонами/пакетами;
- отсутствие двойного начисления дохода.

## dm_courier_orders

- order_key NOT NULL
- нет дублей order_key
- date_delivered >= date_order
- нет отрицательных длительностей
- order_status в допустимом наборе
- согласованность COUNT между 4732 и 7006/7027

## dm_courier_ready_queue

- ready_at NOT NULL
- ready_at <= pickup_at
- нет отрицательного wait_duration
- нет дублей order_key+ready_at

## dm_delivery_zones

- zone_id NOT NULL
- нет пересечения зон по адресу
- история границ без разрывов

## dm_delivery_batches

- batch_key NOT NULL
- нет пересечения заказов между пакетами
- orders_per_batch > 0
- batch_pickup_at >= batch_created_at
- один заказ в одном пакете

## dm_courier_assignments

- assignment_id уникален
- courier NOT NULL
- pickup_at >= assigned_at
- нет назначения завершённого заказа
- нет дублей order+courier+time

## dm_courier_performance

- courier_id NOT NULL
- orders_per_courier >= 0
- нет дублей courier+date
- sum(orders) по курьерам = orders_total
- нет пересечения смен

## dm_courier_income

- нет двойного начисления на заказ
- accrual_amount >= 0
- период тарифа покрывает дату заказа
- courier_id NOT NULL

## dm_courier_mentorship

- mentor_id != newcomer_id
- один наставник на пару
- event_date в периоде обучения
- нет дублей пары

## dm_courier_curator_performance

- curator_id NOT NULL
- новичок привязан к одному куратору в периоде
- нет дублей curator+period

## dm_courier_attendance

- planned_shift_start NOT NULL
- actual >= planned
- нет пересечения смен курьера
- no_show без shift_started

## dm_courier_demand_forecast

- forecast_date >= today
- couriers_available >= 0
- zone_id NOT NULL
- нет дублей zone+date+hour
