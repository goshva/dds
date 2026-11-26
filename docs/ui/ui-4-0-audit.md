# UI-4.0 — аудит прогнозной архитектуры

**Дата:** 2026-11-24 · **Режим:** read-only аудит + документация · **Реализация UI-4.1 не начата**
**Контракт:** [ui-4-forecasting-contract.md](ui-4-forecasting-contract.md) (`forecast-eval/v1`)

Метки: **FACT** / **INFERENCE** / **ASSUMPTION** / **NOT_IMPLEMENTED** / **NOT_VERIFIED** / **RECOMMENDATION**.

---

## 1. Краткое резюме

**Общая готовность:** архитектура прогнозного контура пригодна для UI-4: снапшоты неизменяемы и детерминированы, reconciliation fail-closed, режимы разделены в основных read-model, факт защищён строгой валидацией. Прогнозное ядро переиспользуется без изменений.

**Основные выводы (FACT):**
1. `monitor()` фильтрует записи только по `model_id` и `horizon` — **без `mode`** → агрегаты смешивают replay и shadow (`pipeline.ts`).
2. `monitor()` возвращает `wape: 0` при нулевом знаменателе вместо `null`/`NOT_AVAILABLE` (`pipeline.ts`).
3. `monitor()` приводит `forecast_value` через `as number` → `null` может искажать счётчики under/over.
4. `comparison` в `monitor()` сравнивает модели по горизонту без проверки парности (`n_baseline` ≠ `n_shadow` возможны).
5. `mode` не входит в `snapshot_id` → теоретический CONFLICT между replay и shadow; на текущих данных конфликтов нет (`errors.jsonl` отсутствует).
6. `ReconciliationRecord` не хранит `mode`/`model_version`/`origin_date`/`input_data_version`/`dataset_checksum`; связь только через `snapshot_id`.

**Критические ограничения:** парная выборка и счётчики исключений не реализованы; статус `UNKNOWN` отсутствует; метрики качества для UI-4 нельзя брать из `monitor()` без пересчёта.

**Решение:** **READY WITH CONDITIONS** — переход к UI-4.1 возможен после принятия контракта и выполнения условий раздела 13.

## 2. Состояние репозитория

| Параметр | Значение |
|---|---|
| HEAD | `099f37b2588c2c1cb821faabf81d507f14f14818` |
| Контрольный commit | `099f37b` («pre u4») — **совпадает с HEAD** (0 коммитов между) |
| Branch | `main` |
| `git status --short` | **пусто** (рабочее дерево чистое; staged 0, unstaged 0, untracked 0) |
| Следствие | состояние на контрольном commit **равно** текущему состоянию: UI-1/2/3 и UI-3.1 входят в commit |
| `diff.txt` | отсутствует в рабочем дереве (был закоммичен или удалён до коммита) — **NOT_VERIFIED** |

**Изученные файлы (FACT, полностью или целевыми фрагментами):** `src/forecasting/shadow/{store,runner,pipeline,index}.ts`, `src/forecasting/cli/shadow.ts`, `src/forecasting/analytics/adaptive-baseline/calculator.ts`, `src/server/{sources,api,app,routes,index}.ts`, `src/server/services/read-models.ts`, `src/web/main.ts`, `src/web/api/client.ts`, `src/web/components/{index,cards,data,charts,states,shell}.ts`, `src/web/lib/format.ts`, `src/web/pages/{history,data-quality,provenance}.ts`, `tests/**` (перечень), `docs/ui/**` (UI-0…UI-3), отчёты Stage 3.4.1–3.4.9.

## 3. Текущая архитектура

```text
canonical CSV ──► readHistory() ──► history/coverage read-model ──► API ──► UI (история, качество, provenance)
                                     │
                                     └─► reconcile(rows, store)  ──► reconciliations.jsonl  (append-only)
forecasts.jsonl ──► readSnapshots() ─┘                                   │
                                     └─► monitor(rows, store) ──► метрики (диагностика)
manifest.json ───► readManifest() ──► provenance/freshness
```

