# UI-7.1.0 — Discovery Audit: Forecast Errors & Diagnostics

> **Архитектурная поправка TPL-4.5.** Каталог `src/web/templates/partials/` удалён в TPL-4.4.
> Production HTML формируют `src/web/components/` и `src/web/pages/`; экранирование — `src/web/lib/format.ts`;
> актуальная документация архитектуры — `src/web/templates/README.md`; эталоны страниц — `docs/ui/reference/`
> (генератор `tools/reference/`). Исторические результаты ниже не изменялись.

**Проект:** DSS — DarkStore AI Forecast Engine
**Дата аудита:** 27 ноября 2026
**Тип:** Read-only audit (реализация не выполнялась, источники не изменялись)

---

## 1. Дата, HEAD, branch, Git status

### FACT

| Параметр | Значение |
|---|---|
| Дата | 2026-11-27 |
| Branch | `main` |
| HEAD | `3c3dba020d7d101caa3f6e7f8219d8d0d690360c` (`frontent atom  partical visial not logic`) |
| Upstream | `origin/main` = HEAD (изменений опубликовано нет) |
| Staged (`git diff --cached`) | пусто |
| HEAD в процессе аудита | **не менялся** (read-only) |

### `git status --short` (на начало аудита)

```
 M README.md
 M diff.txt
 M reports/code-review/pii-tracked-inventory.json
 M src/web/main.ts
 M src/web/pages/history.ts
 M src/web/templates/README.md
 M src/web/templates/partials/cards/kpi-card.html
 M src/web/templates/partials/cards/kpi-grid.html
 M src/web/templates/partials/shell/sidebar-nav.html
 M src/web/templates/partials/shell/sidebar.html
 M tests/web/ui-7-0-1-routing.test.ts
?? docs/ui/ui-7-0-2-1-acceptance-report.md
?? src/web/routing.ts
?? tests/web/templates-partials.test.ts
```

- **FACT:** все перечисленные изменения — рабочее состояние UI-7.0.2.1, к UI-7.1 не относятся. Не перезаписывались.
- **FACT:** untracked-файлов, относящихся к UI-7.1, до начала работ не было. Документов `docs/ui/ui-7-1-*` не существовало.
- **FACT:** единственные новые файлы, созданные в ходе UI-7.1.0, — три разрешённых документа (этот и два соседних).

### Этапы UI, фактически присутствующие в коде (FACT)

| Область | Файл | Статус |
|---|---|---|
| Маршрутизация | `src/web/routing.ts` (untracked) | реализована (UI-7.0.2.1) |
| Forecast Quality | `src/web/pages/forecast-quality.ts` | реализована (UI-4.2) |
| API прогнозов | `src/server/routes.ts` (`/api/v1/forecasts*`) | реализована (UI-4.2) |
| Ядро оценки | `src/server/forecast-evaluation.ts` | реализована (UI-4.1.1) |
| Read-models | `src/server/services/forecasting-read-models.ts` | реализована (UI-4.2.1) |
| Шаблоны | `src/web/templates/partials/**` (22 файла) | спецификация (не в runtime) |

---

## 2. Состояние API

### FACT — реальные маршруты (`src/server/routes.ts`)

