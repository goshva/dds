# TPL-4.2 / STAGE B — аудит потребителей и архитектура генерации partials

> **Архитектурная поправка TPL-4.5.** Каталог `src/web/templates/partials/` удалён в TPL-4.4.
> Production HTML формируют `src/web/components/` и `src/web/pages/`; экранирование — `src/web/lib/format.ts`;
> актуальная документация архитектуры — `src/web/templates/README.md`; эталоны страниц — `docs/ui/reference/`
> (генератор `tools/reference/`). Исторические результаты ниже не изменялись.

**Дата:** 2026-11-27 · **HEAD:** `c162612ee33715a171b82e8bee20c6380e12e07c` · **Ветка:** `main` · **Режим:** только чтение, реализация не выполнялась

---

## 1. Executive summary

**Цель этапа:** установить фактических потребителей 22 HTML-partials и доказать, какие из них можно генерировать из production TypeScript-компонентов explicit-способом без дублирования HTML.

**Главный архитектурный вывод.** Ни один partial **не участвует в production runtime и в сборке**. Все 22 файла используются только тестами (`tests/web/templates-partials.test.ts`) и документацией (`src/web/templates/README.md`, `docs/ui/templates-*`). Каталог `dist/web` содержит один HTML-файл — `index.html`; копий partials в сборке нет. Шаблонного движка, собственного renderer и загрузчика partials в исходниках нет.

**Второй вывод.** Explicit-генерация без дублирования HTML технически возможна только там, где структура разметки фиксирована и полностью выражается объявленными слотами: это `cards/status-badge.html`, `shell/topbar.html`, `charts/sparkline.html`. Для остальных 19 файлов генерация требует ручного описания блоков `{{#…}}`/`{{^…}}` и границ фрагментов, то есть второго ручного описания шаблона — это противоречит принципу единственного источника разметки и запрещено заданием.

**Рекомендация:** `NO_GENERATOR_RECOMMENDED`. Частичные файлы следует оставить как замороженные справочные артефакты, а роль производной документации уже выполняют эталоны TPL-4.1, собираемые напрямую из production-компонентов.

## 2. Preflight (FACT)

| Проверка | Значение |
|---|---|
| `git rev-parse HEAD` | `c162612ee33715a171b82e8bee20c6380e12e07c` |
| `git branch --show-current` | `main` |
| staged / unstaged / untracked | 0 / 11 / 3 |
| Незавершённая работа TPL-4.1.1 | `diff.txt`, 7 эталонов, тест генерации, 2 модуля `tools/reference` — сохранены без изменений |
| Защищённые файлы | `diff.txt`, `-files --others --exclude-standard`, отчёты TPL-4.1.1 и TPL-4.2 inventory — не изменялись |
| Отклонения от STAGE A | нет: HEAD, staged, состав изменений совпадают; `diff.txt` не читался на запись |

## 3. Аудит потребителей в runtime

**Метод.** Просканированы 516 файлов в областях `src/`, `tests/`, `tools/`, `docs/`, `.github/` и корневые конфигурации; исключены `node_modules`, `.git`, `dist`, `screenshots`, `data`, `diff.txt`, `bun.lock`. Для каждого partial искались: полный путь `partials/<rel>`, имя файла `<base>.html`, а также слабые упоминания имени компонента рядом со словом partial.

**Замечание о методе (FACT).** Первый проход ошибочно исключил подкаталог `data/` внутри `src/web/templates/partials/`, поэтому два файла (`data/data-table.html`, `data/completeness-calendar.html`) выпали из выборки. Ошибка исправлена прямой проверкой теста: оба файла перечислены в `EXPECTED_FILES` (`tests/web/templates-partials.test.ts:32-33`) и проверяются контрактными тестами (строки 400–421, 528–532).

### 3.1 Анализ шаблонного движка (FACT)

| Проверка | Результат |
|---|---|
| Движки в зависимостях (`mustache`, `handlebars`, `eta`, `ejs`, `nunjucks`, `liquid`, `pug`, `hogan`) | нет |
| Собственный renderer/компилятор в `src/**`, `tools/**` | нет |
| Парсер `{{name}}` / `{{{name}}}` | отсутствует |
| Поддержка `{{#items}}`, `{{^items}}` | отсутствует |
| Runtime-компиляция шаблонов, registry шаблонов, загрузка partials по имени | отсутствует |
| Файловый fallback при отсутствии partials | отсутствует (нечего загружать) |