- **Storage (FACT):** `store.ts` — append-only JSONL, детерминированный `snapshot_id`, no-op/CONFLICT, fail-closed чтение (`readJsonl` + валидаторы `isSnapshotRecord`/`isReconciliationRecord`/`isShadowErrorRecord`).
- **Runner (FACT):** `rolling7()` для baseline, `calculateForVariant("B", …)` для candidate; `SHADOW_ALPHA=1.0`, `SHADOW_LIMIT_PERCENT=0.1`, `SHADOW_MIN_TRAIN=28`, горизонты `[1,3]`; статусы `OK|FALLBACK|INVALID`.
- **Reconciliation (FACT):** `target_date ≤ lastConfirmedDate`, факт из canonical CSV, `absolute_error`/`signed_error`, защита от повторов по `snapshot_id`, `MISSING_ACTUAL` в `errors.jsonl`.
- **Backend (FACT):** 7 GET endpoints; envelope `ok`/`not_available`/`error`; обязательный `eventId`; Host/Origin guard; bind `127.0.0.1`.
- **Frontend (FACT):** hash-роутинг, `ApiClient` (timeout 8000 мс, `validateResult`), компоненты UI-1.x, страницы UI-3.

## 4. Текущие контракты данных

**FACT** — поля зафиксированы в `src/forecasting/shadow/store.ts`:

| Контракт | Поля |
|---|---|
| `ShadowSnapshot` | `snapshot_id`, `run_id`, `mode`, `model_id`, `model_version`, `variant`, `horizon`, `origin_date`, `target_date`, `forecast_value`, `status`, `fallback_reason`, `input_data_version`, `dataset_checksum`, `generated_at` |
| `ReconciliationRecord` | `snapshot_id`, `run_id`, `model_id`, `horizon`, `target_date`, `forecast_value`, `actual`, `absolute_error`, `signed_error`, `reconciled_at` |
| `ShadowError` | `run_id`, `mode`, `code`, `message`, `origin_date`, `target_date`, `model_id`, `horizon`, `created_at` |
| `ShadowManifest` | `version`, `created_at`, `dataset_checksum`, `horizons`, `models`, `alpha`, `limit_percent`, `min_train_days`, `note` |

Идентичность прогноза: `SHA256(model_id|model_version|horizon|origin_date|target_date|input_data_version)` — **FACT**.

## 5. Текущие read-модели

| Read-model | Разделяет режимы | Разделяет модели | Комментарий |
|---|---|---|---|
| `shadowForecastsModel` | **да** (`totals` по режиму, `modeTotals`, `errorsByMode`) | да (`items.modelId`) | **FACT** |
| `reconciliationsModel` | **да** (фильтр по `mode` через карту snapshot, `unknownSnapshots`) | да | **FACT** |
| `monitorModel` → `monitor()` | **нет** | да (по `model_id`×`horizon`) | **FACT** — критично |
| `overviewModel` | **да** (`shadow` / `replay` раздельно) | да (`candidate`/`baseline`) | **FACT** |
| `historyModel` / `coverageModel` | не применимо | не применимо | факты, UI-3.1 |

## 6. Критические находки

| ID | Severity | FACT | Evidence | Impact | Рекомендация | Stage |
|---|---|---|---|---|---|---|
| F-1 | **critical** | `monitor()` агрегирует записи без фильтра `mode` | `pipeline.ts` (`records.filter(model_id && horizon)`) | replay-метрики смешиваются с shadow → недостоверное качество в UI | метрики UI-4 считать собственными функциями с обязательным `mode` | UI-4.1 |
| F-2 | **critical** | WAPE = `0` при нулевом знаменателе | `pipeline.ts` (`actualAbs === 0 ? 0 : …`) | «нулевая ошибка» вместо отсутствия данных | `null` + `NOT_AVAILABLE` (контракт §12) | UI-4.1 |
| F-3 | high | `forecast_value as number` без проверки `null` | `pipeline.ts` (under/over) | искажение счётчиков | фильтровать `forecast_value !== null` | UI-4.1 |
| F-4 | high | `comparison` не проверяет парность выборок | `pipeline.ts` (`n_baseline`, `n_shadow` независимы) | дельта MAE на разных выборках | парная выборка + счётчики | UI-4.1 |
| F-5 | medium | `mode` не входит в `snapshot_id` | `store.ts:snapshotId` | теоретический CONFLICT replay↔shadow | не менять ID; в выборках ключ включает `mode`; CONFLICT — в диагностику | UI-4.1 |
| F-6 | medium | `ReconciliationRecord` не хранит `mode`/`model_version`/`origin_date`/`input_data_version`/`dataset_checksum` | `store.ts` | атрибуция только через snapshot; осиротевшие записи неоцениваемы | JOIN по `snapshot_id`, `unknownSnapshots` в диагностику | UI-4.1 |
| F-7 | medium | нет статуса `UNKNOWN` для неизвестной модели/режима | `read-models.ts` | невозможно честно показать нераспознанные записи | добавить `eligibility.reason` и `UNKNOWN` | UI-4.1 |
| F-8 | low | нет парных счётчиков (`pairedN`, `excluded*`, `unmatchedN`, `conflictN`) | `read-models.ts` | нет прозрачности выборки | добавить в DTO качества | UI-4.1 |
| F-9 | low | исторические отчёты Stage 3.4.x содержат replay-метрики | `reports/forecasting/stage-3.4.*` | риск переноса в live-аналитику | в UI-4 показывать как «историческая диагностика» | UI-4.2 |
| F-10 | info | `errors.jsonl` отсутствует; конфликтов нет | данные `data/shadow/7745` | подтверждает чистоту текущего хранилища | не создавать файл вручную | — |

