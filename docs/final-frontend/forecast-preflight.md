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

---

# FINAL-3.3.2.0 — повторный preflight перед реализацией страницы

**Дата:** 2026-11-28 · **Режим:** только чтение (изменений кода нет)

## 1. Baseline (FACT)

| Проверка | Значение |
|---|---|
| HEAD | `ef1f3ff34c4b34a34d8b7b77395521b9891ce775` («pre final») |
| origin/main | тот же коммит — совпадает |
| Branch | `main` |
| staged / unstaged / untracked | **0 / 0 / 0** — рабочее дерево полностью чистое |
| Ожидаемый ранее baseline | `9a6f9fd…` — **перекрыт внешним коммитом** «pre final» |
| Что вошло в коммит | 14 файлов: `src/web/routing.ts` (54+), `tests/web/forecast-routing.test.ts` (120), `tests/web/history.test.ts` (198), `tests/web/ui-7-0-1-routing.test.ts` (1), `src/web/main.ts`, `src/web/pages/history.ts`, `docs/ui/reference/pages/history.html` и 6 отчётов `docs/final-frontend/` |
| `diff.txt` | отсутствует |
| Артефакт в HEAD (FACT, не мой) | файл с именем `c --noEmit` добавлен в коммит `ef1f3ff` (след прежних shell-команд, аналог прежнего `-files --others --exclude-standard`) |
| Git-операции этого этапа | не выполнялись |

Прежние пользовательские изменения FINAL-2/2.1 более не видны как незакоммиченные: они вошли в коммит `ef1f3ff` (FACT).

## 2. Готовность маршрутизации (FACT)

`src/web/routing.ts` (195 строк) уже содержит маршрут Forecast:

- `PAGES` включает `{ key: "forecast", label: "Прогноз" }` (позиция 5, после `provenance`);
- `Route.segmentCount` — число сегментов hash;
- `parseHash` помечает `isForecast` для страницы `forecast`;
- `normalizeForecastParams` требует **ровно три сегмента** и допустимые `mode`/`horizon`, иначе `mode: null`, `horizon: null`, `valid: false`, `fallback: "#forecast/replay/1"`;
- `forecastHref(mode, horizon)` возвращает один из четырёх канонических адресов.

Тесты маршрута: `tests/web/forecast-routing.test.ts` (120 строк) — проходят.

## 3. Точка входа и dispatch (FACT)

- `src/web/main.ts` — **197 строк** (лимит 200); ветки страниц: `forecast-quality`, `forecast-diagnostics`, `history`, `quality`, `provenance`, иначе — **Overview** (строка 154: `} else {`) .
- Следствие: до реализации `#forecast/...` временно рендерит Overview — известное промежуточное поведение.
- `src/web/app-render.ts` — **отсутствует**, должен быть создан для выноса dispatch (согласовано ранее).
- `src/web/pages/forecast.ts` — отсутствует.

## 4. Повторная проверка API-контрактов (FACT)

| Проверка | Результат |
|---|---|
| `GET /api/v1/forecasts` | присутствует (`routes.ts`), параметры `mode` (обяз.), `horizon` (обяз.), `model` (опц., allowlist), `limit` 1..1000 (по умолч. 200) |
| `GET /api/v1/shadow/reconciliations` | присутствует, параметры `mode` (по умолч. `shadow`), `horizon` (опц. 1\|3), `limit` (по умолч. 60) |
| `ForecastItemDto` | **12 полей**, без `actual`, ошибок, per-record checksum, target, p10/p90 |
| `ReconciliationModel` | `snapshotId, modelId, horizon, targetDate, forecastValue\|null, actual, absoluteError, signedError` + `total`, `unknownSnapshots` |
| Provenance | только у снапшотов (`datasetChecksums`, `datasetVersionWarning`, `manifestStatus`, `manifestDatasetChecksum`, `freshness`, `shadowFileChecksums`, `meta.checksum`); у сверок только `meta.source`/`meta.note` |

Контракты не изменились относительно FINAL-3.1/3.2.

## 5. Компоненты для повторного использования (FACT)

Экспортируются: `appShell`, `pageHeader`, `sidebar`, `topbar`; `card`, `chartCard`, `kpiCard`, `kpiGrid`, `provenanceDrawer`, `statusBadge`; `dataTable`, `completenessCalendar`, `sparkline`; `emptyState`, `errorState`, `loadingState`; `barChart`, `lineChart`; `escapeHtml`, `formatDate`, `formatNumber`, `formatPercent`, `isSafeHref`, `safeHref`, `statusClass`, `statusLabel`, `trusted`. Новых компонентов не требуется; график в FINAL-3 не создаётся.

