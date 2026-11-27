# TPL-4.2 — инвентаризация перед генерацией partials (STAGE A)

> **Архитектурная поправка TPL-4.5.** Каталог `src/web/templates/partials/` удалён в TPL-4.4.
> Production HTML формируют `src/web/components/` и `src/web/pages/`; экранирование — `src/web/lib/format.ts`;
> актуальная документация архитектуры — `src/web/templates/README.md`; эталоны страниц — `docs/ui/reference/`
> (генератор `tools/reference/`). Исторические результаты ниже не изменялись.

**Дата:** 2026-11-27 · **HEAD:** `c162612ee33715a171b82e8bee20c6380e12e07c` · **Ветка:** `main` · **Режим:** только чтение, изменений нет

---

## 1. Preflight и состояние Git (FACT)

| Проверка | Значение |
|---|---|
| `git rev-parse HEAD` | `c162612ee33715a171b82e8bee20c6380e12e07c` |
| `git branch --show-current` | `main` |
| staged / unstaged / untracked | 0 / 11 / 2 |
| unstaged | `diff.txt` + 7 эталонов (`docs/ui/reference`) + тест генерации + 2 модуля `tools/reference` — незавершённая работа TPL-4.1.1 |
| untracked | `docs/ui/templates-tpl-4-1-1-report.md` и артефакт с буквальным именем `-files --others --exclude-standard` |
| `diff.txt` | присутствует, не читался на запись, не изменялся |
| `git diff --stat` | 11 файлов, 485 вставок / 5 643 удаления (эффект генерации эталонов) |

Защищённые объекты не тронуты: `diff.txt`, неизвестный untracked-файл, отчёты предыдущих этапов, изменения TPL-4.1.1. Конфликтов с чужими изменениями не обнаружено.

## 2. Расхождение с текстом задания (FACT)

Задание ссылается на каталог partials `docs/ui/templates/`. Фактически:

- `docs/ui/templates` — **не существует** (0 файлов в индексе);
- partials находятся в **`src/web/templates/partials/`** — 22 HTML-файла (23 отслеживаемых файла вместе с `README.md`);
- `docs/ui/reference` — 156 отслеживаемых файлов (эталоны и скриншоты).

Вывод: целевой каталог генерации — `src/web/templates/partials/`, а не `docs/ui/templates/`. Это требует подтверждения перед реализацией, поскольку затрагивает продуктовый каталог шаблонов.

## 3. Фактические объёмы (FACT)

| Объект | Количество |
|---|---:|
| Partial-файлы | **22** |
| Экспортируемые функции компонентов | **19** (18 рендерящих + валидатор `isSeriesClass`) |
| Функции уровня страницы | **12** (`historyPage`, `historyFilters`, `historyEmpty`, `dataQualityPage`, `buildCalendar`, `provenancePage`, `forecastQualityPage`, `qualityWarnings`, `metricPresentation`, `forecastDiagnosticsPage`, `forecastDiagnosticsLoading`, `forecastDiagnosticsInvalid`) |
| Композиции страниц | 6 (обзор собран в `main.ts`) |
| Тесты web | 8 файлов, включая `templates-partials.test.ts` (552 строки) и `reference-generation.test.ts` (212) |
| Генератор эталонов | `tools/reference/**` (10 модулей), README отсутствует |

Повторная сверка подтвердила ориентиры TPL-0/TPL-4.0: 18 partials имеют одноимённую функцию, `history-filters` соответствует функции страницы, три partials не имеют собственной функции.

## 4. Таблица соответствий (FACT)

