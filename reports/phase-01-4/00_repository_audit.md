# Фаза 1.4.0 — Аудит репозитория и Git

**Дата:** 2026-11-21 · **Проект:** `dds` · **Рабочая директория:** `C:\soft\bun\dds`
**Режим:** read-only для Superset и исходных БД.

---

## 1. Git

| Параметр | Значение |
|---|---|
| Ветка | `main` |
| HEAD | `4fab82d ph1.1 finish` |
| Последние коммиты | `4fab82d ph1.1 finish`, `f89fd72 ph1 finish`, `3f0d135 ph1 pre-finish fix2`, `d684914 ph1 pre-finish fix`, `3608f08 ph1 finish` |
| `git diff --stat` | пусто (tracked-изменений нет) |
| `git diff --name-only` | пусто |
| Tracked-файлов | 83 |
| Untracked | только `ТЗ_Claude_Code_Этап_1.4_Superset.md` (входное ТЗ пользователя) |

Изменения Phase 1.1 и Phase 1.2 на момент аудита **закоммичены** — рабочее дерево чистое.
Новых незаявленных изменений вне разрешённых путей нет.

## 2. Структура репозитория

```
dds/
├── backups/            backups/catalog-before-discovery.sqlite (baseline)
├── data/               catalog.sqlite (исторический снимок), checkpoint_dataset_detail.json
├── docs/               ACCESS_MATRIX.md, ANALYSIS_FROM_FIRST_RUN.md, FIRST_WAVE_PLAN.md
├── output/             dashboards.json, charts.json, datasets.json, dataset_details/, spot_details/, *summary.json
├── reports/            phase-00/, phase-01/, phase-01-1/, phase-01-2/
├── src/                см. таблицу модулей
├── package.json        scripts: audit/summary/search/object/help
├── tsconfig.json       strict, ESNext, Bun, types=bun-types, noEmit
└── .env / .env.example  конфигурация Superset (значения не читаются/не выводятся)
```

`.gitignore` исключает `data/*`, `output/*`, `backups/`, `.env`, `node_modules/`. Значит новые
`data/extracted/phase-01-4/` и `data/snapshots/phase-01-4/` не попадут в Git (это ожидаемо).

## 3. Модули и назначение

| Модуль | Назначение | Решение для 1.4 |
|---|---|---|
| `src/config.ts` | env-конфиг: Superset URL, credentials/token, timeout, page size, rate limit, пути | переиспользовать без изменений |
| `src/superset.ts` | `SupersetClient`: Rison-пагинация, unique-ID контроль, retry/backoff, re-auth, `Retry-After`, классификация сетевых ошибок, `get`/`listFull`/`detail`/`tryGet` | переиспользовать для access-check и read-only extraction |
| `src/discovery.ts` | read-only Discovery: listFull по ресурсам, точечные detail, summary; SQLite только в `--build-catalog` | не запускать полный Discovery; при необходимости — только list-сверка |
| `src/store.ts` | `CatalogStore` (SQLite writer) | **не использовать** в 1.4 (кроме проверки, что путь не открывается на запись) |
| `src/index.ts` | CLI: health / discovery / report | не менять |
| `src/cli.ts` | Локальный CLI по `catalog.sqlite` (readonly): audit/summary/search/object | переиспользовать идеи поиска, но не менять |
| `src/phase1-1-diagnostics.ts` | Послоевая транспортная диагностика (DNS/TCP/TLS/HTTP/auth) | переиспользовать логику в `phase1-4/access`, но **не перезаписывать** отчёт phase-01-1 |
| `src/phase1-1-api-check.ts` | точечные API-проверки (count, форма detail, priority details) | идеи переиспользовать |
| `src/phase1-1-dataset-detail-loader.ts` | загрузка 12 detail с checkpoint/атомарной записью | переиспользовать формат detail; новую массовую загрузку не запускать |
| `src/phase1-1-lineage.ts` | Lineage builder (evidence/relations/preview) | baseline-результаты использовать как контрольные |
| `src/phase1-1-kpi-catalog.ts`, `phase1-1-kpi-fields.ts` | KPI Source Matrix и инвентарь полей | baseline Phase 1.2 |
| `src/phase1-1-api-pagination-test.ts`, `phase1-1-discovery-test.ts` | smoke/read-only тесты | переиспользовать |
| `src/phase1-1-final-validation.ts` | валидация 1.1 | не менять |
| `src/phase1-2/parse-sql.ts` | Прагматичный SQL-парсер: CTE, источники, JOIN/ON, WHERE/GROUP/HAVING/ORDER/LIMIT, окна, UNION, SELECT-поля, Jinja/комментарии | **расширять** (nested SELECT, aggregates, CASE, CAST, date/time exprs, позиции, parse-статусы) |
| `src/phase1-2/audit-datasets.ts` | SQL-аудит 12 датасетов + инвентари | переиспользовать как baseline; расширенный парсинг — в 1.4 |
| `src/phase1-2/build-source-map.ts` | Карта связей между датасетами (127 рёбер, MMD) | baseline |
| `src/phase1-2/build-mart-registry.ts` | 11 витрин, 48 KPI, 17 событий, 13 справочников | baseline |
| `src/phase1-2/validate-phase1-2.ts` | Валидация 1.2 (PASS 10/10) | baseline |

