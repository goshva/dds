# UI-4.1 — вычислительное ядро оценки прогнозов: отчёт о реализации

**Дата:** 2026-11-24 · **HEAD:** `099f37b2588c2c1cb821faabf81d507f14f14818` · **Ветка:** `main` · **Staged:** 0
**Контракт:** `forecast-eval/v1`, уточнённая редакция UI-4.0.2

---

## A. Статус

**ACCEPTED WITH LIMITATIONS** — ядро реализовано, матрица тестов пройдена, прогнозный контур и данные не изменялись. Ограничения перечислены в разделе H (отсутствие чтения JSONL, отсутствие read-model/API — по границам этапа; `CONFLICT_DUPLICATE` для дублей reconciliation выявляется, но пара исключается через `conflictN` без отдельного счётчика в сводке).

## B. Изменённые файлы

| Файл | Тип | Назначение |
|---|---|---|
| `src/server/forecast-evaluation.ts` | создан (новый модуль) | чистые функции оценки: классификация, eligibility, конфликты, пары, метрики, сводка |
| `tests/server/forecast-evaluation.test.ts` | создан (тесты) | матрица тестов UI-4.1 (E/P/D/M/R/I) |
| `docs/ui/ui-4-1-implementation-report.md` | создан | настоящий отчёт |

Изменений в `src/forecasting/**`, `src/server/{sources,routes,api,app,index}.ts`, `src/server/services/**`, `tests/**` (кроме нового файла), `package.json`, `bun.lock`, конфигурациях — **нет**.

## C. Реализованные функции

| Функция | Сигнатура | Вход → выход | Ошибки | Ограничения |
|---|---|---|---|---|
| `isKnownMode` | `(value: unknown) => value is EvaluationMode` | значение → флаг | — | только `replay`/`shadow` |
| `classifyComputeStatus` | `(value: unknown) => ComputeStatus` | значение → `OK`/`FALLBACK`/`INVALID`/`UNKNOWN` | — | неизвестное → `UNKNOWN`, не `OK` |
| `isKnownHorizon` | `(value: unknown) => value is number` | значение → флаг | — | только `{1,3}` |
| `matchesIdentity` | `(snapshot, identity) => boolean` | снапшот, идентичность → флаг | — | проверяет `model_id`, `model_version`, `variant` |
| `classifyUnknown` | `(snapshot) => UnknownKind \| null` | снапшот → вид неизвестности | — | структурно корректная запись не считается повреждением |
| `eligibility` | `(snapshot, reconciliation, options?) => EligibilityResult` | снапшот + reconciliation → пригодность, причина, предупреждения, статусы | не бросает | `technicalFactCutoff` проверяется до reconciliation; `PROVISIONAL` не меняется |
| `classifyConflicts` | `(snapshots, reconciliations) => ConflictReport` | массивы → дубли, сироты, расхождения, неизвестные | не бросает | не использует `errors.jsonl` |
| `buildPairs` | `(snapshots, reconciliations, options?) => PairBuildResult` | массивы → пары + счётчики + конфликты | не бросает | 12 проверок; победитель при дублях не выбирается |
| `computeMetrics` | `(records) => Metrics` | наблюдения → MAE/WAPE/Bias/under/over/exact | не бросает | пустая выборка и нулевой знаменатель → `null` + `NOT_AVAILABLE`; NaN/Infinity отфильтрованы |
| `buildEvaluationSummary` | `(mode, horizon, snapshots, reconciliations, options?) => EvaluationSummary` | режим + горизонт → сводка | не бросает | агрегаты строго по одному режиму и горизонту |
| `summariesByMode` | `(snapshots, reconciliations, options?) => EvaluationSummary[]` | массивы → сводки по режимам×горизонтам | не бросает | режимы не объединяются |

**Чистота (FACT):** в коде нет `readFile`/`writeFile`/`Bun.file`/`fetch(`/`Date.now`/`new Date`/`sqlite`/`process.env`; модуль не импортируется ни одним production-модулем.

## D. Соответствие контракту (§21)

