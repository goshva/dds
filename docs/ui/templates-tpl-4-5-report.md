# TPL-4.5 — согласование документации после удаления legacy partials

**Дата:** 2026-11-27 · **HEAD:** `c162612ee33715a171b82e8bee20c6380e12e07c` · **Ветка:** `main` · **origin/main:** тот же коммит

---

## 1. Preflight (FACT)

| Проверка | Значение |
|---|---|
| `git rev-parse HEAD` | `c162612ee33715a171b82e8bee20c6380e12e07c` |
| `git rev-parse origin/main` | `c162612ee33715a171b82e8bee20c6380e12e07c` |
| `git branch --show-current` | `main` |
| staged | **22** — удаления partials (выполнены внешним процессом в TPL-4.4) |
| unstaged до этапа | 13 (README шаблонов и тест из TPL-4.4; 7 reference-страниц и 2 модуля `tools/reference` из TPL-4.1.1; `diff.txt`) |
| untracked | 7 (отчёты TPL-4.1.1, 4.2 inventory, 4.2 STAGE B, 4.3, 4.4; артефакт `-files --others --exclude-standard`) |
| Документов в `docs/ui/**` | **45** markdown-файлов |
| С упоминаниями partials | **31** |

Существующие staged/unstaged/untracked изменения не перезаписывались; Git-операции не выполнялись; `diff.txt` не изменялся.

## 2. Классификация документов

**A. Актуальная инструкция (исправить полностью).**

| Документ | Категория | Было | Стало | Статус |
|---|---|---|---|---|
| `src/web/templates/README.md` (вне `docs/ui`) | A | описывал partials как legacy-каталог | переписан в TPL-4.4: TypeScript — источник HTML, эталоны через `tools/reference/` | актуален, изменений в TPL-4.5 не требовал |

**B. Архитектурная документация (привести к текущему состоянию).**

| Документ | Было | Стало | Статус |
|---|---|---|---|
| `reference/README.md` | «разметка построена на утверждённых partials из `src/web/templates/partials/`» — неверно | «разметка собирается из production-компонентов и функций страниц через генератор `tools/reference/`» + архитектурная поправка | исправлен |
| `architecture-proposal.md`, `source-to-ui-mapping.md`, `preflight-audit.md` | 1–2 упоминания partials без пометки | добавлена архитектурная поправка TPL-4.5; исторические утверждения не переписаны | согласованы |
| `api-contract.md`, `api-gap-analysis.md`, `design-system-safety.md`, `local-development.md`, `ui-4-forecasting-contract.md` | упоминаний partials нет | без изменений | актуальны |

**C. Исторические отчёты (сохранить факты, добавить заметку).**

| Документ | Упоминаний | Действие | Статус |
|---|---:|---|---|
| `templates-inventory.md` (TPL-0) | 37 | архитектурная поправка | исторический факт сохранён |
| `templates-tpl-1-report.md` | 29 | поправка | сохранён |
| `templates-tpl-1-1-report.md` | 31 | поправка | сохранён |
| `templates-tpl-2-report.md` | 13 | поправка | сохранён |
| `templates-tpl-3-visual-audit.md` | 3 | поправка | сохранён |
| `templates-tpl-4-0-runtime-audit.md` | 18 | поправка | сохранён |
| `templates-tpl-4-0-architecture-decision.md` | 12 | поправка | сохранён |
| `templates-tpl-4-1-1-report.md` | 14 | поправка | сохранён |
| `templates-tpl-4-2-inventory.md` | 37 | поправка | сохранён |
| `templates-tpl-4-2-stage-b-report.md` | 51 | поправка | сохранён |
| `templates-tpl-4-3-report.md` | 34 | поправка | сохранён |
| `ui-4-2-6-1-report.md`, `ui-4-2-6-hardening-report.md` | 2–5 | поправка | сохранён |
| `ui-7-0-1-defect-remediation-report.md`, `ui-7-0-2-1-acceptance-report.md`, `ui-7-0-browser-verification-report.md`, `ui-7-1-0-discovery-audit.md` | 1–19 | поправка | сохранён |
| `templates-tpl-3-1-verification-report.md`, `templates-tpl-3-discrepancies.md`, `templates-tpl-3-1-pair-matrix.md`, `templates-tpl-4-0-migration-plan.md`, `templates-tpl-4-1-report.md`, `templates-tpl-4-4-report.md`, `ui-2-*.md`, `ui-3-*.md`, `ui-4-0-audit.md`, `ui-4-1-implementation-report.md`, `ui-4-2-implementation-report.md`, `ui-4-2-5-presentation-hardening-report.md`, `ui-7-1-1-implementation-report.md`, `ui-7-1-data-contract-matrix.md`, `ui-7-1-specification.md` | 0–5 | ссылка на TPL-4.4 уже присутствовала либо упоминаний partials нет | сохранён |

**D. Reference README.** Исправлен источник генерации эталонов (см. категорию B, первая строка).

**E. Устаревший контракт.**

