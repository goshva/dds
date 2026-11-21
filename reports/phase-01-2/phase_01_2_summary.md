# Этап 1.2 — SQL Audit & Data Mart Registry: итоговая сводка

**Проект:** Courier Analytics / DDS · **Дата:** 21 ноября 2026 г.
**Режим:** read-only audit. `data/catalog.sqlite` не изменялась, исходные БД не затрагивались, полный Discovery не повторялся, витрины не создавались, ETL не запускался.

---

## 1. Утверждённые 12 датасетов (восстановлены из проекта)

Источник: `src/phase1-1-kpi-catalog.ts` (PRIORITY_IDS), `src/phase1-1-dataset-detail-loader.ts`, `reports/phase-01-1/kpi_source_matrix.json`, `output/dataset_details/`.

| ID | Датасет | База / schema | SQL | columns | metrics |
|---:|---|---|---:|---:|---:|
| 4732 | darkstore_ts_partners_new | ch_10.0.15.240 / default | 4 897 | 127 | 22 |
| 5247 | courier_logs_agg_couriers_daily | gp_10.0.112.100 / agile_mart_techaudit | 2 378 | 15 | 2 |
| 5399 | courier_logs_agg_couriers_week | gp_10.0.112.100 / agile_mart_techaudit | 2 889 | 15 | 5 |
| 5797 | hr_couriers | ch_10.0.15.240 / agile_mart_techaudit | 2 246 | 65 | 38 |
| 7006 | cargo_main2 | gp_10.0.112.100 / logs_mart | 8 891 | 44 | 1 |
| 7024 | cargo_main3 | gp_10.0.112.100 / logs_mart | 5 819 | 11 | 1 |
| 7027 | cargo_main4 | gp_10.0.112.100 / logs_mart | 11 820 | 50 | 1 |
| 7119 | cargo_flags | ch_10.0.112.21 | 15 282 | 55 | 1 |
| 7293 | hr_couriers_zone_balance | ch_10.0.15.240 / default | 1 515 | 8 | 1 |
| 7465 | hr_couriers_5shifts | ch_10.0.15.240 / agile_mart_techaudit | 2 331 | 59 | 38 |
| 7473 | hr_couriers_five_shifts | ch_10.0.15.240 / agile_mart_techaudit | 2 772 | 54 | 38 |
| 7775 | all_couriers_list | ch_10.0.15.240 / default | 600 | 11 | 1 |

**Расхождение со списком кандидатов из ТЗ зафиксировано:** кандидаты `7248 cargo_samopools1`, `7252 cargo_samopools2`, `7212 cargo_veer1`, `7220 cargo_veer7_vkusvill`, `7221 cargo_veer7_veeroute` в утверждённый набор Stage 1.1 **не входят** и в основной аудит не включались. Вместо них утверждены `5247`, `5399`, `7293`. Приоритет — фактическая конфигурация проекта.

**SQL:** подтверждён у всех 12 (12/12), detail JSON на месте, missing = 0, extra = 0.

## 2. Что проверено

- Полный разбор SQL: CTE, источники, JOIN и условия ON, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, оконные функции, UNION, SELECT-поля и aliases, вычисляемые поля.
- Поля: 514 записей инвентаря (columns + calculated_columns); метрики: 149 записей; источники: 99 записей.
- Временные поля: роль и статус (VERIFIED / PROBABLE / UNKNOWN) с доказательством по SQL.
- Ключи: сущность, тип, подтверждённость, возможность соединения.
- Карта связей между датасетами: 127 рёбер, Mermaid-схема.
- Реестр витрин: 11 витрин, grain, primary key, источники, правила, проверки качества, приоритеты.
- Матрица доступности: 48 показателей с формулами, источниками, ключами, периодом, статусом и ограничениями.
- Реестр недостающих событий: 17; справочников: 13.
- Все ссылки на поля/метрики проверены по инвентарю: evidence issues = 0.
- `catalog.sqlite`: quick_check = ok, relations = 0, counts совпадают с backup → **не изменялась**.

## 3. Подтверждённые SQL-источники

