# Этап 1.4 — Расширенный поиск, извлечение и восстановление модели данных Superset

**Проект:** `dds` · **Дата:** 21 ноября 2026 г. · **Режим:** read-only для Superset и исходных БД.

---

## 1. Итоговый статус: **PASS**

| Gate | Статус | Что проверено |
|---|---|---|
| G0 | PASS | Аудит репозитория и Git сохранён, переиспользуемый код определён |
| G1 | PASS | Superset доступен: `ACCESS_OK`, login success, spot checks 3/3 |
| G2 | PASS | Каталог синхронизирован: все страницы собраны, дублей/ошибок нет |
| G3 | PASS | Все 12 утверждённых datasets на месте; кандидаты классифицированы |
| G4 | PASS | Метаданные выбранного охвата извлечены с provenance |
| G5 | PASS | SQL разобран; неразобранные конструкции перечислены |
| G6 | PASS | Физический каталог, логические сущности, связи и зерно построены |
| G7 | PASS | Проверки качества, unresolved refs, PII-аудит, бизнес-покрытие |

`final_validation.json`: `catalog_sqlite_modified=false`, `source_databases_queried=false`,
`superset_objects_modified=false`, `git_committed=false`, `git_pushed=false`,
`pii_leaks=0`, TypeScript OK, 14 локальных тестов пройдено.

## 2. Git и репозиторий (фаза 1.4.0)

- Ветка `main`, HEAD `4fab82d ph1.1 finish`; tracked 83 файла.
- На момент аудита tracked-изменений не было; изменения Phase 1.1/1.2 закоммичены.
- `src/phase1-4/` создан с нуля; переиспользованы `src/superset.ts`, `src/config.ts`, `src/phase1-2/parse-sql.ts`.
- Отчёт: `00_repository_audit.md` (+ `00_repository_audit.auto.json`).

## 3. Доступ к Superset (фаза 1.4.1)

| Слой | Результат |
|---|---|
| DNS A | OK, 10.210.254.19 |
| TCP 443 | OK |
| TLS | OK (GlobalSign, valid_to May 20 2027) |
| HTTP `/health` | 200 |
| login | success |
| spot checks | dataset/4732, chart/28360, dashboard/1680 — 3/3 OK |

Историческая блокировка (`BLOCKED_TCP`/`ECONNREFUSED`) снята. Секреты не выводились.
Отчёты: `01_superset_access_report.md/json`.

## 4. Синхронизация каталога (фаза 1.4.2)

Новый snapshot (read-only, checkpoint/resume, 242 страницы, 0 ошибок, 0 дублей):

| Ресурс | Было | Стало | Добавлено | Не видно в snapshot | Изменено |
|---|---:|---:|---|---:|---:|
| dashboard | 331 | 332 | 1681 | 0 | 0 |
| chart | 19 924 | 19 927 | 32582, 32583, 32584 | 0 | 32417 (1) |
| dataset | 3 776 | 3 778 | 7923, 7924 | 0 | 0 |

`NOT_SEEN_IN_SNAPSHOT` не трактуется как удаление. Snapshot: `data/snapshots/phase-01-4/`
(compact + raw-страницы в `.checkpoint/`), manifest с `snapshot_id`.
Отчёты: `02_catalog_sync.md`, `02_catalog_diff.csv/json`.

## 5. Расширенный поиск (фаза 1.4.3)

12 предметных областей (ORDERS, FULFILLMENT, DELIVERY, COURIER, SHOP, GEO, ROUTE, QUEUE,
SHIFT, PAY, MENTOR, EVENTS), объяснимый scoring по названию/описанию, SQL, полям, метрикам,
charts и dashboards.

| Приоритет datasets | Кол-во |
|---|---:|
| P0 (утверждённые) | 12 |
| P1 | 659 |
| P2 | 2 637 |
| OUT_OF_SCOPE | 470 |

- datasets с совпавшими терминами: 2 644 из 3 778;
- charts-кандидатов: 10 516; dashboards-кандидатов: 88;
- все 12 утверждённых ID включены принудительно, независимо от scoring.

Отчёты: `03_dataset_candidates.csv/json`, `03_chart_candidates.csv/json`,
`03_dashboard_candidates.csv/json`, `03_search_coverage.md`.

