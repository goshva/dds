# UI-0 — анализ разрывов API

Метки: **FACT** / **INFERENCE** / **NOT_IMPLEMENTED**.

---

## 1. Существующие endpoint'ы (FACT)

HTTP API в DSS **отсутствует**: нет Hono, нет `Bun.serve`, нет `src/api`. Все операции выполняются через CLI (`forecast:*`) и скрипты.

| Операция | Сейчас | Для UI |
|---|---|---|
| чтение истории | CLI/скрипты читают CSV | нужен GET |
| чтение shadow JSONL | `readJsonl` в коде | нужен GET |
| reconcile/monitor | CLI `--mode reconcile/monitor` | нужен POST или серверный вызов |
| shadow snapshots | CLI `--mode shadow` | нужен POST (только shadow) |
| backtest/калибровка | CLI | вне UI (статические отчёты) |

## 2. Предлагаемые API (proposal, не реализованы)

### GET (read-only)
| Endpoint | DTO | Источник | Статус |
|---|---|---|---|
| `/api/v1/system/health` | `HealthDTO` | файлы/БД | NOT_IMPLEMENTED |
| `/api/v1/dashboard/overview` | `OverviewDTO` | CSV + shadow | NOT_IMPLEMENTED |
| `/api/v1/history` | `HistoryDTO` | canonical CSV | NOT_IMPLEMENTED |
| `/api/v1/history/coverage` | `CoverageDTO` | canonical CSV | NOT_IMPLEMENTED |
| `/api/v1/forecasts` | `ForecastDTO` | shadow snapshots | NOT_IMPLEMENTED |
| `/api/v1/forecasts/timeline` | `TimelineDTO` | snapshots + CSV | NOT_IMPLEMENTED |
| `/api/v1/models/quality` | `ModelQualityDTO` | reconciliations | NOT_IMPLEMENTED |
| `/api/v1/shadow/summary` | `ShadowSummaryDTO` | store + manifest | NOT_IMPLEMENTED |
| `/api/v1/shadow/runs` | `RunDTO[]` | store | NOT_IMPLEMENTED |
| `/api/v1/shadow/snapshots` | `SnapshotDTO[]` | store (пагинация) | NOT_IMPLEMENTED |
| `/api/v1/shadow/reconciliations` | `ReconciliationDTO[]` | store | NOT_IMPLEMENTED |
| `/api/v1/scenarios` | `ScenarioDTO[]` | `scenarios` (пусто) | NOT_IMPLEMENTED (данных нет) |
| `/api/v1/events` | `EventDTO[]` | `domain_events` | NOT_IMPLEMENTED |
| `/api/v1/data-quality` | `DataQualityDTO` | CSV + SQLite | NOT_IMPLEMENTED |

### POST (контролируемые)
| Endpoint | Действие | Ограничения |
|---|---|---|
| `/api/v1/shadow/run` | `runShadowMode({mode:"shadow"})` | без `all`/`replay`; lock; checksum |
| `/api/v1/shadow/reconcile` | `reconcile(...)` | lock; только чтение снапшотов |
| `/api/v1/shadow/monitor` | `monitor(...)` | lock; перезапись только `shadow-monitor.json` |
| `/api/v1/scenarios` | создание записи | NOT_IMPLEMENTED (нет движка/данных) |
| `/api/v1/scenarios/:id/calculate` | расчёт | NOT_IMPLEMENTED |
| `/api/v1/events` | создание события | NOT_IMPLEMENTED (плановые события не факты) |

## 3. Gaps (FACT)

| Gap | Влияние |
|---|---|
| Нет HTTP-слоя | UI-2 блокируется до добавления сервера |
| `scenarios`/`scenario_results` пусты | UI-6: конструктор + `NOT_IMPLEMENTED`, без чисел |
| `forecast_results` пуст | прогнозные интервалы p10/p90 недоступны |
| `forecast_evaluations` пуст | нет отдельных оценок прогнозов (только reconciliations) |
| `domain_events` только `planned` | фактический эффект событий недоступен |
| Нет API-схем/валидации | требуется создать DTO + валидаторы |
| Нет CORS/rate-limit/CSRF | требуется при создании сервера |
| PII в dimension values | маскирование на уровне сериализаторов |

## 4. Что можно переиспользовать напрямую (FACT)

- `shadow/store.ts`: `readJsonl` (fail-closed), `isSnapshotRecord`, `isReconciliationRecord`, `isShadowErrorRecord`, `storePaths`, `MODEL_VERSIONS`, `snapshotId`.
- `shadow/pipeline.ts`: `reconcile`, `monitor` (готовые агрегаты).
- `shadow/runner.ts`: `runShadowMode` (только `mode:"shadow"`).
- `shadow/lock.ts`: `acquireShadowLock`/`releaseShadowLock`.
- `analytics/expansion/history-builder.ts`: `readCanonicalCsv`.
- `analytics/calendar/calendar-core.ts`: `isoDayOfWeek`, `moscowDateOf`.
- `storage/interfaces/*`: типы статусов (`DataStatus`, `EvidenceStatus`, `QualityStatus`, `MetricKind`, `ConfidenceStatus`).

## 5. Что требует нового кода (INFERENCE)

| Новое | Объём |
|---|---|
| Hono-приложение + роутинг | ~150 строк |
| read services (history/shadow/quality/data-quality) | ~300 строк |
| DTO + валидаторы | ~200 строк |
| сериализаторы + PII-маскирование | ~100 строк |
| безопасность (CORS, rate limit, лимит тела) | ~80 строк |
| UI-каркас + дизайн-система | UI-1 |
| страницы (10) | UI-3…UI-6 |
| тесты API/UI | UI-1…UI-7 |

## 6. Ограничения и запреты (FACT)

- Не создавать второй forecasting engine.
- Не давать UI доступ к `--mode all`/`replay`.
- Не писать в canonical CSV/SQLite из UI.
- Не подменять отсутствующие данные нулями.
- Не использовать mock-данные в production-пути (fixture — только в playground UI-1 с явной маркировкой).
- Не добавлять авторизацию пользователя.

## 7. Открытые вопросы

1. Согласовать добавление Hono (или разрешить `Bun.serve`).
2. Подтвердить, что UI-6 — только конструктор/просмотр, без расчёта.
3. Подтвердить хранение read-моделей (in-memory кэш с TTL/checksum или без кэша на MVP).
4. Подтвердить допустимость POST `/shadow/*` на локальном стенде (не production).