| Partial | Production function | Source file | Структура | Contract match | Status |
|---|---|---|---|---|---|
| `cards/card.html` | `card()` | `components/cards.ts` | 2 условия | значения + 2 trusted | MATCH_WITH_ADAPTER |
| `cards/chart-card.html` | `chartCard()` | `components/cards.ts` | 2 условия | значения + 2 trusted | MATCH_WITH_ADAPTER |
| `cards/kpi-card.html` | `kpiCard()` | `components/cards.ts` | 2 условия | partial ждёт слот `statusBadge`, функция принимает `status` | **CONTRACT_MISMATCH** |
| `cards/kpi-grid.html` | `kpiGrid()` | `components/cards.ts` | цикл по `items` | trusted `kpiCard` | MATCH_WITH_ADAPTER |
| `cards/provenance-drawer.html` | `provenanceDrawer()` | `components/cards.ts` | 1 условие | значения | MATCH_WITH_ADAPTER |
| `cards/status-badge.html` | `statusBadge()` | `components/cards.ts` | фиксированная | значения | **MATCH** |
| `charts/bar-chart.html` | `barChart()` | `components/charts.ts` | цикл по столбцам | partial ждёт `x/y/barWidth/barHeight`, функция считает сама | **CONTRACT_MISMATCH** |
| `charts/line-chart.html` | `lineChart()` | `components/charts.ts` | 2 цикла | partial ждёт `path/cssClass` и сетку | **CONTRACT_MISMATCH** |
| `charts/sparkline.html` | `sparkline()` | `components/data.ts` | фиксированная | `points` считает функция | **MATCH** |
| `data/completeness-calendar.html` | `completenessCalendar()` | `components/data.ts` | цикл по дням | значения | MATCH_WITH_ADAPTER |
| `data/data-table.html` | `dataTable()` | `components/data.ts` | 6 блоков | partial ждёт `cells[]`, функция строит `<td>` сама | **CONTRACT_MISMATCH** |
| `pages/forecast-mode-switcher.html` | нет | инлайн в `pages/forecast-quality.ts` и `pages/forecast-diagnostics.ts` | 2 цикла | две независимые реализации | **NO_PRODUCTION_SOURCE** |
| `pages/history-filters.html` | `historyFilters()` | `pages/history.ts` | 1 цикл | partial ждёт `ranges[].badgeClass`; функция строит разметку сама | **SPECIAL_COMPOSITION** + SECURITY_REVIEW_REQUIRED |
| `shell/app-shell.html` | `appShell()` | `components/shell.ts` | 1 условие | 3 trusted слота | MATCH_WITH_ADAPTER |
| `shell/page-header.html` | `pageHeader()` | `components/shell.ts` | 1 условие | значения + `right` | MATCH_WITH_ADAPTER |
| `shell/sidebar-brand.html` | нет (внутри `sidebar()`) | `components/shell.ts` | фиксированная | значения | **SPECIAL_COMPOSITION** |
| `shell/sidebar-nav.html` | нет (внутри `sidebar()`) | `components/shell.ts` | 4 блока | trusted `safeHref` | **SPECIAL_COMPOSITION** |
| `shell/sidebar.html` | `sidebar()` | `components/shell.ts` | 4 блока | trusted `brand`, `safeHref` | MATCH_WITH_ADAPTER |
| `shell/topbar.html` | `topbar()` | `components/shell.ts` | фиксированная | значения | **MATCH** |
| `states/empty-state.html` | `emptyState()` | `components/states.ts` | 1 условие | значения | MATCH_WITH_ADAPTER |
| `states/error-state.html` | `errorState()` | `components/states.ts` | 2 условия | значения | MATCH_WITH_ADAPTER |
| `states/loading-state.html` | `loadingState()` | `components/states.ts` | цикл | partial ждёт `skeletons[].width`, функция принимает `rows` | **CONTRACT_MISMATCH** |

Итоги: MATCH — 3, MATCH_WITH_ADAPTER — 11, CONTRACT_MISMATCH — 5, SPECIAL_COMPOSITION — 3, NO_PRODUCTION_SOURCE — 1 (пересечения: `history-filters` учитывается и как SPECIAL_COMPOSITION, и как требующий security review).

## 5. Исключения (FACT)

- **`shell/sidebar-brand.html`** — собственной функции нет: блок `.ds-brand` формируется внутри `sidebar()`. Структура фиксированная (2 значения, без условий), поэтому фрагмент можно получить из результата `sidebar()` с маркерными значениями и извлечь по границам `.ds-brand`.
- **`shell/sidebar-nav.html`** — формируется внутри `sidebar()` вместе с контейнером; содержит 4 блока (`sections`, `items`, `current`, `unsafe`) и доверенный `safeHref`. Возможно получение через дифференциальный рендеринг, но с наибольшим риском неточности.
- **`pages/history-filters.html`** — единственная функция страницы `historyFilters(active, from, to)`; контракт partial (`ranges[]`, `badgeClass`) не совпадает с функцией, которая сама формирует разметку кнопок из `RANGES`. Отдельная проблема безопасности: `from`/`to` подставляются в атрибуты `value="…"` **без `escapeHtml`** (production-дефект, зафиксирован в TPL-3.1).
- **`pages/forecast-mode-switcher.html`** — единой функции нет: переключатели собраны инлайн в двух страницах (`forecast-quality.ts`, `forecast-diagnostics.ts`) независимо. Производственного источника для генерации не существует; создание новой функции требует изменения `src/web/**`, что запрещено.

