# Отчёт TPL-1.1 — упрочнение проверки контрактов

**Дата:** 2026-11-27 · **Исходный HEAD:** `6e84af17cc1586f425777efb79b62e1086f36f2a` («disign») · **Ветка:** `main`
**Вердикт:** `ACCEPTED WITH LIMITATIONS` (незакрытых P1 нет; документированные P2 и NOT_VERIFIED — разделы 15 и 17)

---

## 1. Краткое резюме

Проверка контрактов partials усилена, происхождение контрольных сумм TPL-1 установлено, аудит production-генерации hash-ссылок выполнен. Изменены только разрешённые файлы: тесты, `README.md` шаблонов и документ контрактов. Partial-файлы в этом этапе не изменялись (нормализация выполнена в TPL-1). Production-код, страницы, маршрутизация, компоненты и данные не изменялись.

Главные результаты:

- hash-ссылки проверяются позиционно: маршрут, число сегментов, допустимые placeholder-имена, допустимые литеральные значения; 20 недопустимых примеров отклоняются тестовым валидатором;
- тесты по таблице, состоянию загрузки, графикам и доверенным слотам проверяют структуру и поведение компонентов, а не только наличие токенов;
- 102 теста partials проходят, `tsc` чист, PII gate PASS;
- контрольные суммы TPL-1 воспроизводимы: SHA-256 по конкатенации сырых байтов 22 partials в лексикографическом порядке путей, в отчёте TPL-1 приведены первые 32 hex-символа.

## 2. Исходное состояние Git

| Параметр | Значение |
|---|---|
| HEAD | `6e84af17cc1586f425777efb79b62e1086f36f2a` |
| Ветка | `main` |
| staged | 0 |
| unstaged | 9 |
| untracked | 3 |
| Базовый прогон partials | 95 pass / 0 fail |

Изменённые до начала этапа: `diff.txt` (внешнее изменение), `src/web/templates/README.md`, 6 partials, `tests/web/templates-partials.test.ts`. Untracked: `docs/ui/templates-contract.md`, `docs/ui/templates-inventory.md`, `docs/ui/templates-tpl-1-report.md`.

**FACT:** `diff.txt` изменён не этим этапом: в preflight TPL-1 он не был изменён, ни одна команда этапа в него не пишет. Файл не трогали, не восстанавливали и не форматировали.

## 3. Проверенные файлы

- `docs/ui/templates-inventory.md`, `docs/ui/templates-contract.md`, `docs/ui/templates-tpl-1-report.md`;
- `src/web/templates/README.md`, все 22 partials (включая `history-filters.html`, `forecast-mode-switcher.html`, `app-shell.html`, `kpi-card.html`, `data-table.html`, `loading-state.html`);
- `src/web/components/` (`cards.ts`, `charts.ts`, `data.ts`, `shell.ts`, `states.ts`, `index.ts`);
- `src/web/pages/history.ts`, `src/web/pages/forecast-quality.ts`, `src/web/routing.ts`;
- `src/web/lib/format.ts`, `tests/web/templates-partials.test.ts`.

## 4. Изменённые файлы

| Файл | Изменение |
|---|---|
| `tests/web/templates-partials.test.ts` | блок TPL-1 заменён усиленным блоком TPL-1.1: валидатор `checkHashHref`, позиционные проверки, поведенческие тесты компонентов |
| `docs/ui/templates-contract.md` | добавлены разделы 15 (позиционные правила hash-ссылок) и 16 (ограничения автоматических проверок) |
| `src/web/templates/README.md` | добавлен раздел «Уточнения TPL-1.1» со ссылками на контракт |
| `docs/ui/templates-tpl-1-1-report.md` | создан: этот отчёт |

**Не изменялись:** partials (нормализованы в TPL-1), `src/web/components/**`, `src/web/pages/**`, `main.ts`, `routing.ts`, API и сервер, forecasting core, данные, стили, `package.json`, lock-файлы, конфигурация сборки, другие тесты.

**Условный файл:** `src/web/components/history-filters.ts` **не существует** — условие allowlist неприменимо, файл в diff отсутствует.

## 5. Аудит hash-маршрутов

| Маршрут | Сегментов | Позиция 1 | Позиция 2 |
|---|---:|---|---|
| `#history/` | 1 | `key`: `all`, `30`, `90`, `180`, `365` | — |
| `#forecast-quality/` | 2 | `mode`: `replay`, `shadow` | `horizon`: `1`, `3` |

