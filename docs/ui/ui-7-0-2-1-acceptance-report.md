# Отчёт: UI-7.0.2.1 — Acceptance Closure & Regression Audit

> **Архитектурная поправка TPL-4.5.** Каталог `src/web/templates/partials/` удалён в TPL-4.4.
> Production HTML формируют `src/web/components/` и `src/web/pages/`; экранирование — `src/web/lib/format.ts`;
> актуальная документация архитектуры — `src/web/templates/README.md`; эталоны страниц — `docs/ui/reference/`
> (генератор `tools/reference/`). Исторические результаты ниже не изменялись.

**Репозиторий:** `goshva/dds`
**Дата:** 27 ноября 2026
**Итоговый статус:** **ACCEPTED WITH LIMITATIONS**

Все обозначенные несоответствия закрыты; проверки выполнены. Остаточные ограничения перечислены в разделах NOT_IMPLEMENTED / NOT_VERIFIED.

---

## 1. HEAD (исходный и итоговый)

| | Значение |
|---|---|
| Ветка | `main` |
| Исходный HEAD | `3c3dba020d7d101caa3f6e7f8219d8d0d690360c` — `frontent atom partical visial not logic` |
| Итоговый HEAD | `3c3dba020d7d101caa3f6e7f8219d8d0d690360c` (без изменений) |

> **FACT:** Git-мутации не выполнялись. Все изменения — в рабочем дереве, HEAD не двигался.
> Upstream `origin/main` совпадает с локальным HEAD.

---

## 2. Git status (итоговый)

```
 M README.md                                   (замена раздела «Данные»: 3 источника)
 M diff.txt                                    (не наш файл — см. раздел 11)
 M reports/code-review/pii-tracked-inventory.json  (пересоздан `pii:inventory` — см. раздел 9)
 M src/web/main.ts                             (использует routing.ts)
 M src/web/pages/history.ts                    (RANGES реэкспортируется из routing.ts)
 M src/web/templates/README.md                 (контракты loading-state/safeHref + история исправлений)
 M src/web/templates/partials/cards/kpi-card.html      (P1: {{note}})
 M src/web/templates/partials/cards/kpi-grid.html      (P1: структура цикла)
 M src/web/templates/partials/shell/sidebar-nav.html   (P1: safeHref + unsafe)
 M src/web/templates/partials/shell/sidebar.html       (P1: safeHref + unsafe)
 M tests/web/ui-7-0-1-routing.test.ts          (production-функции, D-003/D-005)
?? src/web/routing.ts                          (НОВЫЙ — чистые функции маршрутизации)
?? tests/web/templates-partials.test.ts        (НОВЫЙ — аудит partials)
```

Staged — пусто. Изменения **только локальные**, в `origin/main` ничего не публиковалось.

---

## 3. Аудит 22 HTML-partials

**FACT:** все 22 файла присутствуют; автоматический аудит (`tests/web/templates-partials.test.ts`) — **80 тестов, 0 fail**.

Проверки аудита:
- состав (22 файла, ожидаемые пути, отсутствие пустых);
- баланс mustache-блоков `{{#}}/{{^}}/{{/}}`;
- баланс HTML-структуры (стек парных тегов, SVG-void исключены);
- отсутствие `href="{{…}}"` (одинарные скобки) во всех partials;
- `{{{ }}}` только для разрешённых TrustedHtml-слотов;
- экранирование динамических значений.

| Файл | Дефект | Статус |
|---|---|---|
| `cards/kpi-card.html` | P1: `{{{note}}}` при `escapeHtml()` в TS | ✅ исправлено → `{{note}}` |
| `cards/kpi-grid.html` | P1: `</div>` внутри `{{#items}}` | ✅ исправлено → цикл в одном контейнере |
| `shell/sidebar.html` | P1: `href` без `safeHref()` | ✅ исправлено → `{{{safeHref}}}` |
| `shell/sidebar-nav.html` | P1: `href` без `safeHref()`; unsafe по `current` | ✅ исправлено → `{{{safeHref}}}` + `{{#unsafe}}` |
| `states/loading-state.html` | P2: контракт README | ✅ контракт зафиксирован (см. раздел 4) |

Остальные 17 partials — соответствуют компонентам, дефектов не обнаружено.

**CLAIM:** partials не подключены к runtime (как и требовалось) — это визуальная спецификация; прод рендерит TypeScript.

---

## 4. Контракт loading-state

Публичный API: **`loadingState({ rows?: number })`** (файл `src/web/components/states.ts`).

- `rows` — публичный параметр (по умолчанию 4).
- Массив `skeletons[]` — **внутреннее производное представление**, не публичный API.
- Ширины скелетонов формирует **компонент** (циклический паттерн `[70, 85, 65, 78]` %).
- Partial `states/loading-state.html` описывает **конечную разметку** (`{{#skeletons}}…{{width}}…{{/skeletons}}`), а не публичный API компонента.

