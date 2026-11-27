# Templates — атомарные HTML-partials (Фаза 2)

Каталог `templates/partials/` содержит **эталонные HTML-partials** для каждого компонента DSS UI.
Каждый partial — это разметка одного атомарного компонента из `src/web/components/*.ts`,
перенесённая 1:1 с заменой интерполяции на Mustache-подобные плейсхолдеры.

## Назначение

- Служит **визуальной спецификацией** разметки компонентов (референс для ручной проверки и документации).
- Не исполняется рантаймом: рендеринг в проде выполняет TypeScript-код в `src/web/components/`.
- При изменении разметки компонента соответствующий partial обновляется синхронно.

## Синтаксис плейсхолдеров

| Запись | Смысл | Пример источника в TS |
|---|---|---|
| `{{name}}` | экранированное значение | `${escapeHtml(props.name)}` |
| `{{{name}}}` | доверенная вложенная разметка (TrustedHtml) | `${props.body}` |
| `{{#cond}}…{{/cond}}` | блок, если значение истинно | `${props.note ? \`…\` : ""}` |
| `{{^cond}}…{{/cond}}` | блок, если значение ложно | тернарный else |
| `{{#list}}…{{/list}}` | повтор по элементам массива | `.map(...).join("")` |

> СоответствиеMustache выбрано как нейтральный, не исполняемый формат —
> он не требует сборки и читается без контекста проекта.

## Структура и соответствие компонентам

### `shell/` — каркас приложения (`components/shell.ts`)
| Partial | Компонент / props |
|---|---|
| `app-shell.html` | `appShell({ sidebar, topbar, content, menuOpen })` |
| `sidebar.html` | `sidebar({ brandName, brandSub, sections })` (контейнер) |
| `sidebar-brand.html` | блок `.ds-brand` внутри sidebar |
| `sidebar-nav.html` | блок `<nav class="ds-nav">` внутри sidebar |
| `topbar.html` | `topbar({ title, shopNo, lastUpdated, sourceStatus })` |
| `page-header.html` | `pageHeader({ title, subtitle, right })` |

### `cards/` — карточки и статусы (`components/cards.ts`)
| Partial | Компонент / props |
|---|---|
| `card.html` | `card({ title, subtitle, right, body })` |
| `chart-card.html` | `chartCard({ title, hint, legend, chart })` |
| `kpi-card.html` | `kpiCard({ label, value, note, status })` |
| `kpi-grid.html` | `kpiGrid(items[])` |
| `status-badge.html` | `statusBadge({ status, text })` |
| `provenance-drawer.html` | `provenanceDrawer({ source, checksum, version, note })` |

### `charts/` — SVG-графики (`components/charts.ts`)
| Partial | Компонент |
|---|---|
| `line-chart.html` | `lineChart(series[], width, height)` |
| `bar-chart.html` | `barChart(values[], width, height)` |
| `sparkline.html` | `sparkline(values[], width, height)` |

### `data/` — табличные данные (`components/data.ts`)
| Partial | Компонент |
|---|---|
| `data-table.html` | `dataTable({ columns, rows, emptyText, caption })` |
| `completeness-calendar.html` | `completenessCalendar(days[])` |

### `states/` — состояния загрузки (`components/states.ts`)
| Partial | Компонент |
|---|---|
| `empty-state.html` | `emptyState({ title, detail })` |
| `loading-state.html` | `loadingState({ rows })` — partial принимает готовый `skeletons[]` (ширины считаются в компоненте) |
| `error-state.html` | `errorState({ title, detail, code })` |

### `pages/` — композиционные блоки страниц (`pages/*.ts`)
| Partial | Компонент / источник |
|---|---|
| `history-filters.html` | `historyFilters(active, from, to)` — `pages/history.ts` |
| `forecast-mode-switcher.html` | mode/horizon переключатель — `pages/forecast-quality.ts` |

## Инварианты безопасности

- В partials значения из API всегда обозначены как `{{esc}}` (экранируемые);
  слоты TrustedHtml — как `{{{trusted}}}`. Это отражает границу `escapeHtml` vs `trusted()` из `lib/format.ts`.
- Значения, которые в TypeScript проходят через `escapeHtml()`, обозначены одинарными `{{ }}`
  (например, `kpi-card.html`: `{{note}}`, а не `{{{note}}}`).
- Атрибут `href` всегда проходит через `safeHref()`; в partial это `{{{safeHref}}}` —
  доверенная разметка, потому что `safeHref()` сам возвращает экранированную строку
  (см. `shell/sidebar.html`, `shell/sidebar-nav.html`).
- Атрибут `data-ds-unsafe-href="1"` проставляется по признаку **небезопасности ссылки**
  (`{{#unsafe}}`), а не по признаку текущего пункта меню.
- Прочие значения никогда не должны попадать в `{{{ }}}` без прохода через компонент.

## История исправлений

| Дата | Файл | Дефект | Исправление |
|---|---|---|---|
| 2026-11-25 | `cards/kpi-card.html` | P1: `{{{note}}}` при `escapeHtml()` в TS | → `{{note}}` |
| 2026-11-25 | `shell/sidebar.html` | P1: `href` без `safeHref()` | → `{{{safeHref}}}` |
| 2026-11-25 | `shell/sidebar-nav.html` | P1: `href` без `safeHref()`; `data-ds-unsafe-href` по `current` | → `{{{safeHref}}}`, `{{#unsafe}}` |
| 2026-11-25 | `cards/kpi-grid.html` | P1: нарушена структура — `</div>` внутри `{{#items}}` | `{{#items}}{{{kpiCard}}}{{/items}}` внутри одного `<div>` |
| 2026-11-25 | `states/loading-state.html` | P2: partial ожидал `skeletons[]`, компонент принимает `rows` | Контракт зафиксирован в таблице `states/` |


## Полнота

22 partials покрывают все публичные компоненты из `components/index.ts`
плюс два композиционных блока страниц. Композитные страницы
(`historyPage`, `forecastQualityPage`, `dataQualityPage`, `provenancePage`) собираются
из этих partials и не имеют отдельного файла-partial.