| Endpoint | Метод | Источник | Read-model | Данные | Ограничения |
|---|---|---|---|---|---|
| `/api/health` | GET | процесс | inline | `{service, readOnly, version}` | без параметров |
| `/api/v1/overview` | GET | canonical CSV + shadow JSONL | `overviewModel` | сводка истории/теневого режима/provenance | нет пагинации |
| `/api/v1/history` | GET | canonical CSV | `historyModel` | точки ряда | `from`,`to`,`limit`≤1000; нет точек → `not_available` |
| `/api/v1/history/coverage` | GET | canonical CSV | `coverageModel` | полнота/пропуски | пусто → `not_available` |
| `/api/v1/shadow/forecasts` | GET | shadow JSONL | `shadowForecastsModel` | агрегаты + последние записи | `mode`,`horizon`,`limit`; пусто → `not_available` |
| `/api/v1/shadow/reconciliations` | GET | shadow JSONL | `reconciliationsModel` | сверки | `mode`,`horizon`,`limit` |
| `/api/v1/shadow/monitor` | GET | shadow JSONL | `monitorModel` | monitor report | пусто → `not_available` |
| `/api/v1/forecasts/quality` | GET | shadow JSONL + canonical CSV | `forecastsQualityModel` | метрики/счётчики/диагностика | **обязательны `mode`,`horizon`**; `paired` |
| `/api/v1/forecasts` | GET | shadow JSONL | `forecastsListModel` | список прогнозов | **обязательны `mode`,`horizon`**; `model`,`limit`≤1000 |
| `/api/v1/forecasts/errors` | GET | shadow JSONL (вычисленная диагностика) | `forecastErrorsModel` | **detected** диагностика | **обязателен `mode`**; `code`,`limit`≤1000 |

Любой не-GET на `/api/*` → `405 METHOD_NOT_ALLOWED`.

### FACT — ключевые особенности контракта

1. **`/api/v1/forecasts/errors` — НЕ persisted errors.** Возвращает `ForecastErrorItemDto` c `source: "detected"` только (persisted-ветка не заполняется: `persistedErrorsAvailable: false` в коде-константе). Содержимое: `unknownRecords` + `pairIdentityConflicts` + `reconciliationMismatches`, отфильтрованные по `mode`.
2. **`errors.jsonl` физически отсутствует.** `readShadowErrors()` вызывает `readJsonl()`, которая при `ENOENT` возвращает `[]` (проваливанием catch `readFile`). API **не отличает** отсутствующий файл от пустого: оба дают `[]`. В `forecastErrorsModel` файл `errors.jsonl` **не читается вовсе** — диагностика строится только из `evaluate()`.
3. **Replay/shadow не смешиваются:** `mode` обязателен и валидируется (`parseEvaluationMode`), `horizon` обязателен (`parseEvaluationHorizon`). `evaluate()` группирует по `(mode, horizon)` и не суммирует их.
4. **Неизвестные статусы не теряются:** `classifyUnknown()` → `UnknownRecord` (`UNKNOWN_MODE/HORIZON/MODEL/STATUS`), попадают в `diagnostics.unknownRecords` и в `/forecasts/errors`.
5. **Причины потерь на уровне DTO:** `/forecasts/errors` отдаёт `reason` как строку (`reason: conflict.field` для reconciliation mismatch — только имя поля, без значений; `reason` unknown — склейка `mode/horizon/model_id/model_version/status`). Отдельного перечисления `EligibilityReason` для каждой исключённой записи этот endpoint **не отдаёт** (оно есть только внутри `evaluate()` → `eligibilityDiagnostics`).
6. **Агрегаты не выдаются за полный список:** `/forecasts/errors` возвращает `total` = длина отфильтрованного массива и `items` (обрезано по `limit`, ≤1000). Агрегированные счётчики (`pairCounters`) отдаёт `/forecasts/quality`, не `/forecasts/errors`.

### FACT — обязательные параметры и валидация

- `mode` ∈ {`replay`,`shadow`}; при отсутствии/ином — `400 INVALID_QUERY`.
- `horizon` ∈ {1,3}; иное — `400`.
- `limit` — целое 1..1000; иное — `400`.
- `model` (только `/forecasts`) ∈ {`rolling_7_day_mean`,`adaptive_baseline`}.
- `code` (только `/forecasts/errors`) — фильтр по `kind` (свободная строка).

### FACT — обработка ошибок

- `SourceError` → `{status:"error",code,message,eventId}` с заданным HTTP-статусом (400/503).
- Прочее → `500 INTERNAL_ERROR` без stack trace.
- Middleware: `Host`/`Origin` allowlist → 403; `notFound` → 404; заголовки `no-store`, `nosniff`, `no-referrer`.

---

## 3. Состояние JSONL