## 6. Контрактные расхождения (FACT)

1. `kpi-card`: partial — слот `{{{statusBadge}}}` под условием `{{#statusBadge}}`; функция — `status: DssStatus` и собственный вызов `statusBadge()`.
2. `data-table`: partial — `columns[]` + `rows[]` + `cells[]`; функция — `columns[]` + `rows[]` без промежуточных `cells`.
3. Графики: partial ожидает готовую геометрию (`path`, `cssClass`, `x`, `y`, `barWidth`, `barHeight`, `points`), функции вычисляют её внутри.
4. `loading-state`: partial — `skeletons[].width`; функция — `loadingState({ rows })` с внутренним расчётом ширин.
5. `sidebar-brand`, `sidebar-nav` — нет самостоятельных функций.
6. `history-filters`: контракт `ranges[]` против самостоятельной разметки; плюс отсутствие экранирования дат.
7. `forecast-mode-switcher`: нет производственной функции.
8. Эталоны уже переведены на production-функции в TPL-4.1 — дублирования разметки в `docs/ui/reference` больше нет.

## 7. Ключевой технический вывод (FACT + INFERENCE)

**FACT.** 18 из 22 partials содержат циклы или условия; 4 имеют фиксированную структуру: `cards/status-badge.html`, `charts/sparkline.html`, `shell/sidebar-brand.html`, `shell/topbar.html`.

**FACT.** Компоненты возвращают готовый HTML с подставленными значениями; обратного преобразования «HTML → шаблон с плейсхолдерами, циклами и условиями» ни в одном модуле нет.

**INFERENCE.** Прямая подстановка значений не позволяет восстановить шаблон. Возможны два подхода:

- **Подход 1 — дифференциальный рендеринг (рекомендуемый).** Компонент вызывается несколько раз: с маркерными значениями вместо строк, с одной и двумя позициями в массивах, с наличием и отсутствием необязательных свойств. Сравнение результатов даёт: значения → `{{name}}` или `{{{name}}}` (по факту экранирования), необязательные фрагменты → `{{#name}}…{{/name}}`, повторяющиеся фрагменты → `{{#items}}…{{/items}}`. Разметка не дублируется: источник — единственный вызов production-функции.
- **Подход 2 — ограниченный охват.** Генерировать только 4 partials с фиксированной структурой, остальные 18 пометить `MANUAL_REVIEW`.

Дополнительное следствие: даже при подходе 1 сгенерированные partials **не совпадут** с текущими вручную написанными, потому что production-контракт иной (например, `kpi-card` получит `{{#status}}` вместо `{{#statusBadge}}`, графики перестанут раскрывать геометрию). Это соответствует правилу «production component имеет приоритет», но означает, что действующие проверки `tests/web/templates-partials.test.ts` (552 строки) начнут падать и потребуют обновления под новый контракт.

## 8. Security review (FACT)

- Примитивы `src/web/lib/format.ts`: `escapeHtml`, `trusted`, `TrustedHtml`, `safeHref`, `isSafeHref`, `statusClass`, `statusLabel`, `formatNumber`, `formatPercent`, `formatDate`, `DssStatus`.
- Закрытый список доверенных слотов (11): `sidebar`, `topbar`, `content`, `brand`, `safeHref`, `right`, `body`, `chart`, `legend`, `kpiCard`, `statusBadge`.
- URL: `safeHref` допускает hash, относительные пути и http(s), запрещает `javascript:`, `data:`, `vbscript:`, `file:`, протокол-относительные ссылки и управляющие символы.
- Риск генерации: автоматическое определение «доверенности» слота по результату рендеринга может ошибочно пометить значение как `{{{…}}}`. Требование: доверенность определяется **только** по закрытому списку, а не по эвристике; любое расхождение — ошибка генерации.
- Существующий production-дефект: `from`/`to` в `historyFilters()` не экранируются; генерация не должна маскировать это, partial обязан сохранять экранируемые `{{from}}`/`{{to}}`.