Валидатор `checkHashHref` отклоняет: посторонние маршруты, недопустимые значения, пустые и лишние сегменты, query-строку, процентное кодирование, управляющие символы, схемы и протокол-относительные ссылки, иной регистр.

Проверенные недопустимые примеры (все отклоняются): `#admin/`, `#history/unknown`, `#history/999`, `#forecast-quality/production/1`, `#forecast-quality/replay/7`, `#history/`, `#history/all/extra`, `#forecast-quality/shadow`, `#forecast-quality/shadow/1/extra`, `#forecast-quality/replay/`, `#history/ALL`, `#History/all`, `#history/all?x=1`, `#history/%61ll`, `#history/all` с управляющим символом, `javascript:alert(1)`, `//evil.example.com`, `https://evil.example.com`, пустая строка.

Фактические href в partials: `{{{safeHref}}}` (навигация), `#history/{{key}}`, `#forecast-quality/{{mode}}/{{horizon}}` — соответствуют контракту.

## 6. Аудит производственной генерации ссылок

| Место | Факт |
|---|---|
| `src/web/pages/history.ts:42-43` | `href="#history/${range.key}"`, ключи берутся из `RANGES` (allowlist) |
| `src/web/pages/forecast-quality.ts:95-98` | режим — из литерала `["replay","shadow"]`, горизонт — из `[1,3]` и `input.horizon` (тип `1 \| 3`) |
| `src/web/components/shell.ts:26` | навигация строится через `safeHref(item.href)` |
| `src/web/routing.ts:48-65` | неизвестная страница → `history`; `forecastParams` нормализует режим и горизонт к `shadow`/`1` |

**AC-06/AC-07:** производственная генерация hash-ссылок использует только литералы и allowlist, обход URL-allowlist через динамические значения не обнаружен.

**Найденное расхождение (P2, вне allowlist):** `src/web/pages/history.ts:48-49` подставляет `value="${from}"` и `value="${to}"` без `escapeHtml()`. Достижимость ограничена: `rangeToQuery` в `main.ts` пропускает только значения формата `^\d{4}-\d{2}-\d{2}$`, иначе отображается состояние ошибки. Partial `history-filters.html` строже production-кода — использует экранируемые `{{from}}`/`{{to}}`. Исправление требует `src/web/pages/**`, что запрещено этим этапом → зафиксировано как NOT_IMPLEMENTED, а не исправлено.

## 7. Проверка контракта таблицы

- порядок блоков: `{{#columns}}` → `{{#rows}}` → `{{#cells}}` → `{{/cells}}` → `{{/rows}}` → `{{^rows}}`;
- пустая ветка использует `{{columnCount}}` и не содержит `{{value}}`;
- вычислений и форматирования нет (`formatNumber`, `escapeHtml`, `toFixed` отсутствуют);
- поведенческая проверка компонента: `dataTable()` с двумя колонками и `numeric` даёт две ячейки и класс `is-num`.

## 8. Проверка контракта состояния загрузки

- partial принимает подготовленный массив: `{{#skeletons}}` + `{{width}}`, без `rows` и без вычислений;
- публичный API `loadingState({ rows })` формирует массив сам: `rows: 3` → 3 скелетона, `rows: 1` → 1, пустой вызов → не менее одного;
- различие «публичный API — внутреннее представление» подтверждено поведенчески, а не только по разметке.

## 9. Проверка контракта графиков

- атрибуты геометрии (`x1`, `y1`, `x2`, `y2` и позиционные `x`, `y`, `width`, `height`) содержат только плейсхолдеры, числовых литералов нет;
- `lineChart()` вычисляет путь (`d="M… L…"`), partial не содержит вычисленных координат;
- текстовые подписи экранируются, доверенные фрагменты формируются компонентами.

## 10. Согласованность доверенных слотов

- раздел 4 контракта, тестовый перечень и фактическое использование в partials совпадают: `sidebar`, `topbar`, `content`, `brand`, `safeHref`, `right`, `body`, `chart`, `legend`, `kpiCard`, `statusBadge` (11 имён);
- доверенные слоты не встречаются с двойными скобками;
- `kpi-card.html` использует `{{#statusBadge}}` + `{{{statusBadge}}}` без двойного использования и без пустого контейнера.

## 11. Исследование алгоритма контрольных сумм

| Вопрос | Ответ |
|---|---|
| Кто формировал значения | скрипты этапа TPL-1 (проверка перед нормализацией и после неё) |
| Алгоритм | SHA-256 (`Bun.CryptoHasher("sha256")`) |
| Что хешировалось | конкатенация **сырых байтов** 22 partials в лексикографическом порядке полных путей |
| Что опубликовано | первые **32 hex-символа** полного дайджеста |
| Воспроизводимость | подтверждена: два независимых прогона дают `aa067e25c2c76d1172bab09e2362ca6fd6db786624c499d0890ccd0cfd7bf328` |