**Путь (FACT):** `data/shadow/7745/` (из `src/server/sources.ts: SHADOW_DIR = resolve(PROJECT_ROOT, "data/shadow/7745")`).

| Файл | Наличие | Строк | Размер |
|---|---|---:|---:|
| `forecasts.jsonl` | ✅ есть | 3508 | 2 055 097 B |
| `reconciliations.jsonl` | ✅ есть | 3502 | 1 245 880 B |
| `errors.jsonl` | ❌ **отсутствует** | — | — |
| `manifest.json` | ✅ есть | (JSON-объект) | 498 B |
| `shadow-monitor.json` | ✅ есть (не читается API v1) | — | 1 706 B |

**FACT — схема записи `forecasts.jsonl`** (поля): `snapshot_id, run_id, mode, model_id, model_version, variant, horizon, origin_date, target_date, forecast_value, status, fallback_reason, input_data_version, dataset_checksum, generated_at`.

**FACT — схема записи `reconciliations.jsonl`:** `snapshot_id, run_id, model_id, horizon, target_date, forecast_value, actual, absolute_error, signed_error, reconciled_at`.

---

## 4. Состояние manifest

**FACT** (`data/shadow/7745/manifest.json`):

```json
{
  "version": "shadow-mode/v1",
  "created_at": "2026-11-24T11:14:48.138Z",
  "dataset_checksum": "8f2b1818da001a42fad3125ba85a600f71c4443316e868181c49fa35708d3d16",
  "horizons": [1, 3],
  "models": { "rolling_7_day_mean": "rolling-7-day-mean/v1", "adaptive_baseline": "adaptive-baseline/v1+variantB" },
  "alpha": 1, "limit_percent": 0.1, "min_train_days": 28,
  "note": "..."
}
```

- **FACT:** `readManifest()` различает три статуса: `OK` / `NOT_AVAILABLE` (ENOENT) / `CORRUPTED` (невалидный JSON или не проходит `isManifest`). Fail-closed: `requireManifest()` бросает `SourceError`.
- **FACT:** allowlist `ALLOWED_MANIFEST_VERSIONS = {shadow-mode/v1, shadow-mode/v1.1}`, `ALLOWED_MANIFEST_HORIZONS = {1,3}`, checksum формата SHA-256-hex.
- **INFERENCE (важный finding):** `manifest.dataset_checksum = 8f2b1818…`. Но **replay-снапшоты (3500 из 3508) имеют `dataset_checksum = d413286e…`**, а `8f2b1818…` встречается только у части shadow-снапшотов. Это значит: `provenanceOf()` для `mode=replay` посчитает `freshness="STALE"` (manifest-checksum ≠ replay-checksum). См. также раздел 14 (finding N-1). Не исправлялось.

---

## 5. Фактические объёмы и распределения данных

### FACT — `forecasts.jsonl` (всего 3508)

| Признак | Значения | Количество |
|---|---|---:|
| mode | `replay` | 3500 |
| | `shadow` | 8 |
| model_id | `rolling_7_day_mean` | 1754 |
| | `adaptive_baseline` | 1754 |
| model_version | `rolling-7-day-mean/v1` | 1754 |
| | `adaptive-baseline/v1+variantB` | 1754 |
| variant | `null` | 1754 |
| | `B` | 1754 |
| horizon | `1` | 1754 |
| | `3` | 1754 |
| status | `OK` | 3508 |
| forecast_value = null | — | 0 |
| неизвестные статусы | — | 0 |
| дубликаты `snapshot_id` | — | 0 |
| `fallback_reason` != null | — | 0 |
| distinct `dataset_checksum` | `d413286e…` (replay 3500 + часть shadow), `8f2b1818…` (= manifest) | 2 |

**FACT — 8 shadow-снапшотов** (origin 2026-11-22 и 2026-11-23, h1/h3 × 2 модели), все `status=OK`, `forecast_value` не null.

### FACT — `reconciliations.jsonl` (всего 3502)

