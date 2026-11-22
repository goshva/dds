# Этап 1.6 — Проверка источников и закрытие бизнес-решений: итоговый отчёт

**Дата:** 2026-11-21 · **Режим:** read-only · **Статус: PASS_WITH_BLOCKERS**

---

## 1. Статусы Gate

| Gate | Статус | Комментарий |
|---|---|---|
| G0 Repository audit | **PASS** | все артефакты 1.5 проверены напрямую; 24/24 BD, model_validation PASS |
| G1 Superset connectivity | **PASS** | login OK, CSRF OK, метаданные датасетов доступны |
| G2 Dataset evidence | **PASS** | актуальные метаданные 6 датасетов получены и сохранены |
| G3 Real SQL checks | **BLOCKED** | SQL Lab: HTTP 403; chart data: HTTP 401; список БД пуст |
| G4 Relationships | **BLOCKED** | доли сопоставления измерить нельзя без доступа к данным |
| G5 Business decisions | **PASS** | все 24 BD имеют статус, доказательства и критерий закрытия |
| G6 Model impact | **PASS** | 25 таблиц оценены; DDL не изменялся |
| G7 Quality and safety | **PASS** | PII 0, `catalog.sqlite` не изменена, Superset не изменялся, tsc OK, 13 тестов OK |

Итог: **14 проверок PASS, 2 BLOCKED, 0 FAIL**.

## 2. Блокер BLOCK-1

| Проверка | Результат |
|---|---|
| `POST /api/v1/sqllab/execute/` (БД 92 и 76) | **403 Forbidden** |
| `GET /api/v1/sqllab/` | 403 Forbidden |
| `POST /api/v1/sqllab/estimate/` | 403 Forbidden |
| `POST /api/v1/chart/data` (датасеты 7802, 3466, 5939) | **401 Not authorized** |
| `POST /superset/sql_json/` | 404 (маршрут отсутствует) |
| `GET /api/v1/database/` | 200, но `count = 0` |
| `GET /api/v1/dataset/{id}`, `/api/v1/chart/` | 200 (метаданные доступны) |

**Причина:** у учётной записи API нет прав `can_sqllab`/`can_execute_sql` и видимости баз.
**Требуется:** выдать права (или отдельный read-only аккаунт SQL Lab) для проверки фактических данных.

## 3. Статистика запросов

| Тип | Попыток | Успешных | Неуспешных |
|---|---:|---:|---:|
| SQL через SQL Lab | 6 | 0 | 6 |
| Chart data (агрегаты) | 3 | 0 | 3 |
| Метаданные (GET) | ~26 | ~26 | 0 |

Все запросы зарегистрированы в `reports/phase-01-6/query_execution_log.json` с ID `Q-016-001…`,
статусом, ошибкой и ссылкой на evidence. Ни один неуспешный запрос не использован как подтверждение
(`data_verified = false` у всех шести датасетов).

Дополнительно выполнена **SQL-форензика** (без выполнения запросов): сохранён полный обезличенный SQL
шести датасетов (`evidence/sql_full/*.sql`), извлечены определения ключевых колонок и фактическое
использование колонок физических таблиц. Также выполнен расширенный анализ локальных метаданных
(`evidence/extended_metadata_scan.json/md`) и подготовлен **план из 18 SQL-проверок**
(`query_plan.json`, `docs/phase-01-6/13_query_plan.md`), предварительно проверенный `assertReadOnly`
и готовый к запуску сразу после выдачи прав.

## 4. Что реально подтверждено Superset (метаданные)

- Актуальные метаданные 6 датасетов: тип, БД, schema, колонки, типы, метрики, SQL-хэши, даты изменения.
- **Физические источники**, извлечённые из обезличенного SQL (25 ссылок):
  - `agile_mart_techaudit.actual_assistant_tt`, `agile_mart_techaudit.hr_daily_pers`, `stage_outer_sources.fio_employee` (5939);
  - `agile_mart_operational.shifts`, `.pools`, `.courier_queue`, `mart_mixed.darkstore_time` (7802);
  - `agile_mart_operational.photo_control_shift_attempt`, ODS-вью (7712);
  - `ods.timesheetfact`, `mart_mixed.darkstore_time_sheet` (7021);
  - `mart_mixed.darkstore_time_sheet`, `report.v_org_unit_actual` (3466);
  - `Loyalty_srv03.dbo.Webcall_log_ui_period`, `Reports.dbo.ksa_time_vw` (2339).
