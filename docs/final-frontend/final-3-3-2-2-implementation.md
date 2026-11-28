# FINAL-3.3.2.2 — реализация страницы «Прогнозирование»

**Дата:** 2026-11-28 · **HEAD:** `db928062b2464d26d14ea9df4c988c332c8ece9b` · **Branch:** `main`

---

## 1. Executive summary

Реализована страница Forecast с **двумя независимыми блоками**: «Снапшоты прогнозов» (`/api/v1/forecasts`) и «Сверка с фактом» (`/api/v1/shadow/reconciliations`). Используются существующие API-клиент, DTO и компоненты; frontend не выполняет расчётов метрик, не объединяет источники и не подменяет `null` нулём. Все автоматические проверки пройдены, браузерная проверка четырёх маршрутов выполнена на реальном API.

**Статус: `READY_FOR_REVIEW`** (требуется ручная приёмка владельца проекта).

## 2. Проверенный HEAD

`db928062b2464d26d14ea9df4c988c332c8ece9b` = `origin/main`; в ходе этапа не изменялся.

## 3. Состояние рабочей директории

| | До | После |
|---|---|---|
| staged / unstaged / untracked | 0 / 1 / 2 | 0 / 3 / 6 |
| unstaged | `D "c --noEmit"` (внешнее удаление), документы API-MAP | + `src/web/app-render.ts`, `tests/web/app-render.test.ts` |
| untracked | `api-map.md`, `api-map-matrix.md` | + 3 модуля страницы и тест страницы |

Файл `c --noEmit` не восстанавливался и не удалялся повторно; Git-операции не выполнялись.

## 4. Изменённые файлы

| Файл | Изменение | Строк |
|---|---|---:|
| `src/web/app-render.ts` | forecast-ветка: валидный маршрут грузит страницу через `loadForecastPage`; некорректный — placeholder без запросов | **200** |
| `tests/web/app-render.test.ts` | проверки Forecast заменены на реальную страницу: 2 запроса с mode/horizon для 4 маршрутов; для некорректных — 0 запросов и NOT_IMPLEMENTED | 179 |

## 5. Новые файлы

| Файл | Назначение | Строк |
|---|---|---:|
| `src/web/pages/forecast.ts` | композиция страницы, переключатели, переходы, `loadForecastPage` (два независимых запроса) | 103 |
| `src/web/pages/forecast-snapshots.ts` | блок снапшотов: таблица из 10 колонок, `total`/`returned`, provenance, состояния | 124 |
| `src/web/pages/forecast-reconciliations.ts` | блок сверок: таблица из 7 колонок, `unknownSnapshots`, `meta.source`/`note`, состояния | 94 |
| `tests/web/forecast-page.test.ts` | null/0, provenance, unknownSnapshots, состояния, независимость, параметры запросов | 161 |
| `docs/final-frontend/final-3-3-2-2-implementation.md` | этот отчёт | — |

Все production-файлы ≤200 строк; `app-render.ts` ровно 200 — дальнейшие добавления требуют выделения модуля.

## 6. Архитектура реализации

`main.ts` (события) → `app-render.renderApp` (поколение рендера `renderRequestSeq`, `commit`, dispatch) → для Forecast: `loadForecastPage` → два параллельных `api.get` (снапшоты + сверки) → каждый блок публикует **свой** `commit` → `shell` → DOM. Расчётов на frontend нет; `null` и `0` различаются; сверки не строятся из снапшотов.

## 7. API endpoints и параметры

| Блок | Endpoint | Параметры |
|---|---|---|
| Снапшоты | `/api/v1/forecasts` | `mode`, `horizon`, `limit=200` |
| Сверки | `/api/v1/shadow/reconciliations` | `mode`, `horizon`, `limit=60` |

Используется только `src/web/api/client.ts`; прямых `fetch` вне клиента — 0. Новые endpoint'ы не создавались, DTO не менялись; селектор моделей не создавался.

## 8. Реализация двух независимых блоков

- «Снапшоты прогнозов»: заголовок с режимом/горизонтом и «показаны последние N из total», таблица (формирование, происхождение, прогноз, модель, версия модели, вариант, значение, статус, версия входных данных, Snapshot ID), provenance (freshness, manifest, checksum данных, список checksums, файлы) и предупреждение при `datasetVersionWarning`.
- «Сверка с фактом»: подзаголовок «сверенное подмножество прогнозных записей», таблица (дата прогноза, модель, прогноз, факт, абсолютная ошибка, знаковая ошибка, Snapshot ID), KPI `total` и `unknownSnapshots`, предупреждение при `unknownSnapshots > 0`, источник из `meta.source` и `meta.note`.
- Provenance снапшотов в блок сверок не переносится (проверено тестом).
- Переходы: `#forecast-quality/<mode>/<horizon>` и `#forecast-diagnostics/<mode>/<horizon>`.

## 9. Состояния

| Блок | loading | success | not_available | error |
|---|---|---|---|---|
| Снапшоты | `data-ds-forecast-snapshots-loading` | карточка с таблицей | текст с кодом `NO_RECORDS_FOR_MODE_AND_HORIZON` | текст ошибки с кодом и сообщением |
| Сверки | `data-ds-forecast-reconciliations-loading` | карточка с таблицей | текст с кодом `NO_RECONCILIATIONS` | текст ошибки с кодом и сообщением |

Состояния независимы: успех одного блока не зависит от второго (проверено детерминированными тестами на `forecastPage`).

## 10. Routing

Маршруты `#forecast/{replay|shadow}/{1|3}`; `normalizeForecastParams` (строго 3 сегмента) не изменялся; переключатели формируются через `forecastHref`; некорректные маршруты показывают placeholder без запросов.