## 6. Извлечение метаданных (фаза 1.4.4)

- 12 утверждённых datasets — из локальных detail JSON (`FULL_DETAIL_LOCAL`);
- 50 новых P1-кандидатов, приоритезированных по релевантности пробелам (SHIFT/PAY/GEO/QUEUE/ROUTE/MENTOR/EVENTS) — detail через API (`FULL_DETAIL_API`);
- 500 charts и 19 dashboards — безопасные поля из snapshot (`LIST_ONLY`);
- 0 ошибок; владельцы/changed_by/email не извлекаются.

Provenance для каждого объекта: `source_system`, `source_object_type`, `source_object_id`,
`retrieved_at`, `snapshot_id`, `extraction_status`, `content_hash`, `parser_version`.
Отчёты: `04_extraction_report.md`, `04_extraction_index.csv`.

## 7. SQL-парсинг (фаза 1.4.5)

Базовый `parseSql` расширен (`parseSqlExtended`): nested SELECT, aggregates, CASE, CAST,
date/time expressions, Jinja-параметры, позиции конструкций, диалект с доказательством,
parse-статусы. Обратная совместимость сохранена.

| Показатель | Значение |
|---|---:|
| datasets с SQL | 3 222 |
| PARSED | 3 170 |
| UNSUPPORTED_SYNTAX | 39 |
| UNRESOLVED | 9 |
| PARTIAL | 4 |
| ClickHouse / Postgres / UNKNOWN | 378 / 646 / 2 198 |
| rows: tables / columns / metrics / joins / issues | 9 976 / 8 475 / 4 184 / 5 590 / 68 |

Правила соблюдены: CTE ≠ таблица, alias ≠ поле, JOIN ≠ FK, неизвестная конструкция
помечается, SQL не исполняется, Jinja не разрешается выполнением.
Отчёты: `05_sql_inventory.csv`, `05_table_inventory.csv`, `05_column_inventory.csv`,
`05_metric_inventory.csv`, `05_join_inventory.csv`, `05_sql_parse_issues.csv`,
`05_sql_parsing_report.md`.

## 8. Модель данных (фаза 1.4.6)

- **Физический каталог:** 436 таблиц; источники происхождения и число использующих datasets сохранены. PK/FK/indexes не выдумывались.
- **Логические сущности (статусы):**
  - VERIFIED: order, delivery, shop, courier, route;
  - INFERRED: address, assignment, shift, event, zone, mentorship;
  - UNKNOWN: order_item, accrual.
- **Связи:** 5 717 записей (127 dataset-key кандидатов из Phase 1.2 + 5 590 SQL JOIN). JOIN не считается FK.
- **Зерно:** 3 222 записи; для 12 утверждённых — с доказательствами (VERIFIED/INFERRED), для остальных — INFERRED/UNKNOWN.
- **Lineage:** dashboard→chart 13 822, chart→dataset 19 763 ссылок; unresolved dashboard refs 318, unresolved dataset refs 45.

Отчёты: `06_physical_catalog.csv/json`, `06_logical_entities.csv/json`,
`06_relationships.csv/json`, `06_data_grain_registry.csv/json`, `06_lineage.mmd`,
`06_er_model.mmd`, `06_modeling_report.md`.

## 9. Качество и бизнес-покрытие (фаза 1.4.7)

| Severity | Кол-во |
|---|---:|
| ERROR | 50 (метрики с неразрешёнными ссылками; выборка) |
| WARN | 49 |
| INFO | 5 |

- unresolved dataset refs: **45**; unresolved dashboard refs: **318**;
- unresolved источников (unknown/subquery из-за отсутствия schema): **4 979** — эвристическая
  классификация, требует ручного разбора;
- unresolved columns (SQL-идентификаторы вне columns): **669**;
- метрик с неразрешёнными ссылками: **1 094** (в основном Jinja/CTE-идентификаторы; эвристика);
- временные преобразования/sentinel: **367** (`+3 hour`, `1970-01-01`, `date_trunc`, `now()-interval`);
- **PII/секреты в отчётах: 0** (после уточнения сканера: 10-digit dataset ID не считаются ИНН).

