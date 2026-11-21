# Качество Lineage — Этап 1.1

Сгенерировано: 2026-11-20T20:24:11.492Z

## Сводка

| Показатель | Значение |
|---|---|
| Свидетельств (evidence rows) | 14426 |
| Уникальных связей (relations) | 13037 |
| Свёрнуто дублей свидетельств | 1389 |
| Сумма evidence_count по relations | 14426 |
| DASHBOARD_HAS_CHART | 9174 |
| CHART_USES_DATASET | 3863 |

## Методы

| Метод | Свидетельств | Уникальных пар |
|---|---:|---:|
| DASHBOARD_POSITION_JSON | 7918 | 7900 |
| CHART_DASHBOARDS_ARRAY | 2645 | 2645 |
| CHART_DATASOURCE_ID | 3755 | 3755 |
| API_FILTER_BY_DATASOURCE_ID | 108 | 108 |

## Категории chart_detail

| Категория | Значение |
|---|---:|
| chart_detail_total | 3766 |
| with datasource_id | 3755 |
| without datasource_id | 11 |
| invalid detail | 0 |
| Сумма категорий | 3766 |
| Сумма == total | true |

## Расхождение 1757 / 2645

Пересчёт из одного snapshot: уникальных пар dashboard|chart по методу CHART_DASHBOARDS_ARRAY = 2645; сырых свидетельств = 2645; chart_detail с непустым dashboards[] = 1757; элементов массивов dashboards[] = 2645; отношений с этим методом = 2645. Значение 1757 совпадает с: charts_with_nonempty_dashboards_array.

## Покрытие

| Показатель | Значение |
|---|---:|
| dashboards_total | 330 |
| dashboards_with_charts_any_method | 361 |
| dashboards_without_confirmed_charts | 1 |
| charts_linked_to_datasets_local | 3755 |
| datasets_used_by_charts_local | 161 |
| datasets_unused_by_charts_local | 3606 |

## Проверки согласованности

- evidence_rows_match: OK
- relations_rows_match: OK
- evidence_count_sum_matches: OK
- relation_type_sum_matches: OK
- chart_detail_categories_sum_matches: OK
- datasets_unused_non_negative: OK
- api_charts_unique_not_exceed_api_rows: OK

Итог: OK.
