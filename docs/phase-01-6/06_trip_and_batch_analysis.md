# 06. Анализ ходок и пакетов (2339, pools)

## 2339 — Перенесенные заказы (Reports, mssql)
- Источник: журнал `Loyalty_srv03.dbo.Webcall_log_ui_period('Orders_header', NULL, DATEADD(MONTH,-1,GETDATE()), GETDATE())`, соединённый с представлением `Reports.dbo.ksa_time_vw` по `id_order = object_id`.
- Фильтр: `type = 'Изменение даты доставки' AND prop = 'date_supply'`.
- `quantity_batch` (INT) и `orders_assignment` (STRING) приходят из представления.
- Уникального идентификатора пакета нет; состав пакета не восстанавливается.
- Окно данных — последний месяц (скользящее).

## Что установлено
- 2339 — это **лог переносов даты доставки**, а не система формирования пакетов/ходок.
- `quantity_batch` и `orders_assignment` не упоминаются в SQL датасета (0 вхождений): они приходят через `SELECT *`
  из представления `Reports.dbo.ksa_time_vw`, поэтому их смысл по SQL установить нельзя.
- Фильтр по причинам переноса прямо перечисляет бизнес-ситуации:
  «Перенос заказа на следующий день из-за невозможности доставки»,
  «Смена даты доставки: Долгое ожидание сборки», «…Долгий поиск курьера»,
  «…Разрушение Пуллинга», «…Дежурный не обновил поиск».
  Это подтверждает существование ситуаций для BD-002/BD-012, но не процедуру их обработки.

## Что найдено дополнительно (SQL 7802)
- `agile_mart_operational.pools`: **id_pool, id_order, pool_start, pool_finish** — физическая связь пул↔заказ.
- `agile_mart_operational.courier_queue`: **courier_id, id_shift, queue_in_dttm, queue_out_dttm, has_order**.
- `agile_mart_operational.shifts`: **id_shift, id_courier, id_pool, shift_start, shift_finish**.

## Вывод
Модель `trips`/`trip_orders` подтверждена **на уровне схемы** (pools содержит id_order), но зерно, порядок
заказов и кардинальность не проверены данными. `quantity_batch`/`orders_assignment` как источник использовать нельзя.
