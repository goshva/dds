# TPL-4.0 — аудит архитектуры шаблонов

**Дата:** 2026-11-27 · **HEAD:** `c6efe8479a2dc8b4a4823be6abc9aa0889ffe867` · **Ветка:** `main` · **Режим:** только чтение

---

## 1. Preflight (FACT)

| Проверка | Значение |
|---|---|
| `git rev-parse HEAD` | `c6efe8479a2dc8b4a4823be6abc9aa0889ffe867` — совпадает с ожидаемым |
| `git branch --show-current` | `main` |
| `git status --short` | ` M diff.txt` — единственная запись |
| staged | 0 |
| unstaged | 1 (`diff.txt`, 3 563 вставки / 3 558 удалений, 219 637 Б, изменён 17:52) |
| untracked | 0 |
| `git log -5 --oneline` | `c6efe84 disign` → `6e84af1 disign` → `5bce18a disign` → `3c3dba0` → `42bbd2c` |

`diff.txt` не изменялся, не форматировался и не восстанавливался. Изменение внешнее по отношению к этапу. Отказов Git-операций не выполнялось.

Состав репозитория: 22 partials, 6 модулей компонентов, 5 страниц (`src/web/pages`) + `main.ts`, 6 reference-страниц.

## 2. Фактическая архитектура (FACT)

```text
Hono API (src/server)  ──►  src/web/api/client.ts  ──►  src/web/main.ts (hash-маршрутизация, рендер)
                                                              │
                                     src/web/pages/*.ts (композиция страницы)
                                                              │
                                     src/web/components/*.ts (атомарные компоненты, TrustedHtml)
                                                              │
                                     src/web/lib/format.ts (escapeHtml, trusted, safeHref, форматирование)

src/web/templates/partials/**   — статические HTML-эталоны разметки, в runtime НЕ участвуют
docs/ui/reference/**            — рукописные HTML-страницы с синтетическими данными, в runtime НЕ участвуют
```

Ключевой факт: **в репозитории нет кода, который связывает partials с production-компонентами**. Ссылок на `docs/ui/reference` в `tools/**` и `docs/**` нет; в `package.json` нет скрипта генерации эталонов. Ни partials, ни reference-страницы не собираются и не проверяются на соответствие фактической разметке компонентов автоматически.

## 3. Компоненты (FACT)

| Модуль | Строк | Экспорты |
|---|---:|---|
| `components/cards.ts` | 53 | `statusBadge`, `kpiCard`, `card`, `chartCard`, `provenanceDrawer`, `kpiGrid`; интерфейсы `KpiCardProps`, `StatusBadgeProps`, `CardProps`, `ChartCardProps`, `ProvenanceDrawerProps` |
| `components/charts.ts` | 84 | `isSeriesClass`, `lineChart`, `barChart`; интерфейсы `SeriesPoint`, `Series`; тип `SeriesClass` |
| `components/data.ts` | 49 | `dataTable`, `completenessCalendar`, `sparkline`; интерфейсы `TableColumn`, `DataTableProps`, `CalendarDay`; тип `CalendarDayStatus` |
| `components/shell.ts` | 66 | `sidebar`, `topbar`, `pageHeader`, `appShell`; интерфейсы `NavItem`, `NavSection`, `TopbarProps`, `AppShellProps` |
| `components/states.ts` | 16 | `emptyState`, `loadingState`, `errorState` |
| `components/index.ts` | 8 | реэкспорт |

Итого 20 функций. Все возвращают `TrustedHtml`; экранирование выполняется внутри компонентов через `escapeHtml`, ссылки — через `safeHref`, классы статусов — через `statusClass`/`statusLabel`, числа и даты — через `formatNumber`/`formatDate`.

Композиции страниц:

| Файл | Строк | Экспорты |
|---|---:|---|
| `pages/history.ts` | 104 | `historyFilters`, `historyPage`, `historyEmpty` |
| `pages/data-quality.ts` | 72 | `buildCalendar`, `dataQualityPage` |
| `pages/provenance.ts` | 72 | `provenancePage` |
| `pages/forecast-quality.ts` | 173 | `qualityWarnings`, `metricPresentation`, `forecastQualityPage` |
| `pages/forecast-diagnostics.ts` | **349** | `forecastDiagnosticsPage`, `forecastDiagnosticsLoading`, `forecastDiagnosticsInvalid` |
| `main.ts` | 189 | маршрутизация и рендер |