| Правило | Реализация | Тест | Статус |
|---|---|---|---|
| `baseline_identity` | `BASELINE_IDENTITY` + `matchesIdentity` | «identities» | PASS |
| `candidate_identity` | `CANDIDATE_IDENTITY` + `matchesIdentity` | P09–P11 | PASS |
| `pair_identity` | `pairKey = mode\|horizon\|origin\|target\|input_data_version` | P01–P08 | PASS |
| `snapshot_identity` не смешивается с `pair_identity` | независимый поиск участников | P01–P03 | PASS |
| `variant` не входит в `snapshot_id` | формула не изменялась; `variant` проверяется отдельно | P11 | PASS |
| Техническая зрелость (`technicalFactCutoff`) | проверка до reconciliation | E07, P16 | PASS |
| `PROVISIONAL` | `semantics: "PROVISIONAL"` в метриках и сводке | «парное сравнение…» | PASS |
| `PersistedErrors` ≠ `DetectedConflicts` | `classifyConflicts` не читает `errors.jsonl` | D01–D12 | PASS |
| `UnknownRecords` | `classifyUnknown` + `unknownRecords` | D06–D07, R04 | PASS |
| `UNKNOWN_MODE` / `UNKNOWN_MODEL` / `UNKNOWN_SNAPSHOT` / `UNKNOWN_STATUS` | классификация + причины | E08–E12, D07 | PASS |
| `UNKNOWN_RECONCILIATION` | выявляется как дубль reconciliation → `CONFLICT_DUPLICATE` | D03 | PASS (частично: отдельного вида нет) |
| `CONFLICT_DUPLICATE` | дубли snapshot/reconciliation | D01–D05 | PASS |
| `CONFLICT_ACTUAL` | расхождение `actual` в паре | P15, D09 | PASS |
| `CONFLICT_FORECAST_VALUE` | расхождение forecast в snapshot/reconciliation | D08 | PASS |
| `UNKNOWN_DATASET_VERSION` | отсутствующий/нестроковый checksum | P19–P20 | PASS |
| `DATASET_VERSION_DIFFERS` | предупреждение при совпадении input_data_version и actual | P18 | PASS |
| NULL/0 policy | `null` вместо 0; `null`-прогноз исключён | E04, M06–M07, M14 | PASS |
| Парное сравнение | только на общей выборке; `pairedN = 0` → `NOT_AVAILABLE` | «парное сравнение…» | PASS |
| Разделение replay/shadow | счётчики и метрики строго по режиму | P17, R01–R05 | PASS |

## E. Тесты

| Показатель | Значение |
|---|---|
| Новых тестов | **45** |
| Успешных | 45 |
| Неуспешных | 0 |
| Пропущенных | 0 |
| `bun test tests/server/forecast-evaluation.test.ts` | 45 pass / 0 fail (exit 0) |
| `bunx tsc --noEmit` | 0 ошибок (exit 0) |
| `bun test` (полный) | **715 pass / 4 skip / 0 fail** (exit 0) |
| PII gate | PASS (2 файла) |

Покрытие матрицы: Eligibility E01–E12 · Парность P01–P20 · Дубли D01–D12 · Метрики M01–M14 · Режимы R01–R05 · Инварианты I01–I06.

**Примечание:** при первом полном прогоне один существующий тест (`CLI базы > ошибки аргументов…`) упал; повторный прогон — 715 pass / 0 fail (флейк, не связан с UI-4.1).

## F. Безопасность

| Проверка | Результат |
|---|---|
| Прогнозный контур (`src/forecasting/**`) | не изменялся ✓ |
| `snapshot_id`, JSONL-формат, `monitor()`, `reconcile()` | не изменялись ✓ |
| Baseline `rolling_7_day_mean`, Variant B | не изменялись ✓ |
| SQLite | `identical: true` ✓ |
| canonical CSV (нормализованный) | `8f2b1818da001a42fad3125b…` ✓ |
| `forecasts.jsonl` / `reconciliations.jsonl` / `manifest.json` | `e35fe27b…` / `32ccd256…` / `9d986747…` ✓ |
| `errors.jsonl` | не создан ✓ |
| Прогнозные операции (shadow/replay/reconcile/monitor/`--mode all`) | не запускались ✓ |
| Новые зависимости | не добавлялись ✓ |

## G. Git

HEAD `099f37b2588c2c1cb821faabf81d507f14f14818`; ветка `main`; staged **0**; unstaged **0**; untracked **4** — два документа UI-4 (созданы ранее, не изменялись в этом этапе) и два новых файла UI-4.1 (`src/server/forecast-evaluation.ts`, `tests/server/forecast-evaluation.test.ts`). Git-операции не выполнялись; index не изменялся.

## H. Ограничения

**NOT_IMPLEMENTED (по границам этапа):**
- чтение `forecasts.jsonl`/`reconciliations.jsonl` (IO вынесено за пределы ядра — UI-4.2);
- read-model, HTTP endpoints, экраны, Vite-интеграция (UI-4.2+);
- отдельный вид `UNKNOWN_RECONCILIATION` (дубль reconciliation классифицируется как `CONFLICT_DUPLICATE`);
- статистическая значимость, бизнес-материальность, p10/p90, сценарии, финансовый эффект;
- SQLite read-only API.

**NOT_VERIFIED:**
- поведение ядра на реальных 3 508 снапшотах и 3 502 reconciliation (в UI-4.1 тесты изолированы; проверка на живых данных — UI-4.2);
- бизнес-семантика `delivered_orders_daily` (`PROVISIONAL` сохраняется);
- браузерная адаптивность (UI-7).

**Ограничение по данным (FACT):** `ReconciliationRecord` не хранит `mode`/`origin_date`/`model_version`/`input_data_version`/`dataset_checksum` — ядро принимает эти поля из снапшота через `snapshot_id`; формат хранения не изменялся.

## I. Следующий этап

**UI-4.2 — Forecasting read-model и GET API:** чтение источников существующими функциями (`readSnapshots`/`readReconciliations`), вызов ядра UI-4.1, DTO `GET /api/v1/forecasts`, `/forecasts/quality`, `/forecasts/errors` (только GET, envelope `ok`/`not_available`/`error`, обязательный `eventId`), тесты контракта API, обновление `api-contract.md`. Без экранов, без SQLite, без запуска прогнозных операций.

