# UI-0 — предложение архитектуры

Метки: **FACT** — проверено; **INFERENCE** — вывод; **ASSUMPTION** — допущение; **NOT_IMPLEMENTED** — не реализовано.

---

## 1. Исходные ограничения (FACT)

- HTTP-сервера в DSS **нет**: Hono не установлен, `Bun.serve` не используется, `dependencies` пусты.
- UI-слоя нет: `src/web`, `src/api`, `public` отсутствуют.
- SQLite и canonical CSV — внутренние read-источники; Superset из frontend не вызывается.
- Shadow API уже изолирован (`store/runner/pipeline/lock`), `--mode all`/`replay` не должны быть доступны.
- Семантика target `PROVISIONAL`; production baseline `rolling_7_day_mean`; candidate — Variant B, h1/h3.

## 2. Предлагаемая структура (INFERENCE)

```text
src/
  api/                     ← HTTP-слой (Hono)
    app.ts                 ← создание приложения, CORS/Origin/rate-limit
    routes/                ← dashboard, history, forecasts, models, shadow, data-quality, system
    services/              ← read-модели: historyService, shadowService, qualityService, dataQualityService
    serializers/           ← DTO → JSON (единые поля, generated_at, provenance)
    schemas/               ← валидация query/body (zod-совместимая ручная проверка или zod)
  web/                     ← UI (статические модули)
    app/                   ← bootstrap, роутер (hash/history), layout
    pages/                 ← overview, history, forecasts, models, shadow, scenarios, events, data-quality, ingestion, reports
    components/            ← AppShell, Sidebar, Topbar, KpiCard, DataTable, ChartCard и др.
    styles/                ← tokens.css, layout.css, components.css, charts.css, responsive.css
    services/              ← fetch-клиент к /api/v1 (типизированный)
    contracts/             ← DTO-типы (зеркало server schemas)
    hooks/                 ← useFetch, useFilters, useDateRange
tests/
  api/                     ← контрактные тесты DTO/эндпоинтов
  web/                     ← unit тесты форматтеров/агрегаций
```

**Важно (INFERENCE):** добавление `hono` в `dependencies` — изменение манифеста зависимостей; требует отдельного согласования (ТЗ п. 2.1 прямо требует API DSS). Альтернатива без зависимости — `Bun.serve` с ручным роутингом; рекомендую Hono как заявлено в стеке проекта, но решение за владельцем.

## 3. Слои и ответственность

| Слой | Делает | Не делает |
|---|---|---|
| API read services | читают SQLite (read-only), canonical CSV, shadow JSONL; считают агрегаты (MAE/WAPE/Bias, покрытие) | не меняют данные; не вызывают Superset |
| API write services (shadow) | вызывают `runShadowMode`/`reconcile`/`monitor` с lock и checksum | не принимают произвольные аргументы; не запускают `all`/`replay` |
| Serializers | единые DTO, `generated_at`, `source`, `provenance` | не содержат PII |
| Web | отображает DTO, фильтры, графики | не считает бизнес-метрики, не подставляет нули |

## 4. Read-модели (предложение)

| DTO | Поля | Источник |
|---|---|---|
| `OverviewDTO` | period, days, lastActualDate, lastActualValue, h1, h3, mae, wape, bias, pending, reconciled, errors, baseline, candidate, semanticsStatus, generatedAt | canonical CSV + shadow |
| `HistoryDTO` | points[{date, value, status, provenance}], coverage{gaps, duplicates, partialDays} | canonical CSV |
| `ForecastDTO` | horizons[{horizon, available, modelId, modelVersion, origin, target, value, status}], timeline[{date, actual, baseline, candidate, pending}] | shadow snapshots |
| `ModelQualityDTO` | perModelHorizon[{model, horizon, n, mae, wape, bias}], mode (`shadow`/`replay`), generatedAt | reconciliations |
| `ShadowSummaryDTO` | forecasts, reconciled, pending, missing, errors, conflicts, fallbacks, invalids, lock, manifest | shadow store |
| `ScenarioDTO` | id, name, kind, status (`NOT_IMPLEMENTED`) | `scenarios` (пусто) |
| `EventDTO` | eventDate, type, status, evidence, planned/actual, expectedEffect, verification | `domain_events` |
| `DataQualityDTO` | coverage, duplicates, nulls, statuses, extractionRuns | CSV + SQLite |

## 5. Эндпоинты (предложение, проверить на дубли)

GET: `/api/v1/dashboard/overview`, `/history`, `/history/coverage`, `/forecasts`, `/forecasts/timeline`, `/models/quality`, `/shadow/summary`, `/shadow/runs`, `/shadow/snapshots`, `/shadow/reconciliations`, `/scenarios`, `/events`, `/data-quality`, `/system/health`.
POST (только контролируемые): `/shadow/run` (mode=`shadow`), `/shadow/reconcile`, `/shadow/monitor`.
Запрещено: любые параметры, ведущие к `all`/`replay`; произвольные пути/команды.

## 6. Безопасность (INFERENCE)

- CORS allowlist (localhost + явно заданный origin), `Origin`-проверка на POST.
- Rate limit (in-memory token bucket) для POST; лимит тела запроса.
- Никаких shell/CLI-вызовов из API: только прямые вызовы функций.
- readJsonl fail-closed; checksum canonical CSV обязателен для shadow-операций.
- Логи без PII; ответы без `dimension_1`/`dimension_2` сырых значений.
- Аутентификация пользователя не добавляется (по ТЗ); доступ ограничивается сетью.