| Признак | Значение |
|---|---:|
| всего сверок | 3502 |
| дубликаты `snapshot_id` | 0 |
| orphan (reconciliation без snapshot) | 0 |
| snapshots без reconciliation | 6 |
| повторные сверки | 0 |
| `actual` не finite | 0 |
| `forecast_value` null в reconciliation | 0 |
| forecast_value mismatch (rc vs snapshot) | 0 |
| actual-конфликты по одной identity | 0 |
| сверки по mode снапшота | replay 3500, shadow 2 |

### FACT — pending-сверки (без reconciliation)

- replay: 0 pending (3500/3500 сверены);
- **shadow: 6 pending из 8** (target_date 2026-11-24/25/26 при последней фактической дате 2026-11-23 → естественный «ожидает факта», не ошибка).
- **FACT:** `technicalFactCutoff` = последняя дата canonical CSV = **2026-11-23**. Snapshot-цели позже этой даты классифицируются `eligibility → reason=PENDING, factStatus=PENDING`.

---

## 6. Результаты reconciliation (сверка источников)

**FACT:**
- reconciliation ↔ snapshot: 0 orphan, 0 дубликатов, 0 расхождений `forecast_value`, 0 расхождений `model_id/horizon/target_date` (проверено программно).
- actual-значения между одинаковыми identity не конфликтуют.
- 6 snapshots (все shadow, h1/h3 обеих моделей) без сверки — корректно «pending» (будущее относительно fact cutoff).
- **NOT_VERIFIED:** соответствие `actual` из `reconciliations.jsonl` значениям canonical CSV по датам — не проверялось поштучно (вне объёма безопасного аудита без записи); расхождений «forecast↔reconciliation» нет, но «actual↔canonical» требует отдельной сверки (рекомендация).

---

## 7. Существующие диагностические категории

Колонка «Статус»: IMPLEMENTED / PARTIAL / NOT_IMPLEMENTED / NOT_VERIFIED.

