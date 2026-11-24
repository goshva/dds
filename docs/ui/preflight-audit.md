# UI-0 — аудит исходного состояния

**Дата:** 2026-11-24 · **HEAD:** `505f70a24fecbb9e5afc190059cf8a1f0fe5301f` · **Ветка:** `main` · **Дерево:** чистое
**Статус:** только аудит. Production-код не изменялся.

Метки: **FACT** — проверено кодом/данными; **INFERENCE** — вывод; **ASSUMPTION** — допущение; **UNCONFIRMED** — не проверено.

---

## 1. DSS: что есть (FACT)

| Слой | Состояние |
|---|---|
| `src/forecasting/storage/interfaces` | `RawRepository`, `MetricsRepository`, `FeaturesRepository`, `EventsRepository`, `ForecastRepository`; типы статусов `EvidenceStatus`, `DataStatus`, `QualityStatus`, `MetricKind`, `ConfidenceStatus`, `EventStatus`, `ScenarioKind` |
| SQLite (`data/forecast/forecasting.sqlite`) | 13 таблиц: `daily_metrics` 6 881, `domain_events` 43, `extraction_runs` 2, `raw_extractions` 8, `shops` 1; **пусты**: `scenarios`, `scenario_results`, `forecast_runs`, `forecast_results`, `forecast_evaluations`, `forecast_features`, `audit_log` |
| canonical CSV | 906 строк (2024-06-01 … 2026-11-23), колонки `date, shop_no, metric, value, source_slice_id, source_dataset_id, source_run_id, quality_status` |
| shadow JSONL | `forecasts.jsonl` 3 508, `reconciliations.jsonl` 3 502, `errors.jsonl` отсутствует; manifest `shadow-mode/v1` |
| Shadow API | `runShadowMode`, `reconcile`, `monitor`, lock, store (append-only, fail-closed) |
| CLI | `forecast:*` (db, profile, canonical, history, backtest, refresh, semantics, calendar, diagnostics, shadow) |
| Документы | контракты Stage 3.4.1–3.4.8.1, отчёты Stage 3.1–3.4.9 |
| HTTP-сервер | **отсутствует**: Hono не установлен, `Bun.serve`/`new Hono` не найдены, `dependencies` пусты (только `@types/bun`) |
| UI | **отсутствует**: `src/web`, `src/api`, `public` нет |

## 2. darkStore: что изучено (FACT/UNCONFIRMED)

| Файл | Статус |
|---|---|
| `PLAN_STRATEGY2.md` | **изучен** (FACT): принципы «честных null», `metric_source` (`entered/inherited/default`), гейты с `[Н/Д]`, карточки полноты, `data_quality`, бенчмарки с источником и датой, MAPE `null` + статус |
| `history.js` | **изучен** (FACT): понедельничные недели, взвешивание ratio по заказам, статусы `partial/in_progress/complete`, `compareWithPlan` (fact vs plan, `null` при отсутствии) |
| `index.html` | **не просмотрен в этой сессии** (UNCONFIRMED): дизайн-токены, sidebar, topbar, карточки — требуют отдельного чтения при UI-1 |
| `PRESENTATION.html` | **не просмотрен** (UNCONFIRMED): заявлена «самодостаточная презентация на 13 слайдов» |
| `superset-core.js`, `ds_bridge.js` | **не просмотрены** (UNCONFIRMED) |
| `chrome-extension/*` | **не просмотрены** (UNCONFIRMED) |
| `SUPERSET_BRIDGE.md`, `TODO.md` | **не просмотрены** (UNCONFIRMED) |

Причина: GitHub API rate limit; raw-доступен только для части файлов. Для UI-1 требуется либо локальный клон darkStore, либо точечное чтение `index.html` (дизайн-токены) — это **зависимость этапа UI-1**, а не блокер UI-0.

## 3. Что DSS даёт для UI (FACT)

