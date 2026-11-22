# 02. Доказательства по датасетам (метаданные Superset)

Сгенерировано: 2026-11-21T21:14:51.282Z

- saved_query API: HTTP 200, count=0
- query history API: HTTP 200, count=17

## Dataset 5939 — hr_daily_pers_mentors

- тип: virtual; schema: agile_mart_techaudit; БД: ch_10.0.112.21 (clickhousedb); колонок: 70; метрик: 31
- источники из SQL (обезличенного): agile_mart_techaudit.actual_assistant_tt, agile_mart_techaudit.hr_daily_pers, stage_outer_sources.fio_employee
- чартов на датасете (первые): 22527:Стажерские смены; 24252:Менторы и кол-во стажеров
- related_objects: HTTP 200
- query_context чарта 22527: сохранён (обезличен)

## Dataset 7802 — shift_time_breakdown

- тип: virtual; schema: agile_mart_operational; БД: gp_10.0.112.100/dwh (postgresql); колонок: 23; метрик: 1
- источники из SQL (обезличенного): agile_mart_operational.shifts, agile_mart_operational.pools, mart_mixed.darkstore_time, agile_mart_operational.courier_queue, ods.v_couriers, ods.v_tt, mart.org_unit_actual
- чартов на датасете (первые): 32393:Время смены по курьерам; 32389:Время смены по региону; 32388:Время смены по кусту; 32387:Время смены по ТТ; 32386:Время смены по ТУ
- related_objects: HTTP 200
- query_context чарта 32393: сохранён (обезличен)

## Dataset 7712 — photo_control_shift_bi

- тип: virtual; schema: agile_mart_operational; БД: gp_10.0.112.100/dwh (postgresql); колонок: 54; метрик: 1
- источники из SQL (обезличенного): mart_mixed.darkstore_time, ods.v_tasks_settings, ods.v_tt, report.v_org_unit_actual, ods.v_couriers, ods.v_couriers_payments_courier_types, ods.v_courier_job_type, agile_mart_operational.photo_control_shift_attempt
- чартов на датасете (первые): 31601:Детализация попыток; 31608:Исход смены за период; 31607:Доля: ок, спорные, не ок; 31606:Динамика: ок, спорные, не ок; 31599:Динамика числа фото
- related_objects: HTTP 200

## Dataset 7021 — ds_collectors_prod

- тип: virtual; schema: —; БД: ch_10.0.112.21 (clickhousedb); колонок: 41; метрик: 12
- источники из SQL (обезличенного): ods.timesheetfact, mart_mixed.darkstore_time_sheet
- чартов на датасете (первые): 28142:Выработка по дням со сборщикам; 28181:Сводная таблица по заказам по часам; 28180:Сводная таблица по часам и дням; 28188:Сводная таблица по позициям по часам; 28187:Сводная таблица по заказам по часам1
- related_objects: HTTP 200
- query_context чарта 28142: сохранён (обезличен)

## Dataset 3466 — darkstore_time_sheet

- тип: virtual; schema: mart_mixed; БД: ch_10.0.112.21/default (clickhousedb); колонок: 167; метрик: 243
- источники из SQL (обезличенного): dt.date_supply, mart_mixed.darkstore_time_sheet, report.v_org_unit_actual
- чартов на датасете (первые): 32583:1.2.01 | Сборка | Общая статистика; 32518:Итоговая таблица по магазинам по дням BI-1000004530; 32517:Итоговая таблица по дням BI-1000004530; 32497:Итоги по дням 5848,7450,6571 Сборка; 32439:1.2.06 | Сборка | Общая статистика
- related_objects: HTTP 200
- query_context чарта 32583: сохранён (обезличен)

## Dataset 2339 — Перенесенные заказы

- тип: virtual; schema: dbo; БД: Reports (mssql); колонок: 107; метрик: 1
- источники из SQL (обезличенного): Loyalty_srv03.dbo.Webcall_log_ui_period, Reports.dbo.ksa_time_vw
- чартов на датасете (первые): 13904:Динамика перенесенных заказов по дням в разрезе причин; 13898:Динамика перенесенных заказов по дням в разрезе ТТ и статусов; 13896:Заказы, перенесенные на сегодня; 13895:Динамика перенесенных заказов по дням в разрезе статусов
- related_objects: HTTP 200
- query_context чарта 13904: сохранён (обезличен)

## Ограничение

Это метаданные и SQL-тексты, а не результаты запросов. Фактические данные проверить не удалось (см. 01_superset_access_audit.md).
