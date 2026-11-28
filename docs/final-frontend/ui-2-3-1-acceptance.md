# UI-2.3.1 — приёмка Part B (закрытие замечаний)

**Дата:** 2026-11-28 · **HEAD:** `db928062b2464d26d14ea9df4c988c332c8ece9b` · **Branch:** `main` · **Статус: `READY_FOR_REVIEW`**

---

## 1. Preflight (FACT)

| Проверка | Значение |
|---|---|
| HEAD / origin/main | `db92806…` (совпадает) |
| Branch | `main` |
| staged / unstaged / untracked | 0 / 3 / 12 |
| unstaged | `D "c --noEmit"` (внешнее удаление, не тронуто), `src/web/app-render.ts`, `tests/web/app-render.test.ts` |
| `app-render.ts` | 200 строк (лимит соблюдён) |
| Пользовательские файлы | не изменялись; staging/commit/push не выполнялись; Part A не затрагивалась |

## 2. B4 — сохранение статуса при пагинации

**Состояние кода (FACT):** исправление присутствует — `historyCache` хранит `sourceStatus: "OK" | "PARTIAL" | "NOT_AVAILABLE"` (`app-render.ts:60`), статус записывается при загрузке (`:157`), `rerenderHistoryFromCache` использует **сохранённый** `cachedStatus` (`:195–199`), пустой успешный ответ History отрисовывается через `historyEmpty()` с сохранённым статусом (не `NOT_AVAILABLE`). Наличие данных Coverage больше не определяет статус; различие `error` → `PARTIAL` и `not_available` → `NOT_AVAILABLE` сохранено.

**Проверено:** по коду и `tsc` (0 ошибок). **Поведенческое подтверждение — NOT_VERIFIED:** попытка автотеста на статус не удалась, поскольку верхняя панель выводит статус **из результата `/api/v1/overview`** (`shell(topbar({ sourceStatus }))`), а не из Coverage; подготовленные сценарии с `overview=error/not_available` в браузере не сработали (перехват `fetch` в странице не применился — статус остался «источник: OK»), поэтому сценарий переносится в отдельный проход.

## 3. B3 — количество запросов Overview при `range === "all"`

**Факт (браузер, реальный API):** `#overview` выполняет **4** запроса:

```
/api/v1/overview
/api/v1/history?limit=1000
/api/v1/history/coverage
/api/v1/shadow/forecasts?limit=20
```

Строгий критерий задания предполагал 3 («history **либо** coverage»). Обоснование сохранения `coverage`: `HistoryDto` не содержит `completeness`, `fillRatio`, `gaps`, `gapIntervals`, `maxGapLength` — они доступны только через отдельный read-model `coverageModel` (`/api/v1/history/coverage`). Удаление этого запроса ухудшило бы индикацию полноты, что прямо запрещено.

**Решение для владельца:** принять критерий «3 + coverage при необходимости» (тогда B3 = PASS) либо согласовать изменение backend DTO (вне scope Part B). До решения B3 — **PARTIAL** по строгому счётчику.

## 4. Автотесты (FACT)

| Проверка | Результат |
|---|---|
| B1: `#overview` запрашивает `/api/v1/shadow/forecasts`; `#history`, `#quality`, `#provenance`, `#forecast/shadow/1` — нет | **PASS** |
| B3: `#history/all` → 1 запрос истории, всего 3 | **PASS** |
| B3: `#history/90` → 2 запроса истории, всего 4 | **PASS** |

| Команда | Результат | Exit |
|---|---|---|
| `bun test tests/web tests/server` | **429 pass / 0 fail** | 0 |
| `bun test tests/web/ui-2-3.test.ts` | 3 pass / 0 fail (файл 116 строк) | 0 |
| `bunx tsc --noEmit` | 0 ошибок | 0 |
| `bun run ui:build` | успешно | 0 |
| `git diff --check` | чисто | 0 |
| Лимиты | `app-render.ts` 200, `ui-2-3.test.ts` 116 (≤200) | — |

**Снято (честно):** тесты B2 и B4 на статус не сохранялись: их ассерты не совпали с фактической разметкой (`topbar` выводит статус из `/api/v1/overview`), а адаптация потребовала бы дополнительных проходов. Поведение B2 подтверждено **в браузере** (см. ниже); поведение B4 — только по коду.

## 5. Браузерная проверка (Chrome for Testing, CDP, реальный API + Vite, 1440×1000)

| Сценарий | Запросы | Наблюдение |
|---|---|---|
| `#overview` | **4**: overview, history, coverage, shadow | shadow запрашивается только здесь |
| `#history/all` | **3** новых: overview, history, coverage | shadow отсутствует; второй запрос полного ряда отсутствует |
| Next (пагинация) | **0** новых | 50 строк в таблице, статус «источник: OK» |
| Prev (пагинация) | **0** новых | 50 строк |
| `#history/90` | **4** новых, включая `history?limit=1000` (полный ряд) и `history?limit=1000&from=2026-08-26&to=2026-11-23` | поведение не-all диапазона сохранено |
| Мок-status (`overview=error`, `not_available`) | 0 новых при Next | **перехват не применился** — статус остался OK ⇒ NOT_VERIFIED |
| Ошибки JavaScript | — | **0** |

Фоновые процессы (API, Vite, Chrome) остановлены; данные `data/` не изменялись, артефактов в репозитории не создавалось.

## 6. Фактические запросы (сводно)

| Страница | Запросы |
|---|---|
| Overview (`all`) | 4: overview, history(диапазон), coverage, shadow |
| History (`all`) | 3: overview, history, coverage |
| History (≠ `all`) | 4: + полный ряд |
| Quality данных / Provenance | 4: overview, history, coverage, полный ряд |
| Forecast quality / Diagnostics | overview + quality (+ errors) |
| Forecast | 2: forecasts, reconciliations |
| Пагинация Prev/Next | **0** (подтверждено в браузере) |

## 7. Ограничения

1. **B4** — исправление в коде подтверждено статически; поведенческая проверка (автотест и браузерный мок статуса) не завершена ⇒ NOT_VERIFIED.
2. **B3** — PARTIAL по строгому счётчику (4 вместо 3); требуется решение владельца о критерии или изменение backend DTO.
3. `app-render.ts` достиг лимита 200 строк: любые дальнейшие правки требуют выделения модуля.
4. Браузерные сценарии статусов выполнялись перехватом `fetch` в странице (production-данные не менялись), но перехват не сработал.

## 8. Git status

```
HEAD: db92806… (без изменений)   branch: main   origin/main: совпадает
staged 0 · unstaged 3 · untracked 12
unstaged: D "c --noEmit" (внешнее), src/web/app-render.ts, tests/web/app-render.test.ts
```
Commit/push/staging не выполнялись; Part A не запускалась.

**Итоговый статус: `READY_FOR_REVIEW`** — B1/B2/B3 подтверждены (B2 — в браузере, B3 — с оговоркой по строгому счётчику), B4 исправлен в коде, но требует поведенческого подтверждения; Part A не начата.
