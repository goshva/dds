# UI-0 — карта источников и экранов

Карта: источник → страница → компонент → адаптер/ограничения.
Метки: **FACT** / **INFERENCE** / **UNCONFIRMED**.

---

## 1. Сводная карта источников

| Источник | Что содержит | Страницы | Готовность |
|---|---|---|---|
| canonical CSV (`data/processed/.../canonical_daily_delivered_orders.csv`) | 906 дней, `date, value, slice, dataset, run, quality_status` | Overview, История, Качество данных, Прогнозы | FACT |
| SQLite `daily_metrics` | 6 881 строк, 5 срезов | История (аудит), Data quality | FACT; фильтр `slice_id=20624` |
| SQLite `domain_events` | 43 события, все `planned` | События, таймлайн | FACT |
| SQLite `scenarios` / `scenario_results` | пусто (0) | Сценарии | FACT — NOT_IMPLEMENTED |
| SQLite `forecast_runs/results/evaluations` | пусто (0) | Прогнозы (диапазоны), Качество | FACT — нет данных |
| shadow `forecasts.jsonl` | 3 508 снапшотов (replay + shadow) | Прогнозы, теневой режим, Качество | FACT |
| shadow `reconciliations.jsonl` | 3 502 записи | Качество, теневой режим | FACT |
| shadow `manifest.json` | версия, горизонты, модели, alpha/limit | теневой режим | FACT |
| shadow `.shadow.lock` | состояние блокировки | теневой режим | FACT (read) |
| отчёты `reports/forecasting/stage-3.4.*` | доказательства, метрики | Отчёты и доказательства | FACT (статические ссылки) |

## 2. Mapping по страницам

### Overview
| KPI | Источник | Расчёт |
|---|---|---|
| дней истории / период | canonical CSV | count/min/max |
| последний факт | canonical CSV | last date+value |
| h1 / h3 forecast | shadow snapshots (mode=`shadow`, последний origin) | read |
| pending / reconciled / errors | shadow store | count |
| MAE / WAPE / Bias | reconcile-записи | **серверный** расчёт (не frontend) |
| baseline / candidate status | manifest + snapshots | read |
| semantics status | константа `PROVISIONAL` | read |

### История (h=дневной ряд)
| Элемент | Источник | Ограничение |
|---|---|---|
| дневная детализация | canonical CSV | 906 строк, серверная пагинация |
| недельная/месячная агрегация | canonical CSV | additive — сумма; ratio — взвешивание по знаменателю (INFERENCE: для одной метрики знаменатель не нужен) |
| календарь полноты | canonical CSV | пропуски — явно, не нули |
| статусы | `quality_status` | actual/derived/estimated/planned/unknown — из типов DSS |
| источник | provенанс строки | `source_slice_id`, `source_run_id` |

### Прогнозы
| Элемент | Источник | Ограничение |
|---|---|---|
| baseline/candidate значения h1/h3 | shadow snapshots | только реальные; отсутствующие — NOT_AVAILABLE |
| model_id/version/origin/target/checksum | snapshot fields | отображать как есть |
| факт после target | canonical CSV | reconcile уже содержит |
| горизонты h7/h14 | нет снапшотов | **не показывать** или показывать `NOT_IMPLEMENTED` |
| интервалы p10/p90 | `forecast_results` пусто | не показывать |

### Качество моделей
| Метрика | Источник | Ограничение |
|---|---|---|
| MAE/WAPE/Bias/n | reconciliations | серверный расчёт |
| common pairs / excluded | reconcile | серверный расчёт |
| step-exact/cumulative | отчёты Stage 3.4.1–3.4.7 | статические артефакты, не live |
| stability | `stability-summary.json` (stage-3.4.7) | статический артефакт |
| leakage/reproducibility | stage-3.4.5–3.4.8 JSON | статические |

### теневой режим
| Элемент | Источник | Действие |
|---|---|---|
| summary (forecasts/reconciled/pending/errors) | store + pipeline | read |
| runs | JSONL группировка по `run_id` | read |
| snapshots/reconciliations | JSONL | read + пагинация |
| lock | `.shadow.lock` | read |
| «Создать snapshots» | `--mode shadow` | POST → `runShadowMode` (только shadow) |
| «Reconcile» | `--mode reconcile` | POST → `reconcile` |
| «Обновить monitor» | `--mode monitor` | POST → `monitor` |
| `--mode all` / `replay` | — | **запрещено** |

### Сценарии и события
| Элемент | Источник | Ограничение |
|---|---|---|
| сценарии | `scenarios` (пусто) | конструктор + `NOT_IMPLEMENTED` для расчёта |
| события | `domain_events` | 43 planned; фактические — нет |
| эффект | `expected_effect`, `verification_result` | показывать раздельно; причинность не утверждать |