- **Документированное зерно 7802:** `id_shift × ТТ`, `rn_shift = 1` — одна строка смены, `rn_shift_pu = 1` — одна строка внутри ПУ.
- **7712** пишется DAG `dag_photo_control_shift_attempt` в `agile_mart_operational.photo_control_shift_attempt`.
- **Физические схемы, вскрытые SQL:**
  `agile_mart_operational.shifts` (id_shift, id_courier, id_pool, shift_start, shift_finish),
  `.pools` (id_pool, id_order, pool_start, pool_finish),
  `.courier_queue` (courier_id, id_shift, queue_in_dttm, queue_out_dttm, has_order, first_delivery_dttm, cluster_id),
  `.photo_control_shift_attempt` (courier_id, attempt_dt, attempt_n, attempt_start, shift_opened),
  `mart_mixed.darkstore_time` (id_order, id_general, shopno, date_order),
  `mart_mixed.darkstore_time_sheet` (121 используемая колонка), `ods.timesheetfact`, `ods.v_couriers`, `ods.v_tt`, `mart.org_unit_actual`.
- **Вычисляемые выражения подтверждены:** `rn_shift` (row_number по id_shift), `shift_minutes`, `useless_minutes = shift − wait − assembly − delivery` (7802); `deadline_sbor`, `last_sbor_touch` (3466); `shift_type = if(time_end > time_start,'Ночной','Дневной')`, `is_night_shift`, `has_timesheet` (7021); `enough_shifts_for_mentor` — оконный агрегат (5939).
- **Устаревшие колонки метаданных:** `time_ready`, `time_ready_plan` (3466) и `date_for_mentor` (5939) — 0 вхождений в SQL датасетов.
- Колонки с неопределённым типом: 3466 — 19, 2339 — 29, 5939 — 8.
- ПДн-колонки присутствуют во всех шести датасетах; в отчёты не выгружались (0 совпадений).

## 5. Пригодность источников

| Источник | Пригодность | Основание |
|---|---|---|
| 7802 `shift_time_breakdown` | **пригоден (схема)** | зерно документировано; вскрыты `shifts`, `pools`, `courier_queue` |
| 7712 `photo_control_shift_bi` | **частично** | подтверждает открытие смены; не мастер смен |
| 3466 `darkstore_time_sheet` | **частично** | `time_ready` опровергнут; Jinja-параметры; 121 колонка витрины |
| 5939 `hr_daily_pers_mentors` | **только аналитика** | справочник помощников ТТ; ПДн; `date_for_mentor` опровергнут |
| 2339 `Перенесенные заказы` | **частично** | лог переносов за месяц; причины переноса полезны для BD-002/BD-012 |
| 7021 `ds_collectors_prod` | **не пригоден для курьеров** | данные о сборщиках; `shift_type` вычисляется из табеля |

## 6. Связи (уровень метаданных)

| ID | Связь | Совпадение типов | Статус |
|---|---|---|---|
| R-1 | 5939 ↔ 7802 | MISMATCH (строка ↔ целое) | NOT_VERIFIED |
| R-2 | 7802 ↔ 7712 | нет общего ключа (`id_shift` отсутствует) | NOT_VERIFIED |
| R-3 | 7802 ↔ 7021 | нет ключа (нет курьера) | **CONTRADICTED** |
| R-4 | 3466 ↔ 4732 | MATCH (`id_order`) | PARTIAL |
| R-5 | 2339 ↔ 4732 | MATCH (`id_order`/`object_id`) | PARTIAL |
| R-6 | 7802 ↔ 4732 | MATCH (`id_courier`) | PARTIAL |
| R-7 | 3466 ↔ 7802 | MATCH по типам (косвенно) | INFERRED |
| R-8 | pools ↔ darkstore_time | MATCH (`id_order`) | INFERRED (схема) |
| R-9 | shifts ↔ courier_queue | MATCH (`id_shift`) | INFERRED (схема) |
| R-10 | courier_queue ↔ v_couriers | MATCH (`courier_id` ↔ `id`) | INFERRED (схема) |

**Ни одна связь не получила VERIFIED** — нет измерения покрытия. SQL JOIN сам по себе не доказывает FK.
Связи R-8…R-10 подтверждены на уровне **схемы** (обе стороны используют соответствующие ключи в SQL),
но кардинарность и покрытие не измерены.

