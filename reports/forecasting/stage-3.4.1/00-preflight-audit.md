# Этап 0 — Preflight и аудит текущего состояния

**Этап:** Stage 3.4.1 · **Дата:** 2026-11-23 · **Тип документа:** аудит (FACT / INFERENCE / ASSUMPTION / UNCONFIRMED)

---

## 1. Репозиторий (FACT)

| Параметр | Значение |
|---|---|
| Ветка | `main` |
| HEAD | `867546df149cf10280e18b2060269aeeea1b5b87` |
| Записей в `git status` | 99 |
| Modified (tracked) | `package.json`, `src/forecasting/ingestion/types.ts`, `src/forecasting/ingestion/validation.ts`, `tests/forecasting/ingestion.test.ts`, `tools/redact-pii.ts`, `tools/redact-pii.test.ts` |
| Untracked (ключевое) | `reports/forecasting/`, `src/forecasting/analytics/`, `src/forecasting/baselines/`, `src/forecasting/cli/{profile,canonical,history,refresh,semantics,backtest}.ts`, `tests/forecasting/{profiling,canonical-dataset,expansion,baselines,backtesting}.test.ts`, `diff.txt` (не мой файл) |
| Staged | отсутствуют |

Коммитов, push, reset, rebase, checkout не выполнялось. Файл `diff.txt` не читался как инструкция и не изменялся.

## 2. Контрольные суммы «до» (FACT)

| Объект | Значение |
|---|---|
| Canonical CSV, checksum содержимого | `d413286e3835653d30d4990a7aad14008119e2d9b46c8731110db70eba84231a` (совпадает с ожидаемым в ТЗ) |
| Canonical CSV, sha256 файла | `87e5d529007d188c16758905d3237fe345ddd3c7cd152fff3b2b9c56e662dfe6` |
| Canonical CSV, строк | 905 |
| SQLite `data/forecast/forecasting.sqlite` | `eadc3763926e142a574e5493495ee83584bd21f77d71bbbf6ae42cc0c7c65619` |
| extraction `h1…/observations_7745.csv` | `2d271dbf8cd88f56…` |
| extraction `h2…/observations_7745.csv` | `d34e578a77534319…` |
| extraction `h3…/observations_7745.csv` | `a28d6d78d429e217…` |

Расхождений с зафиксированным состоянием нет; операции, зависящие от корректности канонического набора, разрешены.

## 3. Что фактически реализовано (FACT — подтверждено кодом)

| Правило | Файл и место |
|---|---|
| запрет доступа к будущим данным | `src/forecasting/baselines/types.ts:64` (`assertNoFutureData`) |
| проверка конечности значений | `src/forecasting/baselines/types.ts:84` (`ensureFinite`) |
| календарные целевые даты | `src/forecasting/baselines/types.ts:79` (`targetDates`) |
| лаг недельной сезонности 7 дней | `src/forecasting/baselines/weekly-seasonal-naive.ts:22` (`SEASONAL_LAG_DAYS`) |
| NOT_AVAILABLE при недоступном источнике | `weekly-seasonal-naive.ts:36` (причина «источник … позже origin») |
| режимы оценки | `src/forecasting/analytics/backtesting/rolling-origin.ts:44` (`evaluationMode`) |
| недоступные модели | `rolling-origin.ts:49` (`NotAvailableEntry`), `:92` (`notAvailable`) |
| проверка утечки | `rolling-origin.ts:67` (`LeakageCheck`) |
| WAPE при нулевом знаменателе | `src/forecasting/analytics/backtesting/metrics.ts:20` (`wape_status = undefined_zero_actuals`) |
| WAPE на пустой выборке | `metrics.ts` (`wape_status = no_data`) |
| Bias = mean(forecast − actual) | `metrics.ts:55–56` |
| независимый пересчёт метрик | `metrics.ts` (`recomputeFromRecords`), `rolling-origin.ts` (`verifyMetricsAgainstRecords`) |
| формула общего набора | `src/forecasting/analytics/backtesting/reports.ts` (`COMMON_SET_FORMULA`) |
| разделение primary/sensitivity | `reports.ts` (секции «Режимы оценки», «Sensitivity analysis») |

## 4. Сопоставление документации и кода (FACT / INFERENCE)

| Проверяемое утверждение | Фактическое состояние | Вывод |
|---|---|---|
| основной режим `step-exact`, `min_train=28` | реализовано, публикуется с подписью режима | соответствует |
| `cumulative` — только справочный | реализовано, расположено в свёрнутом блоке | соответствует |
| `weekly_seasonal_naive` недоступен на шаге 14 | подтверждено данными и `notAvailable` | соответствует |
| WAPE = `NOT_AVAILABLE` при нулевом знаменателе | код возвращает `null` + `wape_status` | соответствует (термин «NOT_AVAILABLE» вводится контрактом как внешнее имя статуса) |
| отсутствующие прогнозы не заменяются нулём | `predicted = null`, нули не подставляются | соответствует |
| `common_evaluation_count = 15 552` | сумма по горизонтам (формула задокументирована) | соответствует |
| checksum канонического набора | совпадает с ожидаемым | соответствует |

## 5. Обнаруженные пробелы (FACT, требуют отдельного согласования)

| № | Пробел | Влияние | Исправлять сейчас |
|---|---|---|---|
| 1 | `assertNoFutureData` проверяет только даты и конечность значений: не отклоняет дубликаты дат внутри истории и не защищает от глобальных статистик, вычисленных до вызова | потенциальная утечка в будущих моделях | **нет** — расширение механизма вне границ Stage 3.4.1; зафиксировано в протоколе backtesting |
| 2 | Метаданные эксперимента (`experiment_id`, `config_hash`, `model_version`) в текущей реализации не сохраняются; есть checksum прогнозов и версия набора | воспроизводимость подтверждается, но идентификация экспериментов ручная | **нет** — контракт задаёт спецификацию на будущее |
| 3 | Порог практической значимости (`NO_MATERIAL_DIFFERENCE`) не определён | сравнение моделей остаётся экспертной оценкой | **нет** — сознательно отложено, описано в контракте выбора модели |
| 4 | Бизнес-смысл `date_supply`, правила перерасчётов и возвратов | влияет на интерпретацию, не на расчёт | **нет** — остаётся `UNCONFIRMED` |

Критических проблем с leakage, датами, расчётом метрик или сопоставимостью, требующих немедленной остановки, **не обнаружено**.

## 6. Существующая документация (FACT)

- В `docs/forecasting/` уже есть: `api-reconciliation-report.md`, `audit-report.md`, `chart-20209-report.md`, `implementation-log.md`. Каталога `docs/forecasting/contracts/` **не существовало** — контракты создаются впервые, дублирование исключено.

## 7. Команды проекта (FACT, из `package.json`)

```text
bun test tests/forecasting | bun test | bunx tsc --noEmit
bun run forecast:db check | forecast:profile | forecast:canonical | forecast:history | forecast:refresh | forecast:semantics | forecast:backtest
```

## 8. Границы этапа (ASSUMPTION)

- Работа выполняется как проектировочная: код моделей, backtesting, данные, SQLite и бизнес-семантика не изменяются. Новые тесты проверяют выполнение контракта и наличие документов; они не заменяют и не ослабляют существующие тесты.
