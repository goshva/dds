# UI-2 — итоговый аудит (Vite + Hono + read-only API)

**Статус:** `ACCEPTED WITH DOCUMENTED LIMITATIONS` · **Не production-ready** · **Дата фиксации:** 2026-11-24
**Зафиксировано по:** коду репозитория, отчётам UI-2.2…UI-2.2.5.1 и предоставленным результатам запусков.
**Метки:** FACT — проверено по коду/данным; NOT_VERIFIED — не подтверждено; NOT_IMPLEMENTED — не реализовано.

---

## 1. Executive summary

| Утверждение | Статус |
|---|---|
| UI-2 реализован | FACT |
| Hono API работает через `Bun.serve` | FACT (`src/server/index.ts`) |
| Сервер ограничен `127.0.0.1` | FACT (`const HOST = "127.0.0.1"`) |
| Vite используется для frontend | FACT (`vite.config.ts`, scripts `ui:dev`/`ui:build`) |
| Frontend получает реальные данные через API | FACT (proxy `/api` → `127.0.0.1:8787`; canonical CSV 906 дней) |
| API — read-only GET | FACT (7 GET; POST/PUT/PATCH/DELETE → 405) |
| Исправления безопасности и обработки данных UI-2.2.x закрыты | FACT по предоставленным проверкам (раздел 6) |

**Итог:** `ACCEPTED WITH DOCUMENTED LIMITATIONS`. Система **не** называется production-ready; ограничения раздела 9 не маскируются статусом.

## 2. Архитектура (FACT)

```text
браузер → Vite dev server (127.0.0.1:5173) → proxy /api → Hono (Bun.serve, 127.0.0.1:8787)
                                                              ↓
                                    read-only источники: canonical CSV + shadow JSONL
```

| Слой | Файл | Роль |
|---|---|---|
| HTTP-приложение | `src/server/app.ts` | Hono, защитные заголовки, Host/Origin guard, 404, обработчик ошибок |
| Маршруты | `src/server/routes.ts` | 7 GET, запрет изменяющих методов |
| Контракт | `src/server/api.ts` | `ok` / `not_available` / `error`, `SourceError`, `fail()` с `eventId` |
| Источники | `src/server/sources.ts` | read-only чтение canonical CSV и shadow JSONL, строгая валидация |
| Read-модели | `src/server/services/read-models.ts` | overview, history, coverage, shadow forecasts/reconciliations/monitor |
| Запуск | `src/server/index.ts` | `Bun.serve({ hostname: "127.0.0.1", port: DSS_API_PORT ?? 8787 })` |
| Frontend | `src/web/index.html`, `src/web/main.ts` | оболочка, состояния loading / empty / error / not_available |
| API-клиент | `src/web/api/client.ts` | типизированные запросы, timeout 8000 мс, runtime-валидация |
| Сборка | `vite.config.ts` | root `src/web`, host `127.0.0.1`, port 5173, `strictPort`, outDir `../../dist/web` |
| Дизайн-система | `src/web/styles/*.css`, `src/web/components/*.ts` | UI-1 / UI-1.1 / UI-1.2 |

Команды: `bun run api:start`, `bun run ui:dev`, `bun run ui:build`, `bun run ui:test`.

**SQLite API не реализован** (см. раздел 9).

## 3. API Contract (FACT)

| Endpoint | Назначение | Источник | Доступность | Ограничения |
|---|---|---|---|---|
| `GET /api/health` | состояние приложения | процесс | FACT | без данных источников |
| `GET /api/v1/overview` | сводка DSS | canonical CSV + shadow JSONL | FACT | `provenance.freshness` может быть `NOT_CONFIRMED` |
| `GET /api/v1/history` | дневной ряд фактов | canonical CSV | FACT | `limit ≤ 1000`, диапазон дат |
| `GET /api/v1/history/coverage` | покрытие и пропуски | canonical CSV | FACT | `nullPolicy = REJECTED_AS_CORRUPTED` |
| `GET /api/v1/shadow/forecasts` | снапшоты теневого режима | shadow JSONL | FACT | по умолчанию только `mode=shadow`; `replay` — явно |
| `GET /api/v1/shadow/reconciliations` | сверка прогноз ↔ факт | shadow JSONL | FACT | фильтр по `mode`; неизвестные snapshot не классифицируются |
| `GET /api/v1/shadow/monitor` | диагностика | shadow JSONL (read-only `monitor()`) | FACT | файлы не записываются |

**Формат ответов:** `{status:"ok", data, meta{generatedAt, source, readOnly:true}}`; `{status:"not_available", data:null, meta{reason}}`; `{status:"error", error{code, message, eventId}}` — `eventId` **обязателен**.

**Клиент:** timeout 8000 мс, без автоматических повторных запросов, обработка некорректного JSON (`INVALID_JSON`), неожиданных HTTP-статусов (`HTTP_<status>`) и структуры (`INVALID_RESPONSE`).