**Наблюдение (не исправляется):** правило «файл не более 200 строк» соблюдается в компонентах, но нарушено в `forecast-diagnostics.ts` (349) и близко к пределу в `main.ts` (189) и `forecast-quality.ts` (173).

## 4. Карта partial → компонент → страница (FACT)

| Partial | Компонент | Страница-composition | Соответствие |
|---|---|---|---|
| `cards/card.html` | `card()` | все | по имени есть, разметка сверена ниже |
| `cards/chart-card.html` | `chartCard()` | history, overview | по имени есть |
| `cards/kpi-card.html` | `kpiCard()` | все | условный блок расходится (R-1) |
| `cards/kpi-grid.html` | `kpiGrid()` | все | соответствует |
| `cards/provenance-drawer.html` | `provenanceDrawer()` | overview, provenance, forecast-* | соответствует |
| `cards/status-badge.html` | `statusBadge()` | все | соответствует |
| `charts/bar-chart.html` | `barChart()` | — (не используется страницами) | входные данные расходятся (R-3) |
| `charts/line-chart.html` | `lineChart()` | history, overview | входные данные расходятся (R-3) |
| `charts/sparkline.html` | `sparkline()` | — | входные данные расходятся (R-3) |
| `data/completeness-calendar.html` | `completenessCalendar()` | overview, quality | статус `unknown` без CSS-модификатора (вне этапа) |
| `data/data-table.html` | `dataTable()` | history, overview, forecast-* | промежуточная модель `cells[]` отсутствует в TS (R-2) |
| `pages/forecast-mode-switcher.html` | **нет** | `forecast-quality.ts`, `forecast-diagnostics.ts` (инлайн) | компонента нет (R-7) |
| `pages/history-filters.html` | **нет** (функция страницы `historyFilters`) | `history.ts` | расходятся данные и экранирование (R-6) |
| `shell/app-shell.html` | `appShell()` | все | соответствует |
| `shell/page-header.html` | `pageHeader()` | все | соответствует |
| `shell/sidebar-brand.html` | **нет** (внутри `sidebar()`) | все | компонента нет (R-5) |
| `shell/sidebar-nav.html` | **нет** (внутри `sidebar()`) | все | компонента нет (R-5) |
| `shell/sidebar.html` | `sidebar()` | все | соответствует по структуре |
| `shell/topbar.html` | `topbar()` | все | соответствует |
| `states/empty-state.html` | `emptyState()` | все | соответствует |
| `states/error-state.html` | `errorState()` | все | соответствует |
| `states/loading-state.html` | `loadingState()` | все | входная модель расходится (R-4) |

Проверка camelCase: нарушений нет ни в одном из 22 partials.

## 5. Расхождения (FACT, только контрактные)

Расхождения не влияют на production: partials не исполняются. Они означают, что **partials нельзя использовать как источник разметки без переписывания компонентов**.

- **R-1** `kpi-card.html` показывает бейдж при `{{#statusBadge}}`, а `kpiCard()` принимает `status: DssStatus` и строит бейдж внутри.
- **R-2** `data-table.html` перебирает `{{#cells}}` внутри `{{#rows}}`; `dataTable()` собирает `<td>` напрямую из `rows` и `columns`, промежуточного `cells[]` не существует.
- **R-3** `line-chart.html` ожидает `path` и `cssClass`, `bar-chart.html` — `x`, `y`, `barWidth`, `barHeight`, `sparkline.html` — `points`; все три вычисляются внутри компонентов и наружу не выходят.
- **R-4** `loading-state.html` принимает `skeletons[]` с `width`; `loadingState({ rows })` вычисляет ширины сам.
- **R-5** `sidebar-brand.html` и `sidebar-nav.html` не имеют функций: разметка бренда и навигации встроена в `sidebar()`.
- **R-6** `history-filters.html` ожидает `ranges[]` с `key`, `label`, `badgeClass`; `historyFilters()` формирует строки из `RANGES` и подставляет `from`/`to` без `escapeHtml` (частичный контракт строже производственного кода).
- **R-7** `forecast-mode-switcher.html` не имеет производственной функции: переключатели собраны инлайн в двух страницах.
- **R-8** reference-страницы дублируют разметку оболочки и карточек: 7 HTML-файлов, 38–47 ds-классов каждый, 123–136 строк; генератор отсутствует, данные — статические фикстуры внутри файлов.