**UI-4.2 NOT STARTED.**
---

# UI-4.1.1 — исправление корректности расчётов

**Дата:** 2026-11-24 · **Режим:** точечная корректировка ядра · **Код прогнозного контура и данные не изменялись**

## A. Итоговый статус

**ACCEPTED WITH LIMITATIONS** — все десять дефектов (C-1…C-10) исправлены, матрица T41-01…T41-56 пройдена, прежние группы тестов сохранены. Ограничения — в разделе J.

## B. Таблица C-1–C-10

| ID | Дефект | Исправление | Тесты | Результат |
|---|---|---|---|---|
| C-1 | Независимые метрики ограничены парной выборкой | `EvaluationSummary.independentMetrics` собирается по всем пригодным наблюдениям модели; парное сравнение — отдельно, по общей выборке | T41-01…T41-05 | PASS |
| C-2 | Не проверялся горизонт `{1,3}` | `isKnownHorizon` применяется в `eligibility`, `buildPairs`, `evaluate`, `summariesByMode`; причина `UNKNOWN_HORIZON`; счётчик `unsupportedHorizonN` | T41-06…T41-10 | PASS |
| C-3 | Пустая выборка создавала фиктивный `shadow`/`h=0` | `computeMetrics(records, context)` — контекст обязателен; `emptyMetrics(context)` берёт идентичность только из аргумента | T41-11…T41-14 | PASS |
| C-4 | Не контролировалось переполнение | проверяются разности, накопление сумм и деление; переполнение → метрика `null`, `biasStatus`/`wapeStatus = OVERFLOW`, `overflowN` | T41-15…T41-22 | PASS |
| C-5 | reconciliation не проверялся по доступным полям | проверяются `model_id`, `horizon`, `target_date`, `forecast_value`; несовпадения → `reconciliationMismatches`, причина `CONFLICT_RECONCILIATION` | T41-23…T41-29 | PASS |
| C-6 | Orphan reconciliation терялся в summary | диагностика строится по исходным наборам целиком; `orphanReconciliations`, `orphanReconciliationN`, запись в `unknownRecords` | T41-30…T41-33 | PASS |
| C-7 | Неизвестные записи недостаточно видимы | `unknownRecords` в каждой сводке и в `diagnostics`; виды `UNKNOWN_MODE/MODEL/SNAPSHOT/RECONCILIATION/STATUS/HORIZON` | T41-34…T41-38 | PASS |
| C-8 | Нет `UNKNOWN_RECONCILIATION` | отдельный вид для невалидных обязательных полей; дубли остаются `CONFLICT_DUPLICATE` | T41-39…T41-43 | PASS |
| C-9 | `computeMetrics` допускал смешение | несовпадающие записи не смешиваются и возвращаются в `excluded` (`CONTEXT_MISMATCH`) | T41-44…T41-49 | PASS |
| C-10 | Конфликты pair identity не диагностировались | `pairIdentityConflicts` с участником и всеми `snapshot_ids`; причина `CONFLICT_PAIR_IDENTITY`, счётчик `pairIdentityConflictN` | T41-50…T41-56 | PASS |

## C. Изменения интерфейсов

| Функция | До | После | Причина | Совместимость |
|---|---|---|---|---|
| `computeMetrics` | `(records) => Metrics` | `(records, context: MetricsContext) => MetricsResult` | C-3 (фиктивный контекст), C-4 (переполнение), C-9 (смешение) | **несовместимо**: обновлены только тесты UI-4.1.1; серверные API не затронуты |
| `EvaluationSummary` | `metrics`, `counters`, `conflicts`, `warnings` | `independentMetrics`, `pairedComparison`, `pairCounters`, `eligibilityDiagnostics`, `conflicts`, `unknownRecords`, `warnings` | C-1, C-6, C-7 | **несовместимо** внутри модуля; внешний API не менялся |
| `PairCounters` | 11 полей | 15 полей (`baselineIndependentN`, `candidateIndependentN`, `unsupportedHorizonN`, `orphanReconciliationN`, `invalidReconciliationN`, `pairIdentityConflictN`) | C-2, C-6, C-10 | расширено |
| `EligibilityReason` | 13 значений | + `UNKNOWN_HORIZON`, `CONFLICT_RECONCILIATION`, `CONFLICT_PAIR_IDENTITY`, `INVALID_RECONCILIATION` | C-2, C-5, C-8, C-10 | расширено |
| `UnknownKind` | 5 значений | + `UNKNOWN_HORIZON` | C-2, C-7 | расширено |
| `evaluate()` | отсутствовала | `(snapshots, reconciliations, options?) => EvaluationResult` | единая точка: сводки + глобальная диагностика | новая функция |
| `buildEvaluationSummary` | использовала `metrics` | использует `independentMetrics` | C-1 | сохранена сигнатура |

## D. Тестовая матрица

