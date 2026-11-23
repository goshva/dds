# Этап 0 — Аудит репозитория и данных (DarkStore AI Forecast Engine, SQLite-first MVP)

**Дата:** 2026-11-23 · **Исполнитель:** AI-агент · **Режим:** только чтение + один новый документ
**Область:** `github.com/goshva/dds`, ветка `main`, HEAD `1571466`
**Пилот:** ДС 7745 · **Период артефактов:** 2026-10-13 … 2026-11-22 (41 день)

Обозначения: **FACT** — подтверждено кодом/данными; **INFERENCE** — вывод из нескольких фактов; **ASSUMPTION** — рабочее предположение; **UNKNOWN** — неизвестно, требует решения.

---

## 1. Состояние репозитория (FACT)

| Параметр | Значение |
|---|---|
| HEAD / ветка | `1571466` / `main`, локальный `origin/main` совпадает |
| Рабочее дерево | **чистое**: `git status --short` пусто, `git diff --check` пусто, untracked 0, tracked 522 |
| Runtime | Bun **1.4.4**, Node **v26.13.0** |
| `bun:sqlite` | **доступен** (проверено созданием in-memory БД) |
| Зависимости | только `@types/bun` (devDependencies); `zod`, `hono` и др. **не установлены** |
| `.gitignore` | уже игнорирует `*.sqlite`, `*.sqlite3`, `-wal`, `-shm`, `-journal`, а также `data/*` → новая БД `data/forecast/forecasting.sqlite` **не попадёт в git** без дополнительных правок |
| Незакоммиченные изменения пользователя | отсутствуют |

**Команды проверки (реальные прогоны, 2026-11-23):**

| Команда | Результат | Exit |
|---|---|---|
| `bun run aggregates:test` | 63 pass / 0 fail | 0 |
| `bun run pii:test` | 22 pass / 0 fail | 0 |
| `bun test tools/dds-blocks.test.ts` | 7 pass / 0 fail | 0 |
| `bun test` (полный) | 163 pass / 4 skip / 0 fail | 0 |
| `bunx tsc --noEmit` | без ошибок | 0 |
| `bun tools/redact-pii.ts --in reports/public --in reports/code-review --gate` | GATE PASS | 0 |

**Существующие тест-файлы (18):** `src/phase1-4/tests/{lib,parse,sqlite-readonly}.test.ts`, `src/phase1-5/tests/{invariants,model,schemas}.test.ts`, `src/phase1-6/tests/{evidence,guard}.test.ts`, `src/phase1-6-2/tests/sqlliterals.test.ts`, `src/phase1-8/tests/model.test.ts`, `tools/{dds-blocks,fetch-darkstore-aggregates(.charts|.edge|.live|.security|.shopno|.test),redact-pii}.test.ts`.

---

## 2. Существующие компоненты, которые переиспользуются (FACT) и не переписываются

| Компонент | Фактический интерфейс (проверено в коде) |
|---|---|
| `tools/fetch-darkstore-aggregates.ts` | `--dry-run` (по умолчанию), `--live --yes` (без `--yes` → exit 3), `--shopno`, `--files`, `--bodies`, `--out`, `--weeks`, `--from`, `--to`, `--time-range`, `--row-limit`, `--keep-columns`, `--inject-shopno/--no-inject-shopno`, `--force-shopno`, `--from-chart`, `--charts`, `--offline`, `--raw-artifacts`, `--chart-details-dir`, `--base`, `--session`, `--csrf`, `--token`, `--username/--password`, `--provider`, `--timeout`, `--poll-timeout`, `--help` |
| Выходные артефакты | `<stem>.request.json` / `.response.json`, `observations_7745.csv`, `aggregate_7745.csv`, `manifest.json`, `validation.json`, `quality.json` |
| `tools/dds-blocks.json` | 8 блоков; поля `key, title, status, access_state, status_reason, datasets[], required_rights[], chart_ids[], charts[], dimensions[], metrics[], period, limits, allowed/blocked/unverified_datasets, run_command` |
| `tools/probe-dataset-access.ts` | `--live --yes`, `--datasets`, `--session`, `--out`; пишет `reports/phase-01-9/dataset_access_matrix.json` |
| `tools/redact-pii.ts` | `--in`, `--out`, `--report`, `--dry-run`, `--gate`; key-aware маскирование id-полей и Bearer/Basic пар |
| `tools/pii-tracked-inventory.ts` | `--out`; инвентарь PII в tracked-файлах (счётчики `*_hits`) |
| Каталог метаданных | `reports/phase-01-6-2/` (3 778 датасетов, 17 216 колонок, 9 472 метрики), `output/chart_details/` (3 766 файлов `query_context`), `data/catalog.sqlite` (1 754 МБ) — **только чтение**, с новой БД не сливается |

