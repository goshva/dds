# Журнал реализации (DarkStore AI Forecast Engine, SQLite-first)

Записи ведутся по этапам. Формат: что сделано, как проверено, чем ограничено.

---

## Этап 0 — Аудит репозитория и данных

**Дата:** 2026-11-23 · **Статус:** DONE
**Артефакт:** `docs/forecasting/audit-report.md`
**Итог:** подтверждены источники (артефакты ДС 7745: 1 121 агрегатная строка, 6 892 наблюдения, 41 день), доступ только к датасету `3035`, отсутствие ClickHouse/зависимостей, доступность `bun:sqlite`, 0 дублей, 0 расхождений дневного итога между срезами (62 739). Блокирующих проблем для Этапа 1 нет.

---

## Этап 1 — SQLite Foundation

**Дата:** 2026-11-23 · **Статус:** DONE (ожидает проверки пользователем)

### Что сделано

| Область | Файлы |
|---|---|
| Подключение и PRAGMA | `src/forecasting/storage/sqlite/connection.ts` — `openDatabase`, `closeDatabase`, `withTransaction`, `inTransaction`, `integrityCheck`, `foreignKeyCheck`, `tableNames`, `databaseInfo`, `checkpointWal` |
| Миграции | `src/forecasting/storage/sqlite/migrations/index.ts` + `migrations/sql/001_init.sql` — последовательные версии, sha256-контроль, идемпотентность, детекция drift, откат упавшей миграции |
| Схема (13 таблиц) | `shops`, `extraction_runs`, `raw_extractions`, `audit_log`, `daily_metrics`, `domain_events`, `forecast_features`, `forecast_runs`, `forecast_results`, `forecast_evaluations`, `scenarios`, `scenario_results`, `schema_migrations` |
| Интерфейсы хранилища | `src/forecasting/storage/interfaces/{types.ts, repositories.ts}` — 5 контрактов: `RawRepository`, `MetricsRepository`, `FeaturesRepository`, `EventsRepository`, `ForecastRepository` |
| Реализации | `src/forecasting/storage/sqlite/repositories/{raw,metrics,features,events,forecast}-repository.ts` |
| Фасад | `src/forecasting/storage/sqlite/store.ts` — `openStore` (открытие + миграции + репозитории) |
| Резервное копирование | `src/forecasting/storage/sqlite/backup.ts` — `backupDatabase` (VACUUM INTO), `verifyBackup`, `restoreDatabase`, `listBackups`, `pruneBackups`, `backupFileName` |
| CLI | `src/forecasting/cli/db.ts` — `migrate`, `info`, `check`, `backup`, `restore`, `prune` (exit 0/1/2) |
| Скрипты | `package.json`: `forecast:db`, `forecast:test` |
| Типизация тестов | `tsconfig.json`: в `include` добавлен `tests/**/*.ts` |

### Ключевые решения

1. **Idempotency:** natural key наблюдения — `(shop_no, date, slice_id, dimension_1, dimension_2, metric, transform_version)`; `UNIQUE` без `run_id`. Повторная загрузка того же источника обновляет строку, а не создаёт дубль (проверено тестом на уровне схемы и на уровне репозитория).
2. **Три уровня статусов:** `evidence_status` (строка: actual/derived/estimated/planned/assumed/unknown), `data_status` (строка: full/partial/truncated/none/schema_only), `quality_status` (запуск: full/partial/truncated/none).
3. **NULL ≠ 0:** отсутствующие значения хранятся как `NULL`, тест это фиксирует.
4. **План/факт:** `domain_events` хранит `planned_start`/`actual_start`/`actual_end`/`status`/`verification_result`; уникальность по `(shop_no, event_type, IFNULL(planned_start,''))`, чтобы пустая дата не открывала дубли.
5. **Только этап 1:** репозитории PostgreSQL/ClickHouse не создавались; таблицы `orders/couriers/courier_shifts/trips/trip_orders` не создавались (нет источников).
6. **Read-only соединение** не меняет `journal_mode` (это запись в файл) — исправлено на этапе прогона тестов.
7. **Язык комментариев:** все комментарии, doc-блоки и описания тестов в новых файлах — на русском. Идентификаторы, SQL, флаги CLI и машинные сообщения об ошибках (на них опираются проверки) оставлены на английском.

### Проверки (фактические прогоны)

| Команда | Результат |
|---|---|
| `bun run forecast:test` | **44 pass / 0 fail**, exit 0 |
| `bun test` (полный) | **207 pass / 4 skip / 0 fail**, exit 0 (до этапа было 163 pass) |
| `bunx tsc --noEmit` | exit 0 |
| `bun run forecast:db migrate` (боевая БД) | exit 0, `applied=[1]`, повторный прогон `secondRunApplied=[]` |
| `bun run forecast:db check` | exit 0, `ok=true`, `integrity="ok"`, `pendingMigrations=[]` |
| `bun tools/redact-pii.ts … --gate` | GATE PASS, exit 0 |
| `git diff --check` | пусто |
| `git diff --stat` | изменены только `package.json` (+2 скрипта) и `tsconfig.json` (include тестов) |