## 7. Опровергнутые выводы Этапа 1.5

1. **`time_ready` не является источником готовности** — колонка не формируется SQL датасета 3466 (0 вхождений в 35 926 символах); `time_ready_plan` — то же. BD-013 = **CONTRADICTED**, при этом найден шортлист реальных кандидатов готовности: `date_set_cell`, `date_collected`, `date_printed`, `date_status_10`, `is_collected`, `set_cell_time` — они присутствуют и в 4732, и в `mart_mixed.darkstore_time_sheet`.
2. **7021 не является источником классификации курьерских смен** — это выработка сборщиков даркстора; `shift_type` вычисляется как `if(time_end > time_start,'Ночной','Дневной')` из табеля `ods.timesheetfact`. Поле `courier_shifts.shift_type` из этого источника следует исключить.
3. **2339 не подтверждает модель пакетов/ходок** — журнал изменения даты доставки за скользящий месяц; `quantity_batch`/`orders_assignment` не упоминаются в SQL (приходят через `SELECT *` из представления).
4. **5939 не подтверждает операционное назначение наставника новичку** — источник построен на справочнике помощников ТТ (`actual_assistant_tt`); `date_for_mentor` не формируется SQL; `enough_shifts_for_mentor` — оконный агрегат.

## 7a. Подтверждено на уровне схемы (SQL-форензика)

- `agile_mart_operational.pools` содержит `id_order` и `id_pool` → связь **пул↔заказ** существует физически (кандидат в `trips`/`trip_orders`).
- `agile_mart_operational.courier_queue` содержит `queue_in_dttm`, `queue_out_dttm`, `has_order` → прямой кандидат в `courier_queue_entries`.
- `agile_mart_operational.shifts` содержит `shift_start`, `shift_finish`, `id_pool` → прямой кандидат в `courier_shifts`.
- `mart_mixed.darkstore_time` содержит `id_order`, `id_general`, `shopno` — заказный источник.
- **Кандидаты в 12 утверждённых датасетах:** `arrival_time` / `plan_arrival_deadline` / `fact_arrival_before_deadline` (7006/7027/7119) → очередь и прибытие; `id_pool_calc`, `pool_size`, `pickup_seq`, `pickup_to_courier_minute`, `late_orders_cnt_in_pool` (7006/7024/7027/7119) → пул, порядок и назначение; `shift_N_profit`, `thresholds_taken_payments` (7473) → оплата только первых 5 смен; `shifts_in_first_14d`, `enough_shifts_flg` (5797/7465) → первые смены.

Это **не** заменяет проверку данных: кардинарность, покрытие и NULL-доли не измерены (BLOCK-1).

## 8. Бизнес-решения BD-001…BD-024

| Статус | Кол-во | Решения |
|---|---:|---|
| CONFIRMED_BY_DATA | 0 | — (данные не проверены) |
| READY_FOR_BUSINESS_APPROVAL | 4 | BD-018, BD-020, BD-022, BD-023 |
| BUSINESS_DECISION_REQUIRED | 13 | BD-003, BD-005…BD-011, BD-015, BD-016, BD-019, BD-021, BD-024 |
| PARTIAL_EVIDENCE | 6 | BD-001, BD-002, BD-004, BD-012, BD-014, BD-017 |
| CONTRADICTED | 1 | **BD-013** (`time_ready` опровергнут) |
| NOT_VERIFIABLE | 0 | — |

Ни одно решение не переведено в AGREED. Выносимые на утверждение: СУБД (BD-018),
слоты (BD-020), история зон (BD-022), сроки хранения (BD-023).

Карточки решений приведены к полному формату ТЗ §8: ID, статус, вопрос, бизнес-контекст,
связанные таблицы и события, доказательства, ограничения, **варианты решения** и **влияние каждого
варианта на архитектуру**, вопрос ответственному и критерий закрытия — проверка `C17` подтверждает
полноту всех 24 карточек.

## 9. Изменения в модели 1.5 (DDL не изменялся)