| Показатель | Значение |
|---|---|
| Прежних тестов сохранено | 45 (E01–E12, P01–P20, D01–D12, M01–M14, R01–R05, I01–I06) |
| Новых тестов добавлено | 21 блок, покрывающий T41-01…T41-56 |
| Всего в файле | **66 тестов** |
| Пройдено | 66 |
| Пропущено / упало | 0 / 0 |
| Покрытие T41 | 56 из 56 сценариев |

Часть прежних тестов уточнена по смыслу: `P16` — `pendingN = 2` (оба участника пары незрелые); `P17`/`T41-30` — reconciliation для candidate указывает собственный `model_id` (следствие корректной проверки C-5); `T41-04`/`T41-29` — непригодное/конфликтующее наблюдение имеет отдельную pair identity либо исключается только само.

## E. Независимая и парная оценка (синтетический пример)

```text
вход: 3 baseline (origin 18/19/20.11) + 1 candidate (origin 20.11)
baseline independent n = 3   (MAE считается по трём наблюдениям)
candidate independent n = 1  (MAE считается по одному наблюдению)
pairedN = 1                  (общая пара: origin 20.11 → target 21.11)
pairedComparison.maeBaseline / maeCandidate — только по общей паре
```

Проверено тестом T41-01; T41-02/T41-03 подтверждают, что участник без пары остаётся в независимых метриках.

## F. Арифметическая безопасность

| Ситуация | Поведение |
|---|---|
| Переполнение разности | запись не попадает в `errors`; `overflowN`, `mae/bias = null`, `biasStatus = OVERFLOW` |
| Переполнение накопления сумм | `mae/wape/bias = null`, `wapeStatus = OVERFLOW`, запись в `excluded` |
| Пустая выборка | `n = 0`, `mae/wape/bias = null`, статусы `NOT_AVAILABLE`; контекст — только из аргумента |
| Нулевой знаменатель WAPE | `wape = null`, `wapeStatus = NOT_AVAILABLE` |
| `NaN`/`Infinity` на входе | запись в `excluded` (`NON_FINITE`), в метрики не попадает |
| `wapeStatus = OK` при `wape = null` | невозможно (статус выставляется по итоговому значению) |

## G. Диагностика

| Категория | Реализация |
|---|---|
| Unknown records | `unknownRecords` (сводка + `diagnostics`) с видом, `snapshot_id`, `recordType`, `reason` |
| Orphan reconciliations | `orphanReconciliations`, `orphanReconciliationN`, вид `UNKNOWN_SNAPSHOT` |
| Duplicate snapshots | `duplicateSnapshotIds` (с количеством вхождений), `duplicateN` |
| Duplicate reconciliations | `duplicateReconciliationIds`, `duplicateN` |
| Pair identity conflicts | `pairIdentityConflicts` (участник + все `snapshot_ids`), `pairIdentityConflictN` |
| Invalid reconciliation | `invalidReconciliations`, вид `UNKNOWN_RECONCILIATION`, причина `INVALID_RECONCILIATION` |
| Reconciliation mismatches | `reconciliationMismatches` (поле несовпадения), причина `CONFLICT_RECONCILIATION` |

## H. Безопасность

- Не изменялись: прогнозный контур (`src/forecasting/**`), `snapshot_id`, `input_data_version`, `monitor()`, `reconcile()`, JSONL-формат, baseline `rolling_7_day_mean`, Variant B, SQLite (`identical: true`), canonical CSV (`8f2b1818…`), `forecasts.jsonl` (`e35fe27b…`), `reconciliations.jsonl` (`32ccd256…`), `manifest.json` (`9d986747…`); `errors.jsonl` не создан. Прогнозные операции не запускались; зависимости не добавлялись.

## I. Git

HEAD `099f37b2588c2c1cb821faabf81d507f14f14818`; ветка `main`; staged 0; unstaged 0; untracked 5 (два документа UI-4, отчёт UI-4.1, ядро, тесты). Git-операции не выполнялись.

## J. Остаточные ограничения

**NOT_IMPLEMENTED:** чтение JSONL и подключение ядра к read-model/API (UI-4.2); статистическая значимость, доверительные интервалы, p10/p90, сценарии, финансовый эффект; SQLite read-only API; экраны.
**NOT_VERIFIED:** поведение ядра на реальных 3 508 снапшотах и 3 502 reconciliation (в UI-4.1.1 используются только синтетические unit-тесты); бизнес-семантика `delivered_orders_daily` (`PROVISIONAL` сохраняется); браузерная адаптивность (UI-7).
**Ограничение по данным (FACT):** `ReconciliationRecord` не хранит `mode`/`origin_date`/`model_version`/`input_data_version`/`dataset_checksum` — эти поля берутся из снапшота через `snapshot_id`.
---

# UI-4.1.2 — исправление арифметики и парного сравнения

**Дата:** 2026-11-24 · **Режим:** ограниченная корректировка корректности · **Данные и прогнозный контур не изменялись**

## 1. Исходные дефекты