| Диагностическая категория | Где возникает | Источник | Условие обнаружения | Доступна через API | Надёжность |
|---|---|---|---|---|---|
| pending reconciliation | `eligibility()` | snapshot.target_date > cutoff | `target_date > technicalFactCutoff` → `PENDING` | `/quality` `pairCounters.pendingN`, `warnings` | IMPLEMENTED |
| excluded forecast | `buildPairs`/`evaluate` | snapshot не ELIGIBLE | `eligibility !== "ELIGIBLE"` | `/quality` `excludedBaselineN/CandidateN`, `metricDiagnostics` | IMPLEMENTED |
| invalid forecast (status) | `eligibility()` | `status ∉ {OK,FALLBACK,INVALID}` | `computeStatus==="UNKNOWN"` → `UNKNOWN_STATUS` | `/forecasts/errors`, `/quality` unknownN | IMPLEMENTED |
| fallback forecast | `eligibility()` | `status==="FALLBACK"` | `computeStatus!=="OK"` → `EXCLUDED_STATUS` | **только как счётчик исключённых**, отдельного «FALLBACK» счётчика нет | PARTIAL |
| unknown snapshot (reconciliation) | `classifyConflicts` | rc без snapshot | `!snapshotById.has(id)` → `UNKNOWN_SNAPSHOT` | `/forecasts/errors` (recordType=reconciliation) | IMPLEMENTED |
| orphan reconciliation | `classifyConflicts` | rc.snapshot_id ∉ snapshots | `orphanReconciliations` | `/quality` `orphanReconciliationN`; **список id — только в `/forecasts/errors`** | PARTIAL |
| duplicate snapshot | `classifyConflicts` | >1 snapshot_id | `duplicateSnapshotIds` → `CONFLICT_DUPLICATE` | `/quality` `duplicateN`; список — **нет в API** | PARTIAL |
| conflicting reconciliation | `classifyConflicts` | mismatched fields | `reconciliationMismatches` → `CONFLICT_RECONCILIATION` | `/forecasts/errors` (`reason=field`) | IMPLEMENTED |
| unknown mode | `classifyUnknown` | mode ∉ {replay,shadow} | `UNKNOWN_MODE` | `/forecasts/errors` | IMPLEMENTED |
| unknown status | `classifyUnknown` | status ∉ известных | `UNKNOWN_STATUS` | `/forecasts/errors` | IMPLEMENTED |
| unknown dataset version | `eligibility()` | `dataset_checksum` пуст | `!dataset_checksum` → `UNKNOWN_DATASET_VERSION` | **только внутри eligibilityDiagnostics `/quality`**, в `/forecasts/errors` не выносится | PARTIAL |
| dataset version differs | `buildPairs`/provenance | несколько checksum | `datasetVersionWarning` → `DATASET_VERSION_DIFFERS` | `/quality` `warnings`+`provenance.datasetVersionWarning` | IMPLEMENTED |
| missing actual | `eligibility()` | rc отсутствует | `!reconciliation` → `MISSING_ACTUAL` | `/quality` `missingActualN` | IMPLEMENTED |
| null forecast | `eligibility()` | `forecast_value`=null | `EXCLUDED_NULL_FORECAST` | счётчик исключённых (без отдельного счётчика) | PARTIAL |
| non-finite value | `computeMetrics` | нечисловое | `excluded reason=NON_FINITE` | `/quality` `metricDiagnostics` (агрегат) | PARTIAL |
| arithmetic overflow | `computeMetrics` | разность/накопление | `OVERFLOW` | `/quality` `metricDiagnostics`/`Metrics` статусы | IMPLEMENTED |
| insufficient sample | `interpretabilityOf` | pairedN==1 | `INSUFFICIENT` | `/quality` `interpretabilityStatus` | IMPLEMENTED |
| incomplete sample | `computeMetrics` | excluded.length>0 | `sampleStatus=PARTIAL` | `/quality` `sampleStatus`/`metricDiagnostics` | IMPLEMENTED |
| unavailable metrics | `computeMetrics` | n==0 | статус метрики `NOT_AVAILABLE` | `/quality` `Metrics.*Status` | IMPLEMENTED |
| **persisted errors (errors.jsonl)** | — | `errors.jsonl` | файл отсутствует | `/forecasts/errors` `persistedErrorsAvailable=false` | NOT_IMPLEMENTED (нет источника) |
| **excluded forecast — per-record cause list** | `evaluate.eligibilityDiagnostics` | snapshot | `eligibility !== ELIGIBLE` | **не выносится отдельным endpoint** (только агрегаты) | PARTIAL |

**FACT:** `evaluate()` возвращает `eligibilityDiagnostics[]` с полной причиной (`EligibilityReason`) для каждого снапшота и `conflicts` (все списки). Но API `/forecasts/errors` использует только подмножество (`unknownRecords`, `pairIdentityConflicts`, `reconciliationMismatches`); `eligibilityDiagnostics`, `duplicateSnapshotIds` (список), `orphanReconciliations` (список), `actualConflicts`, `snapshotsWithoutReconciliation` **не выносятся** отдельным endpoint.

---

## 8. Контракты evaluate()

**FACT** — `evaluate(snapshots, reconciliations, {technicalFactCutoff})` (чистая функция, без I/O):

- группирует по `(mode, horizon)` из **известных** режимов/горизонтов;
- для каждой модели считает независимые метрики (`computeMetrics`) по ELIGIBLE+reconciled;
- строит пары (`buildPairs`) по `pairKey = mode|horizon|origin_date|target_date|input_data_version`;
- парное сравнение — по общей выборке (`pairedN`), `deltaMae` только при конечных обеих MAE;
- диагностика (`classifyConflicts`) — по исходным наборам **целиком** (глобально): дубли, сироты, конфликты, unknown, actual-конфликты, pair identity.

**FACT** — `evaluate()` уже формирует и **может** отдать UI-7.1 следующие сведения, которые сейчас теряются на уровне API:
- `eligibilityDiagnostics[]` (per-snapshot `reason`) — полностью;
- `conflicts.duplicateSnapshotIds[]` (id+count), `orphanReconciliations[]`, `actualConflicts[]`, `snapshotsWithoutReconciliation[]`, `invalidReconciliations[]`, `pairIdentityConflicts[].snapshotIds`;
- `warnings` (`DATASET_VERSION_DIFFERS`).