## 11. Защита от гонок

Поколение рендера `renderRequestSeq` + `commit()` в dispatch (проверка перед каждой записью в DOM). Каждый блок публикует результат отдельным `commit`, поэтому смена режима/горизонта инвалидирует ответы предыдущего выбора. Блочные ответы внутри одной загрузки обрабатываются независимо.

## 12. Тесты

| Команда | Результат | Exit |
|---|---|---|
| `bun test tests/web` | 234 pass / 0 fail | 0 |
| `bun test tests/server` | 189 pass / 0 fail | 0 |
| `bun test tests/forecasting` | 386 pass / 0 fail | 0 |
| `bun test tests/web/forecast-page.test.ts tests/web/app-render.test.ts` | 22 pass / 0 fail | 0 |

Покрыто: null/0 для прогноза, факта и ошибок; экранирование; provenance только снапшотов; предупреждение `unknownSnapshots > 0` и его отсутствие при 0; оба not_available-кода; ошибки обоих блоков; независимость состояний; переходы с текущими mode/horizon; параметры и лимиты двух запросов; отсутствие `h7/h14`.

## 13–15. TypeScript, build, PII

| Проверка | Команда | Результат | Exit |
|---|---|---|---|
| Типы | `bunx tsc --noEmit` | 0 ошибок | 0 |
| Сборка | `bun run ui:build` | успешно | 0 |
| Формат | `git diff --check` | чисто | 0 |
| PII gate | `bun tools/redact-pii.ts --in … --gate` | GATE PASS | 0 |

## 16. Браузерная проверка (FACT)

Chrome for Testing через CDP, реальный API и Vite, viewport **1440×1000**:

| Маршрут | Оба блока | Переключатели | 2 таблицы | provenance | Overflow | Ошибки JS |
|---|---|---|---|---|---|---|
| `#forecast/replay/1` | да | да | да | да | нет | 0 |
| `#forecast/replay/3` | да | да | да | да | нет | 0 |
| `#forecast/shadow/1` | да | да | да | да | нет | 0 |
| `#forecast/shadow/3` | да | да | 1 (сверки отсутствуют — честное пустое состояние) | да | нет | 0 |

Фоновые процессы (API, Vite, Chrome) остановлены.

## 17. Ограничения

1. Мобильные viewport'ы (390/360) в этом этапе **не проверялись**.
2. `app-render.ts` = 200 строк: любые дальнейшие добавления требуют выделения модуля.
3. Показываются последние N записей (200 снапшотов, 60 сверок) — серверного фильтра дат/пагинации нет.
4. Модель-фильтр и селектор моделей не реализованы (allowlist backend).
5. Факт и ошибки доступны только для сверенного подмножества — это отражено в подписях.

## 18. Known issues

1. End-to-end автоматический тест гонки (устаревший ответ после смены режима) отсутствует: попытка с подменой `fetch` ранее давала взаимную блокировку стаба; независимость состояний покрыта детерминированными тестами, а поколение рендера — проверкой кода.
2. `shadow/3` показывает пустое состояние сверок — ожидаемое поведение источника, не дефект.

## 19. Матрица критериев приёмки

| ID | Критерий | Результат | Обоснование |
|---|---|---|---|
| AC-01 | Routing | **PASS** | 4 маршрута в браузере и тестах |
| AC-02 | Forecasts API | **PASS** | `/api/v1/forecasts` с mode/horizon/limit=200 |
| AC-03 | Reconciliations API | **PASS** | `/api/v1/shadow/reconciliations` с mode/horizon/limit=60 |
| AC-04 | Независимость | **PASS** | отдельные состояния и отдельные `commit` |
| AC-05 | Ошибки | **PASS** | тест: ошибка одного блока не стирает второй |
| AC-06 | Empty states | **PASS** | оба кода отображаются отдельно |
| AC-07 | Nullable | **PASS** | тесты null/0 для прогноза и факта |
| AC-08 | Provenance | **PASS** | только снапшоты; тест на отсутствие в сверках |
| AC-09 | Unknown snapshots | **PASS** | предупреждение с количеством, маркер в браузере |
| AC-10 | Реальные данные | **PASS** | mock/fixture/random — 0 вхождений |
| AC-11 | Расчёты | **PASS** | только форматирование; ошибки из API |
| AC-12 | Race conditions | **PARTIAL** | поколение рендера + независимые блоки; e2e-тест гонки отсутствует |
| AC-13 | Navigation | **PASS** | переходы с mode/horizon в тестах и на странице |
| AC-14 | Tests | **PASS** | 234 web + 22 целевых |
| AC-15 | TypeScript | **PASS** | exit 0 |
| AC-16 | Build | **PASS** | `ui:build` exit 0 |
| AC-17 | File size | **PASS** | все ≤200 |
| AC-18 | API architecture | **PASS** | прямой `fetch` вне клиента — 0 |
| AC-19 | Backend | **PASS** | серверные файлы и тесты не изменялись |
| AC-20 | Data integrity | **PASS** | CSV/JSONL/SQLite не изменялись |
| AC-21 | Dependencies | **PASS** | `package.json`/lock не изменялись |
| AC-22 | PII | **PASS** | GATE PASS |
| AC-23 | Git safety | **PASS** | Git-операции не выполнялись |
| AC-24 | Browser | **PARTIAL** | 1440×1000 — PASS; 390/360 — NOT_VERIFIED |

## 20. Итоговый статус

**`READY_FOR_REVIEW`** — реализация завершена, все автоматические проверки пройдены, браузерная проверка на десктопном viewport выполнена; AC-12 и AC-24 частично подтверждены (гонка e2e и мобильные ширины). Commit/push не выполнялись, следующий этап не начат.
