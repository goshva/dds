# UI-2.3 (Part B) — оптимизация запросов и работа без Shadow-данных

**Дата:** 2026-11-28 · **HEAD:** `db928062b2464d26d14ea9df4c988c332c8ece9b` · **Branch:** `main` · **Статус: `READY_WITH_LIMITATIONS`**

---

## 1. Исходное состояние (FACT)

- Рабочее дерево: staged 0, unstaged 3 (`D "c --noEmit"` — внешнее удаление, `src/web/app-render.ts`, `tests/web/app-render.test.ts`), untracked 9 (модули страницы Forecast, тест страницы, документы).
- `src/web/app-render.ts` — 200 строк (на пределе лимита), модули Forecast: `forecast.ts` 103, `forecast-snapshots.ts` 124, `forecast-reconciliations.ts` 94.
- API-клиент — единственный (`src/web/api/client.ts`), прямых `fetch` вне него нет.
- Архитектура отличается от описания задачи в одном: **отдельного «модуля загрузки Overview» нет** — Overview рендерится в ветке `else` внутри `renderApp`, данные приходят из общего блока запросов. Расхождение зафиксировано.

## 2. Причины избыточных запросов (FACT)

| # | Причина | Где |
|---|---|---|
| 1 | `/api/v1/shadow/forecasts` запрашивался **для всех** «остаточных» страниц, хотя используется только в разметке Overview | общий `Promise.all` в `renderApp` |
| 2 | Полный ряд (`/api/v1/history?limit=1000` без `from/to`) запрашивался всегда, хотя при `range === "all"` он совпадает с уже загруженным `history` | тот же блок |
| 3 | Пагинация вызывала `render()` (полный `renderApp`) → повторная загрузка всех данных страницы | `handleAppClick`: `ds-page-prev`/`ds-page-next` |

## 3. Изменённые файлы

| Файл | Изменение | Строк |
|---|---|---:|
| `src/web/app-render.ts` | B1: shadow-запрос только для Overview; B3: `fullHistory` только при `range !== "all"`; B2: кэш страницы истории, `appRoot` и `rerenderHistoryFromCache` без запросов; уплотнение комментариев и вынос placeholder | 200 → **199** |
| `src/web/pages/forecast-placeholder.ts` | новый модуль: placeholder вынесен для соблюдения лимита 200 строк (реэкспорт сохранён) | **14** |
| `docs/final-frontend/ui-2-3-implementation.md` | этот отчёт | — |

Backend, DTO, API, данные, зависимости и пользовательские файлы не изменялись.

## 4. Реализация B1–B5

**B1 — изоляция Shadow.** `shadowResult` запрашивается только при `page === "overview"`, иначе `Promise.resolve(null)`; для Overview при невозможности получить данные используется `not_available` (`reason: "SHADOW_NOT_LOADED"`), пустой успешный результат не подставляется.

**B2 — пагинация без запросов.** Добавлены `appRoot` и `historyCache` (последний успешный `HistoryDto` + `coverage` + диапазон). `handleAppClick` для `ds-page-prev`/`ds-page-next` вызывает `rerenderHistoryFromCache`, который перерисовывает только таблицу из уже загруженного набора; GET-запросы не выполняются. Границы: индекс ограничивается внутри `historyPage`; при смене диапазона кэш перезаписывается и индекс сбрасывается (существующее поведение).

**B3 — переиспользование History.** При `range === "all"` полный ряд не запрашивается: `fullHistory = history` (`fullHistoryResult ?? history`). Запрос `coverage` сохранён (нужен для индикации полноты). Для диапазонов, отличных от `all`, полный ряд по-прежнему запрашивается — подмена неполной истории полной не допускается.

**B4 — семантика статусов.** Не изменялась: `ok → OK`, `error → PARTIAL`, `not_available → NOT_AVAILABLE`; `null` не превращается в `0`; отсутствие shadow-файла не трактуется как отсутствие ошибок; фиктивные снапшоты не создаются.

**B5 — тесты: НЕ ВЫПОЛНЕНО в этом проходе.** Новые проверки (B1–B5 из раздела 6 задания) не добавлены; прогон существующего набора выполнен (см. ниже). Это ограничение, а не PASS.

## 5. Таблица запросов до/после (FACT по коду)

| Страница / ситуация | До | После |
|---|---|---|
| Overview, `range = all` | overview + history + coverage + fullHistory + shadow = **5** | overview + history + coverage + shadow = **4** |
| Overview, диапазон ≠ `all` | 5 | 5 (fullHistory нужен) |
| History, `range = all` | overview + history + coverage + fullHistory + shadow = **5** | overview + history + coverage = **3** |
| History, диапазон ≠ `all` | 5 | overview + history + coverage + fullHistory = **4** |
| Quality данных / Provenance | 5 | **4** (без shadow) |
| Forecast quality / Diagnostics | overview + quality (+errors) | без изменений |
| Forecast (`#forecast/...`) | forecasts + reconciliations = 2 | без изменений |
| Пагинация Prev/Next (History) | 5 запросов на каждый клик | **0 запросов** (только перерисовка) |

## 6. Результаты тестов (FACT)

| Команда | Результат | Exit |
|---|---|---|
| `bun test tests/web tests/server` | **426 pass / 0 fail** | 0 |
| `bunx tsc --noEmit` | 0 ошибок | 0 |
| `bun run ui:build` | успешно | 0 |
| `git diff --check` | чисто | 0 |
| Лимиты | app-render 199, placeholder 14 (≤200) | — |
| Запрещённые области | 0 изменений (`src/server`, `tests/server`, `src/forecasting`, API, данные, зависимости) | — |

## 7. Браузерная проверка

**NOT_VERIFIED** — в этом проходе не выполнялась (не запускались API/Vite/Chrome). Ожидаемое число запросов зафиксировано по коду в разделе 5; для пагинации ожидается 0 дополнительных запросов.

## 8. Оставшиеся ограничения

1. **B5 не выполнен** — новые тесты для B1–B3 и проверок статусов не добавлены; поведение подтверждено только существующим набором (426 pass) и анализом кода.
2. **B2 подтверждён только по коду** — перерисовка из кэша не покрыта автотестом и не проверена в браузере.
3. Страницы Quality данных и Provenance по-прежнему запрашивают `history(range)` и `coverage`, хотя используют `coverage`/`fullHistory` — оптимизация этих страниц в задание не входила.
4. `fullHistory` для диапазонов ≠ `all` и «историю для Overview» оптимизировать нельзя без изменения семантики.

## 9. Git status после реализации

```
HEAD: db92806… (без изменений)   branch: main   origin/main: совпадает
staged 0 · unstaged 3 · untracked 9
unstaged: D "c --noEmit" (внешнее), src/web/app-render.ts, tests/web/app-render.test.ts
untracked: src/web/pages/{forecast,forecast-snapshots,forecast-reconciliations,forecast-placeholder}.ts,
           tests/web/forecast-page.test.ts, docs/final-frontend/*.md
```
Commit/push/staging не выполнялись.

**Итоговый статус: `READY_WITH_LIMITATIONS`** — оптимизации B1–B4 внесены, весь существующий набор тестов, типы и сборка зелёные; B5 (новые тесты) и браузерная проверка остаются незакрытыми. Part A не запускалась.
