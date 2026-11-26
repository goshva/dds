# UI-4.2 — API и read-model оценки прогнозов: отчёт

**Дата:** 2026-11-24 · **HEAD:** `099f37b2588c2c1cb821faabf81d507f14f14818` · **Ветка:** `main` · **Staged:** 0
**Статус:** `ACCEPTED WITH LIMITATIONS`

---

## 1. Что реализовано (FACT)

- **UI-4.2.1 Read-model:** `src/server/services/forecasting-read-models.ts` — читает существующие источники fail-closed функциями, вызывает `evaluate()` ядра UI-4.1, формирует DTO; метрики не пересчитываются, `monitor()` не используется.
- **UI-4.2.2 API:** три GET endpoint (`/api/v1/forecasts/quality`, `/api/v1/forecasts`, `/api/v1/forecasts/errors`) с валидацией параметров, envelope `ok`/`not_available`/`error` и обязательным `eventId`.
- **UI-4.2.3 UI:** страница «Прогнозы и качество» (`#forecast-quality/<mode>/<horizon>`) — переключатели режима и горизонта, независимые метрики, парное сравнение, счётчики, статусы полноты и интерпретируемости, предупреждения, провенанс.
- **UI-4.2.4 Аудит:** тесты, сборка, PII gate, целостность данных, Git.

## 2. Добавленные файлы

| Файл | Назначение |
|---|---|
| `src/server/services/forecasting-read-models.ts` | read-model: `forecastsQualityModel`, `forecastsListModel`, `forecastErrorsModel`, `interpretabilityOf`, парсеры query |
| `src/web/pages/forecast-quality.ts` | страница прогнозной аналитики, `qualityWarnings` |
| `tests/server/forecasting-read-models.test.ts` | 17 тестов (unit на временных данных + API + интеграция на реальных) |
| `tests/web/forecast-quality.test.ts` | 6 тестов отображения и предупреждений |
| `docs/ui/ui-4-2-implementation-report.md` | настоящий отчёт |

## 3. Изменённые файлы

| Файл | Изменение |
|---|---|
| `src/server/routes.ts` | добавлены 3 GET endpoint и импорт read-model/валидаторов |
| `src/web/main.ts` | страница `forecast-quality` в навигации и роутинге |

Прогнозное ядро (`src/forecasting/**`), `forecast-evaluation.ts`, `sources.ts`, `read-models.ts`, `api.ts` — **не изменялись**.

## 4. Схема read-model

```text
HTTP route → forecasting-read-models (loadContext) → sources.readSnapshots/readReconciliations/readManifest/readHistory
                                                     → forecast-evaluation.evaluate()
                                                     → DTO (quality / list / errors)
```

`loadContext()` читает источники один раз на запрос (`Promise.all`), вычисляет `technicalFactCutoff` из последней даты canonical CSV, вызывает `evaluate()` и переиспользует результат для DTO.

## 5. Endpoints (FACT)

| Endpoint | Параметры | Поведение |
|---|---|---|
| `GET /api/v1/forecasts/quality` | `mode` (обяз., replay/shadow), `horizon` (обяз., 1/3), `paired` (опц., true/false) | DTO качества; нет записей → `not_available` |
| `GET /api/v1/forecasts` | `mode` (обяз.), `horizon` (обяз.), `model` (опц.), `limit` (опц., 1…1000) | ограниченный список; пусто → `not_available` |
| `GET /api/v1/forecasts/errors` | `mode` (обяз.), `code` (опц.), `limit` (опц., 1…1000) | только вычисленная диагностика; `persistedErrorsAvailable: false`; пусто → `not_available` |

Ошибки валидации: `400 INVALID_QUERY`; изменяющие методы → `405`; повреждённый JSONL → `SourceError` → 503 `DATA_SOURCE_CORRUPTED`.

## 6. Пример DTO

```json
{
  "mode": "shadow", "horizon": 1, "semantics": "PROVISIONAL",
  "technicalFactCutoff": "2026-11-23",
  "independentMetrics": [{ "modelId": "rolling_7_day_mean", "n": 1, "mae": 40.43, "wape": 2.617, "bias": 40.43, "sampleStatus": "COMPLETE", "semantics": "PROVISIONAL" }],
  "pairedComparison": { "available": true, "pairedN": 1, "maeBaseline": 40.43, "maeCandidate": 124.12, "deltaMae": -83.7, "status": "OK" },
  "pairCounters": { "baselineIndependentN": 1, "candidateIndependentN": 1, "pairedN": 1, "pendingN": 6 },
  "metricDiagnostics": [{ "modelId": "rolling_7_day_mean", "excluded": [], "excludedN": 0, "overflowAffectedN": 0, "sampleStatus": "COMPLETE" }],
  "sampleStatus": "COMPLETE", "interpretabilityStatus": "INSUFFICIENT",
  "warnings": ["PENDING_OBSERVATIONS_PRESENT"],
  "provenance": { "datasetChecksums": ["8f2b1818…"], "datasetVersionWarning": false, "manifestStatus": "OK", "freshness": "MATCH" },
  "availability": { "available": true, "reason": null }
}
```

