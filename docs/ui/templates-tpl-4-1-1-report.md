# TPL-4.1.1 — верификация генератора и исправление фикстур: отчёт

> **Архитектурная поправка TPL-4.5.** Каталог `src/web/templates/partials/` удалён в TPL-4.4.
> Production HTML формируют `src/web/components/` и `src/web/pages/`; экранирование — `src/web/lib/format.ts`;
> актуальная документация архитектуры — `src/web/templates/README.md`; эталоны страниц — `docs/ui/reference/`
> (генератор `tools/reference/`). Исторические результаты ниже не изменялись.

**Дата:** 2026-11-27 · **HEAD:** `c162612ee33715a171b82e8bee20c6380e12e07c` · **Ветка:** `main`
**Статус:** `ACCEPTED WITH LIMITATIONS`

---

## 1. Preflight (FACT)

| Проверка | Значение |
|---|---|
| `git rev-parse HEAD` | `c162612ee33715a171b82e8bee20c6380e12e07c` — совпадает с ожидаемым |
| `git branch --show-current` | `main` |
| staged | 0 |
| unstaged | 1 (`diff.txt`, 392 780 Б) |
| untracked | 1 — артефакт `-files --others --exclude-standard` (файл с буквальным именем, попал в дерево ранее; не создавался и не удалялся этим этапом) |
| `diff.txt` | 392 780 Б, не изменялся |

## 2. Обнаруженные дефекты (FACT)

**D1 — ложное утверждение о четырёх статусах календаря.** В `tools/reference/fixtures/quality.ts` подпись гласила «все четыре состояния», но данные приходили из `buildCalendar()`, который формирует только `missing`, `full` и `unknown` (`src/web/pages/data-quality.ts:22`). Статус `partial` построителем не выдаётся.

**D2 — индекс исключался из проверки файлов.** В тесте присутствовало `if (item.file === "index.html") continue;`, поэтому индекс не проверялся на совпадение с результатом генерации.

**D3 — битые ссылки навигации в индексе (найден новым тестом).** Боковая навигация использовала одинаковые `href` (`overview.html`, …) для страниц и индекса, поэтому из `index.html` ссылки разрешались в `docs/ui/reference/overview.html`, которого нет. Тест «относительные ссылки каждого файла существуют на диске» это выявил.

## 3. Внесённые исправления (FACT)

| Файл | Изменение |
|---|---|
| `tools/reference/fixtures/quality.ts` | данные разделены: календарь построителя (`full`, `missing`, `unknown`) и демонстрация всех статусов, поддерживаемых компонентом, — типизированный массив `CalendarDay[]` со `full`, `partial`, `missing`, `unknown`; подписи приведены к фактам |
| `tools/reference/render-shell.ts` | относительные ссылки навигации зависят от расположения документа: для индекса `pages/<file>` и `index.html`, для страниц `<file>` и `../index.html` |
| `tests/web/reference-generation.test.ts` | исключение индекса убрано; добавлены проверки существования, совпадения содержимого и SHA-256 для всех семи файлов, разрешения относительных ссылок на диске, ссылок индекса на шесть страниц, поддержки статуса `partial` компонентом |
| `docs/ui/reference/pages/quality.html` | перегенерирован генератором (единственный изменённый эталон) |

Production-код, компоненты, CSS, API, маршрутизация, forecasting, данные, partials, `package.json` и `diff.txt` не изменялись.

## 4. Статус `partial` — фактическая картина (FACT)

- тип `CalendarDayStatus` (`src/web/components/data.ts:21`) включает `partial`;
- `completenessCalendar()` формирует класс `ds-calendar-day--${status}`, то есть поддерживает `partial`;
- CSS определяет `.ds-calendar-day--full`, `--partial`, `--missing` и базовый класс; модификатор `--unknown` отсутствует (production-пробел, зафиксирован в TPL-3.1, вне области этапа);
- `buildCalendar()` (`src/web/pages/data-quality.ts:22`) статус `partial` не формирует;
- в браузерной проверке `partial` реально отрисован: 12 вхождений на 36 снимков (2 на каждый снимок страницы качества).

Итог: заявление о поддержке четырёх статусов компонентом верно; заявление о формировании четырёх статусов построителем было ложным и исправлено.

## 5. SHA-256 артефактов (FACT, два последовательных прогона)