## 7. Матрица переиспользования

| Модуль | Что делает | Переиспользовать | Ограничения |
|---|---|---|---|
| `shadow/store.ts` | append-only JSONL, ID, валидаторы | `readJsonl`, `isSnapshotRecord`, `isReconciliationRecord`, `isShadowErrorRecord`, `storePaths`, `MODEL_VERSIONS`, типы | запись не использовать; `readJsonl` fail-closed |
| `shadow/pipeline.ts` | reconcile, monitor | `reconcile()` (не запускать), `MonitorReport` как **диагностический** источник | `monitor()` смешивает режимы, WAPE=0 — **не** источник итоговых метрик |
| `shadow/runner.ts` | расчёт снапшотов | константы `SHADOW_HORIZONS/ALPHA/LIMIT_PERCENT/MIN_TRAIN`, `HistoryRow` | запуск запрещён |
| `analytics/adaptive-baseline/calculator.ts` | формула Variant B | `calculateForVariant` (только чтение кода) | не вызывать в UI-4 |
| `server/sources.ts` | чтение CSV/JSONL, checksums, manifest | `readHistory`, `readSnapshots`, `readReconciliations`, `readShadowErrors`, `readManifest`, `shadowFileChecksums` | пути фиксированы; `readSnapshots(dir?)` — параметризация для тестов |
| `server/services/read-models.ts` | read-model | `parseLimit`, `parseDate`, `shadowForecastsModel`, `reconciliationsModel`, `overviewModel` | `monitorModel` — только диагностика |
| `server/routes.ts` | HTTP | паттерн маршрутов, envelope, `fail()` | только GET |
| `web/api/client.ts` | клиент | `ApiClient`, `validateResult`, `ApiResult` | timeout 8000 мс |
| `web/components/charts.ts` | SVG | `lineChart`, `barChart` | `SeriesClass` allowlist; разрыв линии на `null` |
| `web/components/data.ts` | таблицы/календарь | `dataTable`, `sparkline`, `completenessCalendar` | пустое состояние без нулей |
| `web/components/cards.ts` | карточки/статусы | `card`, `chartCard`, `kpiCard`, `kpiGrid`, `statusBadge`, `provenanceDrawer` | слоты `TrustedHtml` |
| `web/lib/format.ts` | формат | `formatNumber`, `formatPercent`, `formatDate`, `escapeHtml`, `trusted`, `safeHref` | `null` → `NOT_AVAILABLE` |

## 8. Качество данных и происхождение

- canonical CSV: 906 дней, `2024-06-01 … 2026-11-23`, `slice 20624`, пропусков нет, нулевых значений нет — **FACT** (проверено чтением).
- `fileChecksum ≠ normalizedChecksum`; `freshness` и `manifestStatus` раздельны — **FACT**.
- Семантика `PROVISIONAL` — **FACT** (константа + UI).
- Checksum **не** подтверждает бизнес-семантику — **ASSUMPTION**, требующее подтверждения владельцем процесса.

## 9. Целевая архитектура UI-4

**RECOMMENDATION:**

