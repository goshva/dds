# Stage 3.4.5 — реализация вычислителя адаптивного baseline: отчёт

**Дата:** 2026-11-24 · **Статус:** `STAGE_3_4_5_CALCULATOR_READY_FOR_REVIEW`
**Эксперимент не запускался, baseline не переключался, production pipeline не изменялся.**

---

## 1. Краткое резюме

| Пункт | Состояние |
|---|---|
| Вычислитель реализован | да, изолированный модуль |
| Варианты A и B | реализованы |
| Профиль, weight, clip, процентный limit | реализованы |
| Fail-closed валидация и статусы | реализованы |
| Unit-тесты | 29 pass / 0 fail |
| Регрессия forecasting | 339 pass / 0 fail; полный `bun test` — 503 pass / 4 skip / 0 fail |
| TypeScript | 0 ошибок |
| Изоляция | модуль не импортируется production-кодом |
| Данные / SQLite | контрольные суммы не изменились |

## 2. Исходное состояние Git (FACT)

| Параметр | Значение |
|---|---|
| HEAD | `9daafc6332ff190033f3c0ebe231f666489af19d` (совпадает с базовым commit из задания) |
| Ветка | `main` |
| `git status` до | пусто (0 записей) |
| `git status` после | два новых untracked: `src/forecasting/analytics/adaptive-baseline/`, `tests/forecasting/adaptive-baseline-calculator.test.ts` |
| Пользовательские изменения | отсутствовали |

## 3. Использованные спецификации (FACT)

| Документ | Наличие | Сверка |
|---|---|---|
| `docs/forecasting/contracts/adaptive-baseline-spec.md` | есть (11 272 Б) | limit задан в процентах от текущего уровня rolling baseline; формула совпадает |
| `docs/forecasting/contracts/adaptive-baseline-protocol.md` | есть (13 791 Б) | исследовательские части (Holm, шум) не реализовывались — вне scope |
| `reports/forecasting/stage-3.4.5/stage-3.4.5-specification-report.md` | есть (12 879 Б) | решения по CI и Holm не затрагивались |
| `src/forecasting/baselines/rolling-7-day-mean.ts` | есть | расчёт baseline — внешний вход вычислителя; модель не изменялась |
| `src/forecasting/analytics/calendar/calendar-core.ts` | есть | переиспользована `isoDayOfWeek` (без изменения поведения) |

Противоречий между ТЗ и утверждёнными документами не обнаружено: единицы `limit` в спецификации — проценты от уровня, что совпадает с уточнением задания.

## 4. Архитектурное решение (FACT/INFERENCE)

- Новый каталог `src/forecasting/analytics/adaptive-baseline/` — по соглашениям проекта (`analytics/<тема>/`).
- Вычислитель **принимает** `baselineForecast` как число: это гарантирует изоляцию от `rolling-7-day-mean` и от backtesting pipeline (INFERENCE: если бы модуль вызывал модель, появилась бы связанность с production-кодом).
- Переиспользована только `isoDayOfWeek` из `calendar-core` — чистая функция, поведение не изменялось.
- Модуль не импортируется ни одним production-файлом (FACT, проверено `Select-String` по `src/**`).

## 5. Созданные файлы

| Файл | Содержание |
|---|---|
| `src/forecasting/analytics/adaptive-baseline/calculator.ts` | типы, валидация, профиль, поправка, диспетчер вариантов, диагностика |
| `src/forecasting/analytics/adaptive-baseline/index.ts` | публичный экспорт |
| `tests/forecasting/adaptive-baseline-calculator.test.ts` | 29 unit-тестов |
| `reports/forecasting/stage-3.4.5-calculator-implementation.md` | настоящий отчёт |

Изменённых существующих файлов нет.

## 6. Алгоритм профиля (FACT)

1. Валидация: ISO-даты, `target > origin`, уникальность дат, конечность значений, `date ≤ origin`, конечность `baselineForecast`, корректность `alpha`, `limitPercent`, `minWeekdayObservations`.
2. Отбор истории: только `date <= originDate`.
3. `overallMean` — среднее отобранных значений.
4. Группировка по `isoDayOfWeek` (1 = понедельник … 7 = воскресенье), среднее по каждому дню недели.
5. `weight(d) = mean_weekday(d) − overallMean`.
6. Профиль доступен, если наблюдений по дню недели ≥ `minWeekdayObservations` (по умолчанию 3).

## 7. Варианты A и B (FACT)

| Вариант | Правило |
|---|---|
| A | поправка только для `weekday ∈ {1, 6}`; для остальных дней `applied = false`, `correction = null` |
| B | поправка для всех дней недели с доступным профилем |

Вариант Monday-only и иные эвристики не реализованы.