**FACT:** в v3.0 предполагались пустые заготовки `postgresql/` и `clickhouse/`; по v4.0 они **не создаются**. Также таблицы `orders/couriers/courier_shifts/trips/trip_orders` в Этапе 1 **не создаются** — источников нет.

---

## 3. Реальные схемы файлов артефактов (FACT)

Каталог: `data/extraction/superset/7745-6w/`

| Файл | Размер | Строк | Колонки |
|---|---|---|---|
| `aggregate_7745.csv` | 201 994 Б | 1 121 | `date, slice_id, dataset_id, viz_type, dimension_1, dimension_2, source_rows, qty_not_in_slot_all, qty_orders_declined, qty_orders_delivered, qty_orders_in_work, sum_with_bonuses, sum_without_bonuses, share_delivered_taxi, share_not_in_slot_above_all, share_not_in_slot_all, share_not_in_slot_under_all, share_orders_delivered, ratio_weighting` (19) |
| `observations_7745.csv` | 1 018 335 Б | 6 892 | `date, slice_id, dataset_id, viz_type, dimension_1, dimension_2, metric, metric_kind, value` (9) |
| `manifest.json` | 27 587 Б | — | `generated_at, mode, live_requested, live_confirmed, base_url, shopno, dashboard_id, period, sources[], inject_shopno, artifacts_pii_masked, transforms[], metric_kinds, additive_metrics, ratio_metrics, ratio_weight_metric, data_freshness, quality, completeness, quality_per_request, observations, aggregate_rows, requests[], outputs, notes, warnings` |
| `quality.json` | 10 829 Б | — | `generated_at, mode, period, shopno, run{…}, requests[{chart_id, slice_id, datasource_id, source, viz_type, queries, applied_filters, time_range, row_limit, row_count, metrics, dimensions, missing_metrics, missing_dimensions, query_count_mismatch, truncated_queries, duplicate_rows, aggregation_method, ratio_weighting, unweighted_metrics, http_status, mode, completeness, completeness_reason, warnings, problems}]` |
| `validation.json` | 5 072 Б | — | `generated_at, mode, summary, expected_colnames_by_slice, requests[]` |

**FACT (period):** `{"from":"2026-10-13","to":"2026-11-23","time_range":"2026-10-13 : 2026-11-23","weeks":6,"timezone":"Europe/Moscow"}`; фактический последний день данных — **2026-11-22** (верхняя граница у Superset исключающая).
**FACT:** `manifest.shopno=7745`, `artifacts_pii_masked=true`, `inject_shopno=false`, все 5 срезов `datasource_id=3035`.

### 3.1. Покрытие срезов и метрик (FACT)

| Срез | Строк | Дней | `dimension_1` | `dimension_2` | Сумма `qty_orders_delivered` |
|---|---|---|---|---|---|
| 20403 | 241 | 41 | 7 типов сервисов | — | 62 739 |
| 20404 | 240 | 41 | 1 (руководитель доставки) | 7 сервисов | 62 739 |
| 20405 | 359 | 41 | 7 сервисов | 2 («Динамическая доставка», «Доставка по слотам») | 62 739 |
| 20623 | 199 | 41 | 6 сервисов | — | 62 739 |
| 20624 | 82 | 41 | 1 (имя ТТ) | — | 62 739 |