```text
src/server/forecast-evaluation.ts   — чистые функции: eligibility, buildPairs, metrics (без IO)
src/server/services/forecasting-read-models.ts — сбор данных и подготовка DTO
src/server/routes.ts                — HTTP + валидация query
src/web/pages/forecast-explorer.ts  — прогнозы и зрелость
src/web/pages/model-quality.ts      — метрики и парное сравнение
src/web/pages/error-analysis.ts     — исключённые записи и диагностика
```

Границы: метрики и выборка — только на сервере; frontend — отображение и фильтрация полученного. Разделение оправдано: `read-models.ts` уже перегружен (history/coverage/shadow/overview), а `monitor()` нельзя переиспользовать как источник метрик.

## 10. Анализ пробелов в тестах

| Уже покрыто (FACT) | Не покрыто |
|---|---|
| неизменяемость снапшотов, no-op/CONFLICT (`shadow-hardening`) | парная выборка baseline↔candidate |
| fail-closed JSONL, Host/Origin, eventId (`tests/server/hardening`) | WAPE при нулевом знаменателе |
| manifest-схема, CSV-домен, диапазоны (`hardening`, `ui-3`) | исключённые записи и счётчики (`excluded*`, `unmatchedN`) |
| разделение режимов в forecasts/reconciliations (`api.test`, `ui-3`) | `UNKNOWN` для неизвестной модели/режима |
| reconciliation без snapshot (`hardening`) | дубли/конфликты reconciliation в агрегатах |
| адаптивный baseline (`adaptive-baseline-*`) | метрики качества на парной выборке |

**Тестовые фабрики:** `tests/server/hardening.test.ts` (временные каталоги, синтетические JSONL/CSV), `tests/forecasting/shadow-mode.test.ts` (in-memory store). Их можно переиспользовать в UI-4.1 — **RECOMMENDATION**.

## 11. NOT_IMPLEMENTED

- парная выборка и счётчики `pairedN`/`excludedBaselineN`/`excludedCandidateN`/`unmatchedN`/`conflictN`;
- endpoint'ы `/api/v1/forecasts`, `/forecasts/quality`, `/forecasts/errors`;
- статус `UNKNOWN` и раздельные поля `computeStatus`/`factStatus`/`sourceStatus`/`eligibility`;
- страницы Forecasting/Качество моделей/Анализ ошибок;
- p10/p90, сценарии, финансовый эффект;
- SQLite read-only API;
- список аномальных дат (305 outlier flags без привязки к датам);
- FU-1 (календарь «Обзора» — `points.slice(-28)`).

## 12. NOT_VERIFIED

- бизнес-семантика `delivered_orders_daily` (правила перерасчётов, возвраты, `date_supply`);
- поведение при появлении пропусков в canonical CSV в live-режиме (текущий ряд непрерывен);
- браузерная адаптивность (UI-7);
- влияние CONFLICT replay↔shadow на практике (на текущих данных не возникал);
- судьба `diff.txt` (в рабочем дереве отсутствует).

## 13. Рекомендация

**READY WITH CONDITIONS** — переход к UI-4.1 разрешён при выполнении условий:

1. принять контракт `forecast-eval/v1` ([ui-4-forecasting-contract.md](ui-4-forecasting-contract.md));
2. метрики UI-4 считать собственными чистыми функциями (не использовать `monitor()` как итоговый источник) — F-1…F-4;
3. ввести обязательный `mode` в каждый DTO и агрегат;
4. реализовать парную выборку и счётчики исключений;
5. WAPE при нулевом знаменателе — `null` + `NOT_AVAILABLE`;
6. не изменять `snapshot_id`, JSONL-формат, baseline, Variant B, семантику `PROVISIONAL`;
7. `monitor()` не изменять в рамках UI-4 (при необходимости — отдельная задача);
8. SQLite не подключать; replay/shadow/reconcile/monitor не запускать;
9. сохранить fail-closed и обязательный `eventId`.

**UI-4.1 NOT STARTED.**
---

## 14. UI-4.0.1 — уточнение контракта

**Дата:** 2026-11-24 · **Режим:** read-only аудит + правка двух документов · **Реализация не выполнялась**

### 14.1. Исходные замечания и результат

