# Инвентаризация шаблонов (TPL-0)

> **Архитектурная поправка TPL-4.5.** Каталог `src/web/templates/partials/` удалён в TPL-4.4.
> Production HTML формируют `src/web/components/` и `src/web/pages/`; экранирование — `src/web/lib/format.ts`;
> актуальная документация архитектуры — `src/web/templates/README.md`; эталоны страниц — `docs/ui/reference/`
> (генератор `tools/reference/`). Исторические результаты ниже не изменялись.

**Дата:** 2026-11-27 · **HEAD:** `6e84af17cc1586f425777efb79b62e1086f36f2a` («disign») · **Ветка:** `main` · **Staged:** 0 · **Unstaged:** 0 · **Untracked:** 0

**Режим этапа:** только чтение. Код, partials и стили не изменялись; создан единственный документ — этот файл.

---

## 1. Что проверено (FACT)

- все файлы `src/web/components/` (6 файлов);
- все файлы `src/web/pages/` (5 файлов);
- все 22 файла `src/web/templates/partials/`;
- `src/web/templates/README.md` и структура каталогов `src/web/templates/`;
- стили `src/web/styles/` (5 файлов) и media-запросы;
- контракты props и границы безопасности (`escapeHtml`, `safeHref`, `trusted`, `TrustedHtml`) из `src/web/lib/format.ts`;
- существующая автоматическая проверка `tests/web/templates-partials.test.ts`.

Проверка кодировки: все 22 partials — корректный UTF-8 (проверено декодированием с `fatal: true`, ошибок нет). Отображение кириллицы «кракозябрами» в консоли PowerShell — артефакт кодировки вывода, а не дефект файлов.

## 2. Состав слоя

| Группа | Состав |
|---|---|
| Partial-шаблоны | 22 файла в `src/web/templates/partials/` (cards 6, charts 3, data 2, pages 2, shell 6, states 3) |
| Документация шаблонов | `src/web/templates/README.md` (6 834 Б) — синтаксис плейсхолдеров и таблицы соответствия |
| Каталог страниц | `src/web/templates/pages/` — **пусто** |
| Отсутствующие каталоги | `layouts/`, `examples/`, `partials/atoms/` |
| Компоненты | `cards.ts`, `charts.ts`, `data.ts`, `shell.ts`, `states.ts`, `index.ts` |
| Страницы | `overview` (в `main.ts`), `history.ts`, `data-quality.ts`, `provenance.ts`, `forecast-quality.ts`, `forecast-diagnostics.ts` |
| Маршрутизация | `src/web/routing.ts` |
| Формат и безопасность | `src/web/lib/format.ts` |
| Стили | `tokens.css`, `layout.css`, `components.css`, `charts.css`, `responsive.css` |
| Визуальная площадка | `src/web/playground/` (`fixtures.ts`, `main.ts`, `index.html`, `dist/`) |

## 3. Карта соответствия: компонент → partial

