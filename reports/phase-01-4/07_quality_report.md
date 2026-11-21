# Фаза 1.4.7 — Качество данных и бизнес-покрытие

Сгенерировано: 2026-11-21T16:02:41.741Z
Snapshot: `phase-01-4-2026-11-21T15-56-56-676Z`.

## Сводка качества

| Severity | Кол-во |
|---|---:|
| ERROR | 50 |
| WARN | 49 |
| INFO | 5 |

| Область | Severity | Сообщение |
|---|---|---|
| unresolved_refs | WARN | charts ссылаются на 45 dataset id вне snapshot |
| unresolved_refs | WARN | charts ссылаются на 318 dashboard id вне snapshot |
| unresolved_tables | WARN | 4979 источников не классифицированы как физическая таблица/CTE |
| unresolved_columns | WARN | 669 SQL-идентификаторов не найдены в columns |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: collection_time_real_sec_sheet |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: slots;sla_order_time |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: toHour;date_diff;date_add |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMM |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: darkstore_time_sheet |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMMDD |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYearWeek |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMMDD |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: CONCAT |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMM |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMMDD |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: toHour;date_diff;date_add |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMM |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: NUMERIC |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMMDD |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: concat;substring |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMM |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYearWeek |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: toHour;date_diff;date_add |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: CONCAT;toStartOfHour |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYearWeek |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYearWeek |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYearWeek |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: CONCAT |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: CONCAT |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMM |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMM |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: concat |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMM |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMM |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYearWeek |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: toHour;date_diff;date_add |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMMDD |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMM |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: toDayOfMonth;toHour;toMinute |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMM |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: date |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: toHour;date_diff;date_add |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYearWeek |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMMDD |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMM |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMM |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMM |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYearWeek |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: CONCAT;toStartOfHour |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: toHour;date_diff;date_add |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMMDD |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMMDD |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYYYYMM |
| metric_unresolved_refs | ERROR | метрика ссылается на отсутствующие поля: lagInFrame;toYearWeek |
| duplicate_dataset_name | WARN | duplicate table_name: tt_cluster_temp |
| duplicate_dataset_name | WARN | duplicate table_name: 1_1_stoimost_rejsov_postavshik_rc |
| duplicate_dataset_name | WARN | duplicate table_name: offline_tt_dk |
| duplicate_dataset_name | WARN | duplicate table_name: 1_2_stoimost_rejsov_rc_rc |
| duplicate_dataset_name | WARN | duplicate table_name: tmz_darkstore |
| duplicate_dataset_name | WARN | duplicate table_name: tsd |
| duplicate_dataset_name | WARN | duplicate table_name: geojson_test |
| duplicate_dataset_name | WARN | duplicate table_name: first_touch_couriers_exits_v2 |
| duplicate_dataset_name | WARN | duplicate table_name: frutcort_employees_fot_detailed |
| duplicate_dataset_name | WARN | duplicate table_name: dk |
| duplicate_dataset_name | WARN | duplicate table_name: zone_cluster_f |
| duplicate_dataset_name | WARN | duplicate table_name: dttk |
| duplicate_dataset_name | WARN | duplicate table_name: запрос без имени 1 |
| duplicate_dataset_name | WARN | duplicate table_name: dict_tt |
| duplicate_dataset_name | WARN | duplicate table_name: pom_f |
| duplicate_dataset_name | WARN | duplicate table_name: bottom_clients_weekly |
| duplicate_dataset_name | WARN | duplicate table_name: mile_test |
| duplicate_dataset_name | WARN | duplicate table_name: additional_supplies |
| duplicate_dataset_name | WARN | duplicate table_name: darkstore_time_sheet |
| duplicate_dataset_name | WARN | duplicate table_name: аптеки уаги тест |
| duplicate_dataset_name | WARN | duplicate table_name: запрос без имени 10 |
| duplicate_dataset_name | WARN | duplicate table_name: logs |
| duplicate_dataset_name | WARN | duplicate table_name: dtt |
| duplicate_dataset_name | WARN | duplicate table_name: sql_сборщики |
| duplicate_dataset_name | WARN | duplicate table_name: test_jinja |
| duplicate_dataset_name | WARN | duplicate table_name: customer_complaint |
| duplicate_dataset_name | WARN | duplicate table_name: v_check |
| duplicate_dataset_name | WARN | duplicate table_name: losts_for_rtl |
| duplicate_dataset_name | WARN | duplicate table_name: pom_filter |
| duplicate_dataset_name | WARN | duplicate table_name: ksa_time_vw |
| duplicate_dataset_name | WARN | duplicate table_name: ds_filter |
| duplicate_dataset_name | WARN | duplicate table_name: test_1 |
| duplicate_dataset_name | WARN | duplicate table_name: test1 |
| duplicate_dataset_name | WARN | duplicate table_name: запрос среднее количество товара в чеке a/b автоассортимент |
| duplicate_dataset_name | WARN | duplicate table_name: tt_format_f |
| duplicate_dataset_name | WARN | duplicate table_name: pa_16466_capacity_cluster_data |
| duplicate_dataset_name | WARN | duplicate table_name: product_card_ab_tool_design |
| duplicate_dataset_name | WARN | duplicate table_name: cart_data_main_dash_conversion_week |
| duplicate_dataset_name | WARN | duplicate table_name: s3_dir_sizes |
| duplicate_dataset_name | WARN | duplicate table_name: unicode_test |
| duplicate_dataset_name | WARN | duplicate table_name: ws_tasks |
| duplicate_dataset_name | WARN | duplicate table_name: ws_projects |
| unknown_grain | INFO | 2490 datasets с неопределённым зерном |
| unknown_entity | INFO | сущность не подтверждена в исследованном охвате |
| unknown_entity | INFO | сущность не подтверждена в исследованном охвате |
| cross_join | WARN | 188 CROSS JOIN |
| join_without_on | INFO | 1779 JOIN без распознанного ON |
| row_multiplication_risk | WARN | 338 datasets с >=5 JOIN — риск размножения строк |
| grain_change_on_join | WARN | 122 связей между датасетами с разным зерном |
| temporal_transformations | INFO | 368 временных преобразований/sentinel |

## Unresolved references

- unresolved dataset refs: 45; unresolved dashboard refs: 318
- unresolved physical tables/источников: 4979
- unresolved columns: 669

## <ФИО>-покрытие

| Требование | Статус | Пробелы |
|---|---|---|
| Общий список заказов | PARTIAL | address_to_zone/адрес |
| Готовность | NEEDS_EVENT | order_ready |
| ***REMOVED*** | NEEDS_REFERENCE | zone_reference, address_to_zone |
| Ходки | PARTIAL | batch_created/batch_assigned |
| ***REMOVED*** | NEEDS_EVENT | order_ready, order_picked_up |
| Назначение | PARTIAL | batch_assigned, courier_accepted_assignment |
| Оплата | NEEDS_REFERENCE | tariff_reference, courier_income_accrued |
| Смены | NEEDS_EVENT | courier_shift_started/ended, shift_plan_reference |
| Обучение | PARTIAL | courier_mentor_assigned, courier_training_completed |

## Расхождения с Phase 1.2

- Phase 1.2: datasets_expected=12, marts=11, kpis=48, status=PASS
- Phase 1.4 snapshot: dashboards=332, charts=19927, datasets=3778
- Различия количеств объясняются новым snapshot Superset (см. 02_catalog_diff).

PII/секреты: не найдено.