| ID | Замечание | Результат | Доказательство | Изменение документа |
|---|---|---|---|---|
| C-1 | Противоречие Git-состояния: отчёт сообщал о 2 untracked, аудит — о чистом дереве | **Разъяснено**: оба утверждения верны для **разных моментов**. Раздел 2 фиксировал состояние **до** создания документов (тогда `git status --short` был пуст), отчёт UI-4.0 — **после** (2 untracked) | **FACT:** при повторной проверке UI-4.0.1 — `staged=0, unstaged=0, untracked=2`; `git ls-files --error-unmatch` для обоих документов → «нет (untracked)» | §14.6 (состояние Git по моментам), уточнение в разделе 2 |
| C-2 | `model_version` нельзя включать в общий ключ пары | **Уточнено**: введены `baseline_identity`, `candidate_identity`, `pair_identity`; версия проверяется отдельно для каждого участника; порядок 12 проверок | **FACT:** `store.ts:MODEL_VERSIONS` (`rolling-7-day-mean/v1`, `adaptive-baseline/v1+variantB`); `snapshotId` включает `model_version` | контракт §21.1 |
| C-3 | `lastConfirmedDate` может создавать ложное впечатление подтверждённой семантики | **Разделено**: техническая доступность факта (`technicalFactCutoff`, в коде — `lastConfirmedDate`) vs подтверждение бизнес-семантики (`NOT_VERIFIED`); `PROVISIONAL` сохранён | **FACT:** `pipeline.ts:lastConfirmedDate` = последняя дата валидированной истории | контракт §21.2, пометка в §6 |
| C-4 | Отсутствие `errors.jsonl` ≠ отсутствие конфликтов | **Разделено**: `PersistedErrors` / `DetectedConflicts` / `UnknownRecords`; `conflictN` нельзя выводить из наличия файла; перечень независимых проверок | **FACT:** в `errors.jsonl` пишутся только `MISSING_ACTUAL` (`pipeline.ts`) и `SNAPSHOT_CONFLICT` (`store.ts:appendSnapshot`); проверок дублей/расхождений нет | контракт §21.3 |
| C-5 | Статус `UNKNOWN` не определён | **Определён**: `UNKNOWN_MODE`, `UNKNOWN_MODEL`, `UNKNOWN_SNAPSHOT`, `UNKNOWN_RECONCILIATION`, `UNKNOWN_STATUS` + правила и обнаружение текущими валидаторами | **FACT:** `isSnapshotRecord` не проверяет `mode`/`model_version`/`variant`/`status`; `unknownSnapshots` реализован только для reconciliation | контракт §21.3, §21.4 |

### 14.2. Что подтверждено кодом (FACT)

- `MODEL_VERSIONS`: `rolling_7_day_mean → rolling-7-day-mean/v1`, `adaptive_baseline → adaptive-baseline/v1+variantB`.
- `snapshotId` = `SHA256(model_id|model_version|horizon|origin_date|target_date|input_data_version)`; `mode` и `dataset_checksum` в идентичность не входят.
- `isSnapshotRecord` проверяет: `snapshot_id`, `model_id`, `horizon ∈ {1,3}`, `origin_date`, `target_date`, `forecast_value` (number|null), `input_data_version`; **не** проверяет `mode`, `model_version`, `variant`, `status`, `dataset_checksum`.
- `isReconciliationRecord` проверяет: `snapshot_id`, `model_id`, `horizon`, `actual`, `absolute_error`; **не** проверяет `forecast_value`, `signed_error`, `target_date`.
- `errors.jsonl`: только два кода — `MISSING_ACTUAL`, `SNAPSHOT_CONFLICT`.
- `lastConfirmedDate(rows)` = `rows[rows.length - 1].date` — технический cutoff.
- `monitor()`: агрегаты без `mode`; WAPE = 0 при нулевом знаменателе; `forecast_value as number` без проверки null.

### 14.3. Что остаётся рекомендацией (RECOMMENDATION)

- реализация `pair_identity` и 12 проверок пары (UI-4.1);
- независимые проверки дублей, расхождений `forecast_value`/`actual`/`dataset_checksum` (UI-4.1);
- перечень `eligibility reasons` и раздельные поля статусов (UI-4.1);
- отображение `EXCLUDED_MODEL_VERSION` при появлении новой версии модели (UI-4.1).

### 14.4. NOT_IMPLEMENTED

- `pair_identity`, парная выборка, счётчики (`pairedN`, `excluded*`, `unmatchedN`, `conflictN`);
- `DetectedConflicts`, `UnknownRecords`, статус `UNKNOWN`;
- проверки дублей и расхождений в источниках;
- endpoints `/api/v1/forecasts*`;
- страницы «Обозреватель прогнозов», «Качество моделей», «Анализ ошибок»;
- p10/p90, сценарии, финансовый эффект, SQLite read-only API;
- список аномальных дат; FU-1 (календарь «Обзора»).