| Файл | SHA-256 |
|---|---|
| `index.html` | `7ae3dffcda1d3e2bc5670175862392a550840189857b510358e6b192d31d9e79` |
| `pages/overview.html` | `9785d97c405486aa9e42da40d4cad56b3cf3db53b237516dbecb64cb8c6de3b9` |
| `pages/history.html` | `57448111b54b8b3e9c39d063d7035e5a887e19b424b0298d2af9855a687e1d7c` |
| `pages/quality.html` | `af8d27e4959beb66c6d1183e4ff014028436caed86806485e418f4bf7e996499` |
| `pages/provenance.html` | `6d92b65410a446d59142dd5d7ad66395ff2cdae6ea5a53769033dbaf03a360ad` |
| `pages/forecast-quality.html` | `19e2ff93772139d1264f4854f6252514aa93e449417e47b4a0119125cd3e9b34` |
| `pages/forecast-diagnostics.html` | `50640400def3585c4c1f3c2899215e9a9ea2131b7ccc0cc090083eaa7bed0675` |

Оба прогона `bun tools/reference/generate.ts` дали идентичные суммы всех семи файлов — детерминированность подтверждена.

## 6. Результаты проверок (FACT)

| Команда | Результат |
|---|---|
| `bun test tests/web/reference-generation.test.ts` | **20 pass / 0 fail** |
| `bun test tests/web` | **270 pass / 0 fail** |
| `bunx tsc --noEmit` | 0 ошибок |
| `bun run ui:build` | exit 0 |
| `git diff --check` (tools/reference, tests/web, docs/ui/reference) | exit 0 |
| PII gate (отчёт) | GATE PASS: 0 совпадений |

Промежуточные результаты зафиксированы: первый прогон новых тестов — 19 pass / 1 fail (дефект D3), после исправления навигации — 20 pass / 0 fail.

## 7. Браузерная проверка (FACT)

Chrome for Testing 159.0.8154.6 через DevTools Protocol, шесть страниц × шесть ширин = 36 снимков (сохранены вне репозитория):

| Показатель | Результат |
|---|---|
| Снимков | 36 |
| CSS загружен | 36 / 36 |
| Горизонтальный overflow | 0 |
| Ошибки JavaScript | 0 |
| Каркас приложения | 36 / 36 |
| Ссылок навигации на страницу | 7 (минимум и максимум) |
| Календарные статусы | `full` 42, `partial` 12, `missing` 30, `unknown` 204 |

Ссылки между страницами проверены двумя способами: разрешением относительных путей на диске (тест) и подсчётом элементов навигации в браузере.

## 8. Git-контроль (FACT)

| Параметр | До | После |
|---|---|---|
| HEAD | `c162612ee33715a171b82e8bee20c6380e12e07c` | тот же |
| staged | 0 | 0 |
| unstaged | 1 (`diff.txt`) | 4 (`diff.txt`, `quality.html`, `render-shell.ts`, `reference-generation.test.ts`) |
| untracked | 1 (артефакт `-files …`) | 2 (артефакт и отчёт) |

Изменения строго в пределах allowlist: `tools/reference/fixtures/quality.ts`, `tools/reference/render-shell.ts` (вспомогательный модуль генератора, необходим для корректных ссылок), `tests/web/reference-generation.test.ts`, `docs/ui/reference/pages/quality.html` (через генератор), отчёт. Git-операции фиксации не выполнялись; `diff.txt` не изменялся.

Данные: `forecasting.sqlite` идентичен базовому, `catalog.sqlite` `09e827205ada…`, `forecasts.jsonl` `e35fe27b…`, `reconciliations.jsonl` `32ccd256…`, `manifest.json` `9d986747…`, `errors.jsonl` отсутствует.

## 9. CLAIM

- Утверждение предыдущего этапа о четырёх статусах календаря, формируемых построителем, — **опровергнуто** (см. D1).
- Утверждение о проверке всех семи файлов на диске — **не соответствовало коду теста** (см. D2); теперь соответствует.

## 10. INFERENCE

- Появление дефекта D3 только после снятия исключения индекса подтверждает ценность проверки: индекс имел собственную структуру относительных путей, которая ранее не проверялась.
- Отсутствие модификатора `--unknown` в CSS при фактическом формировании статуса `unknown` построителем остаётся production-пробелом: такие дни получают базовое оформление и визуально отличимы от `full`, `partial`, `missing`, но отдельного стиля не имеют.

## 11. NOT_IMPLEMENTED

- добавление `.ds-calendar-day--unknown` в production CSS (вне области этапа);
- формирование статуса `partial` в `buildCalendar()` (изменение production-страницы запрещено);
- добавление скрипта `ui:reference` в `package.json`;
- генерация или удаление partials (TPL-4.2 и далее).

## 12. NOT_VERIFIED

- визуальный просмотр снимков человеком (модель не имеет визуального восприятия);
- фактическая навигация кликом в браузере (проверено разрешение путей и наличие элементов, а не переходы);
- происхождение артефакта `-files --others --exclude-standard` в рабочем дереве (не создавался и не удалялся этим этапом).
