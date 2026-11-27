# FINAL-3.3.2.1 — выделение dispatch и placeholder Forecast

**Дата:** 2026-11-28 · **HEAD:** `ef1f3ff34c4b34a34d8b7b77395521b9891ce775` · **Branch:** `main` · **origin/main:** совпадает

---

## 1. Baseline

| Проверка | До этапа | После этапа |
|---|---|---|
| HEAD / origin/main | `ef1f3ff…` | без изменений |
| Branch | `main` | `main` |
| staged / unstaged / untracked | 0 / 1 / 0 (`docs/final-frontend/forecast-preflight.md` из FINAL-3.3.2.0) | 0 / 2 / 3 |
| Незакоммиченные изменения | preflight-отчёт | + `src/web/main.ts` (изменён), новые `src/web/app-render.ts`, `src/web/pages/overview.ts`, `tests/web/app-render.test.ts` |

Git-операции не выполнялись; `c --noEmit` не тронут; `diff.txt` отсутствует.

## 2. Архитектура dispatch

Поток до этапа: `main.ts (render) → parseHash → if/else по страницам → API → innerHTML`.
Поток после этапа: `main.ts (события, hashchange) → app-render.renderApp → resolvePage → renderer страницы → innerHTML`.

- `main.ts` (25 строк) — DOM-контекст, первичный вызов `renderApp`, единственная подписка на `hashchange`, обработчик кликов (делегирует в `handleAppClick`), переключатель меню. Двойных подписок и двойного первичного рендера нет.
- `app-render.ts` (192 строки) — `resolvePage` (чистая функция выбора), `forecastNotImplemented` (placeholder), `loadResult`, `shell`, `block`, `renderApp` (ветки страниц), `handleAppClick` (диапазон истории и пагинация). URL и история браузера здесь **не изменяются**.
- `pages/overview.ts` (50 строк) — разметка Overview вынесена из dispatch для соблюдения лимита 200 строк (разделение предусмотрено §8 задания). Состав данных и разметка не изменены.

## 3. Изменённые файлы

| Файл | Действие | Строк |
|---|---|---:|
| `src/web/main.ts` | переписан в тонкую точку входа | 197 → **25** |
| `src/web/app-render.ts` | создан (dispatch) | **192** |
| `src/web/pages/overview.ts` | создан (разметка Overview, вынесена из dispatch) | **50** |
| `tests/web/app-render.test.ts` | создан (тесты dispatch) | **94** |

## 4. Поведение Forecast

`resolvePage` для страницы `forecast` возвращает решение `{ kind: "forecast", valid, mode, horizon, canonical }`, используя **строгий** `normalizeForecastParams` (ровно три сегмента, допустимые `mode`/`horizon`). Некорректные значения дают `valid: false`, `mode: null`, `horizon: null` — в renderer они не попадают как валидные параметры; `canonical` равен `#forecast/replay/1` для будущей нормализации URL (сама нормализация на этом этапе не выполняется — dispatch URL не меняет).

Вместо Overview на `#forecast/...` выводится placeholder `NOT_IMPLEMENTED` со статус-бейджем и текстом «Страница прогнозирования ещё не реализована» и пометкой «Данные прогнозов не запрашивались». Это **не** empty state: отсутствие прогнозов не утверждается, API-запросов не делается, фиктивные данные не создаются.

## 5. Существующие страницы (регрессия)

Все ветки перенесены без изменения состава: `forecast-quality` (мягкий `forecastParams`), `forecast-diagnostics` (строгий `diagnosticsParams`, два независимых endpoint, `generatedAt` приоритетом quality → errors → overview), далее `rangeToQuery` и общий блок с `history`, `quality`, `provenance`, `overview`. `DEFAULT_PAGE` для неизвестного маршрута не изменён.

## 6. Тесты

| Проверка | Команда | Результат |
|---|---|---|
| Dispatch | `bun test tests/web/app-render.test.ts` | **7 pass / 0 fail** |
| Web | `bun test tests/web` | **219 pass / 0 fail** |
| Server | `bun test tests/server` | **189 pass / 0 fail** |

Покрыто: выбор renderer для всех 7 маршрутов (включая `history/90`), сохранение `DEFAULT_PAGE` для неизвестных/пустых хешей, отсутствие перехода прогнозных страниц в Forecast-ветку, 4 канонических Forecast-маршрута, 8 некорректных Forecast-маршрутов (неполные, неизвестные значения, лишний сегмент, завершающий слэш), текст и безопасность placeholder, отсутствие в placeholder данных прогнозов и ошибок.

## 7. TypeScript и сборка

| Проверка | Команда | Результат |
|---|---|---|
| Типы | `bunx tsc --noEmit` | **0 ошибок** |
| Сборка | `bun run ui:build` | **exit 0** |
| Формат | `git diff --check` | **exit 0** |

## 8. Архитектурные ограничения (подтверждено)

- API, DTO, `src/server/**`, SQLite, JSONL и forecasting не изменялись; новых endpoint нет.
- `src/web/routing.ts` **не изменялся**; второй парсер не создавался.
- Reference-генератор и `docs/ui/reference/**` не изменялись.
- Storage-модули не читаются из frontend; forecasting-расчётов нет; `any` не используется.
- Dispatch не выполняет API-запросов сам — запросы живут в существующих ветках страниц.
- `src/web/pages/forecast.ts` не создавался (следующий этап).

## 9. Git safety

`docs/final-frontend/forecast-preflight.md` сохранён (изменён только предыдущим этапом); `c --noEmit` не тронут; пользовательские изменения не перезаписывались (незакоммиченных пользовательских файлов на момент старта не было — дерево было чистым, кроме preflight-отчёта). Git-операции не выполнялись.

## 10. NOT_VERIFIED

- браузерная отрисовка placeholder и переключение страниц (этап 3.3.2.8);
- фактическая нормализация URL для некорректного `#forecast/...` (будет реализована вместе со страницей; сейчас показывается placeholder с пометкой о некорректности);
- поведение реальных API-ответов Forecast (страница ещё не реализована).

## 11. Итоговый статус

**`READY_FOR_REVIEW`** — dispatch выделен, `main.ts` сокращён до 25 строк, существующие страницы работают без изменения поведения, Forecast получает явную безопасную ветку `NOT_IMPLEMENTED` вместо Overview, все проверки (тесты, типы, сборка, формат) проходят, лимит 200 строк соблюдён во всех изменённых файлах.

**Остановка: FINAL-3.3.2.2 (страница Forecast) не начат.**