**CLAIM (документация UI-4.x):** «UI не должен пересчитывать eligibility/метрики/пары; ядро — единственный источник». **FACT:** подтверждается: `forecasting-read-models.ts` вызывает `evaluate()` и не дублирует формулы.

---

## 9. UI readiness

**FACT — переиспользуемые компоненты** (`src/web/components/`, 22 partials):
- `dataTable`, `completenessCalendar`, `sparkline`;
- `kpiCard`, `kpiGrid`, `statusBadge`, `card`, `chartCard`, `provenanceDrawer`;
- `emptyState`, `loadingState`, `errorState`;
- каркас `appShell/sidebar/topbar/pageHeader`;
- hash-роутинг `routing.ts` (5 страниц: overview/history/quality/provenance/forecast-quality); фильтры mode/horizon уже реализованы в `pages/forecast-quality.ts`.

**FACT:** диагностический раздел как отдельная страница **отсутствует**; диагностика частично показана внутри «Прогнозы и качество» (KPI счётчики `pairCounters`, таблица `metricDiagnostics`, `warnings`).

**INFERENCE:** новую страницу можно добавить без дублирования компонентов: `dataTable`+`statusBadge`+фильтры mode/horizon + `emptyState/loadingState/errorState`; нужна новая запись в `PAGES` (`routing.ts`) и `pages/*.ts`. Это **реализация — запрещена** на этапе 7.1.0.

---

## 10. Security audit

**FACT:**
- PII: JSONL содержит только числовые/идентификаторные поля (snapshot_id, model, horizon, dates, values, checksum). **PII не обнаружено.** `generated_at/reconciled_at` — таймстампы.
- DTO не содержит абсолютных путей; `SourceError` message — фиксированные строки; логи содержат только `code`+`eventId`.
- `error message` клиенту — без stack trace (проверено `toErrorResponse`).
- Middleware: Host/Origin allowlist (127.0.0.1/localhost), `no-store`/`nosniff`/`no-referrer`.
- Frontend: `escapeHtml`/`trusted`/`safeHref` — частично изменены в UI-7.0.2.1 (partials); в runtime `components/*.ts` — исходная безопасная реализация.
- GET-маршруты только чтение; запись в источники отсутствует.

**INFERENCE:** риск — `reason` в `/forecasts/errors` содержит конкатенацию полей snapshot (`mode/horizon/model_id/model_version/status`) — это не PII, но раскрывает внутренние identifier-поля (не пути). Приемлемо.

---

## 11. Performance risks

**FACT:**
- `forecasts.jsonl` 2.05 MB / 3508 строк; `reconciliations.jsonl` 1.25 MB / 3502.
- **Каждый** запрос `/quality`, `/forecasts`, `/forecasts/errors` заново: `readSnapshots` + `readReconciliations` + `readManifest` + `readHistory` + `shadowFileChecksums` + `evaluate()`. Кэша нет.
- `evaluate()` — O(N) на проходы (классификация + построение пар + метрики); для 3.5k записей — миллисекунды.
- `/forecasts/errors` режет `items` по `limit`≤1000, но `total` считает полный отфильтрованный массив.
- Риск: при росте JSONL до сотен МБ повторное чтение на каждый запрос станет узким местом; повреждённая строка → `ShadowStorageCorruptedError` → fail-closed 503 (UI не зависнет, получит ошибку).

**INFERENCE:** для MVP (3.5k строк) производительность приемлема; при масштабировании — предложение (не реализовано): кэш чтения по mtime/checksum.

---

## 12. PII findings

**FACT: PII не обнаружено** в `forecasts.jsonl`, `reconciliations.jsonl`, `manifest.json`. Поля — технические идентификаторы, даты, числа, checksums. Вывод: DTO UI-7.1 без PII-рисков.

---