Бизнес-покрытие: PARTIAL — заказы, ходки, назначение, обучение;
NEEDS_EVENT — готовность, очередь, смены; NEEDS_REFERENCE — зоны, оплата.

Отчёты: `07_quality_report.md`, `07_quality_issues.csv/json`,
`07_business_coverage_matrix.csv/json`, `07_unresolved_references.csv`, `07_pii_audit.md`.

## 10. Ограничения и открытые вопросы

1. `order_ready` не подтверждён; `date_status_10`/`date_collected` — гипотезы.
2. Справочник зон доставки отсутствует; `area_tt` — территория ТТ, `zone_cluster` — кластер, `inactivity_zone`/`zone` — зоны неактивности.
3. Тарифы и начисления не подтверждены; `sum_order`/`sum_paid` — не доход курьера; `shift_N_profit` — только первые 5 смен (7473).
4. Полной модели смен нет; `events_qty` — события, не явка.
5. В 7006/7024/7027 `calculation_time + interval '3 hour'` — смысл поправки не установлен; в 7119 `1970-01-01` — sentinel.
6. В 5399 две метрики ссылаются на отсутствующие колонки; в 7473 ряд метрик ссылается на поля, которых нет в five_shifts.
7. 39 SQL с неподдерживаемыми конструкциями и 9 UNRESOLVED — перечислены в `05_sql_parse_issues.csv`.
8. `unresolved sources 4 979` и `metrics unresolved 1 094` — эвристики, требуют ручной валидации перед этапом проектирования БД.

## 11. Файлы этапа

```
reports/phase-01-4/   (34 файла)
  00_repository_audit.md (+auto.json)
  01_superset_access_report.md/json
  02_catalog_sync.md, 02_catalog_diff.csv/json
  03_dataset_candidates.csv/json, 03_chart_candidates.csv/json,
  03_dashboard_candidates.csv/json, 03_search_coverage.md
  04_extraction_report.md, 04_extraction_index.csv
  05_sql_inventory.csv, 05_table_inventory.csv, 05_column_inventory.csv,
  05_metric_inventory.csv, 05_join_inventory.csv, 05_sql_parse_issues.csv,
  05_sql_parsing_report.md, 05_sql_parse_index.json
  06_physical_catalog.csv/json, 06_logical_entities.csv/json,
  06_relationships.csv/json, 06_data_grain_registry.csv/json,
  06_lineage.mmd, 06_er_model.mmd, 06_modeling_report.md
  07_quality_report.md, 07_quality_issues.csv/json,
  07_business_coverage_matrix.csv/json, 07_unresolved_references.csv, 07_pii_audit.md
  final_validation.json, 08_validation_summary.json
  phase_01_4_summary.md (этот файл)

src/phase1-4/
  utils.ts, lib.ts, access.ts, catalog-sync.ts, search.ts, extract.ts,
  parse.ts, model.ts, quality.ts, validate.ts, cli.ts
  tests/parse.test.ts, tests/lib.test.ts, tests/sqlite-readonly.test.ts

data/ (gitignored)
  snapshots/phase-01-4/           compact snapshots + manifest + .checkpoint/raw pages
  extracted/phase-01-4/           datasets/ (62), charts/ (500), dashboards/ (19), checkpoint.json
```

## 12. Воспроизводимость

```
bun run phase1-4:audit      # G0
bun run phase1-4:access     # G1
bun run phase1-4:sync       # G2 (checkpoint/resume)
bun run phase1-4:search     # G3
bun run phase1-4:extract    # G4
bun run phase1-4:parse      # G5
bun run phase1-4:model      # G6
bun run phase1-4:quality    # G7
bun run phase1-4:validate   # final_validation.json + tsc + tests
bun run phase1-4:all        # последовательно, останавливается при провале gate
```

## 13. Подтверждение ограничений

`data/catalog.sqlite` не изменялась (counts идентичны backup, readonly-тест на запись падает).
SQL к исходным БД не выполнялся; Superset-объекты не изменялись (только GET).
Массовая загрузка detail не выполнялась: 12 локальных + 50 обоснованных P1.
Commit и push не выполнялись. Секреты и PII в отчёты не попадали.
