# TPL-4.1 — детерминированный генератор эталонов: отчёт

**Дата:** 2026-11-27 · **Исходный HEAD:** `c6efe8479a2dc8b4a4823be6abc9aa0889ffe867` · **Ветка:** `main`
**Итоговый статус:** `ACCEPTED WITH LIMITATIONS`

---

## 1. Preflight (FACT)

| Проверка | Значение |
|---|---|
| `git rev-parse HEAD` | `c6efe8479a2dc8b4a4823be6abc9aa0889ffe867` — совпадает с ожидаемым |
| `git branch --show-current` | `main` |
| `git status --short` (до) | ` M diff.txt` + 3 untracked документа TPL-4.0 |
| staged / unstaged / untracked (до) | 0 / 1 / 3 |
| Существует | 22 partials, 6 модулей компонентов, 5 страниц, 6 эталонов, production CSS (5 файлов) |
| `diff.txt` | 219 637 Б, не изменялся |

## 2. Карта страниц и production-функций (FACT)

| Страница эталона | Production-источник | Особенность |
|---|---|---|
| `index.html` | `appShell`, `sidebar`, `topbar`, `pageHeader`, `card`, `statusBadge` | индекс с описанием и командой генерации |
| `overview.html` | атомарные компоненты (`card`, `kpiGrid`, `provenanceDrawer`, `chartCard`, `lineChart`, `dataTable`, `completenessCalendar`) | отдельной production-функции обзора нет — используется реальная композиция из `main.ts` |
| `history.html` | `historyPage()` | контролируемые даты, не пользовательский ввод; показаны полный и произвольный диапазоны |
| `quality.html` | `dataQualityPage()`, `buildCalendar()`, `completenessCalendar()` | все четыре статуса календаря |
| `provenance.html` | `provenancePage()` | обычное и устаревшее состояние актуальности |
| `forecast-quality.html` | `forecastQualityPage()` | теневой h1 (`INSUFFICIENT`) и исторический h3 (`NOT_AVAILABLE`) |
| `forecast-diagnostics.html` | `forecastDiagnosticsPage()` | доступные данные, недоступное quality, недоступные errors, пустой список, ошибка API |

Фикстуры: `tools/reference/fixtures/{common,overview,history,quality,provenance,forecast-quality,forecast-diagnostics}.ts` — типизированы реальными интерфейсами (`HistoryDto`, `CoverageDto`, `QualityDto`, `ForecastErrorsDto`, `OverviewForProvenance`, `ApiResult`), синтетические, без времени и случайности.

## 3. Созданные и изменённые файлы (FACT)

**Созданы:** `tools/reference/generate.ts` (51 строка), `tools/reference/render-page.ts` (58), `tools/reference/render-shell.ts` (68), `tools/reference/fixtures/common.ts` (63), `fixtures/overview.ts` (70), `fixtures/history.ts` (73), `fixtures/quality.ts` (30), `fixtures/provenance.ts` (46), `fixtures/forecast-quality.ts` (51), `fixtures/forecast-diagnostics.ts` (46), `tests/web/reference-generation.test.ts`, `docs/ui/templates-tpl-4-1-report.md`.

Все модули генератора ≤ 200 строк (правило проекта соблюдено).

**Изменены (перегенерированы):** `docs/ui/reference/index.html` и `docs/ui/reference/pages/*.html` (6 файлов).

**Не изменялись:** production-компоненты, страницы, `main.ts`, `routing.ts`, API, сервер, CSS, forecasting, SQLite, JSONL, CSV, manifest, partials, шаблонный контракт, `package.json`, `diff.txt`.

## 4. Детерминированность (FACT)

Команда: `bun tools/reference/generate.ts`. Два последовательных прогона дали идентичные SHA-256 всех семи файлов:

| Файл | SHA-256 (финальная ревизия) |
|---|---|
| `docs/ui/reference/index.html` | `d39a8da796f0ab679120d383f12ad57c8e2122f4fe5677a54fa3ea590e96081c` |
| `pages/overview.html` | `fb9e921eb910cf038bc1d50d5eb34a1fd962379710ef80e8ced1ef07f00a9ca7` |
| `pages/history.html` | `b54c533c3fc18135c33632b7f972f29f65318d644b2b939beee9600faa24e682` |
| `pages/quality.html` | `908ec36ee5ec048cc6b405e89c1d426833b3092bab160fed7e6c95e88ad1920e` |
| `pages/provenance.html` | `37fb972030a5cb7aab28df53579e609e641f44d56fd22a49304dce6ab6cf5c53` |
| `pages/forecast-quality.html` | `e1922c991044ad308ae3de3bc91a5c3573f43d9fce0d7ac7f03f87a51e7faa9d` |
| `pages/forecast-diagnostics.html` | `f84eb93727d387376f89fc1c1c06acc6188cb160ad444306fa1cb603f937314d` |

Источники детерминированности: фиксированная метка `2026-01-01T00:00:00.000Z`, отсутствие `Date.now()`, `new Date()`, `Math.random()`, сети, API, SQLite, JSONL и зависимости от файловой системы. Добавлена косметическая нормализация завершающих пробелов (не влияет на разметку, устраняет замечания `git diff --check`).

## 5. Тесты (FACT)