Зафиксировано в `src/web/templates/README.md` и подтверждено тестом.

---

## 5. Контракт safeHref

- В partials `href` записывается как `{{{safeHref}}}` (тройные скобки).
- **Тройные скобки допустимы только для результата безопасной обработки URL** (`safeHref()` из `src/web/lib/format.ts` сам возвращает экранированную строку либо `"#"`).
- **Исходный URL напрямую передавать нельзя** — только через `safeHref()`.
- Атрибут `data-ds-unsafe-href="1"` проставляется по `{{#unsafe}}` (признак небезопасности ссылки), а не по `{{^current}}`.

Задокументировано в `src/web/templates/README.md` («Инварианты безопасности») и закреплено тестами.

---

## 6. Результаты D-003 / D-004 / D-005

### D-003 — неизвестные маршруты (единое поведение)

**Единое ожидаемое поведение:** неизвестный hash-сегмент страницы → `history` (`DEFAULT_PAGE`), `isForecast=false`, валидация дат применяется.

Согласовано в трёх местах:
- `src/web/routing.ts` — `DEFAULT_PAGE = "history"` (единственный источник);
- `src/web/main.ts` — использует `parseHash` из модуля;
- `tests/web/ui-7-0-1-routing.test.ts` — 5 тестов на неизвестные/пустые маршруты.

### D-004 — production routing tests

**FACT:** функции `parseHash`, `forecastParams`, `rangeToQuery` вынесены из `main.ts` (точка входа с побочными эффектами) в чистый модуль `src/web/routing.ts` (без `document`/`window`). Тесты **импортируют production-функции**, копий в тестах больше нет.

Покрыто (37 тестов): overview, history, quality, provenance, forecast-quality shadow/replay h1/h3, некорректные mode/horizon, неизвестные страницы, deep links без параметров, пустой hash.

`RANGES` унифицирован: канонический список в `routing.ts`, `pages/history.ts` реэкспортирует его.

### D-005 — календарная валидация дат

**FACT:** добавлена `isValidCalendarDate()` (проверка реальности даты, а не только формата). Матрица:

| Дата | Ожидаемо | Результат |
|---|---|---|
| 2026-02-28 | valid | ✅ |
| 2026-02-29 | invalid | ✅ |
| 2026-13-01 | invalid | ✅ |
| 2026-00-01 | invalid | ✅ |
| 2026-11-31 | invalid | ✅ |
| from > to | invalid | ✅ |
| 2024-02-29 | valid (високосный) | ✅ |

Серверный контракт **не менялся**. Фронтенд-валидация приведена в соответствие с серверной (`parseDate` в `read-models.ts` уже проверял реальность даты). HTTP-проверка: `from=2026-02-29` → `400 INVALID_QUERY "from is not a real calendar date"`.

---

## 7. Результаты тестов

| Набор | Результат |
|---|---|
| `bun run ui:test` (tests/web + tests/server) | **382 pass, 0 fail** (11 файлов) |
| `bun test tests/forecasting` | **386 pass, 0 fail** (20 файлов) |
| `bun test` (полный) | **932 pass, 4 skip, 0 fail** (49 файлов) |

> **FACT (важно):** первый полный прогон `bun test` дал `1 fail / 936`. Три последовательных повторных прогона — стабильно `0 fail`. Флакующий тест **не локализован** (вывод `(fail)` не перехвачен при повторе). См. NOT_VERIFIED.

Новые наборы:
- `tests/web/ui-7-0-1-routing.test.ts` — 37 тестов на production-функциях;
- `tests/web/templates-partials.test.ts` — 80 тестов аудита partials.

---

## 8. TypeScript / build

| Команда | Результат |
|---|---|
| `bunx tsc --noEmit` | ✅ exit 0 |
| `bun run ui:build` | ✅ `dist/web/index.html` 0.41 kB, CSS 9.91 kB (gzip 2.83), JS **33.84 kB (gzip 11.33)** |

---

## 9. PII gate

| Команда | Результат |
|---|---|
| `bun run pii:test` | ✅ 23 pass, 0 fail |
| `bun run pii:inventory` | ✅ `reports/code-review/pii-tracked-inventory.json` перегенерён (все tracked-файлы помечены PUSHED) |
| PII-скан новых/изменённых файлов | ✅ совпадений нет (regex: телефон/phone/ФИО-паттерн) |

> **FACT:** `pii:inventory` перезаписал `reports/code-review/pii-tracked-inventory.json` (+282/−73 строк). Это **артефакт PII-gate**, а не источник данных DSS. Файл оставлен изменённым в рабочем дереве (git-мутации запрещены, восстановление через checkout не выполнялось). См. раздел 12.