| ID | Дефект | Последствие |
|---|---|---|
| C-11 | переполнение учитывалось непоследовательно: `underN/overN/exactN` считались по всем валидным записям, а `n` — по успешным разностям; `overflowN` вычислялся как разность массивов; переполнение одной метрики обнуляло все; исключённые из-за переполнения строки не попадали в `excluded` | счётчики противоречили друг другу, частичный результат мог выглядеть полным, диагностика терялась |
| C-12 | `pairedComparison.status` определялся только условием `pairedN > 0` | при недоступных (переполненных) метриках сравнение сообщало `OK` |
| C-13 | тесты `T41-16/17/19/20/21` содержали проверки вида `Number.isFinite(metrics.mae ?? 0)` | `null` превращался в `0`, дефект не воспроизводился |

## 2. Что изменено

| Область | Изменение |
|---|---|
| `computeMetrics()` | поэтапная проверка конечности (разность → `Math.abs` → накопление `absSum`/`errorSum`/`actualAbsSum` → деление → `×100`); наблюдение с переполнением разности исключается и фиксируется в `excluded`; классификация `under/over/exact` — только по наблюдениям, вошедшим в расчёт |
| Счётчики | `n` = число наблюдений, полностью прошедших арифметику; `underN + overN + exactN === n`; `overflowN` = наблюдения, затронутые переполнением (разность + накопление); добавлены `excludedN`, `contextMismatchN`, `nonFiniteN` |
| Статусы | добавлен `maeStatus`; статусы MAE/Bias/WAPE независимы; нулевой знаменатель WAPE → `NOT_AVAILABLE`, переполнение → `OVERFLOW` |
| `EvaluationSummary` | добавлено `metricDiagnostics` (исключённые наблюдения по каждой модели) — диагностика `computeMetrics().excluded` больше не теряется |
| `pairedComparison` | `available` и `status` определяются доступностью **обеих** MAE и конечностью `deltaMae`, а не только наличием пар |

## 3. Политика обработки переполнения

1. Проверяется конечность **каждого** промежуточного результата.
2. Наблюдение, у которого переполнилась разность, не входит в расчёт (`n`) и попадает в `excluded` с причиной `OVERFLOW`.
3. Накопление (`absSum`, `errorSum`, `actualAbsSum`) проверяется отдельно: переполнение одной суммы обнуляет **только** зависящие от неё метрики (MAE и WAPE — от `absSum`; Bias — от `errorSum`; WAPE дополнительно — от `actualAbsSum`).
4. Если метрика недостоверна — значение `null`, статус `OVERFLOW` (переполнение) или `NOT_AVAILABLE` (нулевой знаменатель / пустая выборка).
5. Частичный результат не обозначается как полный: `n` отражает фактически рассчитанные наблюдения, `overflowN` — затронутые.
6. Порядок входных записей не влияет на числовые метрики (проверено тестом I04).

## 4. Инварианты счётчиков

| Инвариант | Проверка |
|---|---|
| `underN + overN + exactN === n` | тесты M11, T7 |
| `overflowN` = число наблюдений, затронутых переполнением | T1 (1), T2 (3), T7 (1) |
| `excludedN` = размер `excluded` | T1, T7 |
| `contextMismatchN` + `nonFiniteN` + `overflowN` + `n` = число переданных записей | T41-44…T41-49, T7 |
| Переполнение не смешивается с нулевым знаменателем | T5 (`OVERFLOW`) и T6 (`NOT_AVAILABLE`) |

## 5. Статусы метрик

| Ситуация | MAE | Bias | WAPE |
|---|---|---|---|
| нормальные значения | значение / `OK` | значение / `OK` | значение / `OK` |
| пустая выборка | `null` / `NOT_AVAILABLE` | `null` / `NOT_AVAILABLE` | `null` / `NOT_AVAILABLE` |
| нулевой знаменатель | значение / `OK` | значение / `OK` | `null` / `NOT_AVAILABLE` |
| переполнение разности | `null` / `OVERFLOW` | `null` / `OVERFLOW` | `null` / `OVERFLOW` |
| переполнение `absSum` | `null` / `OVERFLOW` | значение / `OK` (если `errorSum` конечна) | `null` / `OVERFLOW` |
| переполнение `errorSum` | значение / `OK` | `null` / `OVERFLOW` | значение / `OK` |
| переполнение `actualAbsSum` | значение / `OK` | значение / `OK` | `null` / `OVERFLOW` |
| переполнение финального `×100` | значение / `OK` | значение / `OK` | `null` / `OVERFLOW` |

## 6. Новые и заменённые тесты

| Тест | Проверяет | Результат |
|---|---|---|
| T1 | переполнение разности: `n=0`, все метрики `null`/`OVERFLOW`, `overflowN=1`, `excluded` | pass |
| T2 | переполнение `absSum`: `n=3`, `maeStatus=OVERFLOW`, `overflowN=3` | pass |
| T3 | переполнение `errorSum`: `biasStatus=OVERFLOW` | pass |
| T4 | переполнение `actualAbsSum`: MAE/Bias `OK`, WAPE `OVERFLOW` | pass |
| T5 | переполнение финального WAPE при конечных суммах | pass |
| T6 | нулевой знаменатель → `NOT_AVAILABLE` (не `OVERFLOW`) | pass |
| T7 | смешанный набор: `under+over+exact = n`, `overflowN=1`, MAE конечна | pass |
| T8 | baseline MAE переполнена → `status=OVERFLOW`, `available=false` | pass |
| T9 | candidate MAE переполнена → `status=OVERFLOW`, `available=false` | pass |
| T10 | недостижимость переполнения `delta` (MAE ≥ 0) — зафиксировано свойство | pass |
| T11 | обе MAE доступны → `status=OK`, `deltaMae = 45 − 55 = −10` | pass |
| T12 | пар нет → `NOT_AVAILABLE` | pass |
| T13 | `metricDiagnostics` сохраняется в сводке (C-11.4) | pass |
| T41-16/17 (заменён) | конкретные `null` + `OVERFLOW` + счётчики вместо `isFinite(x ?? 0)` | pass |
| T41-19/20/21 (заменён) | нулевой знаменатель → `NOT_AVAILABLE`, MAE/Bias = 0 / `OK` | pass |

