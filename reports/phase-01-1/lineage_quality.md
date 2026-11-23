# Качество Lineage — Этап 1.1 (полный каталог)

Сгенерировано: 2026-11-23T06:14:01.439Z

## Каталог

| Источник | dashboard | chart | dataset |
|---|---:|---:|---:|
| list (output/*.json) | 331 | 19924 | 3776 |
| SQLite list | 330 | 5000 | 3767 |
| detail | 331 | 3767 | — |

## Сводка

| Показатель | Значение |
|---|---:|
| Свидетельств | 48010 |
| Уникальных связей | 33592 |
| Сумма evidence_count | 48010 |
| DASHBOARD_HAS_CHART | 13832 |
| CHART_USES_DATASET | 19760 |

## Методы (источники не смешиваются)

| Метод | Свидетельств | Уникальных пар |
|---|---:|---:|
| DASHBOARD_POSITION_JSON | 7919 | 7901 |
| CHART_DATASOURCE_ID | 3756 | 3756 |
| CHART_DASHBOARDS_ARRAY | 2646 | 2646 |
| CHART_LIST_DASHBOARDS_ARRAY | 13821 | 13821 |
| CHART_LIST_DATASOURCE_ID | 19760 | 19760 |
| API_FILTER_BY_DATASOURCE_ID | 108 | 108 |

## Категории chart

| Категория | Значение |
|---|---:|
| chart_list_total | 19924 |
| chart_list_with_datasource_id | 19760 |
| chart_list_without_datasource_id | 164 |
| chart_detail_total | 3767 |
| chart_detail_valid | 3767 |
| chart_detail_with_datasource_id | 3756 |
| chart_detail_without_datasource_id | 11 |
| chart_detail_invalid | 0 |
| chart_in_list_without_detail | 16157 |
| chart_detail_not_in_list | 0 |
| categories_sum | 3767 |
| categories_sum_matches_total | true |

## LINEAGE_INTERNAL_CONSISTENCY

| Проверка | Результат |
|---|---|
| evidence_rows_match | OK |
| relations_rows_match | OK |
| evidence_count_sum_matches | OK |
| relation_type_sum_matches | OK |
| chart_detail_categories_sum_matches | OK |
| datasets_unused_non_negative | OK |
| api_charts_unique_not_exceed_api_rows | OK |
| list_dashboard_count_matches_summary | OK |
| list_chart_count_matches_summary | OK |
| list_dataset_count_matches_summary | OK |
| detail_within_list | OK |

Итог внутренней согласованности: **PASS**.

## LINEAGE_REFERENCE_QUALITY

| Показатель | Значение |
|---|---:|
| unresolved dashboard refs | 318 |
| unresolved dataset refs | 45 |
| unresolved chart refs | 6 |
| chart с расхождением dashboard sets | 2 |
| chart→dataset конфликты источников | 0 |
| charts без dataset | 164 |
| charts без dashboard | 9268 |
| datasets не используются локальными charts | 1109 |

Статус: **FINDINGS** (findings, не FAIL).

Unresolved/contradiction findings. Ссылки НЕ обозначаются архивными или удалёнными без отдельного подтверждения источником.

Детализация: `lineage_reference_quality.md`.

## Покрытие

| Показатель | Значение |
|---|---:|
| dashboards_total | 331 |
| dashboards_with_charts_any_method | 331 |
| dashboards_without_confirmed_charts | 0 |
| referenced_dashboards_not_in_catalog | 318 |
| position_json_null | 1 |
| position_json_parse_fail | 0 |
| charts_total | 19924 |
| charts_with_dataset_link_local | 19760 |
| charts_without_dataset_local | 164 |
| charts_with_dashboard_link | 10656 |
| charts_without_dashboard | 9268 |
| datasets_total | 3776 |
| datasets_used_by_charts_local | 2712 |
| datasets_used_in_catalog | 2667 |
| datasets_unused_by_charts_local | 1109 |
| datasets_unresolved_refs_local | 45 |

## Integrity

| Показатель | Значение |
|---|---:|
| self_links | 0 |
| multi_dataset_charts | 0 |
| unresolved_chart_refs | 6 |
| unresolved_dataset_refs | 45 |
| unresolved_dataset_refs_local | 45 |
| unresolved_dashboard_refs | 318 |