## 7. Дизайн-система (INFERENCE, детали — UI-1)

- Токены: `--ds-sidebar` (тёмно-зелёный), `--ds-canvas`, `--ds-card`, `--ds-accent`, `--ds-danger`, `--ds-warning`, `--ds-info`, радиусы, spacing, тени, типоразмеры.
- Компоненты: `AppShell`, `Sidebar`, `Topbar`, `PageHeader`, `KpiCard`, `StatusBadge`, `FilterBar`, `DateRangeSelector`, `ChartCard`, `DataTable`, `EmptyState`, `LoadingState`, `ErrorState`, `DataQualityIndicator`, `CompletenessCalendar`, `Timeline`, `ModelComparisonTable`, `ForecastHorizonSelector`, `EventMarker`, `ProvenanceDrawer`.
- Графики: SVG без внешних зависимостей (как history.js darkStore), фиксированный viewBox, responsive.
- Статусы: `NOT_AVAILABLE`, `PARTIAL`, `PROVISIONAL`, `PENDING`, `FALLBACK`, `INVALID`, `CONFLICT`.

## 8. Этапы и проверки

| Этап | Результат | Проверки |
|---|---|---|
| UI-1 | design system + playground на fixture | разрешения 5 шт., токены, без реальных данных |
| UI-2 | read-only API + health/overview/history/data-quality | контрактные тесты, SQLite integrity, PII |
| UI-3 | история + графики | агрегации, пропуски, provenance |
| UI-4 | прогнозы и качество | реальные h1/h3, разделение replay/shadow |
| UI-5 | shadow-операции | lock, idempotency, запрет all/replay |
| UI-6 | сценарии/события | только подтверждённые факторы, NOT_IMPLEMENTED |
| UI-7 | e2e, responsive, security, final report | 20 критериев приёмки |

## 9. Риски

1. Добавление Hono требует согласования зависимостей.
2. Сценарии/интервалы/фактические события отсутствуют — UI-6 будет частично `NOT_IMPLEMENTED`.
3. `daily_metrics` содержит 5 срезов — обязателен фильтр `20624`.
4. Смешение replay и shadow — обязательная маркировка источника.
5. PII в dimension values — обязательная маскировка на API.

## 10. Открытые вопросы к владельцу

1. Согласовать добавление `hono` (или разрешить `Bun.serve`).
2. Подтвердить границы UI-6: только конструктор сценариев + отображение пустых таблиц, без расчёта.
3. Подтвердить, что UI-5 вызывает shadow-операции только на локальном стенде (не на production-данных).
4. Согласовать формат хранения UI-клиента (статические модули без сборщика vs Vite).
---

## 11. UI-0.1 — дизайн-система и стек (FACT/INFERENCE)

### 11.1. Стек (по решению владельца)

- Vite + TypeScript + нативные ES-модули, без React/Vue на MVP.
- Сборка `src/web` обслуживается Hono (`serveStatic`).
- Hono разрешён к добавлению в `dependencies`.
- Bind `127.0.0.1`; UI-5 — только локальный стенд.

### 11.2. Токены (FACT, перенос из darkStore)

Базовые: `--ds-bg #f4f6f5`, `--ds-card #fff`, `--ds-line #e4eae6`, `--ds-ink #18221e`, `--ds-muted #69766f`, `--ds-acc #149447`, `--ds-acc-dark #087638`, `--ds-warn #b42318`, `--ds-amber #d79b2d`, `--ds-info #175cd3`, `--ds-nav #111a18`, `--ds-nav-text #d7e0db`, `--ds-shadow`, `--ds-radius 15px`, `--ds-radius-sm 10px`, `--ds-sidebar 246px`.

Дополнительно для DSS: `--ds-pending` (янтарный), `--ds-provisional` (синий info), `--ds-fallback` (янтарный), `--ds-conflict` (красный), `--ds-not-available` (серый muted).

### 11.3. Breakpoints (FACT) и контрольные разрешения (ТЗ)

| Breakpoint darkStore | DSS поведение | Контроль ТЗ |
|---|---|---|
| >1180 | sidebar 246px, 2-колоночные сетки | 1440×1000, 1280×800 |
| ≤1180 | sidebar 218px, сетки 1fr 1fr | 1024×768 |
| ≤820 | off-canvas sidebar + scrim | 768×1024 |
| ≤560 | компактные отступы, скрытие второстепенных кнопок | 390×844 |

### 11.4. Файлы стилей (UI-1)

`src/web/styles/tokens.css`, `layout.css`, `components.css`, `charts.css`, `responsive.css`; все значения — через CSS variables, без локальных цветов в компонентах.

### 11.5. Графики (FACT)

darkStore использует нативный `svg.chart` с `viewBox` и `min-width:320px`, без библиотек. DSS повторяет подход: SVG-компоненты `LineChart`, `BarChart`, `Sparkline`, `CompletenessCalendar`; responsive через `viewBox`, без ломания layout.

### 11.6. Ограничения UI-1

- No control operations: только отображение.
- No mock-data в production-пути: fixture-данные только в `playground` с явной маркировкой `FIXTURE`.
- Не изменять canonical CSV, SQLite, shadow JSONL.
- PII gate на новые файлы.