| Компонент | Partial | Props | Источник данных | Безопасность |
|---|---|---|---|---|
| `statusBadge` | `cards/status-badge.html` | `status`, `text?` | статус DTO | `statusClass()`, `escapeHtml` |
| `kpiCard` | `cards/kpi-card.html` | `label`, `value`, `note?`, `status?` | DTO страницы | `link escapeHtml` для label/value/note |
| `kpiGrid` | `cards/kpi-grid.html` | `KpiCardProps[]` | DTO страницы | сборка доверенных карточек |
| `card` | `cards/card.html` | `title?`, `subtitle?`, `right?`, `body` | композиция страницы | слоты `TrustedHtml` |
| `chartCard` | `cards/chart-card.html` | `title`, `hint?`, `legend?`, `chart` | DTO страницы | слоты `TrustedHtml` |
| `provenanceDrawer` | `cards/provenance-drawer.html` | `source`, `checksum?`, `version?`, `note?` | read-model провенанса | `escapeHtml` |
| `lineChart` | `charts/line-chart.html` | `series[]`, `width`, `height` | точки ряда | доверенный SVG, `escapeHtml` для дат |
| `barChart` | `charts/bar-chart.html` | `values[]`, `width`, `height` | точки ряда | доверенный SVG, экранируемые подписи |
| `sparkline` | `charts/sparkline.html` | `values[]`, `width`, `height` | точки ряда | доверенный SVG |
| `dataTable` | `data/data-table.html` | `columns`, `rows`, `emptyText?`, `caption?` | DTO страницы | `escapeHtml` по ячейкам |
| `completenessCalendar` | `data/completeness-calendar.html` | `CalendarDay[]` | покрытие истории | `escapeHtml` для даты, allowlist статусов |
| `emptyState` | `states/empty-state.html` | `title?`, `detail?` | состояние UI | `escapeHtml` |
| `loadingState` | `states/loading-state.html` | `rows?` | состояние UI | внутренние скелетоны |
| `errorState` | `states/error-state.html` | `title?`, `detail?`, `code?` | состояние UI | `escapeHtml` |
| `appShell` | `shell/app-shell.html` | `sidebar`, `topbar`, `content`, `menuOpen?` | композиция | слоты `TrustedHtml` |
| `sidebar` | `shell/sidebar.html` | `brandName`, `brandSub`, `sections` | навигация | `safeHref`, `escapeHtml` |
| бренд-блок внутри `sidebar` | `shell/sidebar-brand.html` | `brandName`, `brandSub` | навигация | `escapeHtml` |
| навигация внутри `sidebar` | `shell/sidebar-nav.html` | `sections[]`, `items[]` | навигация | `safeHref`, `escapeHtml` |
| `topbar` | `shell/topbar.html` | `title`, `shopNo`, `lastUpdated`, `sourceStatus`, `menuOpen?` | состояние API | `statusClass`, `escapeHtml` |
| `pageHeader` | `shell/page-header.html` | `title`, `subtitle?`, `right?` | DTO страницы | `escapeHtml`, слот `TrustedHtml` |
| `historyFilters` (в `pages/history.ts`) | `partials/pages/history-filters.html` | `ranges[]`, `from`, `to`, `active` | маршрут и данные | `escapeHtml` для значений полей |
| переключатели режима (инлайн в `forecast-quality.ts`) | `partials/pages/forecast-mode-switcher.html` | `modes[]`, `horizons[]` | маршрут | `escapeHtml`, hash-ссылки |

Итого: 20 компонентных функций из `src/web/components/*.ts` покрыты 20 partials; ещё 2 partials относятся к уровню страниц.

## 4. Partial без отдельной функции компонента (FACT)

- `shell/sidebar-brand.html` — блок бренда встроен в `sidebar()`;
- `shell/sidebar-nav.html` — навигация встроена в `sidebar()`;
- `pages/history-filters.html` — соответствует `historyFilters()` из `src/web/pages/history.ts`;
- `pages/forecast-mode-switcher.html` — переключатели собираются инлайн в `src/web/pages/forecast-quality.ts`.

Это не дефект, но контракт слота для этих partials в коде не выражен отдельным типом props — вопрос для TPL-1.

## 5. Компоненты без самостоятельного partial

Отсутствуют: каждая функция слоя компонентов имеет соответствующий partial.

Пограничные случаи:

- `isSeriesClass()` — валидатор, partial не требуется;
- `sidebar()` покрыт тремя partials (контейнер, бренд, навигация) — требуется правило композиции.

## 6. Контрактные расхождения (для TPL-1)

| Partial | Сейчас | Требуется решение |
|---|---|---|
| `cards/kpi-card.html` | слот `{{#status}}{{{statusBadge}}}{{/status}}` ожидает готовую разметку бейджа | зафиксировать: `status` — значение `DssStatus`, бейдж рендерит компонент, а не шаблон |
| `data/data-table.html` | перебирает `{{#cells}}` внутри `{{#rows}}` | зафиксировать нормализованную форму строки (ячейки) либо перейти на `columns`+`rows` |
| `charts/line-chart.html` | принимает готовые `path` и `cssClass` | зафиксировать: геометрия вычисляется компонентом, шаблон получает результат |
| `charts/bar-chart.html` | принимает `x`, `y`, `barWidth`, `barHeight` | то же |
| `charts/sparkline.html` | принимает строку `points` | то же; уточнить, допустима ли сборка строки в шаблоне |
| `states/loading-state.html` | перебирает `skeletons[]` | привести к контракту компонента (`rows`) или задокументировать приведение |
| `shell/app-shell.html` | плейсхолдеры `{{SIDEBAR}}`, `{{TOPBAR}}`, `{{{CONTENT}}}` в верхнем регистре | привести к общему синтаксису `{{#...}}`/`{{{...}}}` |
| `shell/sidebar-brand.html` | `{{BRANDNAME}}`, `{{BRANDSUB}}`, `{{BRAND}}` | то же |
| `shell/topbar.html` | `{{sourceStatusClass}}` — производное значение | зафиксировать, допустимы ли производные поля в контракте partial |