### 3.2 Загрузка файлов (FACT)

- `src/**`, загружающие partials: только `src/web/templates/README.md` (документация каталога, не код).
- Единственный потребитель файловой системы — `tests/web/templates-partials.test.ts`: `readdirSync` обходит каталог, читает все 22 файла (`readFileSync`), проверяет структуру, баланс блоков, camelCase, доверенные слоты, hash-allowlist и покрытие контрактом.
- Динамические импорты, `glob`, `fetch`, вычисляемые пути к partials — не обнаружены.

### 3.3 Production call graph (FACT)

`Hono → api/client.ts → main.ts → routing.ts → pages/*.ts → components/*.ts → lib/format.ts`.

Ни один узел этой цепочки не ссылается на `src/web/templates/partials/**`. Production-приложение работоспособно без каталога partials: файлы не импортируются, не читаются и не копируются при сборке (`dist/web` содержит только `index.html`). Экспериментальное удаление не выполнялось — вывод основан на отсутствии ссылок в коде, конфигурации Vite и выводе сборки.

### 3.4 Таблица потребителей (все 22 partials)

| Partial | Runtime | Build | Tests | Docs | Доказательство потребителя | Классификация |
|---|---|---|---|---|---|---|
| `cards/card.html` | нет | нет | да | да | `tests/web/templates-partials.test.ts` (EXPECTED_FILES, контракт), `src/web/templates/README.md`, `docs/ui/templates-contract.md` | TEST_ONLY + DOCUMENTATION_ONLY |
| `cards/chart-card.html` | нет | нет | да | да | те же файлы | TEST_ONLY + DOCUMENTATION_ONLY |
| `cards/kpi-card.html` | нет | нет | да | да | те же + `docs/ui/templates-tpl-2-report.md` | TEST_ONLY + DOCUMENTATION_ONLY |
| `cards/kpi-grid.html` | нет | нет | да | да | те же + `docs/ui/source-to-ui-mapping.md`, `docs/ui/preflight-audit.md` | TEST_ONLY + DOCUMENTATION_ONLY |
| `cards/provenance-drawer.html` | нет | нет | да | да | те же | TEST_ONLY + DOCUMENTATION_ONLY |
| `cards/status-badge.html` | нет | нет | да | да | те же | TEST_ONLY + DOCUMENTATION_ONLY |
| `charts/bar-chart.html` | нет | нет | да | да | те же | TEST_ONLY + DOCUMENTATION_ONLY |
| `charts/line-chart.html` | нет | нет | да | да | те же | TEST_ONLY + DOCUMENTATION_ONLY |
| `charts/sparkline.html` | нет | нет | да | да | те же + отчёты TPL-1/4.1 | TEST_ONLY + DOCUMENTATION_ONLY |
| `data/completeness-calendar.html` | нет | нет | да | да | `EXPECTED_FILES:32`, контрактные тесты | TEST_ONLY + DOCUMENTATION_ONLY |
| `data/data-table.html` | нет | нет | да | да | `EXPECTED_FILES:33`, тесты строк 400–421 | TEST_ONLY + DOCUMENTATION_ONLY |
| `pages/forecast-mode-switcher.html` | нет | нет | да | да | `EXPECTED_FILES`, отчёты TPL-1.1/4.2 | TEST_ONLY + DOCUMENTATION_ONLY |
| `pages/history-filters.html` | нет | нет | да | да | `EXPECTED_FILES`, договор о hash-ссылках | TEST_ONLY + DOCUMENTATION_ONLY |
| `shell/app-shell.html` | нет | нет | да | да | те же | TEST_ONLY + DOCUMENTATION_ONLY |
| `shell/page-header.html` | нет | нет | да | да | те же | TEST_ONLY + DOCUMENTATION_ONLY |
| `shell/sidebar-brand.html` | нет | нет | да | да | те же | TEST_ONLY + DOCUMENTATION_ONLY |
| `shell/sidebar-nav.html` | нет | нет | да | да | те же | TEST_ONLY + DOCUMENTATION_ONLY |
| `shell/sidebar.html` | нет | нет | да | да | те же | TEST_ONLY + DOCUMENTATION_ONLY |
| `shell/topbar.html` | нет | нет | да | да | те же | TEST_ONLY + DOCUMENTATION_ONLY |
| `states/empty-state.html` | нет | нет | да | да | те же | TEST_ONLY + DOCUMENTATION_ONLY |
| `states/error-state.html` | нет | нет | да | да | те же | TEST_ONLY + DOCUMENTATION_ONLY |
| `states/loading-state.html` | нет | нет | да | да | те же | TEST_ONLY + DOCUMENTATION_ONLY |