| Датасет(ы) | Исходные таблицы |
|---|---|
| 4732 | `default.darkstore_time_sheet`, `default.services_sla`, `mart.org_unit_actual`, dictionaries (`dict_tt`, `dict_pomoschniki`, `dict_email_dostavka`) |
| 5247 / 5399 | `agile_mart_techaudit.courier_events_logs_aggr` |
| 5797 / 7465 | `agile_mart_techaudit.hr_delivery`, `dictionaries.dict_tt` |
| 7473 | `agile_mart_techaudit.hr_delivery_five_shifts`, `agile_mart_techaudit.hr_delivery`, `dictionaries.dict_tt` |
| 7006 / 7024 / 7027 | `sandbox.ab_logs_mart_routing_results_v1`, `ods.v_delivery_job_lines`, `mart_mixed.darkstore_time` |
| 7119 | `agile_mart_hot_team.order_delivery_base`, `agile_mart_hot_team.routing_results_v1` |
| 7293 | `agile_mart_techaudit.hr_delivery` |
| 7775 | `default.v_couriers`, `default.courier_job_type`, `default.v_couriers_payments_courier_types` |

Подтверждённые связи: заказ↔курьер (`id_order`/`id_courier`, `parcel_id`/`courier_id`), заказ↔ТТ (`shopno`), заказ↔пул (`id_pool`), курьер↔HR (`id_courier`), ТТ↔dict (`shopno`), заказ↔routing (`id_order`=`parcel_id`), дата↔HR (`date`/`event_date`).

## 4. Витрины: 11 зарегистрировано

| Приоритет | Витрина | Статус данных |
|---|---|---|
| P0 | `dm_courier_orders` | PARTIAL |
| P0 | `dm_courier_ready_queue` | NEEDS_EVENT |
| P0 | `dm_delivery_zones` | NEEDS_REFERENCE |
| P0 | `dm_delivery_batches` | PARTIAL |
| P0 | `dm_courier_assignments` | PARTIAL |
| P1 | `dm_courier_performance` | PARTIAL |
| P1 | `dm_courier_income` | NEEDS_REFERENCE + NEEDS_BUSINESS_RULE |
| P1 | `dm_courier_attendance` | NOT_AVAILABLE |
| P2 | `dm_courier_mentorship` | PARTIAL |
| P2 | `dm_courier_curator_performance` | PARTIAL |
| P2 | `dm_courier_demand_forecast` | NEEDS_BUSINESS_RULE |

## 5. Показатели: 48 зарегистрировано

| Статус | Кол-во |
|---|---:|
| VERIFIED | 2 |
| DERIVABLE | 12 |
| PARTIAL | 12 |
| NEEDS_EVENT | 13 |
| NEEDS_REFERENCE | 4 |
| NEEDS_BUSINESS_RULE | 2 |
| NOT_AVAILABLE | 3 |

Сводно: **verified/derivable = 14**, **partial = 18**, **needs_event = 13**, **not_available = 3**.

Доступно уже сейчас: объём и успешные доставки, отмены, заказы по ТТ/курьерам, время доставки, SLA, заказы на курьера, заказов в пакете, размер пула, событийная активность, баланс миграции зон, доход в час для первых 5 смен.

## 6. Показатели, требующие новых событий (13)

`wait_duration`, `order_ready_ts`, `queue_size`, `ready_to_pickup_duration`, `batch_created_at`, `batch_assigned_at`, `time_to_pickup`, `reassignments_total`, `payout_status`, `mentor_assignment`, `training_completed`, `actual_shifts`, `couriers_available`.

Недостающие события (17) включают: `order_ready`, `order_added_to_batch`, `batch_created`, `batch_assigned`, `courier_accepted_assignment`, `order_picked_up`, `order_cancelled`, `order_returned`, `courier_shift_started`, `courier_shift_ended`, `courier_zone_assigned`, `courier_zone_changed`, `courier_mentor_assigned`, `courier_training_completed`, `courier_income_accrued`, `courier_income_adjusted`.

## 7. Отсутствующие справочники (13)

`zone_reference`, `address_to_zone_mapping`, `tariff_reference`, `shift_plan_reference`, `status_dictionary`, `event_dictionary`, `batch_rule_reference`, `mentor_role_reference`, `retention_rule_reference`, `forecast_model_spec`, `absence_reason_dictionary`, `cancel_reason_dictionary`, `payout_status_dictionary`.

## 8. Ключевые ограничения, обнаруженные аудитом