## 13. Data integrity checksums

**FACT** — до/после аудита идентичны (источники не изменялись):

| Источник | До (SHA-256) | После | Идентичен |
|---|---|---|---|
| `canonical_daily_delivered_orders.csv` | `56069e58…3ba377c5` | `56069e58…3ba377c5` | ✅ |
| `forecasts.jsonl` | `e35fe27b…f08a648c` | `e35fe27b…f08a648c` | ✅ |
| `reconciliations.jsonl` | `32ccd256…38dad146` | `32ccd256…38dad146` | ✅ |
| `manifest.json` | `9d986747…fc10c17d` | `9d986747…fc10c17d` | ✅ |
| `errors.jsonl` | отсутствует | отсутствует | ✅ (не создан) |

**FACT:** SQLite не открывался (нет необходимости; sidecar-риск). `git index`/HEAD не менялись.

---

## 14. FACT / CLAIM / INFERENCE / NOT_VERIFIED

### FACT
- 10 API GET-маршрутов + health; только GET.
- `/forecasts/errors` возвращает **только** `detected` диагностику; `persistedErrorsAvailable=false`.
- `errors.jsonl` отсутствует; API не отличает отсутствие от пустого файла.
- 3508 прогнозов (3500 replay, 8 shadow), 3502 сверки, 0 unknown-статусов, 0 дубликатов, 0 orphan, 6 pending (shadow, будущее).
- `evaluate()` формирует полную диагностику, но API выносит часть.
- replay/shadow строго разделены (обязательный `mode`).
- Checksums источников не менялись.

### CLAIM
- Документация UI-4.x: «ядро — единственный источник метрик/eligibility». Подтверждено кодом.
- README: canonical CSV + Shadow JSONL + SQLite (3 источника). Подтверждено `sources.ts`.

### INFERENCE
- **Finding N-1:** `manifest.dataset_checksum=8f2b1818…` ≠ replay `dataset_checksum=d413286e…` → для replay `freshness=STALE`. `8f2b1818…` соответствует только части shadow. Не дефект кода, но UX-риск ложного «STALE» на странице качества replay.
- Для MVP производительность приемлема.

### NOT_VERIFIED
- Попиксельная сверка `actual` в `reconciliations.jsonl` с canonical CSV по датам (не выполнялась — требует записи/полного join вне безопасного объёма).
- Поведение фронтенда при реальном `SourceError` (503) — по коду ожидаемо `errorState`, но браузерно не проверялось в этом аудите.
- `shadow-monitor.json` не является источником API v1 — его согласованность с `evaluate()` не анализировалась.

---

## 15. Блокирующие замечания

**Блокирующих для спецификации — нет.** Реализация UI-7.1 возможна на текущих источниках.

**Неблокирующие findings:**
- **N-1:** `freshness=STALE` для replay из-за расхождения manifest-checksum. Отображать как «версия manifest не совпадает», не как ошибку.
- **N-2:** `/forecasts/errors` не отдаёт per-record `EligibilityReason` (только `unknown/conflict/mismatch`). Для «почему прогноз не попал в оценку» нужен отдельный endpoint или расширение DTO (REQUIRES_IMPLEMENTATION).
- **N-3:** списки дубликатов/сирот/`snapshotsWithoutReconciliation`/`actualConflicts` есть в `evaluate()`, но не вынесены в API. Для UI — REQUIRES_IMPLEMENTATION (расширение ответа).
- **N-4:** `errors.jsonl` отсутствует; persisted-раздел UI должен показывать `NOT_AVAILABLE`, не «0 ошибок».

---

## 16. Итоговый вердикт

**READY WITH CONDITIONS.** Аудит завершён, источники целы, контракты `evaluate()` документированы. Реализация потребует ограниченного расширения API (N-2/N-3) для полноценного ответа на вопросы «почему исключён» и «списки конфликтов»; базовые счётчики и detected-диагностика доступны уже сейчас. Персистентные ошибки — `NOT_AVAILABLE` (источник отсутствует; не маскировать нулём).