| Возможность | Источник | Готовность |
|---|---|---|
| История фактов по дням | canonical CSV / `daily_metrics` | есть |
| Покрытие и пропуски | canonical CSV | есть |
| Прогнозы baseline | shadow snapshots (`model_id=rolling_7_day_mean`) | есть |
| Прогнозы candidate | shadow snapshots (`model_id=adaptive_baseline`, h=1/3) | есть |
| Pending / reconciled | shadow store + pipeline | есть |
| Метрики качества | reconcile-записи (MAE/WAPE/Bias по h) | есть |
| Runs / manifest / lock | `data/shadow/7745/` | есть |
| События | `domain_events` (43, все `planned`) | есть, но фактических нет |
| Сценарии | `scenarios`, `scenario_results` | **пусты** — расчётов нет |
| Прогнозные диапазоны p10/p90 | `forecast_results` | **пусто** |
| Оценки прогнозов | `forecast_evaluations` | **пусто** |

## 4. Риски и конфликты (INFERENCE)

1. **Сценарии и события-эффекты** нельзя показывать как расчёт: `scenarios`/`scenario_results` пусты, planned-события не факты. UI-6 — только конструктор и заготовка, без выдуманных чисел.
2. **Бизнес-семантика `PROVISIONAL`** — UI обязан показывать статус, не выдавая прогноз за подтверждённый.
3. **PII**: `daily_metrics.dimension_1` для среза 20404 содержит плейсхолдер персонального имени (маска вместо значения); API не должен отдавать сырые dimension values без маскирования.
4. **Смешение источников**: replay, shadow, backtest и canonical — разные сущности; UI должен маркировать источник каждого числа.
5. **Отсутствие сервера**: UI-2 требует добавить Hono (или иной сервер) — это изменение зависимостей, требует отдельного согласования.
6. **`daily_metrics` содержит 5 срезов** (6 881 строк ≠ 906 дней): API обязан фильтровать `slice_id=20624` и не суммировать срезы.

## 5. Что можно использовать напрямую (FACT)

- Read-репозитории `MetricsRepository`/`EventsRepository`/`ForecastRepository` (нужен read-only сервисный слой).
- `shadow/store.ts` (readJsonl с валидацией), `shadow/pipeline.ts` (reconcile/monitor), `shadow/runner.ts` (только через контролируемый endpoint).
- Типы статусов и `MetricKind` для агрегации (ratio — не среднее без знаменателя).
- `calendar-core` (Europe/Moscow, день недели).

## 6. Что требует адаптера (INFERENCE)

- Превращение `daily_metrics` → дневной ряд 7745 (фильтр slice 20624, дедупликация, сортировка).
- Shadow JSONL → DTO (unknown-типы из JSON).
- `domain_events` → timeline-модель (planned vs actual отдельно).
- CSV-экспорт с PII-проверкой.

## 7. Что невозможно без расширения backend (FACT)

- Расчёт сценариев (нет движка и данных).
- Прогнозные интервалы p10/p90 (нет данных в `forecast_results`).
- Сравнение «ожидаемый vs фактический эффект событий» (нет фактических `domain_events`).

## 8. Вердикт UI-0

Аудит достаточен для архитектуры: DSS имеет все read-источники и shadow-операции; отсутствуют HTTP-сервер, UI, сценарный движок и фактические события. Требуется решение о добавлении Hono и о границах UI-6 (только конструктор/заготовка).
---

## 9. UI-0.1 — дизайн-система darkStore (FACT)

Источник: `index.html` darkStore, 319 262 Б (локальная копия в `C:\Temp\darkstore`, вне репозитория). `chrome-extension/manifest.json` и `popup.html` изучены частично.

### 9.1. Токены (FACT, из `:root`)