## 6. Тестовый baseline (FACT)

- `tests/web` — 10 файлов, прогон: **212 pass / 0 fail**;
- `bunx tsc --noEmit` — 0 ошибок;
- лимиты тестов: `forecast-routing.test.ts` 120 (≤120), `history.test.ts` 198 (≤200).

## 7. Reference-генератор (FACT)

- `tools/reference/fixtures/common.ts` (63 строки) содержит **собственный** `PAGES` из **6** записей (без `forecast`) и тип `PageKey`;
- `render-page.ts` (58) — `BUILDERS: Record<PageKey, …>` (2 упоминания);
- `generate.ts` (51) обходит `PAGES` (8 упоминаний) и пишет индекс + страницы;
- навигация reference-страниц строится из всех `PAGES` → добавление Forecast изменит **все** сгенерированные файлы (индекс + 6 страниц + новая).

Это заранее согласовано для FINAL-3.3.2.6 (расширение allowlist: `fixtures/common.ts`, `docs/ui/reference/index.html`, `docs/ui/reference/pages/forecast.html`, перегенерация шести страниц).

## 8. План файлов и лимиты (2 00 строк)

| Файл | Действие | Строк сейчас → план |
|---|---|---|
| `src/web/app-render.ts` | создать (dispatch + page helpers) | 0 → ≤200 |
| `src/web/main.ts` | сократить до тонкой точки входа | 197 → ≤80 |
| `src/web/pages/forecast.ts` | создать (страница) | 0 → ≤200 |
| `src/web/pages/forecast-*.ts` | условно (только при реальном превышении) | 0 → ≤200 |
| `tests/web/forecast.test.ts` | создать | 0 → ≤200 |
| `tools/reference/fixtures/forecast.ts` | создать (FIXTURE, синтетика) | 0 → ≤90 |
| `tools/reference/fixtures/common.ts` | +1 запись PAGES | 63 → ≤70 |
| `tools/reference/render-page.ts` | +1 builder | 58 → ≤62 |
| `tools/reference/generate.ts` | только при необходимости | 51 |
| `docs/ui/reference/index.html`, `pages/forecast.html`, 6 существующих страниц | генерируются | — |
| `docs/final-frontend/forecast-implementation.md` | отчёт FINAL-3.3.2 | — |

`src/web/pages/forecast-diagnostics.ts` (348 строк) **не изменяется** — декомпозиция вне scope.

## 9. Риски

| Приоритет | Риск | Митигация |
|---|---|---|
| P1 | `main.ts` 197/200 → добавление ветки Forecast превысит лимит | вынос dispatch в `app-render.ts`; `main.ts` только точка входа |
| P1 | Гонки запросов между двумя блоками | `selectionGeneration` + независимые `snapshotsRequestSeq`/`reconciliationsRequestSeq` (контракт FINAL-3.2.1) |
| P1 | Reference-генератор меняет 8 файлов | согласованный allowlist FINAL-3.3.2.6, генерация только через `generate.ts` |
| P2 | Промежуточный рендер Overview на `#forecast/...` | устраняется подключением страницы на этапе dispatch |
| P2 | Артефактные файлы в репозитории (`c --noEmit`) | не трогать; зафиксировано как внешнее |
| P3 | `forecast-quality`/`diagnostics` используют мягкие дефолты `forecastParams` | Forecast использует **строгий** `normalizeForecastParams`, поведение других страниц не меняется |

## 10. Ограничения и NOT_VERIFIED

- **NOT_VERIFIED:** фактическое содержимое ответов `/api/v1/forecasts` и `/shadow/reconciliations` на живых данных (не вызывались; будут проверены на этапах 3.3.2.5/3.3.2.8);
- **NOT_VERIFIED:** браузерная отрисовка (этап 3.3.2.8);
- ограничения контракта: нет `actual`/ошибок в снапшотах, нет per-record checksum, нет p10/p90, нет h7/h14, нет финансовых показателей, нет серверной пагинации и фильтра дат.

## 11. Решение

**`GO_WITH_LIMITATIONS`** — маршрутизация готова, контракты подтверждены, baseline зелёный (212 pass, tsc 0). Реализация возможна в согласованном scope при обязательном выносе dispatch в `src/web/app-render.ts` и соблюдении лимита 200 строк.

**Остановка: реализация (3.3.2.1 Dispatch) не начата.**
