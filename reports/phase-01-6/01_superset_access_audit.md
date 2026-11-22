# 01. Аудит доступа к Superset и SQL Lab

Сгенерировано: 2026-11-21T21:16:33.054Z; хост: `superset.svc.vkusvill.ru`.

## Шаги

- login: OK (username-password)
- CSRF: OK (HTTP 200)
- базы данных: OK, доступно 0
- SQL Lab probe: error (rows=0, 575 ms)

## Доступные базы данных

| ID | Название | Backend | expose_in_sqllab | allow_dml |
|---|---|---|---|---|

## Метаданные шести датасетов

| Dataset | Таблица | Тип | Schema | DB | Колонок | Метрик | SQL (redacted) |
|---|---|---|---|---|---:|---:|---|
| 5939 | hr_daily_pers_mentors | virtual | agile_mart_techaudit | ch_10.0.112.21 (clickhousedb) | 70 | 31 | есть |
| 7802 | shift_time_breakdown | virtual | agile_mart_operational | gp_10.0.112.100/dwh (postgresql) | 23 | 1 | есть |
| 7712 | photo_control_shift_bi | virtual | agile_mart_operational | gp_10.0.112.100/dwh (postgresql) | 54 | 1 | есть |
| 7021 | ds_collectors_prod | virtual | — | ch_10.0.112.21 (clickhousedb) | 41 | 12 | есть |
| 3466 | darkstore_time_sheet | virtual | mart_mixed | ch_10.0.112.21/default (clickhousedb) | 167 | 243 | есть |
| 2339 | Перенесенные заказы | virtual | dbo | Reports (mssql) | 107 | 1 | есть |

Сырые SQL датасетов не сохраняются: комментарии содержат авторские ПДн. Хранятся sha256, длина и обезличенный текст.

## Ошибки

- SQL Lab probe: error 