Слабые проверки `Number.isFinite(metrics.mae ?? 0)` и тавтологические условия удалены.

## 7. Результаты проверок

| Команда | Результат |
|---|---|
| `bun test tests/server/forecast-evaluation.test.ts` | **79 pass / 0 fail** (66 прежних + 13 новых) |
| `bun test` | **749 pass / 4 skip / 0 fail** |
| `bunx tsc --noEmit` | 0 ошибок |
| PII gate (3 файла) | PASS |

## 8. Изменённые файлы

1. `src/server/forecast-evaluation.ts` — `computeMetrics`, интерфейсы `Metrics`/`EvaluationSummary`, `pairedComparison`, `metricDiagnostics`.
2. `tests/server/forecast-evaluation.test.ts` — заменены T41-16/17 и T41-19/20/21, добавлены T1–T13.
3. `docs/ui/ui-4-1-implementation-report.md` — настоящий раздел.

## 9. Защита данных

Не изменялись: SQLite (`identical: true`), canonical CSV (`8f2b1818…`), `forecasts.jsonl` (`e35fe27b…`), `reconciliations.jsonl` (`32ccd256…`), `manifest.json` (`9d986747…`), `errors.jsonl` (не создан), `src/forecasting/**`, API/routes/read-models, frontend, `package.json`, `bun.lock`. Прогнозные операции не запускались; Git index не изменялся; commit/push не выполнялись.

## 10. Остаточные ограничения

**NOT_IMPLEMENTED:** подключение ядра к read-model/API (UI-4.2); статистическая значимость, p10/p90, сценарии, финансовый эффект; SQLite read-only API; экраны.
**NOT_VERIFIED:** поведение на реальных 3 508 снапшотах и 3 502 reconciliation (только синтетические unit-тесты); бизнес-семантика метрики (`PROVISIONAL`); браузерная адаптивность (UI-7).
**Ограничение T10:** переполнение `deltaMae` математически недостижимо при неотрицательных MAE — свойство зафиксировано тестом, отдельная ветка кода для него не требуется.
---

# UI-4.1.2.1 — счётчики, диагностика, полнота выборки

**Дата:** 2026-11-24 · **Режим:** ограниченная корректировка · **Данные и прогнозный контур не изменялись**

## 1. Исходные замечания

| ID | Замечание | Последствие |
|---|---|---|
| C-14 | `overflowN = differenceOverflowN + (accumulation ? n : 0)` давал двойной учёт: заявленный инвариант `contextMismatchN + nonFiniteN + overflowN + n = records.length` нарушался (T2: 0+0+3+3 = 6 при 3 записях) | счётчики недостоверны, диагностика вводила в заблуждение |
| C-15 | в `metricDiagnostics` сохранялись только агрегаты; массив `excluded` терялся | невозможно понять, какие наблюдения и почему исключены |
| C-16 | статус `OK` не различал корректность расчёта и полноту выборки | частичный результат мог восприниматься как полный |
| C-17 | тест T3 использовал значения, при которых переполнялись и `absSum`, и `errorSum` | тест не доказывал изолированную работу статуса Bias |

## 2. Что изменено

| Область | Изменение |
|---|---|
| C-14 | введены **непересекающиеся** счётчики: `contextMismatchN`, `nonFiniteN`, `excludedOverflowN` (исключённые из-за переполнения разности), `n` (вошедшие в расчёт). Инвариант: `contextMismatchN + nonFiniteN + excludedOverflowN + n === records.length`. Отдельно `overflowAffectedN` — наблюдения, затронутые переполнением **накопления** (метрика недостоверна, но строка остаётся в расчёте); он не суммируется с исключёнными строками |
| C-14 | агрегированное сообщение о переполнении метрик вынесено из `excluded` в новое поле `MetricsResult.overflowNotes` — `excluded` теперь содержит только исключённые наблюдения |
| C-15 | `EvaluationSummary.metricDiagnostics` хранит **структурированную** диагностику: `excluded[]` (причина + деталь), `overflowNotes[]`, `excludedN`, `excludedOverflowN`, `overflowAffectedN`, `contextMismatchN`, `nonFiniteN`, `sampleStatus` |
| C-16 | в `Metrics` добавлен `sampleStatus: "COMPLETE" \| "PARTIAL"`; `OK` по-прежнему означает корректность расчёта, полнота выражается отдельным полем |
| C-17 | T3 пересмотрен: зафиксирована математическая зависимость `|Σe| ≤ Σ|e|` (переполнение `errorSum` влечёт переполнение `absSum`); добавлен достижимый случай изолированного переполнения `absSum` при взаимно компенсирующихся ошибках разных знаков |