## 7. Безопасность (FACT)

- `escapeHtml()` — единственная точка экранирования; `trusted()` создаёт `TrustedHtml`;
- `safeHref()`/`isSafeHref()` — проверка ссылок; применяется в `shell/sidebar.html` и `shell/sidebar-nav.html` (`{{{safeHref}}}`);
- двойные скобки `{{ }}` — экранируемые значения; тройные `{{{ }}}` — только доверенная разметка;
- значения DTO не попадают в доверенные слоты напрямую.

Найденные исключения (риск, требует правила в TPL-1):

- `partials/pages/history-filters.html` содержит `href="#history/{{key}}"` — hash-ссылка собирается из литерального префикса и экранируемого сегмента, но не проходит через `safeHref()`;
- `partials/pages/forecast-mode-switcher.html` содержит `href="#forecast-quality/{{mode}}/{{horizon}}"` — аналогично.

Существующая проверка ищет только `href="{{…` и потому эти два случая не покрывает.

## 8. Стили и адаптивность (FACT)

- 5 файлов стилей, всего определено 68 классов;
- media-запросы: `max-width: 1180px`, `max-width: 820px`, `max-width: 560px`, `min-width: 1441px`;
- CSS-классы, используемые в partials и отсутствующие в стилях: **нет** (проверено сопоставлением по всем 22 файлам);
- проверка классов в компонентах дала единственное срабатывание `?` — это артефакт разбора условного класса в шаблонной строке, а не реальный класс.

## 9. Расхождения с целевой структурой

| Позиция ТЗ | Фактически |
|---|---|
| `partials/data/sparkline.html` | `partials/charts/sparkline.html` |
| `partials/atoms/` (4 файла) | каталог отсутствует |
| `partials/charts/bar-chart.html` | существует |
| `partials/states/*` | существует |
| `pages/*.html` (6 файлов) | каталог `templates/pages/` пуст |
| `layouts/default.html` | каталог отсутствует |
| `examples/*.html` | каталог отсутствует |

## 10. Существующая автоматическая проверка

`tests/web/templates-partials.test.ts` (8 539 Б) уже покрывает:

- ровно 22 partials и ожидаемые имена;
- отсутствие пустых файлов;
- баланс блоков `{{#…}}{{/…}}`;
- баланс парных HTML-тегов;
- отсутствие ссылок с одинарными скобками;
- `safeHref` в `sidebar.html` и `sidebar-nav.html`;
- экранирование в `kpi-card.html`, `provenance-drawer.html`, `topbar.html`;
- контракты `kpi-grid`, `loading-state`, `app-shell`, `page-header`, `sidebar-brand`.

## 11. Открытые вопросы к TPL-1

1. Единый синтаксис плейсхолдеров: допустимы ли имена в верхнем регистре (2 partials).
2. Допустимы ли производные поля (`sourceStatusClass`, `statusClass`) в контракте partial.
3. Нормализация строк таблицы: `cells` против `columns`+`rows`.
4. Геометрия графиков: подтвердить, что вычисления остаются в компоненте.
5. Правило для hash-ссылок: обязательный `safeHref` или разрешённый литеральный префикс.
6. Контракт слотов для partials уровня страниц (`history-filters`, `forecast-mode-switcher`).
7. Расположение `sparkline.html`: `charts/` или `data/`.

## 12. Ограничения и статус

**NOT_VERIFIED:**

- визуальное соответствие partials и TypeScript-разметки (браузер недоступен; вынесено в TPL-3);
- паритет `src/web/playground/` с основным интерфейсом (не проверялся);
- поведение partials при подстановке реальных длинных значений (checksum, длинные подписи) — задача TPL-3.

**NOT_IMPLEMENTED (по границам этапа):** шаблоны страниц, макеты, примеры данных, автоматическая проверка новых шаблонов.

**Статус TPL-0:** `COMPLETE WITH LIMITATIONS` — карта соответствия построена, расхождения зафиксированы, код и partials не изменялись.

Следующая фаза (TPL-1) не начата и требует отдельного согласования.