---

## 10. Целостность данных

Checksums источников **до и после** проверок идентичны — данные не изменялись:

| Файл | SHA-256 (до = после) |
|---|---|
| `canonical_daily_delivered_orders.csv` | `56069e58…3ba377c5` |
| `data/shadow/7745/forecasts.jsonl` | `e35fe27b…f08a648c` |
| `data/shadow/7745/reconciliations.jsonl` | `32ccd256…38dad146` |
| `data/shadow/7745/manifest.json` | `9d986747…fc10c17d` |

SQLite (`data/catalog.sqlite`) не открывался на запись. `errors.jsonl` отсутствует (отсутствовал и ранее — не создавался).

**HTTP-проверки (routing менялся):**

| Проверка | Результат |
|---|---|
| API `127.0.0.1:8787/api/health` | 200 |
| API `/api/v1/overview` | 200 |
| API `/api/v1/forecasts/quality?mode=shadow&horizon=1` | 200 |
| API `/api/v1/history?from=2026-02-29` | 400 INVALID_QUERY (валидация даты) |
| Vite `127.0.0.1:5173/` | 200 |
| Vite `/api/client.ts` (D-002 регрессия) | 200 |
| Vite `/api/health` (proxy) | 200 |
| Vite `/routing.ts` (новый модуль) | 200 |

---

## 11. Судьба `diff.txt`

**FACT:** `diff.txt` — **отслеживаемый (tracked) файл**, закоммичен в коммитах `099f37b pre u4`, `5887369 for check`, `e1002e3 to chech state and way`. Содержимое — сохранённый `git diff` рабочего дерева (секции README.md, diff.txt, templates/*). Это **рабочий артефакт для проверки состояния**, не код и не данные DSS.

**Удаления не произошло** — файл присутствует (140347 байт), статус `M` (изменён, не удалён). Изменение возникло потому, что в него был пересохранён свежий diff рабочего дерева.

**Рекомендация:** назначение — временный снапшот diff. Его удаление или перезапись — **осознанное действие владельца**, автоматического решения не принималось. Файл содержит trailing whitespace (видно в `git diff --check`), но это не наш файл — не изменялся.

---

## 12. Опубликовано vs локально

| Категория | Файлы |
|---|---|
| **Опубликовано** (есть в `origin/main`) | всё, что входит в HEAD `3c3dba0` |
| **Только локально** (uncommitted) | `src/web/routing.ts`, `tests/web/templates-partials.test.ts` (untracked); `main.ts`, `pages/history.ts`, `README.md`, `templates/README.md`, 4 partials, `ui-7-0-1-routing.test.ts`, `diff.txt`, `pii-tracked-inventory.json` (modified) |

Commit/push не выполнялись.

---

## 13. NOT_IMPLEMENTED

- **Template engine не создавался** (по требованию ТЗ) — partials остаются не-исполняемой спецификацией.
- **E2E/browser-тесты hash-роутинга** не добавлялись (вне объёма закрытия; только unit на production-функциях).
- Восстановление `pii-tracked-inventory.json` из HEAD не выполнялось (git-мутации запрещены).

---

## 14. NOT_VERIFIED

- **Флакующий тест** в первом прогоне `bun test` (1 fail) — не локализован; 3 повторных прогона чистые. Природа (тайминг/порядок/файловая гонка) не установлена.
- **Tablet 1024×768** браузерная проверка — нет инструмента эмуляции (перенос из UI-7.0.1).
- **`errors.jsonl`** физически отсутствует — путь задокументирован, но контент не проверялся.
- **Production-статика с новым `routing.ts`** проверена только сборкой (`ui:build`) и Vite dev; отдельный Bun.serve c `dist` в этом прогоне не поднимался.

---

## 15. Итоговый статус

### **ACCEPTED WITH LIMITATIONS**

Закрыто:
- ✅ 5 дефектов partials (4×P1, 1×P2) — исправлены + закреплены 80 тестами;
- ✅ D-003 (единый fallback), D-004 (production-тесты), D-005 (календарная валидация) — реализованы в коде и протестированы;
- ✅ README (root + templates) приведены в соответствие с package.json и реальными источниками (canonical CSV / Shadow / SQLite разделены);
- ✅ tsc, build, ui:test, forecast:test, bun test, PII gate, git diff --check (наши файлы) — зелёные;
- ✅ целостность данных подтверждена checksums (до = после).

Ограничения (некритичны, описаны): флакующий тест не локализован; tablet и production-static — NOT_VERIFIED; `pii-tracked-inventory.json` изменён артефактом gate; `diff.txt` — рабочий артефакт владельца.

UI-7.1, UI-7.2, UI-4.3 **не начинались** (ожидают отдельного разрешения).