**Итоги:** production runtime — **0**; build — **0**; только тесты — **22** (100 %); только документация — **22**; полностью неиспользуемые — **0**; `UNKNOWN` — **0**.

## 4. Реализуемость явной генерации

### Variant A — production renderer + явные метаданные шаблона

Идея: вызвать production-функцию с фикстурой, в которой строковые значения заменены уникальными токенами, затем заменить токены на объявленные в registry плейсхолдеры; блоки и циклы объявляются в registry явно.

- для **фиксированной структуры** (`statusBadge`, `topbar`, `sparkline`) — реализуемо: все значения проходят через объявленные слоты, разметка целиком приходит из компонента;
- для **циклов и условий** (`kpi-grid`, `data-table`, `completeness-calendar`, `sidebar`, `line-chart`, `bar-chart`, состояния) — нереализуемо без ручного описания границ блоков: рендер с одной позицией массива даёт один элемент, и определить, что именно повторяется и где начинается `{{#items}}`, можно только сравнением результатов (дифференциальный подход — запрещён) либо ручной разметкой блока (дублирование шаблона).

**Вердикт:** YES для 3 partials, NO для остальных.

### Variant B — production renderer + явные фрагменты исходного кода

- `shell/sidebar-brand.html`, `shell/sidebar-nav.html` формируются внутри `sidebar()`; отдельные функции отсутствуют. Выделение фрагмента возможно только разбором HTML результата по DOM-границам, то есть regex/парсингом HTML — запрещено.
- `cards/kpi-grid.html` требует разделения списка карточек: `kpiGrid(items)` возвращает карточки, вставленные подряд; восстановление `{{#items}}` требует знания границ — только ручное описание.
- `shell/app-shell.html` содержит три доверенных слота и условный `{{#menuOpen}}`; слоты можно объявить явно, но условие закрытия/открытия scrim задаётся внутри компонента и неотделимо без ручного блока.

**Вердикт:** NO для четырёх перечисленных случаев; ручное повторение DOM неизбежно.

### Variant C — partials как исторические артефакты

Production-компоненты уже являются единственным источником HTML; partials не используются ни runtime, ни сборкой; производная документация обеспечена эталонами TPL-4.1, которые вызывают те же компоненты. Прекращение ручной поддержки partials не влияет ни на приложение, ни на тесты, кроме самих контрактных тестов.

**Вердикт:** YES — минимальный риск, отсутствие второго источника истины, сохранение всех 22 путей.

### Матрица реализуемости

