# API-3.3.2-MAP — матрица API (компактная)

**HEAD:** `db928062b2464d26d14ea9df4c988c332c8ece9b` · **Branch:** `main` · **Дата:** 2026-11-28
Разделение: FACT (подтверждено кодом) / INFERENCE / NOT_VERIFIED.

| Endpoint | Method | Backend handler (файл:строка) | Frontend consumer (файл:строка) | DTO | Parameters | Status | Source | Readiness |
|---|---|---|---|---|---|---|---|---|
| `/api/health` | GET | `routes.ts:10` (инлайн) | — | `{ status, checksums, source }` | — | ok | manifest/CSV | UNUSED |
| `/api/v1/overview` | GET | `overviewModel` `read-models.ts:341` | `app-render.ts:103` | `OverviewModel` | — | ok/not_available/error | CSV+JSONL | USED |
| `/api/v1/history` | GET | `historyModel` `read-models.ts:77` | `app-render.ts:143,145` | `HistoryModel` | `from`, `to`, `limit` | ok/not_available/error | canonical CSV | USED (дважды) |
| `/api/v1/history/coverage` | GET | `coverageModel` `read-models.ts:162` | `app-render.ts:144` | `CoverageModel` | — | ok/error | canonical CSV | USED |
| `/api/v1/shadow/forecasts` | GET | `shadowForecastsModel` `read-models.ts:230` | `app-render.ts:146` | `ShadowForecastsModel` | `horizon`, `mode`, `limit` | ok/not_available/error | shadow JSONL | PARTIAL (limit=20, mode не передан) |
| `/api/v1/shadow/reconciliations` | GET | `reconciliationsModel` `read-models.ts:293` | — | `ReconciliationModel` + `mode`, `unknownSnapshots` | `mode` (dflt shadow), `horizon` (1\|3), `limit` (dflt 60) | ok/not_available/error | shadow JSONL | UNUSED → план: блок «Сверка с фактом» |
| `/api/v1/shadow/monitor` | GET | `monitorModel` `read-models.ts:324` | — | `MonitorReport` | — | ok/not_available/error | shadow JSONL | UNUSED |
| `/api/v1/forecasts/quality` | GET | `forecastsQualityModel` `forecasting-read-models.ts:147` | `app-render.ts:109,122` | `ForecastsQualityDto` | `mode` (req), `horizon` (req), `paired` | ok/not_available/error | JSONL+CSV | USED (`paired` не используется) |
| `/api/v1/forecasts` | GET | `forecastsListModel` `forecasting-read-models.ts:194` | — | `ForecastsListDto` (`ForecastItemDto`×N) | `mode` (req), `horizon` (req), `model` (allowlist), `limit` (1..1000, dflt 200) | ok (последние N) / not_available `NO_RECORDS_FOR_MODE_AND_HORIZON` | shadow JSONL | UNUSED → план: блок «Снапшоты прогнозов» |
| `/api/v1/forecasts/errors` | GET | `forecastErrorsModel` `forecasting-read-models.ts:227` | `app-render.ts:123` | `ForecastsErrorsDto` | `mode` (req), `code`, `limit` | ok/not_available `NO_DETECTED_DIAGNOSTICS` | shadow JSONL (детекция) | USED (без горизонта) |
| `/api/*` (любой иной метод) | * | `routes.ts:122` | — | `{ status: "error", … }` | — | 404/405 | — | GUARD |

## DTO → поля → доступность для Forecast

