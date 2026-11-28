# ROUTING-FORECAST-ENTRY — корректная точка входа в раздел прогнозирования

**Дата:** 2026-11-28 · **HEAD:** `db928062b2464d26d14ea9df4c988c332c8ece9b` · **Branch:** `main` · **Статус: `READY_FOR_REVIEW`**

---

## 1. Причина исходного поведения (FACT)

- Sidebar формирует ссылку как `#${item.key}` (`src/web/app-render.ts:71`), поэтому пункт «Прогноз» ведёт на `#forecast` — **без** режима и горизонта.
- `parseHash("#forecast")` → `segmentCount = 1`, `range = "all"`, `from = ""`; `normalizeForecastParams` (строгая валидация: ровно три сегмента) возвращает `valid = false`, `mode = null`, `horizon = null`, `fallback = "#forecast/replay/1"` (проверено вызовом production-функций).
- Диспатч для невалидного Forecast показывал placeholder `NOT_IMPLEMENTED` **без запросов** — то есть пользователь не попадал на реализованную страницу, хотя она существует.
- `#forecast/replay` (2 сегмента) также невалиден; `#forecast/replay/2` невалиден (горизонт вне `1|3`).

## 2. Изменённые файлы

| Файл | Изменение | Строк |
|---|---|---:|
| `src/web/app-render.ts` | в forecast-ветке перед placeholder добавлено перенаправление для входа без параметров: `route.segmentCount === 1` → `window.location.replace("#forecast/replay/1")` и commit страницы в состоянии загрузки; уплотнён импорт `routing` | 200 → **197** |
| `tests/web/forecast-page.test.ts` | новый блок `ROUTING-FORECAST-ENTRY` (3 теста); удалены неиспользуемые helpers; переписан тест параметров | 161 → **198** |
| `tests/web/app-render.test.ts` | `#forecast` исключён из списка некорректных маршрутов (теперь это вход) | 179 |
| `docs/final-frontend/routing-forecast-entry.md` | этот отчёт | — |

Правки `routing.ts`, API, DTO, backend, данных и зависимостей **не выполнялись**; mock-данные не добавлялись.

## 3. Реализованное поведение

| Маршрут | Поведение |
|---|---|
| `#forecast` | перенаправление на `#forecast/replay/1` (`location.replace`, без записи в историю); сразу отображается страница в состоянии загрузки; после `hashchange` — один канонический рендер |
| `#forecast/replay`, `#forecast/replay/2`, `#forecast/shadow/2`, `#forecast/unknown/1`, `#forecast/replay/1/extra`, `#forecast//1` | остаются **некорректными**: placeholder, **0 запросов**, перенаправления нет |
| `#forecast/replay/1`, `#forecast/replay/3`, `#forecast/shadow/1`, `#forecast/shadow/3` | работают без перенаправления, ровно 2 запроса |

Переключатели режима и горизонта продолжают формировать канонические адреса через `forecastHref`; дублирующая страница не создавалась.

## 4. Тесты (FACT)

| Команда | Результат | Exit |
|---|---|---|
| `bun test tests/web` | **237 pass / 0 fail** | 0 |
| `bun test tests/web/forecast-page.test.ts tests/web/app-render.test.ts` | 25 pass / 0 fail | 0 |
| `bun test tests/server` | 189 pass / 0 fail | 0 |
| `bunx tsc --noEmit` | 0 ошибок | 0 |
| `bun run ui:build` | успешно | 0 |
| `git diff --check` | чисто | 0 |
| Лимиты | app-render 197, test-page 198 (≤200) | — |

Покрыто: вход `#forecast` → перенаправление и **0 запросов на входе**; канонический рендер после входа → 2 запроса и оба блока; четыре канонических маршрута без перенаправления и ровно 2 запроса; `replay/2`, `shadow/2`, `#forecast/replay` — 0 запросов и placeholder; параметры `mode`/`horizon`/`limit` (200 и 60) в обоих запросах.

## 5. Количество запросов при входе через Sidebar (FACT, браузер)

`#forecast` → hash `#forecast/replay/1`, запросы ровно два:

```
/api/v1/forecasts?mode=replay&horizon=1&limit=200
/api/v1/shadow/reconciliations?mode=replay&horizon=1&limit=60
```

Повторных запросов из-за перенаправления нет (на первом проходе — ноль).

## 6. Браузерная проверка (Chrome for Testing, CDP, реальный API + Vite, 1440×1000)

| Проверка | Результат |
|---|---|
| Вход `#forecast` | hash стал `#forecast/replay/1`; оба блока («Снапшоты прогнозов», «Сверка с фактом») отрисованы; ошибок JS — 0 |
| Запросы на входе | 2 (как выше), дублей нет |
| Reload `#forecast/shadow/3` | hash сохранён (`#forecast/shadow/3`), оба блока и переключатели на месте, ошибок JS — 0 |
| Счётчик запросов в контексте страницы | 4 за две навигации (по 2 на каждую) — накопление счётчика, не дублирование |

Фоновые процессы (API, Vite, Chrome) остановлены; артефактов в репозитории не создавалось.

## 7. Git

```
HEAD: db92806… (без изменений)   branch: main   origin/main: совпадает
staged 0 · unstaged 3 · untracked 7
unstaged: D "c --noEmit" (внешнее, не тронуто), src/web/app-render.ts, tests/web/app-render.test.ts
```
Commit/push/staging не выполнялись; следующий этап не начат.

## 8. Ограничения

1. Перенаправляется только вход без параметров (`segmentCount === 1`); `#forecast/replay` (без горизонта) остаётся некорректным по требованию строгой валидации.
2. `#forecast` использует `location.replace` — запись в истории не создаётся, кнопка «Назад» возвращает на предыдущую страницу, а не на `#forecast`.
3. Мобильные ширины (390/360) в этом этапе не проверялись — `NOT_VERIFIED`.
