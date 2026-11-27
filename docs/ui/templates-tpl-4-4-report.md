# TPL-4.4 — удаление legacy partials и очистка архитектуры

**Дата:** 2026-11-27 · **HEAD:** `c162612ee33715a171b82e8bee20c6380e12e07c` · **Ветка:** `main` · **origin/main:** тот же коммит

---

## 1. Preflight и состояние Git (FACT)

| Проверка | Значение |
|---|---|
| `git rev-parse HEAD` | `c162612ee33715a171b82e8bee20c6380e12e07c` |
| `git rev-parse origin/main` | `c162612ee33715a171b82e8bee20c6380e12e07c` (совпадает) |
| `git branch --show-current` | `main` |
| staged | **22** — удаления partials |
| unstaged | 13 (7 reference-страниц и 2 модуля `tools/reference` из TPL-4.1.1; `diff.txt`; README; тест) |
| untracked | 6 (отчёты TPL-4.1.1, 4.2 inventory, 4.2 STAGE B; артефакт `-files --others --exclude-standard`) |
| Partials на диске | **0** |
| Partials в индексе как удалённые (`--diff-filter=D`) | **22** |

**Ключевое внешнее изменение (FACT).** На момент preflight каталог `src/web/templates/partials/` уже был пуст, а удаление 22 файлов **уже находилось в индексе** (`D  src/web/templates/partials/...`). Эти действия выполнены не мной: ни одной команды удаления файлов или Git-операций этот этап не запускал (запрещены `git add`, `reset`, `restore`, `checkout`, `switch`, `stash`, `clean`). Задача свелась к проверке оснований, выравниванию README и тестов и проверкам.

## 2. Повторный поиск потребителей (FACT)

Просканировано 517 файлов в областях `src/`, `tests/`, `tools/`, `docs/`, `.github/` и корневых конфигурациях (исключены `node_modules`, `.git`, `dist`, `data`, `screenshots`, `diff.txt`, `bun.lock`).

| Категория | Результат |
|---|---|
| Runtime/build-потребители (`src/**`, кроме README) | **0** |
| Тесты | 1 файл — `tests/web/templates-partials.test.ts` |
| `tools/**` | 0 |
| `package.json` scripts | упоминаний partials нет |
| CI/workflows | каталог `.github/workflows` отсутствует |
| Генератор эталонов `tools/reference/**` | ссылок на partials нет |
| Документация | 17 файлов `docs/ui/**` (исторические отчёты аудита + `docs/ui/reference/README.md`) |

Условие остановки не сработало: используемых в runtime или сборке partials нет, удаление безопасно.

## 3. Удалённые файлы (FACT)

Удалены (внешним процессом, застейджено) все 22 отслеживаемых legacy-файла:

`cards/{card,chart-card,kpi-card,kpi-grid,provenance-drawer,status-badge}.html` · `charts/{bar-chart,line-chart,sparkline}.html` · `data/{completeness-calendar,data-table}.html` · `pages/{forecast-mode-switcher,history-filters}.html` · `shell/{app-shell,page-header,sidebar-brand,sidebar-nav,sidebar,topbar}.html` · `states/{empty-state,error-state,loading-state}.html`

Не удалялись: `src/web/components/**`, `src/web/pages/**`, `src/web/lib/**`, `docs/ui/reference/**`, `tools/reference/**`, `tests/web/reference-generation.test.ts`, API, forecasting, `diff.txt`, посторонние untracked-файлы.

## 4. Изменённые файлы (FACT)

| Файл | Действие |
|---|---|
| `src/web/templates/README.md` | переписан: архитектура (TypeScript — источник HTML), эталоны `docs/ui/reference/` и команда генерации, факт и причины удаления каталога, правила для разработчиков, список проверок |
| `tests/web/templates-partials.test.ts` | переписан: сохранены инварианты безопасности и поведение production-компонентов, удалены проверки, требовавшие существования legacy-файлов, добавлена архитектурная проверка отсутствия ссылок |
| `docs/ui/templates-tpl-4-4-report.md` | создан (этот отчёт) |

Production-код, компоненты, страницы, стили, API, forecasting, данные и `package.json` не изменялись.

## 5. Тесты: удалено и сохранено (FACT)

| Показатель | Значение |
|---|---:|
| Тестов в файле до (TPL-4.3) | 106 |
| Тестов в файле после | 15 |
| Удалено проверок, зависевших от файлов partials | 91 |
| Сохранено/перевыражено инвариантов безопасности и поведения | 15 |
| `tests/web` всего после этапа | **183 pass / 0 fail** |
| `tests/server` | **189 pass / 0 fail** |

**Сохранено (перевыражено без зависимости от удалённых файлов):**

- экранирование `& < > " '`, попытки внедрения разметки и атрибутов, пустые и нестроковые значения (`escapeHtml`);
- безопасность URL: разрешены hash, относительные пути, `http(s)`; запрещены `javascript:`, `JavaScript:`, `data:`, `vbscript:`, `file:`, протокол-относительные ссылки, пустые значения, управляющие символы и кавычки (`isSafeHref`, `safeHref`);
- правила hash-маршрутов: allowlist маршрутов, число сегментов, допустимые значения (`#history/all|30|90|180|365`, `#forecast-quality/{replay|shadow}/{1|3}`), отклонение неизвестных значений и лишних сегментов;
- поведение production-компонентов: `dataTable` (сборка ячеек, экранирование, пустое состояние с `colspan`), `loadingState({ rows })` (число скелетонов), `emptyState`/`errorState`, `lineChart` (вычисление пути компонентом), `statusBadge` (перечислимый класс, экранирование текста);
- архитектурная чистота: каталог удалён (0 файлов), production-исходники не содержат ссылок на `templates/partials`.