| DTO (файл:строка) | Поля | Нужно Forecast UI | Есть |
|---|---|---|---|
| `ForecastItemDto` (`forecasting-read-models.ts:46`) | `snapshotId, mode, modelId, modelVersion, variant\|null, horizon, originDate, targetDate, forecastValue\|null, status, inputDataVersion, generatedAt` | таблица снапшотов | 12/12 |
| `ForecastItemDto` | `actual`, `absoluteError`, `signedError`, per-record `datasetChecksum` | колонки факта/ошибки | **НЕТ** (только через сверки) |
| `ForecastsListDto` (`:61`) | `mode, horizon, total, returned, items, provenance` | сводка и provenance | 6/6 |
| `ForecastProvenanceDto` (`:16`) | `datasetChecksums, datasetVersionWarning, manifestStatus, manifestDatasetChecksum, freshness, shadowFileChecksums` | блок provenance снапшотов | 6/6 |
| `ForecastsQualityDto` (`:30`) | `mode, horizon, semantics, technicalFactCutoff, independentMetrics, pairedComparison, pairCounters, metricDiagnostics, sampleStatus, interpretabilityStatus, warnings, provenance, availability` | страница `#forecast-quality` | 13/13 |
| `ForecastErrorsDto` (`:78`) | `mode, total, persistedErrorsAvailable, items[]: {source, kind, snapshotId\|null, recordType, reason}` | диагностика | 6/6 |
| `ReconciliationModel` (`read-models.ts:288`) | `total, items[]: {snapshotId, modelId, horizon, targetDate, forecastValue\|null, actual, absoluteError, signedError}` + `mode`, `unknownSnapshots` | таблица сверки | 8/8 |
| `ReconciliationModel` | `originDate`, `inputDataVersion`, `modelVersion`, `variant`, `status`, provenance | связывание со снапшотами по ключам | **НЕТ** |
| `HistoryModel` / `CoverageModel` | используются страницами History/Quality | не для Forecast | — |

## Избыточные запросы (FACT по `app-render.ts`)

| Страница | Выполняется | Используется | Избыточно |
|---|---|---|---|
| Overview | overview + 4 (строки 143–146) | overview, history, shadow | coverage (1) |
| History | overview + 4 | overview, history, coverage | fullHistory, shadow (2) |
| Quality данных | overview + 4 | overview, coverage, fullHistory | history, shadow (2) |
| Provenance | overview + 4 | overview | history, coverage, fullHistory, shadow (4) |
| Forecast quality | overview + quality | overview, quality | 0 |
| Forecast diagnostics | overview + quality + errors | overview, quality, errors | 0 |
| Forecast (placeholder) | — | — | 0 |

**Итого 9 избыточных запросов** (1+2+2+4). Инвариант: любой рендер, кроме Forecast, начинается с `/api/v1/overview` (строка 103).

## Параметры и валидация (FACT)

| Параметр | Endpoint | Правило | Источник кода |
|---|---|---|---|
| `mode` | forecasts, quality, errors, shadow/* | обязателен для forecasts/quality/errors; для сверок — `shadow` по умолчанию | `parseEvaluationMode` `forecasting-read-models.ts:86`, `read-models.ts:298` |
| `horizon` | forecasts, quality, shadow/* | `1` или `3`, иначе `INVALID_QUERY` | `parseEvaluationHorizon` `:92`, `read-models.ts:296` |
| `model` | forecasts | только значения allowlist | `parseOptionalModel` `:106` |
| `limit` | forecasts, errors, history, shadow/* | целое 1..1000 (forecasts), историческое значение по умолчанию у каждого read-model | `routes.ts:95`, `read-models.ts:294` |
| `from`/`to` | history | календарные даты `YYYY-MM-DD` | `routing.ts` (frontend) + `read-models.ts` (сервер) |

## Тестовое покрытие (FACT)

| Область | Файлы | Пробел |
|---|---|---|
| Маршруты и envelope | `tests/server/api.test.ts` (115), `hardening.test.ts` (556) | нет проверки, что frontend вызывает только существующие маршруты |
| Парсеры/DTO прогнозов | `tests/server/forecasting-read-models.test.ts` (214) | `/forecasts` и `/reconciliations` не покрыты со стороны UI |
| UI-страницы | `tests/web/*` (11 файлов, 2 173 строки) | нет тестов блоков снапшотов и сверок (страница не реализована) |

## Риски (сводно)

P1: факт/ошибки — только подмножество сверок, другие ключи; нет серверного фильтра дат/пагинации.
P2: 9 избыточных запросов; allowlist `model`; неиспользуемые `/shadow/monitor` и `/api/health`.
P3: смешение `persisted` и `detected` в диагностике.

**Блокеров нет** (FACT): все Forecast-endpoint'ы зарегистрированы, валидируются и покрыты серверными тестами.