| Команда | Результат |
|---|---|
| `bun test tests/web/reference-generation.test.ts` | **17 pass / 0 fail** |
| `bun test tests/web` | **267 pass / 0 fail** |
| `bunx tsc --noEmit` | 0 ошибок |
| `bun run ui:build` | exit 0 |
| `git diff --check` (tools/reference, tests, docs/ui/reference) | exit 0 |
| PII gate (новые исходники) | GATE PASS |

Промежуточный результат (зафиксирован): первый прогон тестов — 15 pass / 2 fail, причины — отсутствие маркера `PROVISIONAL` на странице истории и отсутствие блока состояний (`loadingState`/`emptyState`/`errorState`). Исправлено добавлением общего блока «Состояния и семантика»; повторный прогон — 17 pass / 0 fail.

## 6. Браузерная проверка (FACT)

Chrome for Testing 159.0.8154.6, DevTools Protocol, ожидание готовности (шрифты, изображения, двойной `requestAnimationFrame`), 6 страниц × 6 ширин = **36 снимков** (сохранены вне репозитория, в `C:/Temp/tpl41-shots`, чтобы не нарушать allowlist этапа):

| Показатель | Результат |
|---|---|
| Снимков | 36 |
| CSS загружен (переменная `--ds-ink` доступна) | 36 / 36 |
| Горизонтальный overflow | 0 |
| Ошибки JavaScript (error, unhandledrejection) | 0 |
| Каркас приложения (`.ds-app`) присутствует | 36 / 36 |

Первый прогон проверки выполнен до нормализации пробелов; после нормализации проверка повторена (изменение — только завершающие пробелы, разметка и геометрия не затрагиваются).

## 7. Данные (FACT)

| Объект | Значение |
|---|---|
| `data/forecast/forecasting.sqlite` | идентично базовому (`identical: true`) |
| `data/catalog.sqlite` | `09e827205ada06b7…` |
| `forecasts.jsonl` | `e35fe27b002e42cc…` |
| `reconciliations.jsonl` | `32ccd25604ae78b3…` |
| `manifest.json` | `9d986747771c5fd1…` |
| `errors.jsonl` | отсутствует (не создавался) |

Прогнозные команды не запускались.

## 8. Git (FACT)

| Параметр | До | После |
|---|---|---|
| HEAD | `c6efe8479a2dc8b4a4823be6abc9aa0889ffe867` | тот же |
| staged | 0 | 0 |
| unstaged | 1 (`diff.txt`) | 8 (`diff.txt` + 7 перегенерированных HTML) |
| untracked | 3 (документы TPL-4.0) | 14 (документы TPL-4.0, `tools/reference/**`, тест, отчёт) |

`git add`, commit, push, reset, restore, clean, checkout, switch, stash, rebase не выполнялись; история не изменялась; `diff.txt` не изменялся.

## 9. Использованные production-функции (FACT)

`appShell`, `sidebar`, `topbar`, `pageHeader`, `card`, `chartCard`, `kpiGrid`, `statusBadge`, `provenanceDrawer`, `lineChart`, `dataTable`, `completenessCalendar`, `emptyState`, `loadingState`, `errorState`, `historyPage`, `dataQualityPage`, `buildCalendar`, `provenancePage`, `forecastQualityPage`, `forecastDiagnosticsPage`. Собственных реализаций компонентов и копий их разметки в генераторе нет; `barChart`, `sparkline`, `kpiCard` доступны, но не используются текущими композициями (страницы их не применяют).

## 10. CLAIM

- «Эталоны построены из partials» — не подтверждается и не утверждается: источник — production-компоненты.
- «Генерация использует API или реальные данные» — опровергнуто: фикстуры синтетические, обращений нет.

## 11. INFERENCE

- Совпадение SHA-256 при повторных прогонах и отсутствие источников недетерминированности в коде означают, что генерацию можно включать в проверки (сравнение артефактов) без риска ложных диффов.
- Различия между эталоном и production теперь ограничены набором данных, а не разметкой: разметка приходит из одних и тех же функций.

## 12. NOT_IMPLEMENTED

- скрипт `ui:reference` в `package.json` (изменение файла не входит в allowlist этапа);
- генерация partials из компонентов (TPL-4.2);
- удаление или депрекация partials (TPL-4.4);
- интерактивные состояния (переключение режимов и фильтров) в эталонах;
- попиксельное сравнение с production (эталон — документационный артефакт).

## 13. NOT_VERIFIED

- визуальный просмотр изображений человеком (модель не имеет визуального восприятия); проверены загрузка CSS, геометрия, отсутствие overflow и ошибок JS;
- поведение при экстремально длинных значениях, отсутствующих в фикстурах;
- полный паритет с production по данным невозможен по определению: эталон использует синтетический набор.

## 14. Ограничения

- страница «Обзор» не имеет production-функции: композиция воспроизведена вызовом тех же атомарных компонентов, что и в `main.ts` (копирование разметки исключено, но состав секций задаётся генератором);
- `historyFilters()` подставляет `from`/`to` без `escapeHtml` (production-дефект, зафиксирован в TPL-3.1); эталон передаёт только контролируемые синтетические даты формата `YYYY-MM-DD`;
- генератор — документационный инструмент и не входит в production-runtime; ссылок из `src/web` на него нет.
