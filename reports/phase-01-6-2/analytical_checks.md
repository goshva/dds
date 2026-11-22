# Этап 1.6.2 — аналитические проверки

<ФИО> выполнены по доступным значениям и метаданным; фактические данные не получены.

## 1. Одинаковые статусы в разных датасетах
- 4732 / partner_type: Цветы
- 5797 / zone_transition_type: Возврат в Green
- 7006 / pickup_minute: 20
- 7006 / pickup_seq: 2, 12
- 7006 / pickup_to_courier_minute: 15
- 7024 / courier_type: вело, авто
- 3035 / is_paid: false, true
- 3035 / date_collected: DATETIME("today") : DATEADD(DATETIME("today"), 1, day), DATETIME("today") : DATEADD(DATETIME("tomorrow"), -1, second)
- 3035 / date_delivered: DATETIME("today") : DATEADD(DATETIME("tomorrow"), -1, second), DATEADD(DATETIME("now"), -7, day) : now, DATEADD(DATETIME("2026-04-17T00:00:00"), -7, day) : 2026-04-17T00:00:00, today :, 2026-01-01 : today, DATEADD(DATETIME("2026-04-14T00:00:00"), -7, day) : 2026-04-14T00:00:00, dateadd(datetime('today'), -7, day) : datetime('tomorrow')
- 3035 / gettype: 6
- 3035 / id_partner_type: 2, 1
- 3035 / courier_type: <ФИО>, <ФИО>, <ФИО> Курьер, Автономный мобильный Авто курьер, Автономный мобильный Вело курьер, <ФИО>, Ночной авто курьер
- 3035 / delivery_type: ЗиЗ-12, ЗиЗ-11, ЗиЗ-20, ЗиЗ-10, ЗиЗ-13, ЗиЗ-06, ЗиЗ-21, ЗиЗ-01, <ФИО>.Доставка, Достависта
- 3035 / delivery_type_group: Курьеры, Такси
- 3035 / partner_type: <ФИО>
- 3035 / delivery_type_incl_out: <ФИО>, Курьеры ВкусВилл, <ФИО> определен, Такси
- 3035 / type_service: ГОРОД, Город экспресс
- 3466 / date_collected_sheet: Last week
- 3466 / type_sheet: Партнеры
- 3466 / is_collected: true
- 3466 / id_pse_type: 1, 11
- 3466 / date_collect_start: today : tomorrow
- 3466 / date_collected: DATETIME("today") : DATEADD(DATETIME("tomorrow"), -1, second), today : tomorrow, DATETIME("today") : DATEADD(DATEADD(DATETIME("today"), 1, day), -1, second), 2024-02-27 : 2024-02-28, Last week
- 3466 / collection_time: 60
- 3466 / order_status: Отменен
- 3466 / pse_type: ДаркКитчен
- 3466 / is_canceled: false
- 3466 / is_collection_overdue: true
- 5799 / pse_type: ДаркКитчен
- 5799 / date_collected: DATETIME("today") : DATEADD(DATETIME("tomorrow"), -1, second), DATETIME("YESTERDAY") : DATETIME("TODAY")
- 7712 / is_attempt: 1
- 4373 / state: Error, Success
- 4565 / collection_device_type: УТ
- 5438 / date_delivered: DATETIME("today") : DATEADD(DATETIME("tomorrow"), -1, second)
- 5438 / date_delivered_double: DATETIME("today") : DATEADD(DATETIME("tomorrow"), -1, second)
- 5438 / delivery_type_group: Курьеры, Такси
- 5888 / darkkitchen_flag: да
- 5888 / time_collected: DATETIME("today") : DATETIME("tomorrow"), DATETIME("today") : DATEADD(DATEADD(DATETIME("today"), 1, day), -1, second), DATETIME("today") : DATEADD(DATETIME("tomorrow"), -1, second)
- 7713 / is_attempt: 1
- 2338 / date_status: DATETIME("today") : DATEADD(DATEADD(DATETIME("today"), 1, day), -1, second)

## 2. Статусы, отсутствующие в отдельных источниках
Сравнение невозможно без фактических значений; зафиксировано только наличие полей в метаданных.

## 3. Временные поля по источникам
Временных полей в P0/P1: **3161**. Диапазоны не измерены.

## 4. NULL и специальные даты
NULL-доли не измерены. Дата `1970-01-01` не заменялась; специальные значения не подтверждены.

## 5. Потенциальные идентификаторы
Выявлены по именам полей (`id_*`, `*_id`, `*_code`, `*_key`); уникальность не проверена.

## 6. Поля-связки
Кандидатов связей: **274**. Все — на уровне имён и SQL, не данных.

## 7. Отношения с подтверждённой кратностью
Нет: кардинальность не измерена.

## 8. Одинаковые названия метрик с разными формулами
Выявлены по каталогу метрик; см. `analysis_package/metrics_catalog.csv`.

## 9. Технические заглушки
Проверены значения `1970-01-01`, пустые строки, `NULL`, `-1`; без данных подтвердить нельзя.

## 10. <ФИО> и противоречивые определения
Зафиксированы ранее: `time_ready` в 3466, `date_for_mentor` в 5939, `shift_type` в 7021.