- значение «after» из отчёта TPL-1 (`aa067e25c2c76d1172bab09e2362ca6f`) — префикс подтверждённого полного SHA-256;
- значение «before» (`4a539578031b9fe64bbbe963c4fc3a6b`) получено той же процедурой до нормализации; повторно не вычислимо без возврата файлов к прежнему состоянию (запрещено). Косвенное подтверждение: пофайловые суммы неизменённых файлов совпадают с preflight TPL-1 (`cards/card.html` `9ed1c1b0…`, `cards/kpi-grid.html` `4ab9e9bc…`), изменённых — отличаются;
- **промежуточный артефакт:** в черновом выводе встречалось значение `e3b0c44298fc1c149afbf4c8996fb924` — это SHA-256 пустого ввода, полученный повторным вызовом `digest()` в диагностическом скрипте. Значением агрегата partials оно не является и в отчёте TPL-1 не использовалось;
- значения в отчёте TPL-1 задним числом не изменялись.

## 12. Тесты и команды

| Команда | Результат |
|---|---|
| `bun test tests/web/templates-partials.test.ts` (базовый прогон) | 95 pass / 0 fail |
| промежуточный прогон после замены блока | 99 pass / 3 fail (логика трёх проверок: дублирующий импорт, ложное срабатывание на `{{badgeClass}}`, `safeHref` как сегмент) |
| `bun test tests/web/templates-partials.test.ts` (итог) | **102 pass / 0 fail** |
| `bun test tests/web` | **250 pass / 0 fail** |
| `bunx tsc --noEmit` | 0 ошибок |
| PII gate (`templates-contract.md`, `templates/README.md`) | GATE PASS |
| `git diff --check` по разрешённым файлам | exit 0 (чисто) |
| `git diff --check` (весь репозиторий) | exit 2 — только из-за `diff.txt` (внешнее изменение) |
| UTF-8 и BOM (22 partials + README + документ) | 24 файла: ошибок кодировки 0, BOM 0 |

## 13. Целостность данных

| Объект | Значение | Статус |
|---|---|---|
| `data/forecast/forecasting.sqlite` | `eadc3763926e142a…` | идентично базовому (`identical: true`) |
| `data/catalog.sqlite` | `09e827205ada06b7…`, mtime 2026-11-20 | не изменялся этим этапом (mtime предшествует этапу) |
| `forecasts.jsonl` | `e35fe27b002e42cca0d5d67579d9831c…` | не изменялся |
| `reconciliations.jsonl` | `32ccd25604ae78b36996738c10581cea…` | не изменялся |
| `manifest.json` | `9d986747771c5fd1cc3654a8eec6c0cf…` | не изменялся |
| `errors.jsonl` | отсутствует | не создавался |

**Уточнение:** значение `eadc3763926e142a…`, ранее приведённое в отчётах как «SQLite», относится к `data/forecast/forecasting.sqlite`, а не к `data/catalog.sqlite`. Разные артефакты не смешиваются.

## 14. Матрица критериев приёмки

| ID | Критерий | Статус | Основание |
|---|---|---|---|
| TPL-1.1-AC-01 | Git preflight | PASS | HEAD, branch, staged/unstaged/untracked зафиксированы (раздел 2) |
| TPL-1.1-AC-02 | Hash routes | PASS | allowlist из двух маршрутов; тест фактических href |
| TPL-1.1-AC-03 | History values | PASS | допустимы только `all/30/90/180/365` |
| TPL-1.1-AC-04 | Forecast values | PASS | только `replay/shadow` и `1/3` |
| TPL-1.1-AC-05 | Negative tests | PASS | 20 недопустимых примеров отклоняются |
| TPL-1.1-AC-06 | Production links | PASS | аудит `history.ts`, `forecast-quality.ts`, `shell.ts`, `routing.ts` |
| TPL-1.1-AC-07 | safeHref | PASS | обхода allowlist нет; расхождение экранирования `from`/`to` зафиксировано как P2 |
| TPL-1.1-AC-08 | DataTable | PASS | порядок блоков, пустая ветка, отсутствие форматирования, поведение компонента |
| TPL-1.1-AC-09 | Loading state | PASS | различены `loadingState({ rows })` и `skeletons[]` |
| TPL-1.1-AC-10 | Chart geometry | PASS | только плейсхолдеры в атрибутах; путь считает компонент |
| TPL-1.1-AC-11 | Trusted slots | PASS | документ, тесты и partials совпадают |
| TPL-1.1-AC-12 | Hash provenance | PASS | алгоритм и состав входных данных подтверждены; значение «before» не пересчитывается (NOT_VERIFIED в разделе 17) |
| TPL-1.1-AC-13 | Tests | PASS | 102 pass / 0 fail; 250 pass по `tests/web` |
| TPL-1.1-AC-14 | TypeScript | PASS | `bunx tsc --noEmit` — 0 ошибок |
| TPL-1.1-AC-15 | PII | PASS | GATE PASS |
| TPL-1.1-AC-16 | Diff | PASS | по разрешённым файлам чисто; глобальный exit 2 вызван `diff.txt` |
| TPL-1.1-AC-17 | Scope | PASS | изменены только разрешённые файлы; `diff.txt` — внешнее изменение |
| TPL-1.1-AC-18 | Data integrity | PASS | контрольные суммы данных не изменились |
| TPL-1.1-AC-19 | Git safety | PASS | commit/push/reset/checkout и подобные операции не выполнялись, staged = 0 |
| TPL-1.1-AC-20 | Final status | PASS | итоговый статус приведён в разделе 18 |