**Query-параметры:** `limit` (1…1000), `from`/`to` (`YYYY-MM-DD`, реальная календарная дата, `from ≤ to`), `horizon` (`1`/`3`), `mode` (`shadow`/`replay`); нарушение → `400 INVALID_QUERY`.

**Методы:** только GET; POST/PUT/PATCH/DELETE → `405 METHOD_NOT_ALLOWED`.

**Заголовки:** `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.

## 4. Безопасность и изоляция (FACT)

| Область | Реализованное поведение |
|---|---|
| Network binding | только `127.0.0.1` (`Bun.serve`), внешний интерфейс недоступен |
| Host validation | allowlist `127.0.0.1`, `localhost`, `[::1]`, `::1`; иное → `403 HOST_NOT_ALLOWED` (защита от DNS rebinding) |
| Origin validation | разбор через `URL`, полное сравнение с allowlist; `null`, мусор, иные схемы/порты → `403 ORIGIN_NOT_ALLOWED` |
| HTTP methods | только GET; изменяющие → 405 |
| CORS | не включён (same-origin через Vite proxy) |
| Cache / MIME / Referrer | `no-store` / `nosniff` / `no-referrer` |
| API errors | без stack trace, путей, SQL и внутренних подробностей |
| Event correlation | `eventId` во всех путях ошибок (400/403/404/405/500) |
| PII | PII gate; API не отдаёт `dimension_1`/`dimension_2` и персональные поля |
| Shadow storage | fail-closed чтение JSONL (повреждение → `DATA_SOURCE_CORRUPTED`) |
| Manifest | строгая проверка структуры (раздел 5) |
| Replay / Shadow | раздельные режимы, раздельные агрегаты, раздельное отображение |

**Важно:** привязка к loopback **не является** пользовательской аутентификацией. Любой локальный процесс пользователя может обратиться к API; авторизация не реализована (раздел 9, п. 4).

## 5. Целостность данных и происхождение (FACT)

**canonical CSV** (`data/processed/forecasting/7745/canonical_daily_delivered_orders.csv`):
- точный состав и порядок колонок (`date, shop_no, metric, value, source_slice_id, source_dataset_id, source_run_id, quality_status`), без дублей и лишних колонок;
- календарная дата проверяется round-trip; хронология обязательна;
- `shop_no = 7745`, `metric = qty_orders_delivered`, `source_slice_id = 20624`;
- числовой домен: только неотрицательные целые в десятичном формате; отклоняются отрицательные, дробные, экспоненциальные, hex, `NaN`, `Infinity`, небезопасные целые, пустые значения и `NULL`;
- повреждённое значение **не** превращается в ноль; нарушение → `DATA_SOURCE_CORRUPTED`.

**Provenance:**
- `fileChecksum` — SHA-256 исходных байтов файла; `normalizedChecksum` — SHA-256 нормализованных точек; значения различаются и не подменяют друг друга;
- `freshness`: `MATCH` / `STALE` / `NOT_CONFIRMED` — соответствие версии фактов и `manifest` не объявляется автоматически.

**Исправление UI-2.2.5.1 (разбор CSV):**
- глобальный `trim()` удалён;
- удаляется ровно один завершающий разделитель: CRLF целиком либо одиночный LF;
- одиночный завершающий `\r` не удаляется; управляющие символы в любой ячейке → `DATA_SOURCE_CORRUPTED`;
- пустые строки (внутренние и двойной завершающий перевод) отклоняются;
- пробелы и табуляции в значениях не нормализуются;
- заголовки не нормализуются: пробелы отклоняются проверкой точного соответствия колонок.

## 6. Исправления и закрытые замечания

| Этап | Замечание | Исправление | Итог |
|---|---|---|---|
| UI-2.2.1 | Строгая проверка manifest | Схема: allowlist версий, SHA-256, горизонты {1,3}, обязательные поля | CLOSED |
| UI-2.2.1 | Ошибки без `eventId` | Единый контракт ошибок через `fail()` | CLOSED |
| UI-2.2.1 | Смешение агрегатов Shadow и Replay | `totals` по режиму + `modeTotals`; отдельные `shadow`/`replay` в overview; фильтр reconciliations | CLOSED |
| UI-2.2.2 | Слабая проверка `created_at` | Строгий ISO timestamp + round-trip даты и времени | CLOSED |
| UI-2.2.2 | Необязательный `eventId` | `eventId` обязателен на сервере и в клиенте, проверяется `validateResult()` | CLOSED |
| UI-2.2.2 | `?? "shadow"` для неизвестного snapshot | Неизвестные snapshot исключаются и считаются в `unknownSnapshots` | CLOSED |
| UI-2.2.3 | Недостаточная проверка CSV | Точный набор/порядок колонок, дубликаты, даты, shop/metric/slice | CLOSED |
| UI-2.2.4 | Некорректный числовой формат | Только неотрицательные безопасные целые (`/^\d+$/` + `isSafeInteger`) | CLOSED |
| UI-2.2.5 | Глобальный `trim()` | Сохранение исходных символов значений | CLOSED |
| UI-2.2.5.1 | Обработка CR/LF и одиночного CR | Один завершающий разделитель, контроль управляющих символов, запрет пустых строк | CLOSED |

## 7. Регрессионные проверки UI-2.2.5.1

Фактический запуск: `bun C:\Temp\dss-regression-ui2251.ts` → **EXIT=0, 13/13 совпало**. Все CSV — временные; рабочие данные не изменялись.

| № | Кейс | Ожидание | Факт |
|---:|---|---|---|
| 1 | `15` без завершающего перевода строки | PASS | PASS |
| 2 | `15` с LF | PASS | PASS |
| 3 | `15` с CRLF | PASS | PASS |
| 4 | `15 ` (пробел после значения) | REJECT | REJECT |
| 5 | ` 15` (пробел перед значением) | REJECT | REJECT |
| 6 | `15\t` (табуляция) | REJECT | REJECT |
| 7 | `15\r` без LF (`\r` внутри value) | REJECT | REJECT |
| 7.1 | `15\r` как последний символ файла | REJECT | REJECT |
| 8 | два завершающих LF | REJECT | REJECT |
| 9 | пустая строка между записями | REJECT | REJECT |
| 10 | полный CSV с CRLF без завершающего разделителя | PASS | PASS |
| 11 | заголовок с пробелом в конце | REJECT | REJECT |
| 11.1 | заголовок с пробелом внутри колонки | REJECT | REJECT |

Все отклонения — с кодом `DATA_SOURCE_CORRUPTED`.

## 8. Итоговые проверки и целостность

Результаты **предоставленных запусков и отчётов** (в рамках текущей задачи повторно не выполнялись):

| Проверка | Результат |
|---|---|
| Регрессионные проверки UI-2.2.5.1 | 13/13 PASS (EXIT=0) |
| `bun test tests/server` | 69 pass / 0 fail |
| SQLite | `identical: true` |
| Canonical CSV | `8f2b1818da001a42…` |
| `forecasts.jsonl` | `e35fe27b002e42cc…` |
| `reconciliations.jsonl` | `32ccd25604ae78b3…` |
| `manifest.json` | `9d986747771c5fd1…` |
| `errors.jsonl` | не создан |
| Git HEAD | `505f70a…` |
| Branch | `main` |
| Staged | 0 |

Полные прогоны, зафиксированные ранее: `bun test` 648 pass / 4 skip / 0 fail; `bun test tests/server tests/web` 98 pass; `bunx tsc --noEmit` 0 ошибок; `bun run ui:build` exit 0; PII gate PASS.

## 9. Ограничения и NOT_IMPLEMENTED

1. SQLite read-only API не реализован.
2. SQLite API connection — `NOT_IMPLEMENTED`.
3. Read-only режим SQLite — `NOT_VERIFIED`.
4. Пользовательская аутентификация отсутствует.
5. Сценарные расчёты не реализованы.
6. Расчёт эффектов управленческих изменений не реализован.
7. P10/P90 не реализованы.
8. Реальные финансовые эффекты и экономия не рассчитываются.
9. Запуск теневого режима из UI не реализован.
10. Браузерная визуальная проверка не выполнена — UI-7.
11. Полноценный production deployment не подтверждён.

Дополнительно: `daily_metrics` содержит несколько срезов — API использует canonical CSV, а не SQLite; интеграция с Superset из frontend отсутствует; кэширование read-моделей не реализовано.

## 10. Следующие этапы

- **UI-2** — принят с документированными ограничениями.
- **UI-3** — не начат.
- **UI-7** — отдельная задача визуальной проверки в браузере.
- **SQLite read-only API** — отдельная задача, если будет согласована.
- **Сценарный модуль** — отдельный этап согласно утверждённой архитектуре.

Сроки не назначаются; следующий этап не начат.

## 11. Связанные документы

- [preflight-audit.md](preflight-audit.md) — аудит источников и darkStore
- [source-to-ui-mapping.md](source-to-ui-mapping.md) — карта источников и экранов
- [architecture-proposal.md](architecture-proposal.md) — предложение архитектуры
- [api-gap-analysis.md](api-gap-analysis.md) — разрывы API
- [ui-2-implementation.md](ui-2-implementation.md) — реализация UI-2
- [api-contract.md](api-contract.md) — контракт API
- [local-development.md](local-development.md) — локальный запуск
- [design-system-safety.md](design-system-safety.md) — контракт безопасности UI-1.x