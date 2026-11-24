# UI-2 — контракт API

## 1. Формат ответов

Успех: `{ "status": "ok", "data": {...}, "meta": { "generatedAt", "source", "readOnly": true, "checksum?" } }`
Нет данных: `{ "status": "not_available", "data": null, "meta": { ..., "reason": "CODE" } }`
Ошибка: `{ "status": "error", "error": { "code": "...", "message": "..." } }`

## 2. Endpoints и источники полей

| Endpoint | Поля | Источник |
|---|---|---|
| `/api/health` | service, readOnly, version | процесс |
| `/api/v1/overview` | shopNo, timezone, metric, sliceId, semantics, history{days,firstDate,lastDate,lastValue,checksum,completeness}, shadow{snapshots,shadow,replay,pending,reconciled,errors,candidate,baseline,horizons,available} | canonical CSV + shadow JSONL |
| `/api/v1/history` | points[{date,value}], from, to, totalPoints, returnedPoints | canonical CSV |
| `/api/v1/history/coverage` | firstDate, lastDate, days, gaps, duplicateDates, nullValues, completeness | canonical CSV |
| `/api/v1/shadow/forecasts` | totals{...}, horizons, models, modes, manifest, checksums, items[{snapshotId,mode,modelId,modelVersion,variant,horizon,originDate,targetDate,forecastValue,status,inputDataVersion,generatedAt}] | shadow JSONL + manifest |
| `/api/v1/shadow/reconciliations` | total, items[{snapshotId,modelId,horizon,targetDate,forecastValue,actual,absoluteError,signedError}] | shadow JSONL |
| `/api/v1/shadow/monitor` | forecasts, reconciled, pending_future, missing_actual, errors, status_counts, metrics[], comparison[] | shadow JSONL (существующий read-only `monitor()`) |

## 3. Query-параметры (allowlist)

| Параметр | Правило | Ошибка |
|---|---|---|
| `limit` | целое 1…1000 | `400 INVALID_QUERY` |
| `from`, `to` | `YYYY-MM-DD`; `from <= to` | `400 INVALID_QUERY` |
| `horizon` | `1` или `3` | `400 INVALID_QUERY` |
| `mode` | `shadow` (по умолчанию) или `replay` | `400 INVALID_QUERY` |

## 4. Семантика

- **UI-2.2:** `/api/v1/shadow/forecasts` по умолчанию возвращает только `mode=shadow`; историческая диагностика (`mode=replay`) запрашивается явно и отображается отдельным блоком с пометкой «историческая диагностика».
- **UI-2.2.1:** агрегаты `shadow` и `replay` никогда не суммируются: `shadow/forecasts` возвращает `totals` только для выбранного режима (по умолчанию `shadow`) и `modeTotals.{shadow,replay}` раздельно; `overview` содержит отдельные `data.shadow` и `data.replay`; `shadow/reconciliations` фильтруются по `mode` и возвращают поле `mode`.
- **UI-2.2.1:** любая ошибка API (включая ошибки маршрутов) возвращает `error.eventId` — идентификатор события для корреляции с серверным логом; сырые сообщения, пути и SQL в лог не пишутся.
- **UI-2.2.1:** `coverage.nullPolicy = "REJECTED_AS_CORRUPTED"` — нечисловое/`NULL` значение в canonical CSV трактуется как повреждение источника (ошибка), а не как пропуск полноты; поэтому `nullValues` при нормальной работе равен 0.
- **UI-2.2.1:** `manifest` валидируется строго: версия из allowlist (`shadow-mode/v1`, `shadow-mode/v1.1`), `dataset_checksum` — 64 hex (SHA-256), горизонты ⊆ {1, 3}, корректные `created_at`, `alpha`, `limit_percent`, `min_train_days`.
- **UI-2.2:** `overview.data.provenance` содержит `fileChecksum` (исходный CSV), `normalizedChecksum` (нормализованные точки), `manifestDatasetChecksum`, `manifestStatus` и `freshness` (`MATCH` / `STALE` / `NOT_CONFIRMED`). `meta.checksum` — всегда checksum исходного файла.
- **UI-2.2:** `Origin` разбирается через `URL`, сравнивается целиком; `null`, мусор, иные схемы и порты → `403`. Same-origin допускается только при точном совпадении с `Host`.

- `forecastValue: null` означает отсутствие значения; ноль не подставляется.
- `not_available` возвращается, когда источник пуст или диапазон не содержит наблюдений.
- `semantics: "PROVISIONAL"` — бизнес-семантика целевой метрики не подтверждена.
- Режимы `shadow` и `replay` в снапшотах не смешиваются.

## 5. Безопасность

- Клиенту не отдаются: абсолютные пути, stack trace, SQL, `dimension_1`/`dimension_2`, PII.
- Только GET; POST/PUT/PATCH/DELETE → 405.
- CORS не открывается: предполагается same-origin через Vite proxy.
- Ответы с `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- Заголовок bind: `127.0.0.1` (проверено фактически).
- **Host allowlist (UI-2.1):** `127.0.0.1`, `localhost`, `[::1]`, `::1` (с портом или без) — защита от DNS rebinding; иное → `403 HOST_NOT_ALLOWED`.
- **Origin allowlist (UI-2.1):** `http://127.0.0.1:5173`, `http://localhost:5173`, loopback-источники; посторонние → `403 ORIGIN_NOT_ALLOWED`. Запросы без `Origin` (curl, серверные вызовы) разрешены.
---

## 6. Итоговый аудит

Полная фиксация контракта, безопасности и ограничений: [ui-2-final-audit.md](ui-2-final-audit.md). SQLite API в контракт не входит (NOT_IMPLEMENTED).

---

## 7. Расширения UI-3

- GET /api/v1/history: добавлен summary (sum/average/max/min/calendarDays/observationDays/missingDays/complete/formula) — агрегаты только по доступным фактическим значениям.
- GET /api/v1/history/coverage: добавлены missingDates, gapIntervals[{from,to,length}], maxGapLength, illRatio, illRatioFormula.
- Реализация UI-3 описана в [ui-3-implementation.md](ui-3-implementation.md); итоговый аудит — [ui-3-final-audit.md](ui-3-final-audit.md).