## 8. Leakage prevention (FACT)

| Правило | Проверка в коде | Тест |
|---|---|---|
| `date > origin` блокируется | `validateInput` → `FUTURE_DATA_DETECTED` | 4 теста (будущее больше/меньше/на origin/сортировка) |
| наблюдение ровно на origin допускается | `date <= origin` | тест «наблюдение ровно на origin» |
| дубликаты дат | `DUPLICATE_DATE` | тест |
| неконечные значения | `NON_FINITE_VALUE` | тесты `NaN`, `Infinity` |
| результат не зависит от будущих значений | будущие записи не проходят валидацию | тест «будущие значения не влияют» |

## 9. Clipping и параметры (FACT)

```text
limit_abs = |baseline_forecast| × limit_percent
raw_correction = alpha × weight
correction = clip(raw_correction, ±limit_abs)
corrected = baseline_forecast + correction
```

- Округление отсутствует (тест на `limitPercent = 0.123456789`).
- `alpha = 0` → `correction = 0`, `corrected === baseline` (identity control).
- Нулевой baseline → `limit_abs = 0`, поправка 0.
- Отрицательный `limitPercent` / `alpha` / `NaN` / `Infinity` → `INVALID_INPUT`.

## 10. Таблица тестов (FACT)

| Группа | Тестов | Результат |
|---|---:|---|
| Профиль (3 наблюдения, 2 наблюдения, отсутствие, пустая история, одинаковые значения) | 6 | pass |
| Variant A (пн, сб, вт–вс) | 3 | pass |
| Variant B (все дни недели) | 1 | pass |
| Clipping, alpha, процентный лимит, нулевой baseline, некорректные параметры | 7 | pass |
| Leakage prevention (future, дубликат, NaN/Infinity, сортировка, target ≤ origin) | 7 | pass |
| Детерминизм, инварианты, точность, независимость от времени | 4 | pass |
| **Итого** | **29** | **pass** |

## 11. TypeScript (FACT)

```text
bunx tsc --noEmit → exit 0, 0 ошибок
```

## 12. Регрессия (FACT)

| Команда | Результат | Exit |
|---|---|---:|
| `bun test tests/forecasting/adaptive-baseline-calculator.test.ts` | 29 pass / 0 fail | 0 |
| `bun test tests/forecasting` | 339 pass / 0 fail | 0 |
| `bun test` | 503 pass / 4 skip / 0 fail | 0 |

`calendarWeekdaySeasonalMean` не изменялась; её тесты проходят (INFERENCE: поведение сохранено, код не затрагивался).

## 13. PII gate (FACT)

```text
bun tools/redact-pii.ts --in reports/forecasting --in docs/forecasting/contracts --in data/processed --gate
→ GATE PASS, PII hits: 0
```

## 14. Целостность данных (FACT)

| Объект | До | После |
|---|---|---|
| Canonical CSV checksum | `d413286e…` | `d413286e…` — совпал |
| SQLite sha256 | `eadc3763…` | `eadc3763…` — `identical: true` |
| Extraction-файлы | — | не изменялись |
| Schema / migrations | — | не изменялись |

## 15. Проверка diff и запретов (FACT)

| Проверка | Результат |
|---|---|
| `git diff --check` | пусто |
| `Math.random`, `Date.now`, `new Date()` без аргументов | отсутствуют |
| обращения к SQLite, сети, `fs`, `process`, `console` | отсутствуют |
| чтение системных часов | отсутствует (`new Date(string)` используется только для валидации ISO-даты в UTC) |
| неявное округление | отсутствует |
| production wiring | отсутствует: модуль не импортируется `src/**` |
| commit, push, reset, rebase, checkout | не выполнялись |

## 16. Неизвестные и ограничения

- Вычислитель не проверяет, что переданный `baselineForecast` действительно получен из `rolling_7_day_mean` — это ответственность вызывающего кода (ASSUMPTION).
- Нулевой baseline даёт нулевую поправку; в исследовании такой случай отдельно не описан (INFERENCE: следует из формулы `limit_abs = |baseline| × percent`).
- Параметры `alpha`/`limitPercent` не валидируются на соответствие утверждённому списку `{0.5, 0.75, 1.0}` / `{5 %, 10 %, 15 %}`: вычислитель поддерживает произвольные корректные значения, выбор конфигурации — задача будущего эксперимента.
- Эксперимент, sensitivity grid, шумовой контроль, HAC/Holm не запускались.

## 17. Подтверждение отсутствия эксперимента (FACT)

- `forecast:calendar-backtest` и любые команды Stage 3.4.5 experiment не запускались.
- HAC, Holm, noise control, validation selection, test evaluation не вычислялись.
- Победитель не объявлялся; лучший вариант не выбирался.