## 3. Значения счётчиков

| Счётчик | Определение |
|---|---|
| `n` | наблюдения, полностью прошедшие арифметику и вошедшие в метрику |
| `excludedOverflowN` | наблюдения, исключённые из-за переполнения **разности** |
| `overflowAffectedN` | наблюдения в расчёте, затронутые переполнением **накопления** (`0` или `n`) |
| `excludedN` | `contextMismatchN + nonFiniteN + excludedOverflowN` |
| `contextMismatchN` / `nonFiniteN` | несовпадение контекста / нечисловые входы |
| `sampleStatus` | `COMPLETE`, если `excludedN = 0`, иначе `PARTIAL` |

## 4. Инварианты (проверены тестами)

1. `contextMismatchN + nonFiniteN + excludedOverflowN + n === records.length` — непересекающееся покрытие входа.
2. `excludedN === excluded.length`.
3. `overflowAffectedN ≤ n`.
4. `underN + overN + exactN === n`.
5. Двойной учёт отсутствует при одновременном переполнении разности и накопления.

## 5. Тесты

| Тест | Проверяет | Результат |
|---|---|---|
| C-14 инвариант (4 набора) | непересекающееся покрытие входа, `overflowAffectedN ≤ n`, `excludedN = сумма` | pass |
| C-14 двойной учёт | 4 записи: `n = 3`, `excludedOverflowN = 1`, `overflowAffectedN = 3`, сумма = 4 | pass |
| C-15 структурированная диагностика | `excluded[0] = { reason: "OVERFLOW", detail: "разность не конечна" }`, `overflowNotes` — массив | pass |
| C-15 различимость причин | `CONTEXT_MISMATCH` и `NON_FINITE` различимы | pass |
| C-16 полнота | `COMPLETE` без исключений; `PARTIAL` с исключением при `maeStatus = OK` | pass |
| C-17 зависимость | переполнение `errorSum` влечёт переполнение `absSum` | pass |
| C-17 изолированное переполнение `absSum` | `maeStatus = OVERFLOW`, `biasStatus = OK`, `overflowAffectedN = 2` | pass |
| C-17 пересмотренный T3 | одна запись: `absSum` и `bias` конечны, статусы `OK` | pass |
| T2 / T41-16-17 (обновлены) | накопление: `excludedN = 0`, `overflowAffectedN = 3`, `sampleStatus = COMPLETE` | pass |
| T13 (обновлён) | `metricDiagnostics[].excluded` — массив, `excludedN = excluded.length` | pass |

## 6. Результаты проверок

| Команда | Результат |
|---|---|
| `bun test tests/server/forecast-evaluation.test.ts` | **87 pass / 0 fail** |
| `bun test` | **757 pass / 4 skip / 0 fail** |
| `bunx tsc --noEmit` | 0 ошибок |
| PII gate (2 файла) | PASS |

## 7. Изменённые файлы

1. `src/server/forecast-evaluation.ts` — счётчики C-14, `overflowNotes`, структурированный `metricDiagnostics`, `sampleStatus`.
2. `tests/server/forecast-evaluation.test.ts` — обновлены T2/T13/T41-16-17, добавлены 8 тестов C-14…C-17 (79 → 87).
3. `docs/ui/ui-4-1-implementation-report.md` — настоящий раздел.

## 8. Защита данных

SQLite `identical: true`; canonical CSV `8f2b1818…`; `forecasts.jsonl` `e35fe27b…`; `reconciliations.jsonl` `32ccd256…`; `manifest.json` `9d986747…`; `errors.jsonl` не создан; `src/forecasting/**`, API/routes/read-models, frontend, `package.json`, `bun.lock` не изменялись; прогнозные операции не запускались; Git index не изменялся (staged 0, HEAD `099f37b`).

## 9. Остаточные ограничения

**NOT_IMPLEMENTED:** подключение ядра к read-model/API (UI-4.2); статистика/p10-p90/сценарии/финансовый эффект; SQLite read-only API; экраны.
**NOT_VERIFIED:** поведение на реальных 3 508 снапшотах и 3 502 reconciliation (только синтетические тесты); бизнес-семантика метрики (`PROVISIONAL`); браузерная адаптивность (UI-7).
**Математическое ограничение (FACT):** изолированное переполнение `errorSum` без переполнения `absSum` недостижимо при `|Σe| ≤ Σ|e|`; сценарий документирован, отдельная ветка кода не требуется.
---

# UI-4.1.2.2 — диагностика переполнения WAPE

**Дата:** 2026-11-24 · **Режим:** ограниченная корректировка · **Данные и прогнозный контур не изменялись**

## 1. Причина дефекта (C-18)

В `computeMetrics()` финальное вычисление WAPE выполнялось одним выражением:

```ts
const wapeRaw = … ? (absSum / actualAbsSum) * 100 : null;
```

