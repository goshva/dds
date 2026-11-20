# Анализ результатов первой выгрузки

Источник: предоставленные пользователем `list.txt`, `courier_candidates.json`,
`dashboards.json`, `datasets.json`, `discovery_summary.json`.

## Сводка

- Dashboard list: 330, status `ok`
- Chart list: 5,000, status `ok`
- Dataset list: 3,767, status `ok`
- Endpoint errors: 5,661
- HTTP 401 errors: 5,660
- Один AbortError для chart_detail
- `relations` в локальном SQLite: 0 записей
- SQLite `quick_check`: `ok`

## Ошибки

- `dataset_detail`: 3,767 × HTTP 401
- `chart_detail`: 1,233 × HTTP 401 плюс один AbortError
- `dashboard_charts`: 330 × HTTP 401
- `dashboard_datasets`: 330 × HTTP 401

Сводка говорит, что токен истёк (`Token has expired`). Списки ресурсов собраны,
но подробные Dataset и связи Dashboard не были получены. Поэтому каталог
нельзя считать полным графом метаданных.

## Приоритетные Dataset-кандидаты из списка

<ФИО> названия и SQL-определения virtual Dataset, а не доказательство доступности
исходных строк:

| ID | Dataset | Признаки |
|---:|---|---|
| 4732 | darkstore_ts_partners_new | id_courier, date_supply, date_delivery_start, date_delivered, id_delivery_job |
| 7002 | cargo_main | логика доставки, временные отметки и кластер |
| 7006 | cargo_main2 | courier_id, duration_from_previous |
| 7024 | cargo_main3 | courier_id, distance_from_previous |
| 7027 | cargo_main4 | доставка, кластер, расстояние |
| 5797 | hr_couriers | id_courier, fio, phone, active, кадровые даты |
| 7465 | hr_couriers_5shifts | id_courier, name_courier, event_hiring, event_date |
| 7473 | hr_couriers_five_shifts | история выходов/последнего заказа |
| 6828 | couriers_schedule | CourierId, Date, WorkFrom, WorkTo |
| 6845 | couriers_schedule_half_hour | расписание с получасовой детализацией |
| 6939 | couriers_raiting | рейтинг курьеров |
| 1597 | Активность курьеров | запрос использует delivery_couriers |
| 1598 | Курьеры без доступа, зарегистрированы вчера | id, name, phone, active, last_activity |
| 1623 | Активность когорт курьеров | id, courier, INN, phone, date |
| 1659 | Выходы курьеров | выходы/активность курьеров |
| 3477 | couriers_registr | регистрационные данные курьеров |

## Приоритетные Dashboard

- 665 — Онлайн статистика по заказам и курьерам
- 663 — Статистика по заказам и курьерам (ответственные по гео)
- 1025 — Статистика доставок курьерами в разрезе пулов
- 1612 — Курьеры по дням
- 1453 — <ФИО>
- 1673 — Доставки курьеров по дарксторам
- 1585 — Выходы курьеров и прогноз заказов
- 1356 — Активность курьеров
- 1352 — Последний доставленный заказ
- 1472 — Метрики маршрутизатора
- 1228 — HR Dashboard Доставка

## Рекомендации к следующей версии online discovery

1. Корректно обновлять access token после HTTP 401 штатным механизмом Superset.
2. Не считать успешное получение списка доказательством получения detail-объектов.
3. Сохранять статус каждого detail-запроса отдельно от метаданных.
4. Возобновлять сбор только для недостающих/ошибочных объектов.
5. Получать связи Dashboard → Chart и Chart → Dataset, записывать их в relations.
6. Сначала повторить детали для приоритетных Dashboard/Chart/Dataset.
7. После успешного чтения метаданных отдельно тестировать доступность `chart/data` на небольшом безопасном наборе.

## Ограничения классификатора

В `courier_candidates.json` много ложных срабатываний: слова `доставка` и `delivery`
встречаются в нерелевантных описаниях и SQL. Нельзя считать score=10 доказательством
курьерской тематики. Нужна классификация по полям и SQL-признакам:
`id_courier`, `courier_id`, `CourierId`, `date_delivered`, `date_supply`,
`WorkFrom`, `WorkTo`, `delivery_job`, а также по контексту dashboard/chart.
