# Отчёт TPL-2 — HTML reference pages

**Дата:** 2026-11-27 · **HEAD:** `6e84af17cc1586f425777efb79b62e1086f36f2a` · **Ветка:** `main`
**Вердикт:** `ACCEPTED WITH LIMITATIONS` (ограничения — разделы 10, 12, 13)

## 1. Назначение

- Создать независимый комплект HTML-эталонов страниц DSS UI на утверждённых partials, пригодный для проверки структуры, композиции, размеров, отступов, иерархии и адаптивности. Эталоны не подключаются к API, не выполняют расчётов и не влияют на production.

## 2. Preflight

| Проверка | Источник | Результат |
|---|---|---|
| Git state | `git status --short` | staged 0, unstaged 9, untracked 4 |
| HEAD | `git rev-parse HEAD` | `6e84af17cc1586f425777efb79b62e1086f36f2a` |
| PAGES | `src/web/routing.ts` | 6 страниц: `overview`, `history`, `quality`, `provenance`, `forecast-quality`, `forecast-diagnostics` |
| Partial inventory | `src/web/templates/partials` | 22 файла |
| Component mapping | `src/web/components` | 6 модулей, 20 функций |
| Page composition | `src/web/pages`, `src/web/main.ts` | `dataQualityPage`, `forecastDiagnosticsPage`, `forecastQualityPage`, `historyPage`, `provenancePage`, композиция обзора в `main.ts` |
| Styles | `src/web/styles` | `tokens.css`, `layout.css`, `components.css`, `charts.css`, `responsive.css` |
| Breakpoints | CSS | `max-width: 1180px`, `820px`, `560px`, `min-width: 1441px` |
| TPL-1.1 contract | документация и тесты | `docs/ui/templates-contract.md`, 102 теста partials |

**Внешнее изменение:** `diff.txt` изменён не этим этапом (в preflight TPL-1 он был не изменён). Файл не трогали.

**Расхождение с прежними материалами:** ранее упоминалось «пять-шесть» эталонов; фактический routing содержит **шесть** страниц — шестая (`forecast-diagnostics`) подтверждена кодом UI-7.1.1, поэтому создана.

## 3. Production-страницы (FACT)

| Route | Page key | Функция | Компоненты | Основные данные |
|---|---|---|---|---|
| `#overview` | overview | композиция в `main.ts` | `pageHeader`, `card`, `kpiGrid`, `statusBadge`, `provenanceDrawer`, `lineChart`, `dataTable`, `completenessCalendar` | история, теневой режим, провенанс |
| `#history` | history | `historyPage`, `historyFilters`, `historyEmpty` | `kpiGrid`, `chartCard`, `lineChart`, `dataTable`, фильтры | ряд, агрегаты периода, покрытие |
| `#quality` | quality | `dataQualityPage`, `buildCalendar` | `kpiGrid`, `completenessCalendar`, `dataTable` | полнота, пропуски, ограничения |
| `#provenance` | provenance | `provenancePage` | `card`, `kpiGrid`, `provenanceDrawer`, `statusBadge` | источник, версии, актуальность |
| `#forecast-quality` | forecast-quality | `forecastQualityPage`, `qualityWarnings`, `metricPresentation` | `kpiGrid`, `dataTable`, `provenanceDrawer` | независимые метрики, парное сравнение |
| `#forecast-diagnostics` | forecast-diagnostics | `forecastDiagnosticsPage`, `forecastDiagnosticsLoading`, `forecastDiagnosticsInvalid` | `kpiGrid`, `dataTable`, состояния | качество, диагностические записи, провенанс |

## 4. Mapping страница → компонент → partial

| Страница | Partial |
|---|---|
| index | `shell/sidebar.html`, `shell/sidebar-brand.html`, `shell/sidebar-nav.html`, `shell/topbar.html`, `shell/page-header.html`, `cards/card.html` |
| overview | + `cards/kpi-card.html`, `cards/kpi-grid.html`, `cards/status-badge.html`, `cards/provenance-drawer.html`, `charts/line-chart.html`, `data/data-table.html`, `data/completeness-calendar.html`, `states/*` |
| history | + `partials/pages/history-filters.html`, `states/empty-state.html`, `states/error-state.html` |
| quality | + `data/completeness-calendar.html`, `cards/kpi-grid.html` |
| provenance | + `cards/provenance-drawer.html`, `cards/status-badge.html` |
| forecast-quality | + `partials/pages/forecast-mode-switcher.html`, `cards/kpi-grid.html`, `cards/provenance-drawer.html` |
| forecast-diagnostics | + `partials/pages/forecast-mode-switcher.html`, `data/data-table.html`, `states/loading-state.html` |