| Partial | Production source | Explicit adapter | Дублирование HTML | Feasibility | Decision |
|---|---|---|---|---|---|
| `cards/status-badge.html` | `statusBadge()` | объявленные слоты `statusClass`, `text` | нет | YES | GENERATE |
| `shell/topbar.html` | `topbar()` | объявленные слоты значений и производный класс | нет | YES | GENERATE |
| `charts/sparkline.html` | `sparkline()` | объявленные `width`, `height`, `points` | нет | YES | GENERATE |
| `cards/card.html` | `card()` | требует ручного блока `{{#title}}` | шаблонный блок | YES_WITH_LIMITATIONS | KEEP_MANUAL |
| `cards/chart-card.html` | `chartCard()` | то же для `hint`, `legend` | шаблонный блок | YES_WITH_LIMITATIONS | KEEP_MANUAL |
| `cards/kpi-card.html` | `kpiCard()` | контракт изменён (слот `statusBadge` против `status`) | шаблонный блок | YES_WITH_LIMITATIONS | KEEP_MANUAL |
| `cards/kpi-grid.html` | `kpiGrid()` | нужен ручной цикл по карточкам | шаблонный блок | NO | KEEP_MANUAL |
| `cards/provenance-drawer.html` | `provenanceDrawer()` | ручной блок `{{#note}}` | шаблонный блок | YES_WITH_LIMITATIONS | KEEP_MANUAL |
| `charts/bar-chart.html` | `barChart()` | геометрия не выходит наружу, нужен ручной цикл | блок + данные | NO | KEEP_MANUAL |
| `charts/line-chart.html` | `lineChart()` | два ручных цикла (сетка, серии) | блок + данные | NO | KEEP_MANUAL |
| `data/completeness-calendar.html` | `completenessCalendar()` | ручной цикл по дням | шаблонный блок | NO | KEEP_MANUAL |
| `data/data-table.html` | `dataTable()` | контракт `cells` отсутствует, нужны циклы строк и ячеек и inverse-ветка | блок + данные | NO | KEEP_MANUAL |
| `pages/forecast-mode-switcher.html` | отсутствует | — | — | MANUAL_REVIEW | KEEP_MANUAL |
| `pages/history-filters.html` | `historyFilters()` | контракт `ranges[]` не совпадает; даты без экранирования | шаблонный блок | MANUAL_REVIEW | KEEP_MANUAL |
| `shell/app-shell.html` | `appShell()` | ручное условие `{{#menuOpen}}` | шаблонный блок | YES_WITH_LIMITATIONS | KEEP_MANUAL |
| `shell/page-header.html` | `pageHeader()` | ручное условие `{{#subtitle}}` | шаблонный блок | YES_WITH_LIMITATIONS | KEEP_MANUAL |
| `shell/sidebar.html` | `sidebar()` | ручные циклы секций и пунктов | шаблонный блок | NO | KEEP_MANUAL |
| `shell/sidebar-brand.html` | внутри `sidebar()` | выделение фрагмента запрещено | — | NO | KEEP_MANUAL |
| `shell/sidebar-nav.html` | внутри `sidebar()` | выделение фрагмента запрещено | — | NO | KEEP_MANUAL |
| `states/empty-state.html` | `emptyState()` | ручное условие `{{#detail}}` | шаблонный блок | YES_WITH_LIMITATIONS | KEEP_MANUAL |
| `states/error-state.html` | `errorState()` | два ручных условия | шаблонный блок | YES_WITH_LIMITATIONS | KEEP_MANUAL |
| `states/loading-state.html` | `loadingState()` | контракт `skeletons` против `rows`, нужен цикл | блок + данные | NO | KEEP_MANUAL |

Итого: `GENERATE` — 3, `KEEP_MANUAL` — 19, `BLOCKED` — 0.

## 5. Проверка безопасности

- **Примитивы** (`src/web/lib/format.ts`, 85 строк): `escapeHtml`, `trusted`, `TrustedHtml`, `safeHref`, `isSafeHref`, `statusClass`, `statusLabel`, `formatNumber`, `formatPercent`, `formatDate`, `DssStatus`.
- **Trusted slots (11)** используются строго внутри компонентов: `sidebar`, `topbar`, `content`, `brand` — `shell.ts`; `right`, `body`, `chart`, `legend`, `kpiCard`, `statusBadge` — `cards.ts`/`pages`; `safeHref` — `shell.ts` через `safeHref()`.
- **URL-allowlist:** `safeHref` пропускает `#`, относительные пути и `http(s)`, блокирует `javascript:`, `data:`, `vbscript:`, `file:`, протокол-относительные и управляющие символы. Hash-ссылки в page-partials ограничены allowlist маршрутов и перечислимыми сегментами (проверено тестами TPL-1.1).
- **Экранирование:** все значения API проходят `escapeHtml` внутри компонентов; частичные файлы используют `{{value}}` для экранируемых и `{{{value}}}` только для 11 объявленных слотов.
- **Известный дефект (P2, не исправлялся):** `pages/history.ts:41-53` — `historyFilters(active, from, to)` подставляет `from`/`to` в `value="…"` без `escapeHtml`. Достижимость ограничена проверкой формата `^\d{4}-\d{2}-\d{2}$` в `main.ts`, поэтому инъекция атрибута практически недостижима, но защита зависит от вызывающей стороны. Partial `pages/history-filters.html` строже production-кода (`{{from}}`, `{{to}}`).
- **Риск генерации (учтён):** автоматическая маркировка доверенности по результату рендера запрещена; доверенность определяется только закрытым списком из 11 имён. При реализации подхода с фиксированной структурой это правило проверяемо.
- Дополнительных дефектов безопасности в рамках аудита не выявлено.