1. `courier_shifts`: зерно подтверждено (одна строка на `id_shift`); физические поля `shift_start`/`shift_finish`; **исключить `shift_type` из 7021**.
2. `courier_queue_entries`: подтверждена таблица `agile_mart_operational.courier_queue` (`queue_in_dttm`/`queue_out_dttm`/`has_order`).
3. `trips`/`trip_orders`: `agile_mart_operational.pools` содержит `id_pool` и `id_order` — связь пул↔заказ подтверждена на уровне схемы.
4. `order_readiness`: `time_ready` **опровергнут** (не формируется SQL); готовность вводится новым событием.
5. `mentorship_assignments`: убрать `date_for_mentor` (нет в SQL); пересмотреть зерно (наставник × ТТ × период).
6. `courier_events`: кандидаты-источники найдены (`photo_control_shift_attempt`, `courier_queue`), словарь событий отсутствует.
7. `work_slots`, `zone_boundary_versions`: источников нет — возможно отложить.
8. Устаревшие колонки метаданных (`time_ready`, `time_ready_plan`, `date_for_mentor`) не использовать и не переносить.

## 10. Неподтверждённые таблицы и события

Таблицы без источника: `delivery_zones`, `zone_boundary_versions`, `work_slots`, `tariff_versions`,
`courier_accruals`, `accrual_adjustments`, `mentorship_shift_reviews`, `domain_events`.
События без источника: все новые операционные (ORDER_READY, очередь, назначения, смены, начисления).

## 11. Что блокирует финализацию DDL

1. **BLOCK-1** — нет проверки фактических данных.
2. Нет тарифной формулы (BD-008/BD-024).
3. Нет справочника зон доставки.
4. Не определён мастер-источник заказа и курьера (BD-016/BD-017).
5. Не утверждена СУБД (BD-018).

## 12. Можно ли переходить к Этапу 1.7

**Условно да** — как к этапу корректировки модели и подготовки финального DDL, при условии что Этап 1.7:
либо получит доступ к SQL Lab (снятие BLOCK-1), либо явно зафиксирует работу без проверки данных.
Финализация DDL без BLOCK-1 и без решений BD-008/BD-013/BD-018 **невозможна**.

## 13. Созданные файлы

```
docs/phase-01-6/                     13 документов + validation_final_validation.json
  00_scope_and_methodology.md
  01_superset_access_audit.md
  02_dataset_evidence.md
  03_mentor_data_analysis.md
  04_shift_data_analysis.md
  05_order_ready_analysis.md
  06_trip_and_batch_analysis.md
  07_cross_dataset_relationships.md
  08_business_decisions_review.md
  09_data_quality_report.md
  10_model_impact_assessment.md
  11_unresolved_questions.md
  12_final_recommendations.md

reports/phase-01-6/
  00_repository_audit.md, 01_superset_access_audit.md, 02_dataset_evidence.md
  decision_evidence.json/csv, dataset_checks.json/csv, relationship_checks.json/csv,
  data_quality_checks.json, model_impact.json, query_execution_log.json, final_validation.json
  evidence/ (project_snapshot, connectivity_probe, sqllab_diagnostics, metadata_evidence,
             source_tables.json/md, sql_forensics.json/md, sql_full/*.sql,
             extended_metadata_scan.json/md, query_execution_log, dataset_metadata/*.json)

src/phase1-6/
  client.ts (SQL Lab + assertReadOnly + redactSql), pii16.ts, audit.ts, connectivity.ts,
  sqllab-diag.ts, metadata-evidence.ts, source-extraction.ts, sql-forensics.ts, extended-scan.ts,
  build-reports.ts, validate.ts, tests/guard.test.ts, tests/evidence.test.ts
```

## 14. Воспроизводимость

```
bun src/phase1-6/audit.ts               # G0
bun src/phase1-6/connectivity.ts        # G1/G2 + probe (ожидаемо exit 2 из-за BLOCK-1)
bun src/phase1-6/sqllab-diag.ts         # диагностика блокера
bun src/phase1-6/metadata-evidence.ts   # метаданные-доказательства
bun src/phase1-6/source-extraction.ts   # физические источники + история запросов
bun src/phase1-6/build-reports.ts       # 13 документов + JSON
bun src/phase1-6/validate.ts            # 15 проверок + final_validation.json
bun test src/phase1-6/tests             # 13 тестов
```

## 15. Ограничения этапа

Реальные миграции, ETL и production-запросы не выполнялись. Superset не изменялся (только GET;
POST-вызовы login/CSRF и отклонённые sqllab/chart-data). `data/catalog.sqlite` не изменена
(counts совпадают с backup). Файлы этапов 1.1/1.2/1.4/1.5 не изменялись (git status подтверждает).
ПДн в отчёты не выгружались. Commit/push не выполнялись.