Использованы все категории partials: `shell` (6), `cards` (6), `charts` (3), `data` (2), `pages` (2), `states` (3) — 22 из 22.

## 5. Структура reference

```text
docs/ui/reference/
  index.html
  pages/{overview,history,quality,provenance,forecast-quality,forecast-diagnostics}.html
  assets/reference.css
  assets/reference.js
  screenshots/reference/*.png        (36 файлов)
  screenshots/production/*.png       (34 файла)
  README.md
```

## 6. Использованные CSS tokens

Собственная палитра не вводилась: `assets/reference.css` подключает production-стили (`tokens.css`, `layout.css`, `components.css`, `charts.css`, `responsive.css`) через `@import`. Добавлены только три служебных класса reference (`.ds-ref-banner`, `.ds-ref-index`, `.ds-ref-note`).

Проверка: из 19 «неизвестных» production-классов 18 — служебные `ds-ref-*`; один (`ds-calendar-day--unknown`) отсутствует в production CSS и зафиксирован как расхождение TPL-3.

## 7. Источник демонстрационных данных

Только локальные синтетические значения, помеченные баннером `REFERENCE DATA — NOT PRODUCTION DATA` на каждой странице. Данные не читаются из API, не записываются в JSONL или SQLite, не совпадают с реальными показателями. Семантика сохранена: `PROVISIONAL`, `[Н/Д]` вместо нуля, предупреждения не превращены в ошибки.

## 8. Реализованные состояния

Для каждой страницы: нормальное состояние, загрузка (`ds-state` + `ds-skeleton`), пустота (`data-ds-empty`), недоступность (`NOT_AVAILABLE`), ошибка источника (`ds-state--error` + конфликтный бейдж), предупреждение о качестве или актуальности (полнота, ожидание факта, интерпретируемость). Интерактивность не изобреталась: работает только мобильное меню.

## 9. Адаптивные правила

Проверены ширины 1440, 1280, 1024, 768, 390, 360 px. Используются production-медиазапросы (1180 / 820 / 560 px). Скриншоты эталонов: 36 файлов, по 6 на страницу; размеры полотна совпадают с заданными viewport.

## 10. Ограничения

- эталоны статичны: состояния показаны одновременно, без переключения;
- фильтры и переключатели режима не выполняют переходов;
- данные синтетические, поэтому текст и геометрия отличаются от production;
- паритет с production проверяется статически и по скриншотам (TPL-3); человеческая визуальная приёмка не выполнялась.

## 11. Проверки

| Проверка | Результат |
|---|---|
| HTML-файлов | 7 (index + 6 страниц) |
| Битые относительные ссылки | 0 |
| Внешние ссылки (CDN, http/https) | 0 |
| Сетевые вызовы (`fetch`, XHR, localhost) | 0 |
| Верхнерегистровые плейсхолдеры | 0 |
| Ошибки кодировки | 0 |
| Страницы из `PAGES` | 6 из 6, все связаны из индекса |
| Скриншоты эталонов | 36 из 36 |
| `bun run ui:build` | exit 0 (production не изменялся) |
| Тесты partials (регрессия) | 102 pass / 0 fail |

## 12. NOT_IMPLEMENTED

- интерактивные фильтры и переключатели в эталонах;
- автоматическая сборка эталонов из partials (эталоны — статическая разметка);
- перенос `sparkline` и других partials в новую структуру;
- исправление найденных production-расхождений (вне области этапа);
- изменение production CSS, компонентов, страниц, API.

## 13. NOT_VERIFIED

- визуальная приёмка эталонов человеком;
- паритет с production на уровне пикселей и шрифтов (см. TPL-3: корреляция профиля строк 0.15 в среднем, причины — данные и состояния);
- поведение при экстремально длинных значениях, отсутствующих в синтетическом наборе.

## 14. Итоговый вердикт

**`ACCEPTED WITH LIMITATIONS`.** Все 18 критериев TPL-2 имеют статус PASS или NOT_VERIFIED согласно матрице в отчёте TPL-3; данные и production-код не изменялись.
