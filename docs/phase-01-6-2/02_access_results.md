# Этап 1.6.2 — результаты проверки доступа

## Матрица возможностей

| Возможность | Статус |
|---|---|
| metadata_datasets | AVAILABLE |
| metadata_charts | AVAILABLE |
| metadata_dashboards | AVAILABLE |
| related_objects | AVAILABLE |
| dashboard_charts_form_data | AVAILABLE |
| dashboard_datasets | AVAILABLE |
| dashboard_filter_values | NOT_FOUND |
| column_values | FORBIDDEN |
| sql_lab | FORBIDDEN |
| chart_data | FORBIDDEN |
| databases | NO_VISIBLE_DATABASES |
| saved_queries | AVAILABLE |
| dashboard_filter_values_via_detail | AVAILABLE |
| dashboard_native_filters_count | 3349 |

## Пробы

| ID | Возможность | Endpoint | HTTP | мс |
|---|---|---|---:|---:|
| P01 | connectivity | /health | 200 | 41 |
| P02 | auth | /api/v1/security/login | 200 | 0 |
| P03 | auth | /api/v1/security/csrf_token/ | 200 | 1000 |
| P04 | metadata | /api/v1/me/ | 401 | 972 |
| P05 | metadata | /api/v1/dataset/?q=(page:0,page_size:1) | 200 | 1101 |
| P06 | metadata | /api/v1/dataset/4732 | 200 | 1399 |
| P07 | metadata | /api/v1/dataset/4732/related_objects | 200 | 608 |
| P08 | metadata | /api/v1/chart/?q=(page:0,page_size:1) | 200 | 1063 |
| P09 | metadata | /api/v1/chart/28360 | 200 | 888 |
| P10 | metadata | /api/v1/dashboard/?q=(page:0,page_size:1) | 200 | 1583 |
| P11 | metadata | /api/v1/dashboard/1680 | 200 | 673 |
| P12 | filters | /api/v1/dashboard/1680/charts | 200 | 922 |
| P13 | filters | /api/v1/dashboard/1680/filters | 405 | 767 |
| P14 | filters | /api/v1/dashboard/1680/filter_state | 405 | 1001 |
| P15 | filters | /api/v1/dashboard/1680/datasets | 200 | 1452 |
| P16 | values | /api/v1/dataset/4732/values/?column_name=order_status | 404 | 552 |
| P17 | values | /api/v1/datasource/table/4732/values/?column_name=order_status | 404 | 996 |
| P18 | values | /api/v1/dataset/4732/column/order_status/values | 404 | 1000 |
| P18b | values | /api/v1/datasource/table/4732/column/order_status/values | 403 | 1044 |
| P18c | values | /api/v1/datasource/table/4732/column/order_status/values/ | 403 | 976 |
| P19 | sql_lab | /api/v1/sqllab/ | 403 | 1008 |
| P20 | sql_lab | /api/v1/sqllab/execute/ | 403 | 1000 |
| P21 | sql_lab | /api/v1/sqllab/estimate/ | 403 | 1002 |
| P22 | chart_data | /api/v1/chart/data | 401 | 1110 |
| P23 | databases | /api/v1/database/?q=(page:0,page_size:50) | 200 | 1044 |
| P24 | databases | /api/v1/database/92 | 404 | 908 |
| P25 | databases | /api/v1/database/76 | 404 | 1000 |
| P26 | metadata | /api/v1/query/?q=(page:0,page_size:100) | 200 | 1035 |

## Ограничения
- SQL Lab (`/api/v1/sqllab/execute/`) — 403; `/api/v1/database/` возвращает 0 доступных баз.
- Chart data API — 401.
- Прямые значения колонок через `/api/v1/dataset/{id}/values` — маршрут отсутствует; вариант `/datasource/.../values` — 403.

## Сетевой простой
Зафиксирован простой соединения с Superset. Начало: 2026-11-22T09:19:23.210Z; восстановление: 2026-11-22T09:31:43.363Z. Всего попыток: 31.

Доступность API не считается доказательством права выполнять SQL.