### 14.5. NOT_VERIFIED

- бизнес-семантика `delivered_orders_daily` (перерасчёты, возвраты, `date_supply`, окончательность значений);
- фактическое наличие/отсутствие дублей и расхождений в `forecasts.jsonl`/`reconciliations.jsonl` — проверки не выполнялись (запрет на запуск reconcile/monitor; анализ всего файла в рамках UI-4.0.1 не проводился);
- практическое влияние возможного CONFLICT replay↔shadow;
- браузерная адаптивность (UI-7);
- историческая судьба `diff.txt`.

### 14.6. Состояние Git по моментам (FACT)

| Момент | staged | unstaged | untracked | Комментарий |
|---|---:|---:|---:|---|
| До создания документов UI-4.0 | 0 | 0 | 0 | рабочее дерево чистое — это состояние зафиксировано в разделе 2 |
| После создания документов UI-4.0 (отчёт UI-4.0) | 0 | 0 | 2 | два новых документа в `docs/ui/` |
| Начало UI-4.0.1 (повторная проверка) | 0 | 0 | 2 | подтверждено `git status --short`; документы **не** в индексе и **не** в истории (`git ls-files` их не знает) |
| После правок UI-4.0.1 | 0 | 0 | 2 | те же два файла изменены по содержимому; новых файлов не создано |

**INFERENCE:** документы остаются незакоммиченными; утверждение «закоммичены» нигде не делалось и не подтверждается.

### 14.7. Контроль неизменности (FACT)

| Область | До UI-4.0.1 | После UI-4.0.1 |
|---|---|---|
| SQLite | `eadc3763926e142a574e5493495ee83584bd21f77d71bbbf6ae42cc0c7c65619` | не изменялась |
| canonical CSV (нормализованный) | `8f2b1818da001a42fad3125b…` | не изменялся |
| `forecasts.jsonl` | `e35fe27b002e42cca0d5d675…` | не изменялся |
| `reconciliations.jsonl` | `32ccd25604ae78b36996738c…` | не изменялся |
| `manifest.json` | `9d986747771c5fd1cc3654a8…` | не изменялся |
| `errors.jsonl` | отсутствует | не создан |
| `src/**`, `tests/**`, `package.json`, `bun.lock`, конфигурации | без изменений | без изменений |
| Git index | staged 0 | staged 0 |

### 14.8. Итог UI-4.0.1

Контракт `forecast-eval/v1` уточнён (раздел 21 контракта): идентичность пары и совместимость версий, техническая зрелость против бизнес-семантики, разделение ошибок и конфликтов, классификация `UNKNOWN`, причины исключения. Базовые формулы и правила eligibility не изменялись; новая версия контракта не вводилась.
---

## 15. UI-4.0.2 — уточнение семантики checksum, парности и дублей

**Дата:** 2026-11-24 · **Режим:** документационная корректировка · **Код, тесты и данные не изменялись**

### 15.1. Исходные замечания и результат

| ID | Замечание | Результат | Доказательство | Изменение документа |
|---|---|---|---|---|
| C-6 | Не определена семантика `dataset_checksum` при парном сравнении | **Уточнено**: `dataset_checksum` — sha256 **нормализованного** набора на момент запуска (не байты файла); решающим для пары является `input_data_version`; различие checksum → предупреждение `DATASET_VERSION_DIFFERS`, а не исключение | **FACT:** `cli/shadow.ts:53` (checksum считается по `date\tvalue`), `runner.ts:101`; в данных **2** различных `dataset_checksum` (`d413286e…` — 905 дней, `8f2b1818…` — 906 дней) при 877 `input_data_version` | контракт §21.1 (таблица семантики и правило сравнения) |
| C-7 | Первый шаг построения пары не определён (общий `snapshot_identity` невозможен) | **Уточнено**: поиск baseline и candidate выполняется **независимо** по двум разным идентичностям, затем проверяется принадлежность одному `pair_identity`, уникальность каждого участника и только затем формируется пара | **FACT:** `snapshotId` включает `model_id` и `model_version`, которые у участников различаются | контракт §21.1 (шаги 1–5) |
| C-8 | Не определено поведение при дублях | **Уточнено**: запрещено выбирать первую/последнюю запись, перезаписывать, усреднять и формировать пару; обязательно сохранять все конфликтующие `snapshot_id` для диагностики | **FACT:** в коде проверок дублей нет (`reconcile` защищает только от повторной записи по `snapshot_id`) | контракт §21.3 (таблица обработки дублей) |
| C-9 | `FACT` использован для требований, а не реализованного поведения | **Разделено**: введены категории `FACT` / `CONTRACT REQUIREMENT` / `RECOMMENDATION`; таблица §21.5 переклассифицирована | **FACT:** пустая выборка, WAPE при нулевом знаменателе и парное сравнение в коде отсутствуют; в `monitor()` WAPE = 0 | контракт §21.5 |
| C-10 | Не зафиксирован статус уточнённой редакции | **Зафиксировано**: уточнения не меняют формулы и базовую семантику, но реализация обязана следовать уточнённой редакции; новая версия не вводится | **INFERENCE** из содержания уточнений | шапка контракта, §20 |