## 4. Контрольные результаты предыдущих этапов (проверены фактически)

| Показатель | Значение | Где |
|---|---:|---|
| dashboards / charts / datasets (list) | 331 / 19 924 / 3 776 | `output/*.json`, `output/discovery_summary.json` |
| Lineage: свидетельства / связи | 48 010 / 33 592 | `reports/phase-01-1/lineage_preview.json` |
| Phase 1.2: marts / KPI / events / refs | 11 / 48 / 17 / 13 | `reports/phase-01-2/data_mart_registry.json` |
| Phase 1.2 validation | PASS, 10/10, errors=0 | `reports/phase-01-2/final_validation.json` |
| Утверждённые dataset IDs | 4732, 5247, 5399, 5797, 7006, 7024, 7027, 7119, 7293, 7465, 7473, 7775 | `kpi_source_matrix.json`, `dataset_details/` |
| `data/catalog.sqlite` | 330 dashboards / 5 000 charts / 3 767 datasets, relations=0 (устаревший снимок) | `data/catalog.sqlite` |

**Важно:** `data/catalog.sqlite` — исторический неполный снимок, не источник истины. Полный каталог — в `output/*.json`.

## 5. Пробелы и ограничения, влияющие на 1.4

1. **Текущий доступ к Superset не подтверждён** (в Phase 1.1 зафиксированы `BLOCKED_TCP` / `ECONNREFUSED`). Проверка — фаза 1.4.1.
2. Нет `src/phase1-4/`, нет `reports/phase-01-4/`, нет `data/snapshots/`, нет `data/extracted/`.
3. В `package.json` нет скриптов `phase1-4:*`.
4. `parse-sql.ts` не извлекает nested SELECT, aggregates, CASE, CAST, date/time expressions, позиции и не выдаёт parse-статусы — требуется расширение.
5. Нет физического каталога таблиц/колонок и логической модели сущностей — задача фазы 1.4.6.
6. Нет матрицы бизнес-покрытия требований курьерской службы — задача фазы 1.4.7.
7. API может не отдавать часть метаданных (columns/metrics для произвольных datasets) — это фиксируется как ограничение покрытия, а не додумывается.

## 6. Предлагаемые изменения (в рамках 1.4)

**Новые модули** (структура упрощена относительно рекомендуемой, без дублирования Phase 1.2):

```
src/phase1-4/
  types.ts          общие типы (provenance, parse status, confidence)
  utils.ts          hash, csv, json, snapshot id, timestamps
  access.ts         DNS/TCP/TLS/HTTP/login/spot checks → 01 отчёт
  catalog-sync.ts   сравнение snapshots, diff
  search.ts         расширенный поиск + scoring по 12 областям
  extract.ts        извлечение метаданных с provenance (без массового detail fetch)
  sql-parse.ts      обёртка над src/phase1-2/parse-sql.ts (расширение)
  model.ts          физический каталог, логические сущности, связи, зерно
  quality.ts        quality issues, unresolved refs, PII audit, бизнес-покрытие
  validate.ts       final_validation.json
  cli.ts            команды audit/access/sync/search/extract/parse/model/quality/validate/all
  tests/            unit/integration тесты
```

**Новые отчёты:** `reports/phase-01-4/` (структура из раздела 12 ТЗ).

**Новые данные (gitignored):** `data/extracted/phase-01-4/{datasets,charts,dashboards}/`, `data/snapshots/phase-01-4/`.

**package.json:** добавить скрипты `phase1-4:audit|access|sync|search|extract|parse|model|quality|validate|all` (lock-файл не менять).

**Не менять:** `data/catalog.sqlite`, отчёты `phase-00/01/01-1/01-2`, `.env`, `src/phase1-1/*`, `src/phase1-2/*` (кроме аккуратного расширения парсера при необходимости и обратной совместимости).

## 7. Gate G0

Аудит сохранён; переиспользуемый код определён; новые модули не дублируют существующие.
**G0 = PASS.** Разрешено переходить к фазе 1.4.1 (проверка доступа к Superset).