### Качество данных / История загрузок
| Элемент | Источник |
|---|---|
| покрытие, пропуски, дубликаты | canonical CSV + `daily_metrics` |
| extraction runs | `extraction_runs` (2) |
| quality_status | `daily_metrics`, snapshot manifest |

### Отчёты и доказательства
| Элемент | Источник |
|---|---|
| перечень отчётов | `reports/forecasting/**` |
| checksums | отчёты/JSON |

## 3. Адаптеры (INFERENCE)

| Адаптер | Вход | Выход |
|---|---|---|
| `historyReader` | canonical CSV | `HistoryPointDTO[]` (date, value, status, provenance) |
| `shadowReader` | JSONL | `ShadowSummaryDTO`, `RunDTO[]`, `SnapshotDTO[]` |
| `qualityReader` | reconciliations | `ModelQualityDTO` (серверный MAE/WAPE/Bias) |
| `eventsReader` | `domain_events` | `EventDTO[]` (planned/actual/evidence раздельно) |
| `dataQualityReader` | CSV + `daily_metrics` | `CoverageDTO` (пропуски, дубликаты, статусы) |
| `exportCsv` | история | CSV после PII-проверки |

## 4. Недоступно без backend-расширения (FACT)

- Сценарии: `scenarios`/`scenario_results` пусты, движка нет.
- Прогнозные интервалы: `forecast_results` пусто.
- Фактические эффекты событий: нет фактических `domain_events`.
- Автоматическое обновление: только ручной сбор Stage 3.4.9 (cron не включён).

## 5. Соответствие компонентам дизайна (ссылка на darkStore)

| Паттерн darkStore | Применение в DSS UI |
|---|---|
| карточка «Полнота данных» (PLAN_STRATEGY2) | `DataQualityIndicator`, `CompletenessCalendar` |
| метка источника метрики (`entered/inherited/default`) | `ProvenanceDrawer`, бейджи источника |
| статусы `partial/in_progress/complete` (history.js) | статусы недель/дат в календаре |
| взвешивание ratio по заказам (history.js) | агрегация ratio в истории |
| `[Н/Д]` для неизмеренных значений | `StatusBadge` + `NOT_AVAILABLE` |
| сравнение факт/план с `null` | `ModelComparisonTable` (без нулей вместо отсутствия) |
| бенчмарки с источником и датой | не используется на MVP (в DSS бенчмарков нет) |
---

## 6. UI-0.1 — маппинг компонентов darkStore → DSS

Источник: `index.html` darkStore (селекторы и токены, см. preflight-audit.md, раздел 9).

| Компонент DSS | Опора в darkStore | Адаптация |
|---|---|---|
| `AppShell` | `.app` + `.main` | `margin-left:var(--sidebar)` |
| `Sidebar` | `.sidebar`, `.brand`, `.nav a` | токены `--nav`, `--sidebar`; off-canvas на ≤820px |
| `Topbar` | `.topbar` | `min-height:76px`; на мобильном 68px |
| `PageHeader` | `h1`, `.sub` | 22px/780 + 12px muted |
| `KpiCard` | `.kpi`, `.kpi-grid` | 2 колонки, gradient, radius 11px |
| `ChartCard` | `.card`, `.chart-block`, `svg.chart`, `.chart-legend` | SVG без внешних библиотек |
| `DataTable` | таблицы внутри `.card` | скролл в контейнере |
| `StatusBadge` | цветовые токены `--good/--warn/--amber/--info` | семантика DSS: `PROVISIONAL`, `NOT_AVAILABLE`, `PENDING`, `FALLBACK`, `CONFLICT` |
| `FilterBar` / `DateRangeSelector` | `.top-actions`, `.cycle-select` | компактные контролы, 44px на мобильном |
| `CompletenessCalendar` | карточка «Полнота данных», статусы `partial/complete` (history.js) | без наследования значений |
| `ProvenanceDrawer` | `metric_source` (`entered/inherited/default`) | источник каждого числа |
| `ModelComparisonTable` | `compareWithPlan` (fact vs plan, `null`) | без нулей вместо отсутствия |
| `EmptyState` / `LoadingState` / `ErrorState` | не выделены в darkStore | новые компоненты DSS |
| `ForecastHorizonSelector` | нет аналога | новый (h1/h3, `NOT_AVAILABLE`) |

Правило: токены darkStore переиспользуются как визуальная база, но статусы и бизнес-семантика DSS определяются контрактами DSS, а не darkStore.