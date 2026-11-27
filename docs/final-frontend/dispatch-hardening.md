# FINAL-3.3.2.1-HARDENING — отчёт

## 1. Preflight

| Проверка | Результат |
|---|---|
| HEAD / branch | `ef1f3ff34c4b34a34d8b7b77395521b9891ce775` / `main` (origin/main совпадает) |
| staged | 0 |
| unstaged | 2 — `docs/final-frontend/forecast-preflight.md` (этап 3.3.2.0), `src/web/main.ts` (3.3.2.1) |
| untracked | 6 — `docs/final-frontend/dispatch-implementation.md`, `src/web/app-render.ts`, `src/web/pages/overview.ts`, `tests/web/app-render.test.ts` (+ отчёты прежних этапов) |
| Пользовательские изменения | отсутствовали (дерево было чистым, кроме отчёта и работы 3.3.2.1) |
| Исходные тесты | `tests/web` 219 pass, `tsc` 0, `ui:build` 0 |
| Риски | гонки `renderApp`, зависимость Forecast от `/api/v1/overview`, вложенные клики, обработка исключений |

## 2. Обнаруженные проблемы

1. **Race condition (FIX-1):** несколько вызовов `renderApp()` выполнялись параллельно; устаревший вызов мог перезаписать актуальный экран (включая промежуточный loading).
2. **Зависимость Forecast от Overview (FIX-2):** placeholder ожидал `GET /api/v1/overview`, хотя данные Overview не использует.
3. **Вложенные клики (FIX-3):** `handleAppClick` проверял `target.id`; клик по `<span>`/`<svg>` внутри кнопки не распознавался.
4. **Обработка исключений (FIX-4):** `loadResult` обращался к полям приведённого типа; при `null`/`undefined`/строке это могло упасть, а сообщение — стать пустым.

## 3. Выполненные исправления

| # | Файл | Функция | Что изменено | Почему |
|---|---|---|---|---|
| 1 | `src/web/app-render.ts` | `renderApp` | Введено поколение рендера `renderRequestSeq`; каждый вызов получает `generation`, все **8** записей в DOM идут через `commit()`, который проверяет актуальность поколения | Устаревший вызов не может изменить DOM после нового, включая промежуточный loading |
| 2 | `src/web/app-render.ts` | `renderApp` | Ветка Forecast обрабатывается **до** любого `api.get` (первый `api.get` — строка 103): placeholder + `shell(..., null, "NOT_AVAILABLE", page)` и немедленный выход | Forecast не зависит от доступности/скорости Overview API; запросов нет вовсе |
| 3 | `src/web/app-events.ts` (новый) | `resolveClickAction`, `clickActionFor` | Делегирование через `closest("#ds-apply, #ds-reset, #ds-page-prev, #ds-page-next")` + проверка `container.contains(element)`; сопоставление id → действие вынесено в чистую функцию | Клик по вложенному `span`/`svg` работает; посторонние элементы вне приложения действий не запускают |
| 4 | `src/web/app-result.ts` (новый) | `toErrorResult`, `loadResult`, `block` | Любое исключение (`null`, `undefined`, строка, число, `Error`, объект) нормализуется: безопасный `code`, непустое `message`, обрезка до 200 символов, уникальный `eventId`; успешный `ApiResult` не изменяется | Renderer не падает и не раскрывает лишние данные при ошибке |

Намеренно **не** менялись: `routing.ts`, `pages/*` (кроме ранее вынесенного `overview.ts`), компоненты, API, DTO, SQLite/JSONL, reference-генератор, CSS, зависимости, семантика `PROVISIONAL`, преобразование `null` → `[Н/Д]`, fail-closed поведение.

Разделение модулей (`app-result.ts`, `app-events.ts`) выполнено из-за лимита 200 строк: `app-render.ts` остался в границах (190).

## 4. Тесты

| Команда | Результат |
|---|---|
| `bun test tests/web/app-render.test.ts` | **11 pass / 0 fail** (exit 0) |
| `bun test tests/web` | **223 pass / 0 fail** (exit 0) |
| `bun test tests/server` | **189 pass / 0 fail** (exit 0) |
| `bunx tsc --noEmit` | **0 ошибок** (exit 0) |
| `bun run ui:build` | **exit 0** |
| `git diff --check` | **exit 0** |

Добавленные проверки: 4 канонических Forecast-маршрута показывают placeholder **при нуле вызовов `fetch`** (FIX-2); сопоставление действий `ds-apply`/`ds-reset`/`ds-page-prev`/`ds-page-next` и `null` для посторонних id (FIX-3); безопасность `toErrorResult` для 6 типов исключений, уникальность `eventId`, обрезка сообщения до 200 символов (FIX-4). Лимиты: `app-render.ts` 190, `app-result.ts` 42, `app-events.ts` 31, `main.ts` 24, тест 154 — все ≤ 200.

## 5. Ограничения и NOT_VERIFIED

1. **FIX-1 (гонки) — не подтверждён автотестом.** Попытка воспроизвести гонку через подмену `globalThis.fetch` привела к взаимной блокировке (оба вызова ожидали общий отложенный ответ) и таймауту 5000 мс, поэтому тест снят, а не «подогнан». Защита реализована в production-коде (проверка поколения перед каждой записью в DOM), но её проверка отложена до браузерного этапа 3.3.2.8.
2. **FIX-3 (вложенные клики) — частично.** Чистое сопоставление id покрыто тестами; сам `closest` и проверка принадлежности контейнеру требуют DOM, отсутствующего в Bun, поэтому проверка также отложена до браузерного этапа.
3. Не проверено: поведение при медленном реальном API (искусственные задержки не вводились), доступность (a11y) и мобильные размеры — этап 3.3.2.8.

## 6. Изменённые файлы

| Файл | Строк |
|---|---:|
| `src/web/app-render.ts` | 190 |
| `src/web/app-result.ts` (новый) | 42 |
| `src/web/app-events.ts` (новый) | 31 |
| `src/web/main.ts` | 24 |
| `tests/web/app-render.test.ts` | 154 |
| `docs/final-frontend/dispatch-hardening.md` | этот отчёт |

## 7. Git status после работы

```
HEAD: ef1f3ff… (без изменений)   branch: main   origin/main: совпадает
staged 0 · unstaged 2 · untracked 7
unstaged: docs/final-frontend/forecast-preflight.md, src/web/main.ts
untracked: app-render.ts, app-result.ts, app-events.ts, pages/overview.ts,
           tests/web/app-render.test.ts, dispatch-implementation.md, dispatch-hardening.md
```
Git-операции не выполнялись; `c --noEmit` и `diff.txt` не затрагивались; пользовательские файлы сохранены.

## 8. Итог

**`READY_WITH_LIMITATIONS`** — все четыре исправления внесены, тесты, типы, сборка и формат проходят; ограничение: автоматическая проверка гонок (FIX-1) и DOM-часть делегирования (FIX-3) не подтверждены из-за отсутствия DOM и стабильного способа управления задержками в Bun — вынесены на браузерный этап.