- **FACT:** `dates_with_disagreement = 0` — все пять срезов дают одинаковый дневной итог; 41 день, пропусков дат нет.
- **FACT:** метрик 11 (`additive`: `qty_not_in_slot_all, qty_orders_declined, qty_orders_delivered, qty_orders_in_work, sum_with_bonuses, sum_without_bonuses`; `ratio`: `share_delivered_taxi, share_not_in_slot_above_all, share_not_in_slot_all, share_not_in_slot_under_all, share_orders_delivered`).
- **FACT (неполнота по метрикам внутри «полного» прогона):** заполненность в `aggregate_7745.csv` неоднородна: `qty_orders_delivered` — 1 121/1 121; пять метрик — 840/1 121; пять — 600/1 121. Причина — разные наборы метрик у срезов, а не пропуски периода.
- **FACT:** `qty_orders_in_work` = 0 во всех 600 непустых ячейках (`min=0, max=0`) → метрика неинформативна на этом окне.
- **FACT:** `ratio_weighting` принимает два значения: `weighted:qty_orders_delivered` и пустое (для не-ratio строк).
- **FACT:** дублей по ключу `(date, slice_id, dimension_1, dimension_2, viz_type)` — **0** (1 121 ключ); в `observations` дублей по `(date, slice_id, dimension_1, dimension_2, metric)` — **0** (6 892).
- **FACT:** 11 наблюдений имеют пустой `date` — это строка «итог за период» из второго запроса среза 20403 (`row_limit=0`).

### 3.2. Качество и валидация (FACT)

`quality.run.completeness = {full:5, partial:0, truncated:0, none:0}`, `duplicate_rows_total=0`, `missing_metrics_total=0`. По каждому срезу: HTTP 200, `missing_metrics=0`, `missing_dimensions=0`, `query_count_mismatch=false`, `truncated_queries=[]`, `warnings=0`. `validation.summary: ok=5, failed=0`, проблем — 0.

**INFERENCE:** текущий артефакт пригоден для Этапа 1 и 2 без повторного обращения к Superset. **ASSUMPTION:** для Этапа 2 достаточно этих 11 метрик; расширение (курьеры/пул) — по согласованию.

---

## 4. Идемпотентность и natural key (ответ на замечание №1)

**FACT:** в артефактах нет технического ключа, который различал бы запуски; `run_id` в v3.0 предлагался как часть уникальности — это создало бы дубли при повторной загрузке того же источника.

**INFERENCE (предлагаемый natural key наблюдения):**

```
natural_key = (shop_no, date, slice_id, dimension_1, dimension_2, metric, transform_version)
```

- `run_id` **не входит** в natural key; он остаётся атрибутом строки (какой запуск её записал) и в `extraction_runs`.
- `slice_id` **обязателен** в ключе, потому что одни и те же метрики приходят из разных срезов (20403/20404/20405) с разными измерениями, а строки `dimension_1='__ALL__'` у разных срезов численно совпадают (62 739) — без `slice_id` они бы конфликтовали.
- `transform_version` входит в ключ, чтобы пересчёт по новой версии преобразования создавал новую версию наблюдения, не перетирая старую (воспроизводимость).
- Итоговый `UNIQUE(shop_no, date, slice_id, dimension_1, dimension_2, metric, transform_version)` + `ON CONFLICT DO UPDATE` только для технических полей (`run_id`, `loaded_at`).

**FACT:** проверка на реальных данных: 0 коллизий по этому ключу в `aggregate_7745.csv` и в `observations_7745.csv`. **UNKNOWN:** считать ли 20403 каноническим срезом для «дневного итога» — предлагается не выбирать канон в БД, а хранить все срезы и вводить представление «канонический срез» отдельно.

---

## 5. Статусы достоверности и качества (ответ на замечание №2)

**FACT:** HTTP 200 на срезе не означает полноту каждой метрики (см. §3.1: 600/840/1 121), а `completeness=full` относится к запуску, а не к строке.

Предлагается три независимых уровня:

| Уровень | Где | Значения |
|---|---|---|
| Достоверность наблюдения | `daily_metrics.evidence_status` | `actual, derived, estimated, planned, assumed, unknown` |
| Статус строки | `daily_metrics.data_status` | `full, partial, truncated, none, schema_only` |
| Статус запуска | `extraction_runs.quality_status` + `quality.json` | `full, partial, truncated, none` |

**INFERENCE:** правило заполнения — `evidence_status='actual'` присваивается только наблюдению, чей HTTP-ответ 200 **и** метрика присутствует в `colnames` **и** `quality.requests[].completeness='full'`; строки «итог за период» (пустой `date`) получают `data_status='partial'` с пометкой в `audit_log`/`notes`; метрики-константы (например, `qty_orders_in_work=0`) не считаются ошибкой, но помечаются признаком «неинформативна на окне» в `data-quality.md`.

