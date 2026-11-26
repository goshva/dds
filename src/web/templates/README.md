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
| `loading-state.html` | `loadingState({ rows })` |
| `error-state.html` | `errorState({ title, detail, code })` |

### `pages/` — композиционные блоки страниц (`pages/*.ts`)
| Partial | Компонент / источник |
|---|---|
| `history-filters.html` | `historyFilters(active, from, to)` — `pages/history.ts` |
| `forecast-mode-switcher.html` | mode/horizon переключатель — `pages/forecast-quality.ts` |

## Инварианты безопасности

- В partials значения из API всегда обозначены как `{{esc}}` (экранируемые);
  слоты TrustedHtml — как `{{{trusted}}}`. Это отражает границу `escapeHtml` vs `trusted()` из `lib/format.ts`.
- Частичные значения никогда не должны попадать в `{{{ }}}` без прохода через компонент.

## Полнота

22 partials покрывают все публичные компоненты из `components/index.ts`
плюс два композиционных блока страниц. Композитные страницы
(`historyPage`, `forecastQualityPage`, `dataQualityPage`, `provenancePage`) собираются
из этих partials и не имеют отдельного файла-partial.