Итого: **8 расхождений**, из них 7 контрактных (R-1…R-7) и 1 архитектурное (R-8, дублирование разметки).

## 6. Reference-страницы (FACT)

- шесть страниц: `overview`, `history`, `quality`, `provenance`, `forecast-quality`, `forecast-diagnostics` (по 6 500–10 300 Б);
- разметка написана вручную; автоматической связи с partials или компонентами нет;
- состояния (`loading`, `empty`, `error`, `not_available`) представлены статически, одновременно на странице;
- значения — синтетические, помечены баннером `REFERENCE DATA — NOT PRODUCTION DATA`;
- невозможно без дополнительной подготовки: реальные DTO, вычисленная SVG-геометрия, состояния гонки загрузки, ошибки API.

**Ответ на вопрос этапа:** автоматическая генерация reference-страниц из production-компонентов **технически возможна** (компоненты чистые функции `props → TrustedHtml`), но требует: набора фикстур на каждую страницу, обёртки, собирающей страницу в HTML-документ, и замены инлайн-разметки оболочки вызовами `appShell`/`sidebar`/`topbar`.

## 7. Безопасность и доверенные значения (FACT)

`src/web/lib/format.ts` (85 строк) экспортирует: `DssStatus`, `escapeHtml`, `formatNumber`, `formatPercent`, `formatDate`, `statusLabel`, `statusClass`, `TrustedHtml`, `trusted`, `isSafeHref`, `safeHref`.

| Значение | Источник | Тип | Обработка |
|---|---|---|---|
| Текст из DTO | API | string | `escapeHtml` внутри компонента |
| Разметка компонента | production component | `TrustedHtml` | доверенный слот (тройные скобки в partial) |
| URL навигации | маршрут / props | string | `safeHref` + allowlist маршрутов |
| Геометрия SVG | вычисления компонента | number | подготовка в TypeScript |
| CSS-класс статуса | enum | string | `statusClass` (перечислимый) |
| Статус API | DTO | enum | проверка допустимых значений |
| Дата и число | DTO | string / number | `formatDate`, `formatNumber` (`[Н/Д]` вместо нуля) |

Границы доверенных слотов закрыты: 11 имён (`sidebar`, `topbar`, `content`, `brand`, `safeHref`, `right`, `body`, `chart`, `legend`, `kpiCard`, `statusBadge`). Тройные скобки применяются только к ним; проверено тестами.

Риски, которые учитывались при оценке вариантов: XSS через текст API, инъекция атрибутов (`value="…"`), инъекция URL (`javascript:`, `//`), инъекция SVG, некорректные типы, отсутствующие поля, неизвестные enum, пустые массивы, некорректные числа. Схема, при которой произвольный текст попадает в тройные скобки, недопустима ни в одном варианте.

## 8. Состояние тестов (FACT)

`tests/web/templates-partials.test.ts` (102 теста) проверяет: наличие 22 файлов и отсутствие пустых, camelCase имён, отсутствие выражений, закрытый перечень доверенных слотов и его совпадение с документом, отсутствие доверенных слотов в двойных скобках, allowlist hash-ссылок с позиционными правилами, структуру `data-table`, контракт `loading-state`, подготовку геометрии в SVG-partials, покрытие всех partials таблицей контракта, согласованность README.

Чего тесты **не** проверяют: соответствие partial фактической разметке production-функции; соответствие props ↔ placeholders; совпадение порядка элементов; синхронность изменений компонента и partial; поведение компонентов (проверяется отдельно в других тестах). То есть partials защищены от синтаксических ошибок, но не от расхождения с кодом — что и подтверждают R-1…R-7.

## 9. Ограничения аудита

- визуальная проверка в этом этапе не выполнялась (её результаты зафиксированы в TPL-3.1);
- эквивалентность partials и компонентов оценивалась статически по тексту и сигнатурам;
- остаются открытыми замечания репозитория вне области этапа: имя пакета `vkusvill-courier-discovery`, крупный `diff.txt`, отсутствие workflow runs для `c6efe847`.