**Удалено с обоснованием:** проверки состава `EXPECTED_FILES`, отсутствия пустых файлов, баланса mustache-блоков и HTML-тегов, camelCase плейсхолдеров, соответствия документу контракта, структуры legacy-артефактов (`cells`, `skeletons`, `statusBadge`, геометрия графиков), hash-проверок по содержимому partials, покрытия 22 файлов таблицей контракта. Предмет этих проверок (файлы) удалён; их security-содержание перенесено в проверки чистых функций и production-компонентов, а не отброшено. Фиктивные проверки и snapshot-тесты удалённой разметки не создавались.

## 6. Результаты проверок (FACT)

| Проверка | Команда | Результат |
|---|---|---|
| Тесты web | `bun test tests/web` | **183 pass / 0 fail** |
| Тесты server | `bun test tests/server` | **189 pass / 0 fail** |
| Типы | `bunx tsc --noEmit` | 0 ошибок |
| Сборка | `bun run ui:build` | exit 0 |
| Генератор эталонов без partials | `bun tools/reference/generate.ts` | exit 0, 7 файлов; SHA-256 совпадают с TPL-4.1.1 (`index` `7ae3dffc…`, `overview` `9785d97c…`, `history` `57448111…`, `quality` `af8d27e4…`, `provenance` `6d92b654…`, `forecast-quality` `19e2ff93…`, `forecast-diagnostics` `50640400…`) |
| Формат | `git diff --check` (изменённые файлы) | exit 0 |
| PII gate | `bun tools/redact-pii.ts --in src/web/templates/README.md --in tests/web/templates-partials.test.ts --gate` | GATE PASS (0 совпадений) |
| Поиск ссылок на удалённый каталог | `src/`, `tests/`, `tools/` | 1 ссылка — архитектурная проверка внутри теста (ожидаемо); в production-коде — 0 |

Промежуточный результат зафиксирован честно: первый прогон `tests/web` дал 182 pass / 1 fail — моя проверка пустой таблицы ошибочно ожидала полное отсутствие `<td>`, тогда как production-компонент выводит служебную ячейку с `colspan`. Исправлена проверка (не production-код): теперь утверждается одна служебная ячейка и наличие `colspan`; повторный прогон — 183 pass / 0 fail.

## 7. Остаточные риски

| Приоритет | Риск | Пояснение |
|---|---|---|
| P1 | Документация ссылается на удалённый каталог | 17 файлов `docs/ui/**`: `docs/ui/reference/README.md` утверждает, что эталоны построены на partials (неверно), `docs/ui/templates-contract.md` и отчёты TPL описывают удалённый механизм. В область TPL-4.4 входили только README шаблонов и тест |
| P2 | Индекс Git содержит 22 staged-удаления | выполнены внешним процессом; фиксация (commit) не производилась, индекс не изменялся мной |
| P2 | Пустой каталог `src/web/templates/partials/` может остаться на диске | Git не отслеживает пустые каталоги; на содержимое и сборку не влияет |
| P3 | Исторические отчёты могут восприниматься как актуальные | низкий: README шаблонов прямо помечает их как след проверок |

## 8. NOT_VERIFIED

- намерения внешнего процесса, удалившего и застейджившего partials (кто и зачем) — установить невозможно;
- поведение внешних (внерепозиторных) потребителей partials — вне области проверки;
- судьба остальных документов, упоминающих partials: правки не выполнялись (вне согласованной области), требуется отдельное решение.

## 9. Итоговый статус

**`READY_WITH_LIMITATIONS`.**

Основания: все 22 legacy partials удалены и не имеют runtime/build-потребителей; production HTML формируется TypeScript-компонентами и страницами; генератор эталонов работает без partials и воспроизводит прежние контрольные суммы; инварианты безопасности сохранены и проверяются; README соответствует фактической архитектуре; тесты, типы, сборка, формат и PII gate проходят. Ограничение: документация `docs/ui/**` частично описывает удалённый каталог как действующий механизм — правки вне области этого этапа, рекомендованы отдельной задачей.

## 10. Критерии приёмки

| Критерий | Результат | Доказательство |
|---|---|---|
| Все 22 legacy partials удалены | PASS | `--diff-filter=D` = 22; на диске 0 |
| Runtime/build consumers отсутствуют | PASS | 0 в `src/**` (кроме README), 0 в `tools/**`, 0 в scripts, CI отсутствует |
| Production HTML работает через TypeScript | PASS | `tests/web` 183 pass, `ui:build` exit 0 |
| Reference generator работает | PASS | `bun tools/reference/generate.ts` — 7 файлов, суммы совпадают |
| Security-тесты сохранены | PASS | экранирование, `safeHref`, hash-allowlist, поведение компонентов (15 проверок) |
| README соответствует фактической архитектуре | PASS | переписан, содержит правило удаления и источники HTML |
| TypeScript, tests, build, PII gate проходят | PASS | 183 + 189 pass, tsc 0, build exit 0, GATE PASS |
| Отчёт содержит проверяемые результаты | PASS | этот документ |
