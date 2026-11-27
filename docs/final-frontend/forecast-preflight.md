# FINAL-3.0 — Preflight страницы «Прогноз»

**Дата:** 2026-11-27 · **Режим:** только чтение (изменений кода нет) · **HEAD:** `9a6f9fdb13178352aa25a0584003aeab27425566` · **origin/main:** тот же · **Ветка:** `main`

---

## 1. Git integrity (FACT)

| Проверка | Значение |
|---|---|
| `git rev-parse HEAD` / `origin/main` | `9a6f9fd…` — совпадают |
| staged / unstaged / untracked | **0 / 3 / 4** |
| unstaged | `docs/ui/reference/pages/history.html`, `src/web/main.ts`, `src/web/pages/history.ts` — незакоммиченные результаты FINAL-2/FINAL-2.1 |
| untracked | `docs/final-frontend/` (3 отчёта), `tests/web/history.test.ts` |
| `diff.txt` | **файл отсутствует** (`Get-Item` → не найден; в коммите `9a6f9fd` он удалён внешним процессом) |
| Внешние изменения в ходе этапа | не обнаружены |

Чужие изменения зафиксированы и не включаются в работу FINAL-3; Git-операции не выполнялись.

## 2. Структура UI (FACT)

| Путь | Содержимое |
|---|---|
| `src/web/pages/` | 5 файлов: `history.ts` (157), `data-quality.ts`, `provenance.ts`, `forecast-quality.ts` (172), `forecast-diagnostics.ts` (**348** — превышает лимит 200) |
| `src/web/components/` | 6 модулей: `shell` (66), `cards` (53), `charts` (84), `data` (49), `states` (16), `index` (8) |
| `src/web/lib/` | `format.ts` (85) |
| `src/web/api/` | `client.ts` (88) — `ApiResult`, `validateResult`, `ApiClientError`, timeout |
| `src/web/routing.ts` | 147 строк, 6 маршрутов, hash-allowlist |
| `src/web/main.ts` | **197 строк** — близко к лимиту; новая страница требует отдельного модуля |
| `src/server/` | 8 файлов; `services/` — `read-models.ts` (392), `forecasting-read-models.ts` (258) |
| `tests/web` / `tests/server` | 9 / 5 файлов |
| `tools/reference/` | 10 модулей + 7 фикстур; `docs/ui/reference/pages` — 6 эталонов |

## 3. Маршруты и состояния (FACT)

Маршруты: `overview`, `history`, `quality`, `provenance`, `forecast-quality`, `forecast-diagnostics` (**отдельного маршрута `forecast` нет**). Параметры: диапазоны истории `all/30/90/180/365/custom`; диагностика `#forecast-diagnostics/<mode>/<horizon>`.

Состояния: `main.ts` — блоки загрузки/пустоты/ошибки/недоступности; `forecast-diagnostics.ts` — расширенный набор (`loadingState`, `emptyState`, `errorState`, `forecastDiagnosticsLoading`, `forecastDiagnosticsInvalid`, `not_available`); `states.ts` — 16 строк с примитивами.

## 4. Реальные API endpoints (FACT)

`/api/health` · `/api/v1/overview` · `/api/v1/history` · `/api/v1/history/coverage` · `/api/v1/shadow/forecasts` · `/api/v1/shadow/reconciliations` · `/api/v1/shadow/monitor` · `/api/v1/forecasts/quality` · `/api/v1/forecasts` · `/api/v1/forecasts/errors`

Все — GET, read-only; envelope `{ status: "ok" | "not_available" | "error", data, meta }`.

## 5. Ключевое ограничение, обнаруженное в preflight (FACT)

`ForecastItemDto` (endpoint `/api/v1/forecasts`) **не содержит фактического значения, ошибки и checksum записи**:

```
snapshotId, mode, modelId, modelVersion, variant|null, horizon, originDate,
targetDate, forecastValue|null, status, inputDataVersion, generatedAt
```

Факт, прогноз и ошибка в одной строке доступны только через `/api/v1/shadow/reconciliations` (`ReconciliationModel`, `read-models.ts:288-317`):

```
items: snapshotId, modelId, horizon, targetDate, forecastValue|null,
       actual: number, absoluteError: number, signedError: number
```

Следствие: требование «фактическое и прогнозное значение в одной таблице» и «ошибка, только если она уже предоставлена API» **не может быть выполнено на одном `/api/v1/forecasts`**. Ошибки в реконсиляциях считает backend — frontend их не вычисляет.

## 6. Длина файлов под планируемые изменения (FACT)

| Файл | Строк | Решение |
|---|---:|---|
| `src/web/main.ts` | 197 | добавлять только минимальный вызов, не код страницы |
| `src/web/routing.ts` | 147 | добавить маршрут `forecast` с параметрами mode/horizon |
| новый `src/web/pages/forecast.ts` | 0 | страница целиком, ≤200 строк |
| `src/web/pages/forecast-diagnostics.ts` | 348 | **не трогать в FINAL-3** (декомпозиция — отдельная задача) |

## 7. Подтверждённые ограничения

- h1/h3 поддерживаются (`parseEvaluationHorizon`, `[1, 3]`); h7/h14 — нет.
- `mode` и `horizon` обязательны для `/api/v1/forecasts`; пустой результат → `not_available` с кодом `NO_RECORDS_FOR_MODE_AND_HORIZON`.
- `limit` 1..1000, по умолчанию 200; сервер возвращает **последние** N записей, `total` — полное число.
- `model` — необязательный фильтр, валидируется allowlist (неизвестное значение → `INVALID_QUERY`).
- Семантика `qty_orders_delivered` — `PROVISIONAL`; в DTO качества зафиксировано `semantics: "PROVISIONAL"`.
- p10/p90, доверительные интервалы, финансовые эффекты, per-record checksum — в API отсутствуют.
- `meta.generatedAt` — время ответа; checksum ответа — `shadowFileChecksums.forecasts` (может быть `NOT_AVAILABLE`).

## 8. Риски

| Приоритет | Риск | Митигация |
|---|---|---|
| P1 | Требование «факт + прогноз + ошибка в одной таблице» не выполнимо на `/api/v1/forecasts` | использовать реконсиляции как второй источник, явно помеченный; утвердить дизайн до реализации |
| P1 | Смешение Replay и Shadow | каждый блок страницы получает `mode` из URL и не переключается автоматически |
| P2 | `model`-фильтр может вернуть `INVALID_QUERY` при значении вне allowlist | не создавать селектор моделей в FINAL-3 или брать значения только из загруженных записей |
| P2 | `main.ts` 197 строк | логика страницы — в `pages/forecast.ts`, в `main.ts` только вызов |
| P3 | Стухшие данные после смены режима | перерисовка с флагом состояния, без сохранения прошлых записей |

## 9. Решение

**`GO_WITH_LIMITATIONS`.**

Ограничения, требующие согласования до FINAL-3.2/3.3:

1. Таблица «факт + прогноз + ошибка» строится по `/api/v1/shadow/reconciliations` (mode/horizon), а не по `/api/v1/forecasts`; ошибки берутся готовыми из API.
2. Список прогнозов (модель, версия, variant, origin/target, status, inputDataVersion, generatedAt) — отдельный блок по `/api/v1/forecasts`.
3. Селектор моделей в FINAL-3 не реализуется (риск `INVALID_QUERY`); при необходимости — отдельным решением.
4. Дата-диапазон на странице не вводится: сервер отдаёт последние N записей без фильтра по датам.