1. **Нет подтверждённого события `order_ready`.** `date_status_10` и `date_collected` — только гипотезы; очередь готовых заказов без него не строится.
2. **Нет зон доставки.** `area_tt` — территория ТТ; `mart.org_unit_actual.zone_cluster` — кластер орг-единицы; `inactivity_zone` (5797/7465/7473) и `zone` (7293) — зоны бездействия/миграции, не зоны доставки.
3. **Нет тарифов за заказ.** `sum_order`/`sum_paid` — суммы заказа, не доход курьера. Подтверждён только `shift_N_profit`/`shift_N_work_minutes` (7473) для первых 5 смен новичка.
4. **Нет смен.** Подтверждены только первые 5 смен (7473) и 14-дневные признаки (5797/7465). Явка/невыходы не рассчитываются; `events_qty` — события, не явка.
5. **`id_pool_calc` вычисляется** по разрывам `date_pickuped` (7006/7027) и не равен исходному `id_pool`; пакет из 5 заказов — проектное правило, не подтверждено.
6. **TZ-риск:** в 7006/7024/7027 `calculation_time + interval '3 hour'`; в 7119 `1970-01-01` трактуется как NULL для `date_pickuped`.
7. **Усечённые окна:** 3 месяца (7006/7024/7027), 14 дней (7119), 7 дней/неделя (5247/5399, причём 5399 отбрасывает неполные недели), 30 дней (7465/7473).
8. **Битые метрики:** в 5399 метрики `events_daily_otkl_rate`/`_abs` ссылаются на отсутствующие колонки; в 7473 множество метрик ссылается на колонки, которых нет в five_shifts (скопированы из hr_couriers). См. `dataset_metrics_inventory.csv`.
9. **PII:** 4732 (`phone`, `user_inn`), 5797/7465 (`fio`, `phone`, `inn`), 7473 (`name_courier`), 7775 (`Курьер`, `Телефон`, `ИНН`). Значения не выгружаются.
10. **4732:** дубли полей-суффиксов `_sheet`; единицы `*_time` не подтверждены; `id_order` — подзаказ, `id_general` — объединённый заказ.

## 9. Что делать на этапе 1.3

1. Утвердить справочник постоянных зон и привязку адрес/ТТ→зона (P0).
2. Утвердить правило пакета (5 заказов) и справочник тарифов «оплата за заказ» (P0/P1).
3. Специфицировать регистрацию событий: `order_ready`, batch/assignment/pickup, shift start/end, income accrued/adjusted.
4. Утвердить единое правило удержания и признак «наставник» vs «куратор».
5. Согласовать формулы SLA и нормализацию часовых поясов между 4732, 7006/7024/7027 и 7119.
6. После утверждения — реализовать ETL витрин P0 на подтверждённых полях; не начинать до отдельного разрешения.

## 10. Файлы этапа 1.2

```
reports/phase-01-2/
├── phase_01_2_summary.md
├── dataset_audit.md
├── dataset_sql_inventory.csv
├── dataset_fields_inventory.csv
├── dataset_metrics_inventory.csv
├── dataset_source_tables.csv
├── dataset_join_map.csv
├── dataset_join_map.mmd
├── data_mart_registry.md
├── data_mart_registry.csv
├── data_mart_registry.json
├── data_mart_fields.csv
├── kpi_availability_matrix.csv
├── missing_events_registry.csv
├── missing_references_registry.csv
├── data_quality_rules.md
├── implementation_priorities.md
└── final_validation.json

src/phase1-2/
├── parse-sql.ts
├── audit-datasets.ts
├── build-source-map.ts
├── build-mart-registry.ts
└── validate-phase1-2.ts
```

## 11. Результат валидации

`final_validation.json`: **status = PASS**, 10/10 проверок пройдено:
12 датасетов и SQL, поля/метрики (514/149, совпадают с detail JSON), карта связей (127 рёбер),
реестр витрин (11 уникальных), KPI-матрица (48, статусы валидны), доказательства (0 issues),
события/справочники (17/13), локальные тесты анализатора, TypeScript (`bunx tsc --noEmit` = 0),
неизменность `catalog.sqlite`.

```
datasets_expected = 12      datasets_audited = 12
datasets_with_sql = 12      datasets_without_sql = 0
marts_registered = 11       metrics_registered = 48
metrics_verified = 14       metrics_partial = 18
metrics_needs_event = 13    metrics_not_available = 3
missing_events = 17         missing_references = 13
validation_errors = 0
catalog_sqlite_modified = false
source_databases_accessed = false
full_discovery_rerun = false
```

## 12. Подтверждение ограничений

`data/catalog.sqlite` не изменялась (quick_check = ok, relations = 0, counts идентичны backup).
Прямых подключений к ClickHouse, PostgreSQL, GP100/DWH и другим исходным БД не было; SQL на
исходных БД не выполнялся. Массовая загрузка detail не выполнялась, `--build-catalog` не
использовался, ETL и витрины не создавались. Commit и push не выполнялись.
