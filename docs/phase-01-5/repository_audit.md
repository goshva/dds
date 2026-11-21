# Этап 1.5.0 — Аудит репозитория и результатов 1.4

**Дата:** 2026-11-21 · **Режим:** read-only, без миграций и production-запросов.
**Вход:** `reports/phase-01-4/`, `data/snapshots/phase-01-4/`, `data/extracted/phase-01-4/`, `src/phase1-4/`.

---

## 1. Git

| Параметр | Значение |
|---|---|
| Ветка | `main` |
| HEAD | `4fab82d ph1.1 finish` |
| Изменённые tracked-файлы | `diff.txt` (пользовательский артефакт), `package.json`, `src/phase1-2/parse-sql.ts` |
| Untracked | `reports/phase-01-4/`, `src/phase1-4/`, ТЗ 1.4 и 1.5 (имена файлов) |
| Коммиты/ push | не выполнялись |

`package.json` и `src/phase1-2/parse-sql.ts` изменены на Этапе 1.4 (разрешено его ТЗ). На Этапе 1.5
эти файлы не изменяются.

## 2. Фактическое наличие артефактов 1.4

Все заявленные артефакты найдены (43 файла в `reports/phase-01-4/`):

| Артефакт | Наличие | Ключевые числа |
|---|---|---|
| `final_validation.json` | да | status PASS, G0–G7 PASS, errors 0 |
| `00_repository_audit.md` | да | — |
| `01_superset_access_report.json` | да | ACCESS_OK, login success, spot 3/3 |
| `02_catalog_sync.md`, `02_catalog_diff.*` | да | 332 / 19 927 / 3 778; +1 / +3 / +2 |
| `03_dataset_candidates.*` | да | P0 12, P1 659, P2 2 637, OOS 470 |
| `03_chart_candidates.*`, `03_dashboard_candidates.*` | да | 10 516 charts, 88 dashboards |
| `04_extraction_report.md`, `04_extraction_index.csv` | да | 62 datasets, 500 charts, 19 dashboards |
| `05_*` inventories | да | 3 222 SQL, 9 976 table-refs, 8 475 columns, 4 184 metrics, 5 590 joins |
| `06_physical_catalog.*` | да | 436 таблиц |
| `06_logical_entities.*` | да | 13 сущностей |
| `06_relationships.*` | да | 5 717 |
| `06_data_grain_registry.*` | да | 3 222 |
| `06_lineage.mmd`, `06_er_model.mmd` | да | — |
| `07_quality_report.md`, `07_quality_issues.*` | да | ERROR 50 / WARN 49 / INFO 5; PII 0 |
| `07_business_coverage_matrix.*` | да | 9 требований |
| `07_unresolved_references.csv`, `07_pii_audit.md` | да | — |
| `phase_01_4_summary.md` | да | — |
| Snapshot `data/snapshots/phase-01-4/` | да | compact + manifest + raw pages |
| Extraction `data/extracted/phase-01-4/` | да | datasets 62, charts 501, dashboards 20 файлов |

Несоответствий «заявлено, но отсутствует» не выявлено.

## 3. Ключевые числа 1.4 (для контроля модели)

- `approved_datasets_found = 12/12`; `new_candidates = 659`; `deeply_parsed_datasets = 62`.
- `unresolved_refs`: dataset 45, dashboard 318, источников 4 979 (эвристика), columns 669.
- `metrics_with_unresolved_refs = 1 094` (эвристика); `temporal_transformations = 367`; `pii_leaks = 0`.
- `catalog_sqlite_modified = false`; `source_databases_queried = false`; `superset_objects_modified = false`.

## 4. Логические сущности 1.4 (статусы)

| Сущность | Статус | Комментарий 1.4 |
|---|---|---|
| order | VERIFIED | `id_order`/`id_general` в SQL joins |
| delivery | VERIFIED | `id_delivery_job`/`date_delivered`/`parcel_id` |
| shop | VERIFIED | `shopno`/`id_tt` |
| courier | VERIFIED | `id_courier`/`courier_id` |
| route | VERIFIED | `parcel_id`/`id_route`/`cluster_id` |
| address | INFERRED | координаты только из routing; адрес доставки как поле не подтверждён |
| assignment | INFERRED | связь заказ↔курьер есть; события назначения нет |
| shift | INFERRED | были доступны только первые 5 смен (7473) |
| event | INFERRED | `event_name`/`status`/`flag_` без словаря |
| zone | INFERRED | зона доставки не подтверждена |
| mentorship | INFERRED | `name_curator`; роль наставника не подтверждена |
| order_item | UNKNOWN | позиции заказа отдельной сущностью не подтверждены |
| accrual | UNKNOWN | тарифы/начисления не подтверждены; `sum_paid` ≠ доход |

## 5. Бизнес-покрытие 1.4

| Требование | Статус | Пробел |
|---|---|---|
| Общий список заказов | PARTIAL | адрес доставки |
| Готовность | NEEDS_EVENT | `order_ready` |
| Зоны | NEEDS_REFERENCE | справочник зон, address→zone |
| Ходки | PARTIAL | batch/trip события |
| Очередь | NEEDS_EVENT | события очереди |
| Назначение | PARTIAL | события назначения |
| Оплата | NEEDS_REFERENCE | тарифы, начисления |
| Смены | NEEDS_EVENT | модель смен |
| Обучение | PARTIAL | роль наставника, завершение обучения |