## 6. Стратегия тестирования

`tests/web/templates-partials.test.ts` (552 строки, 102 теста) — статический аудит разметки: обход каталога, `EXPECTED_FILES` (22 имени), отсутствие пустых файлов, баланс блоков, баланс парных тегов, camelCase, отсутствие выражений, закрытый перечень доверенных слотов и его совпадение с документом, hash-allowlist, структура `data-table`, контракт `loading-state`, подготовка геометрии SVG, покрытие всех partials таблицей контракта, согласованность README.

| Категория проверок | Судьба после генерации |
|---|---|
| Безопасность: доверенные слоты, отсутствие двойных скобок у слотов, hash-allowlist, отсутствие внешних ссылок | **сохранить** (реальные инварианты безопасности) |
| Структурные: баланс блоков и тегов, отсутствие пустых файлов, camelCase | **переписать** под новые артефакты (проверять сгенерированный результат) |
| Контрактные: `data-table` (`cells`), `loading-state` (`skeletons`), `kpi-card` (`statusBadge`), геометрия графиков | **устаревают**: кодируют ручной контракт, противоречащий production-API |
| Покрытие: 22 файла в таблице контракта, согласованность README | **сохранить**, при генерации — переориентировать на реестр |
| Отсутствие незаменённых плейсхолдеров в готовом HTML | **неприменимо** к partials (это шаблоны); относится к эталонам |

**Рекомендуемая матрица новых проверок (для STAGE C, если он состоится):** полнота реестра (все зарегистрированные partials существуют, дубликатов нет, каждый вызывает production-функцию); соответствие fixture типам; детерминированность (два прогона, SHA-256); целостность артефактов; безопасность (экранирование `& < > " '`, `javascript:`, `data:`, неизвестные схемы, закрытый список trusted slots); неизменность файлов при ошибке; режим `--check` (не изменяет файлы, возвращает ненулевой код при расхождении); явный список исключений (legacy/manual).

## 7. Архитектурное решение

**Выбранный вариант: C — partials остаются замороженными справочными артефактами; генератор partials не создаётся.**

Основания:

1. ни один partial не имеет runtime- или build-потребителя (доказано отсутствием ссылок в `src/**`, `vite.config.ts`, `package.json`, отсутствием копий в `dist/web`);
2. производная документация уже обеспечена эталонами TPL-4.1, которые вызывают production-компоненты напрямую;
3. explicit-генерация без дублирования HTML достижима только для 3 из 22 файлов; для остальных 19 требуется ручное описание шаблонных блоков, что создаёт второй ручной источник шаблонной структуры и может разойтись с компонентами;
4. создание `tools/templates/**` и CLI добавило бы сопровождение без влияния на продукт.

**Если пользователь настаивает на генерации**, минимальная безопасная конфигурация: реестр на 3 partials (`status-badge`, `topbar`, `sparkline`), типизированные фикстуры, явные объявления слотов, режим `--check`, обновление контрактных тестов; остальные 19 файлов помечаются `KEEP_MANUAL` с указанием причины. Ценность: поддержание трёх файлов в согласии с кодом.

**Границы ответственности при любом варианте:** production-компоненты — единственный источник HTML; страницы — композиция и данные; `lib/format.ts` — экранирование и форматирование; эталоны `docs/ui/reference/**` — визуальная документация; partials — справочный контракт без runtime-роли.

## 8. Files for STAGE C

| File | Action | Reason | Permission |
|---|---|---|---|
| — | — | при рекомендации `NO_GENERATOR_RECOMMENDED` изменения не требуются | — |
| `src/web/templates/README.md` | возможная пометка «справочный артефакт, не генерируется» | устранить ожидание автоматической синхронизации | разрешено пользователем в STAGE C |
| `tests/web/templates-partials.test.ts` | возможная пометка устаревших контрактных проверок | контракт `cells`/`skeletons`/`statusBadge` противоречит production | разрешено пользователем в STAGE C |
| `tools/templates/**` | не создавать (рекомендация) | отсутствие потребителей и дублирование шаблонной структуры | требуется решение |
| `docs/ui/templates-tpl-4-2-stage-b-report.md` | создан | отчёт этапа | — |