---

## 6. Признаки MVP: что реально вычислимо (ответ на замечание №3)

| Признак | Источник в артефактах | Статус сейчас |
|---|---|---|
| `dow`, `is_weekend` | календарь | **вычислим**, `derived` |
| `orders_lag_1/7/14`, `rolling_mean_7/14`, `rolling_std_7` | `qty_orders_delivered` (20403, `__ALL__`) | **вычислим**, `derived` |
| `cancellation_rate` | `qty_orders_declined / qty_orders_delivered` | **вычислим**, `derived` (знаменатель подтверждён) |
| `out_of_slot_rate`, `share_delivered_taxi` | одноимённые метрики срезов | **вычислим**, `derived` |
| `service_mix` | `dimension_1` среза 20403 (7 значений) | **вычислим**, `derived` |
| `slot_mode_share` | `dimension_2` среза 20405 (2 значения) | **вычислим**, `derived` |
| `intervention_flag`, `days_since_intervention` | `domain_events` из плана (только `planned`) | **вычислим как `planned`**, не как факт |
| `is_holiday` | внешний календарь | **UNKNOWN** → `NULL` |
| `qty_couriers`, `avg_qty_delivered_per_1_courier` | в текущем артефакте **отсутствуют**; доступны через chart 20209 на `3035` (проверено: HTTP 200) | **не вычислимы из имеющегося**, требуют отдельного запроса |
| `courier_attendance_rate`, `pool_capacity`, `routing_delay`, `tmc_availability` | нет источника (401/нет поля) | **исключены из моделей**, `unknown` |

**INFERENCE:** нельзя подставлять 0 вместо отсутствующих признаков: строки с `NULL` исключаются из обучения модели, а не заполняются.

---

## 7. Backtesting: реальная выполнимость (ответ на замечание №4)

**FACT:** 41 наблюдение на дневном ряду.

| Мин. обучающая история | Горизонт | Максимум фолдов |
|---|---|---|
| 21 | 1 | 20 |
| 21 | 3 | 18 |
| 21 | 7 | 14 |
| 21 | 14 | 7 |
| 28 | 7 | 7 |
| 28 | 14 | **0** |

**INFERENCE:** для MVP разумны `minTrain=21`, фолды 14/7 для горизонтов 7/14; квантили `p10/p90` на 41 точке оцениваются слабо → при малом числе остатков модель обязана вернуть `insufficient_data` вместо интервалов. **ASSUMPTION:** горизонт 14 считать `low_confidence` во всех ответах API.

---

## 8. План мероприятий (FACT)

Файл: `C:\Users\Василиса\Documents\2_5190795335328377737 (1).csv`, кодировка **CP1251**, разделитель **`;`**.

- 8 колонок: `День; Время; Задача; Ответственный; Кто контролирует; Результат + как проверить; Риски (1–2 ключевых); Мера снижения`.
- **43 строки данных**, 11 групп дней: «День 1 (пн) … День 10 (пт)» + «После Дня 10 (недели 3–6)».
- 42 строки имеют временное окно вида `09:00–10:00`.
- **Колонки фактической даты нет** → все мероприятия могут быть только `planned`, `status='planned'`, эффект не подтверждён.
- Упоминания нормативов: «12 ч» — 1 строка, «пул 5» — 2, «10 ходок» — 2, «50» — 3, «180/300» — 4, «1 бокс / 20 %» — 1, «срок ≤3 дней» — 1; «общая очередь + кластер + отключение карты — только при 3 условиях» — 1 строка (после Дня 10).

**INFERENCE:** таблица `domain_events` в Этапе 1 заполняется этим файлом с `evidence_status='planned'`; оценка эффекта невозможна до появления фактических дат.

---

## 9. Доступ к источникам (FACT)

`reports/phase-01-9/dataset_access_matrix.json`: **ALLOWED — только `3035`**; `3466`, `5888`, `7696`, `7712` → **401**; остальные не проверялись (`UNVERIFIED`).