## 7. Результаты тестов (FACT)

| Команда | Результат |
|---|---|
| `bun test tests/server/forecasting-read-models.test.ts` | **17 pass / 0 fail** |
| `bun test tests/web/forecast-quality.test.ts` | **6 pass / 0 fail** |
| `bun test tests/server tests/web` | **235 pass / 0 fail** |
| `bun test` | **785 pass / 4 skip / 0 fail** |
| `bunx tsc --noEmit` | 0 ошибок |
| `bun run ui:build` | exit 0 |
| PII gate (4 новых файла) | GATE PASS |

## 8. Проверка реальных данных (FACT)

| Срез | independentN (baseline/candidate) | pairedN | interpretabilityStatus | pendingN |
|---|---|---:|---|---:|
| replay/h1 | 875 / 875 | 875 | LIMITED | 0 |
| replay/h3 | 875 / 875 | 875 | LIMITED | 0 |
| shadow/h1 | 1 / 1 | 1 | **INSUFFICIENT** | 2 |
| shadow/h3 | 0 / 0 | 0 | **NOT_AVAILABLE** | 4 |

- Режимы не смешиваются: replay и shadow — раздельные сводки; replay маркируется «Историческая диагностика», shadow — «Текущий теневой режим».
- Shadow/h1 с одним наблюдением отображается с предупреждением «описательный характер», без статуса «Улучшение» и без объявления победителя.
- `Δ MAE` в интерфейсе подписан «не доказательство превосходства».
- `dataset_checksums` передаются списком; при нескольких версиях — предупреждение `DATASET_VERSION_DIFFERS`.

## 9. Целостность (до = после)

| Объект | Значение |
|---|---|
| SQLite | `identical: true` |
| canonical CSV (нормализованный) | `8f2b1818da001a42fad3125ba85a600f71c4443316e868181c49fa35708d3d16` |
| `forecasts.jsonl` | `e35fe27b002e42cca0d5d67579d9831c…` |
| `reconciliations.jsonl` | `32ccd25604ae78b36996738c10581cea…` |
| `manifest.json` | `9d986747771c5fd1cc3654a8eec6c0cf…` |
| `errors.jsonl` | не создан |

## 10. Безопасность

- Только GET (изменяющие → 405); обязательный `eventId`; ошибки без stack trace, путей и PII; Host/Origin guard, `no-store`/`nosniff`/`no-referrer` не ослаблены; `limit ≤ 1000`; PII gate PASS; прогнозные операции не запускались.

## 11. Git

HEAD `099f37b2588c2c1cb821faabf81d507f14f14818`; staged 0; unstaged: `src/server/routes.ts`, `src/web/main.ts`; untracked: 2 документа UI-4, отчёт UI-4.1, ядро, read-model, страница, 3 тестовых файла, настоящий отчёт. Commit/push/reset/rebase/checkout не выполнялись; index не изменялся.

## 12. NOT_IMPLEMENTED

- статистическая значимость и порог интерпретируемости (не согласован; `LIMITED` для любого `pairedN > 1`);
- запись/хранение ошибок (`errors.jsonl` не создаётся);
- кэширование read-model (вычисление на запрос);
- p10/p90, сценарии, финансовый эффект, SQLite read-only API;
- экраны UI-4.3+.

## 13. NOT_VERIFIED

- браузерная визуальная проверка и адаптивность (UI-7);
- поведение при обновлении Shadow-хранилища после даты аудита (тесты интеграции устойчивы: проверяют структуру и инварианты, а не жёсткие числа);
- бизнес-семантика `delivered_orders_daily` (`PROVISIONAL`).

## 14. Остаточные риски

1. **P0 (принят с ограничением):** shadow-выборка мала (1 пара h1, 0 пар h3) — UI обязан показывать `INSUFFICIENT`/`NOT_AVAILABLE`; реализовано.
2. **P1:** `LIMITED` не означает статистическую достаточность — порог не согласован, зафиксировано в DTO.
3. **P1:** повторные чтения JSONL (3.3 МБ) на каждый запрос; кэш не введён сознательно (риск устаревших данных).
4. **P2:** `forecastErrorsModel` возвращает только вычисленную диагностику; персистентный источник помечен как недоступный.
5. **P2:** два значения `dataset_checksum` в данных — передаются списком с предупреждением.

## 15. CLAIM

Заявления предыдущих этапов (3 508 снапшотов, 3 502 reconciliation, 1 751 пара, 6 pending) **подтверждены** аудитом UI-4.2.0 и воспроизводятся read-model; в production-логику и тесты они не зашиты (интеграционные тесты проверяют инварианты, а не константы).