## 9. NOT_IMPLEMENTED

Генератор partials не создан; `tools/templates/**` не существует; CLI и режим `--check` не реализованы; partials не изменялись; тесты и README не изменялись; production-код не изменялся.

## 10. NOT_VERIFIED

- влияние удаления каталога partials на внешние процессы (CI отсутствует, workflows не найдены) — проверено только по отсутствию ссылок;
- поведение сгенерированных артефактов для 3 «feasible» partials — реализация не выполнялась, вывод основан на анализе кода;
- точная судьба каждого из 102 тестов после гипотетической генерации — проверка не выполнялась (тесты не запускались для изменённых артефактов, так как изменений нет);
- наличие внешних (внерепозиторных) потребителей partials — вне области проверки.

## 11. Risks

| Приоритет | Риск | Пояснение |
|---|---|---|
| P1 | Двойной источник шаблонной структуры | генерация 19 partials требует ручных блоков `{{#…}}`, которые могут разойтись с компонентами |
| P1 | Ложная уверенность в синхронизации | наличие генератора не гарантирует соответствие, если блоки описаны вручную |
| P2 | Устаревшие контрактные тесты | проверки `cells`/`skeletons`/`statusBadge` не отражают production-API и могут вводить в заблуждение |
| P2 | Неэкранированные `from`/`to` в `historyFilters()` | защита зависит от вызывающей стороны; partial строже production |
| P3 | Справочные partials устаревают | при изменении компонентов документация-контракт расходится; роль живой документации выполняют эталоны TPL-4.1 |

## 12. Acceptance matrix

| Критерий | Результат | Доказательство |
|---|---|---|
| Проверены все 22 partials | PASS | обход каталога + прямая проверка `EXPECTED_FILES` |
| Проверены статические и динамические способы загрузки | PASS | поиск импортов, `readFileSync`, `glob`, `fetch`, вычисляемых путей — не найдено |
| Исследован runtime template engine | PASS | зависимостей-движков нет, renderer/парсер/registry отсутствуют |
| Установлено фактическое использование | PASS | 22 TEST_ONLY + DOCUMENTATION_ONLY; runtime 0, build 0 |
| Доказательство или UNKNOWN для каждого partial | PASS | таблица раздела 3.4; UNKNOWN — 0 |
| Проверены три архитектурных варианта | PASS | раздел 4 |
| Исключена эвристическая реконструкция | PASS | дифференциальный подход и regex-парсинг HTML отклонены как запрещённые |
| Проверена возможность explicit generation | PASS | реализуемо для 3 файлов, невозможно без дублирования для 19 |
| Оценено дублирование HTML | PASS | матрица реализуемости, колонка «Дублирование HTML» |
| Проверены trusted slots и escaping | PASS | раздел 5 |
| Изучены существующие тесты | PASS | 552 строки, категоризация в разделе 6 |
| Подготовлена тестовая стратегия | PASS | раздел 6 |
| Составлен минимальный план STAGE C | PASS | раздел 8 (рекомендация — без генератора) |
| Создан итоговый отчёт | PASS | этот документ |
| Другие файлы не изменены | PASS | Git status: изменён только новый отчёт |

## 13. Recommendation

**`NO_GENERATOR_RECOMMENDED`** — генератор partials не требуется: у partials нет runtime- и build-потребителей, а explicit-генерация без дублирования HTML возможна лишь для 3 из 22 файлов. Живую документацию разметки уже дают эталоны TPL-4.1, собранные из production-компонентов.

Альтернатива при отдельном решении пользователя: `READY_WITH_LIMITATIONS` — минимальный явный генератор для `status-badge`, `topbar`, `sparkline` с реестром, типизированными фикстурами, `--check` и обновлением контрактных тестов; остальные 19 partials — `KEEP_MANUAL`, `forecast-mode-switcher` и `history-filters` — `MANUAL_REVIEW`.