Следствия: из плана автоматически доступно то, что есть в `3035` (курьеры и производительность — только через отдельный chart 20209; слоты; зоны `zone_cluster`; SLA/просрочки; сборка; вайты; оборот). Недоступно без прав: пул (`7006/4732/3466`), смены и явка (`7473/5797`), наставничество (`5939`), опросы (`7733/7740`), ТМЦ (`3871/3306/3746`), гео-зоны (`6863/4518`), ЗИЗ (`1583`), фотоконтроль (`7712`).

---

## 10. Риски

| № | Риск | Влияние | Смягчение |
|---|---|---|---|
| R1 | `run_id` в natural key → дубли при повторной загрузке | искажение всех агрегатов | ключ без `run_id` (§4), тест идемпотентности |
| R2 | Перенос качества запуска на строки | ложные `actual` | три уровня статусов (§5) |
| R3 | Подстановка 0 вместо отсутствующих признаков | ложные прогнозы мощности | `NULL` + `unknown`, исключение из обучения (§6) |
| R4 | Слабые квантили на 41 точке | ложная уверенность | `insufficient_data`, `low_confidence` для 14 дней (§7) |
| R5 | «Ходка», «пул 5», «50», «180–300» без определения единиц | неверная интерпретация | не считать нормативами до подтверждения (§11) |
| R6 | Плановые мероприятия как факт | ложный «эффект» | `planned` + запрет авто-влияния на обучение |
| R7 | PII в БД/логах | нарушение политики | не хранить ФИО/телефоны; `pii:gate` на публикуемых артефактах |
| R8 | Изменение артефактов сбора | потеря воспроизводимости | артефакты read-only; новые записи только в `forecasting.sqlite` |

---

## 11. UNKNOWN / вопросы бизнесу

1. Единица и период расчёта «50 заказов на курьера» (день/смена/час), определения «ходка» и «заказы в ходке».
2. Что измеряет «объём зоны 180–300» и как `zone_cluster` связан с ЗИЗ.
3. Формат ежедневного отчёта куратора (явка, подтверждение 12 ч, ТМЦ, боксы/зарядки).
4. Источник причин отмен и данных о расходах/ставках.
5. Критерии «3 условий» перехода на общую очередь.
6. Считать ли `20403` каноническим срезом дневного итога (или хранить все срезы без канона).
7. Единицы денежных метрик (`sum_with_bonuses`: рубли или копейки; в данных — значения вида 98 073 619,14).

---

## 12. План реализации (Этап 1, предлагаемые файлы)

Создаются (новые):

```
docs/forecasting/{architecture,data-dictionary,data-quality,model-evaluation,implementation-log,known-limitations}.md
src/forecasting/storage/sqlite/{connection.ts, migrations/001_init.sql, migrations/index.ts}
src/forecasting/storage/interfaces/{metrics,forecast,events,features,raw}-repository.ts
src/forecasting/storage/sqlite/repositories/*.ts
src/forecasting/ingestion/{artifact-reader.ts, validation.ts, normalizer.ts, deduplicator.ts, importer.ts, plan-loader.ts}
src/forecasting/cli/{import-artifacts.ts, migrate.ts}
tests/forecasting/{sqlite-migrations,ingestion,idempotency,backup-restore}.test.ts
scripts/forecasting/README.md            # как запускать импорт
```

Изменяются (минимально): `package.json` — только новые скрипты (`forecast:migrate`, `forecast:import`, `forecast:test`). **Больше ничего.**

Не изменяются: `tools/**` (все инструменты), `src/phase1-*`, `reports/**`, `docs/phase-*`, `data/extraction/**`, `data/catalog.sqlite`, `.gitignore` (уже покрывает SQLite/WAL).

Порядок Этапа 1: миграции → подключение и PRAGMA → репозитории → ingestion (артефакты + план) → идемпотентность → backup/restore → тесты → отчёт.

---

## 13. Блокирующие проблемы

**Нет.** Этап 1 может начинаться: `bun:sqlite` доступен, артефакты на месте и внутренне согласованы, артефакты неизменяемы, `.gitignore` уже исключает файлы БД.

Ограничение, не блокирующее Этап 1: признаки и модели мощности курьеров нельзя построить без выдачи прав на HR-датасеты или без ежедневного отчёта куратора (§6, §9).