| Документ | Было | Стало | Статус |
|---|---|---|---|
| `templates-contract.md` | описывал действующий контракт HTML-partials (14 разделов, таблица 22 partials) | добавлен блок **«СТАТУС: SUPERSEDED (TPL-4.5)»** с причиной и ссылками на актуальные источники (`src/web/templates/README.md`, `src/web/components/`, `src/web/pages/`, `docs/ui/reference/`, `tools/reference/`); таблицы сохранены как исторический след | SUPERSEDED |

Ни один документ не удалён.

## 3. Изменения по документам (FACT)

Изменено **19 документов**:

1. `reference/README.md` — исправлено утверждение об источнике разметки эталонов + добавлена поправка.
2. `templates-contract.md` — статус SUPERSEDED.
3–19. `templates-inventory.md`, `templates-tpl-1-report.md`, `templates-tpl-1-1-report.md`, `templates-tpl-2-report.md`, `templates-tpl-3-visual-audit.md`, `templates-tpl-4-0-runtime-audit.md`, `templates-tpl-4-0-architecture-decision.md`, `templates-tpl-4-1-1-report.md`, `templates-tpl-4-2-inventory.md`, `templates-tpl-4-2-stage-b-report.md`, `templates-tpl-4-3-report.md`, `ui-4-2-6-1-report.md`, `ui-4-2-6-hardening-report.md`, `ui-7-0-1-defect-remediation-report.md`, `ui-7-0-2-1-acceptance-report.md`, `ui-7-0-browser-verification-report.md`, `ui-7-1-0-discovery-audit.md`, `architecture-proposal.md` — добавлена единая архитектурная поправка TPL-4.5.

Текст поправки: каталог `src/web/templates/partials/` удалён в TPL-4.4; production HTML формируют `src/web/components/` и `src/web/pages/`; экранирование — `src/web/lib/format.ts`; актуальная документация — `src/web/templates/README.md`; эталоны — `docs/ui/reference/` (генератор `tools/reference/`); исторические результаты не изменялись.

Поправка вставляется сразу после заголовка документа, не затрагивая таблицы, даты и выводы; повторная вставка исключена проверкой наличия ссылки на TPL-4.4/TPL-4.5.

## 4. Намеренно сохранённые исторические упоминания

Исторические упоминания partials **сохранены** (нулевое количество не является целью):

- таблицы контракта и инвентаризации 22 partials в `templates-contract.md` и `templates-inventory.md`;
- факты о TPL-1/1.1 (camelCase, доверенные слоты, hash-allowlist) и TPL-2/3 (визуальный аудит, несоответствия);
- анализ TPL-4.2 STAGE B (категории MATCH/MISMATCH, матрица реализуемости);
- разделы отчётов со счётчиками тестов, SHA-256 и результатами проверок;
- упоминания в отчётах UI-7 (признание владельца шести HTML-файлов, замечания по `{{note}}`).

После правок **документов, упоминающих partials и не содержащих ссылки на TPL-4.4/TPL-4.5, не осталось** (проверено скриптом: 0).

## 5. Проверки и результаты (FACT)

| Проверка | Команда | Результат |
|---|---|---|
| Тесты web | `bun test tests/web` | **183 pass / 0 fail** |
| Типы | `bunx tsc --noEmit` | 0 ошибок |
| Сборка | `bun run ui:build` | exit 0 |
| Формат | `git diff --check -- docs/ui` | exit 0 |
| PII gate | `bun tools/redact-pii.ts --in … --gate` (4 документа, включая SUPERSEDED-контракт и reference README) | GATE PASS (0 совпадений) |
| Ссылки Markdown | собственный обход `docs/ui/**`: относительные цели | проверено 16, битых **0** |
| Повторная генерация эталонов | `bun tools/reference/generate.ts` | exit 0; SHA-256 не изменились: `index` `7ae3dffc…`, `overview` `9785d97c…`, `history` `57448111…`, `quality` `af8d27e4…`, `provenance` `6d92b654…`, `forecast-quality` `19e2ff93…`, `forecast-diagnostics` `50640400…` |
| Изменённых документов `docs/ui` | `git diff --name-only -- docs/ui` | 22 (19 от этого этапа + 3 из TPL-4.1.1/4.4) |

## 6. Остаточные риски

| Приоритет | Риск | Пояснение |
|---|---|---|
| P3 | Исторические документы содержат описания удалённого контракта | снижено поправкой и статусом SUPERSEDED; полное переписывание истории аудита не выполнялось сознательно |
| P3 | `templates-contract.md` остаётся в каталоге `docs/ui` и может быть найден поиском первым | блок SUPERSEDED в начале документа перенаправляет к актуальным источникам |
| P3 | Индекс Git содержит 22 staged-удаления из TPL-4.4 | фиксация не выполнялась; состояние внешнее по отношению к этому этапу |

## 7. Итоговый статус

**`READY_FOR_CLOSE`.**

Все документы `docs/ui/**` согласованы с текущей архитектурой: актуальная инструкция описывает TypeScript как источник HTML, reference README исправлен, устаревший контракт помечен SUPERSEDED, исторические отчёты сохранили факты и получили отметку об удалении partials в TPL-4.4. Проверки (тесты, типы, сборка, формат, PII gate, ссылки Markdown, повторная генерация эталонов) пройдены; production-код, UI, CSS, forecasting, данные и `diff.txt` не изменялись; генератор документации не создавался.