## 15. Оставшиеся риски

1. **P2.** `src/web/pages/history.ts:48-49` подставляет `from`/`to` без `escapeHtml()`; достижимость ограничена валидацией формата даты, исправление требует файла вне allowlist.
2. **P2.** Проверки partials остаются regex/token-based: HTML-парсер и новые зависимости не добавлялись; ограничение зафиксировано в разделе 16 контракта.
3. **P2.** `diff.txt` изменён внешним процессом; этап его не трогал, но он влияет на глобальный `git diff --check`.
4. **P2.** Позиционные правила hash-ссылок реализованы тестовым валидатором: он проверяет строку ссылки, но не фактическую навигацию браузера.
5. **P2.** В тест-файле сосуществуют исходные проверки и блок TPL-1.1; при дальнейшем расширении возможны пересечения.

## 16. NOT_IMPLEMENTED

- экранирование `from`/`to` в `src/web/pages/history.ts` (файл вне allowlist);
- отдельная функция-компонент для `pages/forecast-mode-switcher.html`;
- единый авторитетный перечень доверенных слотов в виде модуля (оставлен в документе и тестах);
- HTML-парсер или структурный валидатор разметки;
- шаблоны страниц и визуальная проверка (TPL-2, TPL-3), runtime-интеграция (TPL-5).

## 17. NOT_VERIFIED

- повторное вычисление значения «before» (`4a539578031b9fe64bbbe963c4fc3a6b`) невозможно без возврата файлов к прежнему состоянию (процедура подтверждена косвенно);
- происхождение mtime и содержимого `data/catalog.sqlite` вне этапа (файл не изменялся этим этапом);
- визуальное соответствие partials и TypeScript-разметки (браузер недоступен);
- паритет `src/web/playground/` с основным интерфейсом.

## 18. Итоговое состояние Git

```
 M diff.txt                                  (внешнее изменение, этапом не затрагивалось)
 M src/web/templates/README.md
 M src/web/templates/partials/cards/kpi-card.html
 M src/web/templates/partials/pages/forecast-mode-switcher.html
 M src/web/templates/partials/pages/history-filters.html
 M src/web/templates/partials/shell/app-shell.html
 M src/web/templates/partials/shell/sidebar-brand.html
 M src/web/templates/partials/shell/sidebar.html
 M tests/web/templates-partials.test.ts
?? docs/ui/templates-contract.md
?? docs/ui/templates-inventory.md
?? docs/ui/templates-tpl-1-report.md
?? docs/ui/templates-tpl-1-1-report.md
```

HEAD `6e84af17cc1586f425777efb79b62e1086f36f2a`, ветка `main`, staged 0. Операции commit, push, pull, merge, rebase, reset, checkout, switch, stash, clean, restore и `add` не выполнялись.

## 19. Вердикт

**`ACCEPTED WITH LIMITATIONS`.**

Основания: все 20 критериев приёмки — PASS; незакрытых P1 нет; частичные файлы не изменялись; данные и прогнозный контур не затронуты. Ограничения: два документированных P2-расхождения (экранирование `from`/`to` вне allowlist, regex-природа проверок), внешнее изменение `diff.txt` и один NOT_VERIFIED пункт (повторное вычисление значения «before»).

**TPL-2 не начата.** Этап остановлен, Git-операции не выполнялись.