## 6. Новая доказательная база, найденная при аудите 1.5

При проверке извлечённых 62 datasets (метаданные столбцов, не бизнес-подтверждение) обнаружены
дополнительные источники, которые **уточняют** выводы 1.4. Статус — `INFERRED`, требует подтверждения:

| Dataset | Таблица | Что найдено | Влияние на модель |
|---|---|---|---|
| 5939 | `hr_daily_pers_mentors` (ch_10.0.112.21) | `mentorid`, `mentorfio`, `mentor_at_date`, `mentor_same_tt_date`, `enough_shifts_for_mentor`, `trainee_shift_in_five`, `trainee_shifts_qty`, `shift_rn_trainee_by_mentor`, `first_shift_date`, `last_shift_date`, `shifts_qty`, `progul` (невыход), `stake`, `uvol`, `second_hire`, `date_start_work`, `event_type`, `role`, `position_name` | mentorship и частично смены/невыходы имеют прямой источник; `stake` — финансовый скаляр с неясной семантикой |
| 7802 | `shift_time_breakdown` (gp_10.0.112.100/dwh) | `id_shift`, `id_courier`, `dt`, `shopno`, `rn_shift*`, `shift_minutes`, `assembly_minutes`, `delivery_minutes`, `wait_minutes`, `useless_minutes` | появляется зерно «смена курьера за день с разбивкой времени» |
| 7712 | (54 cols, ch_10.0.15.240/default) | `shift_opened`, `shift_open_time`, `courier_id`, `shopno`, `attempt_dt`, `attempt_start`, `attempt_n`, selfie/vehicle/bag checks | открытие смены и проверки; кандидат в смены |
| 7021 | (41 cols) | `shift_type`, `is_night_shift`, `hours_on_schedule`, `has_timesheet`, `time_start`, `time_end`, `part_start`, `part_end`, `is_overdue` | тип смены, ночная смена, плановые часы |
| 3466 | `darkstore_time_sheet` (167 cols) | `time_ready`, `time_ready_plan`, `deadline_sbor`, `date_collected`, `date_status_10`, `wait_time`, `waiting_area_time`, `zone_cluster` | `time_ready` — **кандидат DIRECT на `ORDER_READY`** (BD-013), но тип поля не определён |
| 3035 | `darkstore_time_click` (165 cols) | `Куратор курьера`, `zone_cluster`, `Куст`, `area_tt`, `wait_min_taxi`, `avg_wait_min_dost`, `courier_inn` (PII) | куратор и кластеры; PII-риск |
| 2339 | `Перенесенные заказы` (Reports) | `quantity_batch`, `orders_assignment`, `Кол-во переносов`, `Скорость переназначения 1..3`, `log_data`, `action`, `autor`, `source` | частичное подтверждение размера пакета и переназначений |

**Выводы:**
1. «Смены» — не `NEEDS_EVENT`, а `PARTIAL`: исторические смены можно получить из 7802/7021/7712, но реального времени начала/окончания и перерывов в операционном смысле нет.
2. «Обучение» — `PARTIAL` с прямым источником 5939 (`mentorid`), но роль «наставник = куратор» требует BD-001/подтверждения.
3. «Готовность» — кандидат `time_ready` (3466) вместо гипотезы `date_status_10`; требуется BD-013.
4. «Ходки/пакет» — `quantity_batch`/`orders_assignment` (2339) дают частичное подтверждение, но семантика не доказана.
5. PII расширяется: `courier_inn`, `mentorfio`, `fio`, `phone`, `user_inn` — в отчёты и fixtures не попадают.

## 7. Несоответствия и пробелы относительно ТЗ 1.5

1. Нет `docs/phase-01-5/` — создаётся на этом этапе.
2. Нет `src/phase1-5/` — создаётся только для генератора/валидатора/тестов.
3. Нет JSON Schema событий и синтетических fixtures — создаются.
4. Нет ADR по выбору СУБД — создаётся `ADR-001`.
5. Нет реестра бизнес-решений — создаётся (BD-001…BD-024).
6. Зерно 1.4 для 3 222 datasets — аналитическое; для операционной модели зерно задаётся заново по ТЗ.
7. Mapping Superset→домен в 1.4 не строился — создаётся на 1.5.

## 8. Ограничения, обязательные для 1.5

- Не обращаться к Superset (артефактов 1.4 достаточно).
- Не выполнять SQL в исходных БД, не менять `data/catalog.sqlite`.
- Не менять файлы Phase 1.1/1.2/1.4 (кроме чтения).
- Не выполнять миграции, не создавать production-таблицы, не запускать ETL.
- Не загружать PII, не менять `.env`/credentials.
- Не делать commit/push, не удалять пользовательские файлы.
- Новые файлы только в `docs/phase-01-5/`, `reports/phase-01-5/`, `src/phase1-5/`.

## 9. Gate G0

Источники и ограничения поняты, артефакты 1.4 фактически проверены, ничего не потеряно,
дополнительная доказательная база зафиксирована.
**G0 = PASS.** Работа не изменяла исходные данные.