## 9. План генерации (предложение для STAGE B)

1. `tools/templates/registry.ts` — типизированный реестр: partial → функция → fixture → путь → проверки.
2. `tools/templates/fixtures/*.ts` — типизированные наборы: маркерные значения, одна и две позиции массивов, наличие/отсутствие необязательных свойств.
3. `tools/templates/infer.ts` — дифференциальный вывод плейсхолдеров, условий и циклов.
4. `tools/templates/render.ts` — сборка partial и проверки (закрытый список доверенных слотов, запрет `javascript:`/`data:`, отсутствие незаменённых маркеров).
5. `tools/templates/generate.ts` — CLI с `--check`: генерация всех результатов в памяти, проверка, затем запись.
6. `tests/web/templates-generation.test.ts` — реестр, детерминированность, контракты, безопасность, граничные случаи.

## 10. Файлы, которые потребуется изменить (нужно подтверждение)

| Область | Причина |
|---|---|
| `tools/templates/**` (новые) | генератор partials |
| `src/web/templates/partials/**` (22 файла) | целевые артефакты генерации — **продуктовый каталог**, отличается от указанного в задании `docs/ui/templates/` |
| `src/web/templates/README.md` | пометка «файлы генерируются, вручную не правятся» |
| `tests/web/templates-partials.test.ts` | текущие проверки кодируют старый контракт (cells, skeletons, `statusBadge`) и будут падать после генерации |
| `docs/ui/templates-tpl-4-2-report.md` | отчёт этапа |

Вне области: `src/web/components/**`, `src/web/pages/**`, `main.ts`, `routing.ts`, `src/server/**`, `src/forecasting/**`, `data/**`, CSS, `package.json`, `docs/ui/reference/**` (эталоны перегенерировать не требуется), `tools/reference/**`.

## 11. Риски

1. **Инверсия шаблона эвристична** (подход 1): возможны неточности в границах блоков; требуется покрытие тестами и явный отказ генерации при неоднозначности.
2. **Изменение продуктового каталога** `src/web/templates/partials/` — расхождение с текстом задания; без подтверждения реализация не начинается.
3. **Падение существующих тестов** partials после смены контракта; их обновление — изменение проверок, что требует отдельного согласия.
4. **`forecast-mode-switcher`** не имеет производственного источника: генерация невозможна без создания новой функции в `src/web/**` (запрещено) либо без композиции из существующих компонентов (`statusBadge`/`card`) с ручным описанием структуры, что противоречит принципу единственного источника.
5. **`history-filters`**: генерация из `historyFilters()` даст разметку без `ranges[]`-контракта и может закрепить неэкранированные даты; требуется решение по безопасности.
6. **Детерминированность** обеспечивается только при отсутствии времени/случайности и фиксированном порядке реестра.

## 12. NOT_VERIFIED

- поведение дифференциального вывода на компонентах с вложенными условиями (`data-table`, `sidebar-nav`) — не проверялось, реализации нет;
- влияние генерации на визуальный паритет эталонов (эталоны используют компоненты напрямую, проверка TPL-3.1 остаётся в силе);
- точная реакция `tests/web/templates-partials.test.ts` на каждый из 22 сгенерированных файлов — не проверялась, так как генерация не выполнялась.

## 13. Рекомендация

**READY WITH CONDITIONS (STAGE A закрыт, реализация не начата).**

Условия для перехода к STAGE B:

1. подтвердить целевой каталог `src/web/templates/partials/` вместо отсутствующего `docs/ui/templates/`;
2. выбрать подход: **1** — дифференциальный вывод (полный охват с риском эвристики) или **2** — только 4 partials с фиксированной структурой;
3. разрешить обновление `tests/web/templates-partials.test.ts` и `src/web/templates/README.md`;
4. определить судьбу `forecast-mode-switcher.html` и `history-filters.html`: `MANUAL_REVIEW` (файл не генерируется) либо отдельное решение по производственной функции и экранированию дат.

Без этих решений реализация генератора либо затронет продуктовый код вне согласованной области, либо потребует ручного описания блоков, что противоречит принципу единственного источника разметки.