База: `data/forecast/forecasting.sqlite` (131 072 Б, WAL). Каталог `data/*` в `.gitignore` — файл БД в git не попадает.

### Ограничения этапа

- Данные в БД не загружены: ingestion артефактов — следующий контрольный пункт (не входил в разрешённый объём).
- `hourly_metrics`, а также таблицы заказов/курьеров/смен/ходок отсутствуют осознанно (нет источников); появятся отдельной миграцией при появлении данных или прав.
- Признаки и модели не реализованы (Этапы 2–3).

---

## Этап 2 — Повторный API-сбор, сверка данных и импорт в SQLite

**Дата:** 2026-11-23 · **Статус:** DONE (ожидает проверки пользователем)

### Что сделано

| Область | Файлы |
|---|---|
| Повторный сбор | `data/extraction/superset/7745-api-refresh/` (те же пять срезов, период 2026-10-13…2026-11-23, `--raw-artifacts`) |
| Сборка набора из поштучных прогонов | `src/forecasting/cli/assemble-refresh.ts` (сохраняет провенанс каждого среза) |
| Модуль сверки | `src/forecasting/reconciliation/{types,normalizer,comparison,difference-classifier,reconciliation-report}.ts` |
| CLI сверки | `src/forecasting/cli/reconcile.ts` |
| Отчёт сверки | `docs/forecasting/api-reconciliation-report.md`, `docs/forecasting/api-reconciliation.json` |
| Отдельная проверка chart 20209 | `data/extraction/superset/7745-chart-20209/`, `docs/forecasting/chart-20209-report.md` |
| Слой загрузки | `src/forecasting/ingestion/{types,artifact-reader,validation,importer,plan-loader}.ts` |
| CLI импорта | `src/forecasting/cli/import.ts` |
| Тесты | `tests/forecasting/reconciliation.test.ts` (19), `tests/forecasting/ingestion.test.ts` (10) |

### Ключевые решения и находки

1. **Залп из 5 тяжёлых запросов отклоняется движком**: Superset отдаёт HTTP 500, внутри — ответ ClickHouse 429. Доступ не при чём (401/403 не было). Сбор выполнен поштучно (по одному срезу за запрос с паузой), затем собран в один канонический каталог.
2. **Запросы воспроизведены байт-в-байт**: `request_sha256` всех пяти срезов совпали со старой выгрузкой.
3. **Сверка: статус IDENTICAL** — 6 892 из 6 892 наблюдений совпали, изменений значений нет, новых и исчезнувших строк нет, дневные итоги (62 739) совпадают по всем срезам.
4. **Маскирование**: старая выгрузка хранит измерения в замаскированном виде (995 строк среза 20404), новая — «сырые». Сверка приводит обе стороны к одному виду; импорт также маскирует измерения, поэтому версии не размножаются в две строки и в аналитических данных нет ПДн (проверено: маскировщик не изменяет ни одно из 27 значений измерений в БД).
5. **Итоги за период** (11 строк с пустой датой) в `daily_metrics` не пишутся: схема требует ISO-дату. Они сравниваются отдельно в отчёте сверки.
6. **План мероприятий**: 43 пункта импортированы как `planned`/`planned`, даты факта пусты. Файл плана в CP1251 читается явным декодером; текст плана не маскируется (деловое содержание), при этом известен ложный положительный результат маскировщика на обороте «После Дня 10».
7. **chart 20209**: структура подтверждена (12 метрик, включая `qty_couriers` и `avg_qty_delivered_per_1_courier`), но семантика нет — `extras.where = (slots = 1)`, то есть подмножество (5 694 доставки против 62 739). В модели не включаем до подтверждения.

### Проверки

| Команда | Результат |
|---|---|
| `bun test tests/forecasting` | 71 pass / 0 fail |
| `bun test` (полный) | 234 pass / 4 skip / 0 fail |
| `bunx tsc --noEmit` | exit 0 |
| `bun run forecast:db check` | `ok=true`, `integrity=ok`, нарушений внешних ключей нет |
| PII gate | PASS |
| `git diff --check` | пусто |

Импорт: `legacy-6w` → 6 881 строка, `api-refresh` → 0 новых и 6 881 обновление (идемпотентность), план → 43 мероприятия. Итог: `daily_metrics` = 6 881, `domain_events` = 43, `extraction_runs` = 2, `raw_extractions` = 8.