Переполнение деления или умножения приводило к `wape = null` и `wapeStatus = OVERFLOW`, однако **причина не сохранялась**: `overflowNotes` заполнялся только при переполнении накоплений. В результате диагностика финального этапа терялась, а T5 проверял лишь `null` и статус.

## 2. Исправление

- Вычисление WAPE разделено на этапы с отдельными проверками конечности:

| Этап | Проверка | Причина в `overflowNotes` |
|---|---|---|
| `absSum` | накопление | `накопление: abs=… error=… actual=…` |
| `actualAbsSum` | накопление | то же сообщение |
| деление `absSum / actualAbsSum` | `Number.isFinite(ratio)` | `WAPE: деление absSum / actualAbsSum не конечно` |
| умножение `ratio * 100` | `Number.isFinite(scaled)` | `WAPE: умножение отношения на 100 не конечно` |

Правила:

- при переполнении на финальном этапе — `wape = null`, `wapeStatus = OVERFLOW`, конкретная причина в `overflowNotes`;
- MAE и Bias сохраняют собственные значения и статусы (`OK`), если рассчитаны корректно;
- `overflowAffectedN` **не** переопределяется: он по-прежнему относится только к переполнению накоплений (для финального переполнения остаётся `0`);
- нулевой знаменатель остаётся `NOT_AVAILABLE` и не маскируется под `OVERFLOW`;
- агрегированные заметки не попадают в `excluded`: наблюдение не исключается из расчёта, недостоверной становится только метрика.

## 3. Тестовые случаи

| Тест | Вход | Ожидание | Результат |
|---|---|---|---|
| T5 (усилен) | `forecast = MAX_VALUE`, `actual = 1` | `wape = null` / `OVERFLOW`; `overflowNotes` содержит «WAPE» и «умножение»; `mae`/`bias` = `MAX_VALUE − 1` со статусом `OK`; `n = 1`, `excludedN = 0`, `excluded = []`, `overflowAffectedN = 0` | pass |
| C-18 деление | `forecast = MAX_VALUE`, `actual = MIN_VALUE` | отношение бесконечно → `wape = null` / `OVERFLOW`; причина содержит «деление»; MAE/Bias `OK`; накопления не переполнены (`overflowAffectedN = 0`) | pass |
| C-18 умножение | `forecast = MAX_VALUE`, `actual = 10` | отношение конечно (`≈1.8 × 10³⁰⁷`), произведение на 100 бесконечно → причина содержит «умножение» | pass |
| C-18 нулевой знаменатель | `forecast = 5`, `actual = 0` | `wape = null` / `NOT_AVAILABLE`; заметок о WAPE нет; `mae = 5` / `OK` | pass |
| C-18 различимость | накопление vs финальный этап | у накопления — заметка «накопление» и `overflowAffectedN = n`; у финального этапа — заметка «WAPE» и `overflowAffectedN = 0` | pass |
| C-18 сохранение в сводке | пара baseline/candidate с `forecast = MAX_VALUE`, `actual = 10` | `metricDiagnostics[].overflowNotes` содержит «WAPE», `excluded` пуст | pass |

Оба случая финального переполнения **достижимы** на конечных входных значениях, поэтому искусственная ветка кода не создавалась.

## 4. Результаты проверок

| Команда | Результат |
|---|---|
| `bun test tests/server/forecast-evaluation.test.ts` | **92 pass / 0 fail / 0 skip** (87 прежних + 5 новых/усиленных) |
| `bun test` | **762 pass / 4 skip / 0 fail** |
| `bunx tsc --noEmit` | 0 ошибок |
| PII gate (3 файла) | GATE PASS |

## 5. Изменённые файлы

1. `src/server/forecast-evaluation.ts` — поэтапный расчёт WAPE, отдельные причины в `overflowNotes`, уточнение `wapeStatus`.
2. `tests/server/forecast-evaluation.test.ts` — усилен T5, добавлены 5 тестов C-18.
3. `docs/ui/ui-4-1-implementation-report.md` — настоящий раздел.

## 6. Защита данных

SQLite `identical: true`; canonical CSV `8f2b1818…`; `forecasts.jsonl` `e35fe27b…`; `reconciliations.jsonl` `32ccd256…`; `manifest.json` `9d986747…`; `errors.jsonl` не создан; `src/forecasting/**`, API/routes/read-models, frontend, `package.json`, `bun.lock` не изменялись; прогнозные операции не запускались; Git index не изменялся (staged 0, HEAD `099f37b`).

## 7. Остаточные ограничения

**NOT_IMPLEMENTED:** подключение ядра к read-model/API (UI-4.2); статистика/p10-p90/сценарии/финансовый эффект; SQLite read-only API; экраны.
**NOT_VERIFIED:** поведение на реальных 3 508 снапшотах и 3 502 reconciliation (только синтетические тесты); бизнес-семантика метрики (`PROVISIONAL`); браузерная адаптивность (UI-7).
**Регрессии C-14–C-17:** сохранены без изменений — счётчики, `overflowAffectedN`, `sampleStatus`, `pairedComparison` и структура диагностики не пересматривались.