| Токен | Значение | Семантика в DSS |
|---|---|---|
| `--bg` | `#f4f6f5` | canvas |
| `--card` / `--surface` | `#fff` | карточки |
| `--surface-soft` | `#f8faf9` | вложенные блоки |
| `--line` | `#e4eae6` | границы |
| `--line-strong` | `#d7e0da` | границы контролов |
| `--ink` | `#18221e` | основной текст |
| `--muted` | `#69766f` | вторичный текст |
| `--acc` / `--green` | `#149447` | акцент |
| `--acc2` / `--green-dark` | `#087638` | акцент тёмный |
| `--green-soft` / `--green-pale` | `#e8f7ed` / `#f2fbf5` | фоны акцента |
| `--warn` | `#b42318` | отрицательный статус |
| `--red` / `--red-soft` | `#e56c7b` / `#fff0f1` | мягкий negative |
| `--amber` / `--amber-soft` | `#d79b2d` / `#fff7e7` | предупреждение |
| `--info` | `#175cd3` | информационный / сценарный слой |
| `--nav` / `--nav-text` | `#111a18` / `#d7e0db` | sidebar |
| `--shadow` | `0 8px 26px rgba(26,48,36,.045)` | тени карточек |
| `--radius` / `--radius-sm` | `15px` / `10px` | скругления |
| `--sidebar` | `246px` | ширина sidebar |

### 9.2. Раскладка (FACT)

| Элемент | Реализация darkStore |
|---|---|
| `.app` / `.main` | `min-height:100vh`; `.main{margin-left:var(--sidebar)}` |
| `.sidebar` | `position:fixed; inset:0 auto 0 0; width:var(--sidebar)`; фон `linear-gradient(180deg,var(--nav),#151e1b)`; padding `22px 14px 16px` |
| `.brand-mark` | 36×36, цвет `#20b45a` |
| `.nav a` | padding `11px 12px`, radius `10px`, font 13px/600, hover `#26342e` |
| `.topbar` | `min-height:76px`, фон `rgba(255,255,255,.94)`, border-bottom |
| `.card` | surface, border `1px solid var(--line)`, radius 15px, shadow, padding `14px 15px` |
| `.card-title` | 16px/760 |
| `.kpi-grid` | `grid-template-columns:repeat(2,1fr)`, gap 8px; `.kpi` gradient `#effaf2→#e5f6e9`, radius 11px |
| сетки | overview `1fr 1.16fr`; middle `1.12fr 1fr`; matrix `1.58fr .92fr` |
| шрифт | `Inter, ui-sans-serif, system-ui, …`, 14px/1.45; h1 22px/780; h2 16px/760; `.sub` 12px |
| графики | `svg.chart{width:100%;min-width:320px;height:auto}`; `.chart-wrap{overflow-x:auto}`; легенда `.chart-legend` |
| таблицы | внутри `.card`, горизонтальный скролл в контейнере |

### 9.3. Адаптив (FACT)

| Breakpoint | Правила |
|---|---|
| `max-width:1180px` | `--sidebar:218px`; content padding 16px; overview/middle → `1fr 1fr`; matrix → `1fr` |
| `max-width:820px` | `--sidebar:0px`; sidebar → off-canvas 260px (`transform:translateX(-100%)`, `.open`), scrim |
| `max-width:560px` | скрытие лишних icon-button, topbar 68px, content padding 10px, gap 10px |

Контрольные разрешения ТЗ (1440/1280/1024/768/390) ложатся в эти breakpoints; в UI-1 добавим проверки на всех пяти.

### 9.4. Интеграционный слой (FACT, не переносим)

- `manifest.json`: MV3, permissions `tabs, scripting, storage`, host_permissions Superset + localhost/127.0.0.1, content_scripts переносят снапшоты в `localStorage`.
- В DSS расширение **не переносится** (по ТЗ): данные берутся только из DSS API.

### 9.5. Осталось непросмотренным (UNCONFIRMED)

- `PRESENTATION.html`, `superset-core.js`, `ds_bridge.js`, `popup.html` (содержимое), `TODO.md`, `SUPERSET_BRIDGE.md` — при необходимости изучаются точечно в UI-1/UI-5.

## 10. Вердикт UI-0.1

Дизайн-система darkStore извлечена в виде токенов, раскладки и breakpoints; монолитный `index.html` в DSS не копируется. Продуктовая семантика DSS (прогнозы, shadow, PROVISIONAL, честные null) отличается и заменяет бизнес-логику darkStore.