### 15.2. Подтверждено кодом и данными (FACT)

- `dataset_checksum` в снапшоте = `sha256(normalized rows "date\tvalue")` на момент запуска (`cli/shadow.ts:53`, `runner.ts:101`), **не** sha256 байтов CSV (байтовый checksum: `56069e58…`).
- `input_data_version` = `sha256("date=value…" до origin)` (`store.ts:inputDataVersion`) — 877 уникальных значений.
- В `forecasts.jsonl` — 2 различных `dataset_checksum`; `manifest.dataset_checksum = 8f2b1818…` совпадает с текущим нормализованным набором.
- `snapshotId` включает `model_id` и `model_version` → общий `snapshot_identity` для пары невозможен.
- Дубли в источниках не проверяются; `reconcile()` защищает только от повторной записи reconciliation по `snapshot_id`.

### 15.3. Что осталось рекомендацией (RECOMMENDATION)

- реализация независимого поиска участников пары и 12 проверок (UI-4.1);
- реализация обработки дублей и `CONFLICT_DUPLICATE` (UI-4.1);
- пометка `DATASET_VERSION_DIFFERS` в DTO (UI-4.1).

### 15.4. NOT_IMPLEMENTED / NOT_VERIFIED (без изменений)

- `NOT_IMPLEMENTED`: парная выборка, счётчики, `DetectedConflicts`, `UnknownRecords`, `UNKNOWN`, проверки дублей, endpoints, экраны, p10/p90, сценарии, финансовый эффект, SQLite read-only API, список аномалий, FU-1.
- `NOT_VERIFIED`: бизнес-семантика `delivered_orders_daily`; фактическое наличие дублей/расхождений в JSONL (проверки не запускались); влияние CONFLICT replay↔shadow; браузерная адаптивность (UI-7); судьба `diff.txt`.

### 15.5. Контроль неизменности (FACT)

| Область | До UI-4.0.2 | После UI-4.0.2 |
|---|---|---|
| SQLite | `eadc3763926e142a574e5493495ee83584bd21f77d71bbbf6ae42cc0c7c65619` | не изменялась |
| canonical CSV (нормализованный) | `8f2b1818da001a42fad3125b…` | не изменялся |
| `forecasts.jsonl` | `e35fe27b002e42cca0d5d675…` | не изменялся |
| `reconciliations.jsonl` | `32ccd25604ae78b36996738c…` | не изменялся |
| `manifest.json` | `9d986747771c5fd1cc3654a8…` | не изменялся |
| `errors.jsonl` | отсутствует | не создан |
| `src/**`, `tests/**`, `package.json`, `bun.lock`, конфигурации | без изменений | без изменений |
| Git index | staged 0, untracked 2 | staged 0, untracked 2 (те же документы) |

### 15.6. Состояние Git (FACT)

| Момент | staged | unstaged | untracked |
|---|---:|---:|---:|
| До создания документов UI-4.0 | 0 | 0 | 0 |
| После UI-4.0 (отчёт) | 0 | 0 | 2 |
| Начало UI-4.0.1 | 0 | 0 | 2 |
| Начало UI-4.0.2 | 0 | 0 | 2 |
| После UI-4.0.2 | 0 | 0 | 2 |

Документы остаются untracked и не закоммичены; новых файлов не создано.