## 18. Подтверждение неизменности baseline (FACT)

- `rolling_7_day_mean` и остальные baseline-модели не изменялись.
- `rolling-origin.ts`, backtesting pipeline и CLI не изменялись.
- Результаты Stage 3.3–3.4.4.1 не пересчитывались.
- Адаптивная модель не подключена к forecasting pipeline; действующий baseline остаётся прежним.
---

## 19. Корректирующий проход вычислителя

### 19.1. Исправленные дефекты

| Дефект | Было | Стало |
|---|---|---|
| A. Variant A, дни кроме пн/сб | `status = OK`, `applied = false`, `correction = null`, `correctedForecast = null` | `status = OK`, `applied = false`, `correction = 0`, `correctedForecast = baseline`; профиль и диагностика сохраняются |
| B. недостаток истории (0, 1 или 2 наблюдения weekday) | `correction = null`, `correctedForecast = null` | `weight = 0`, `correction = 0`, `correctedForecast = baseline`; в диагностике `weekdayObservations` и причина; порог 3 не изменён |
| C. публичная `buildWeekdayProfile` | экспортировалась из публичного API; при пустой истории давала `NaN` в `overallMean` | исключена из публичного API (`index.ts`), внутренний вызов получает `minWeekdayObservations`; при пустой истории `overallMean = null` (без NaN/Infinity); добавлен fail-closed guard в вычислителе |
| D. `WeekdayProfile.available` | `values.length >= 1` | `values.length >= minWeekdayObservations` (по умолчанию 3), согласовано с порогом |

Сверка со спецификацией: раздел 8 `adaptive-baseline-spec.md` задаёт «3 наблюдения, иначе `weight = 0`» — поведение B соответствует утверждённому документу. Противоречий между кодом и спецификацией не обнаружено.

### 19.2. Новые тесты (14)

| № | Тест | Результат |
|---|---|---|
| 1–5 | Variant A, вт/ср/чт/пт/вс: `correctedForecast === baseline` | pass |
| 6–7 | Variant A, пн и сб: поправка применяется | pass |
| 8 | Variant B, weekday с 2 наблюдениями: `correction = 0`, прогноз = baseline | pass |
| 9 | Variant B, weekday с 1 наблюдением: `correction = 0`, прогноз = baseline | pass |
| 10 | Variant B, weekday без наблюдений: `correction = 0`, прогноз = baseline | pass |
| 11 | при 3 наблюдениях профиль доступен (`available = true`) | pass |
| 12 | `alpha = 0`: прогноз = baseline для A и B | pass |
| 13 | пустая история: нет NaN/Infinity, `overallMean = null`, fail-closed | pass |
| 14 | одинаковое множество прогнозных дат для baseline, A и B | pass |

Итого в файле: **43 теста** (было 29).

### 19.3. Результаты команд (FACT)

| Команда | Результат | Exit |
|---|---|---:|
| `bun test tests/forecasting/adaptive-baseline-calculator.test.ts` | 43 pass / 0 fail | 0 |
| `bun test tests/forecasting` | 353 pass / 0 fail | 0 |
| `bun test` | 517 pass / 4 skip / 0 fail | 0 |
| `bunx tsc --noEmit` | 0 ошибок | 0 |
| PII gate | GATE PASS, 0 срабатываний | 0 |
| `git diff --check` | пусто | 0 |

### 19.4. Изменённые файлы

| Файл | Изменение |
|---|---|
| `src/forecasting/analytics/adaptive-baseline/calculator.ts` | ветки A/B, порог `available`, безопасный профиль, guard от null-среднего, верхнеуровневые поля результата из `extras` |
| `src/forecasting/analytics/adaptive-baseline/index.ts` | `buildWeekdayProfile` убрана из публичного API |
| `tests/forecasting/adaptive-baseline-calculator.test.ts` | обновлены ожидания, добавлены 14 тестов |
| `reports/forecasting/stage-3.4.5-calculator-implementation.md` | настоящий раздел |

### 19.5. Подтверждения

- Baseline-модели, `rolling-origin.ts`, backtesting pipeline и CLI не изменялись.
- Модуль по-прежнему не импортируется production-кодом.
- Формула `weight`, формула clipping, `rolling_7_day_mean` не изменялись.
- Канонический CSV: checksum `d413286e…` — совпал.
- SQLite sha256: `eadc3763…` — `identical: true`.
- Эксперимент, sensitivity grid, validation selection, noise control, HAC/Holm, test evaluation не запускались.
- Commit, push, reset, rebase, checkout не выполнялись; HEAD `9daafc6…`, ветка `main`.

**Обновлённый статус: `STAGE_3_4_5_CALCULATOR_READY_FOR_REVIEW`.**