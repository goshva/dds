# UI-4 — контракт прогнозной аналитики

**Версия контракта:** `forecast-eval/v1` (предложение) · **Дата:** 2026-11-24 · **База:** HEAD `099f37b2588c2c1cb821faabf81d507f14f14818` (`pre u4`), рабочее дерево чистое
**Статус:** проект контракта для UI-4.1+. Реализация не начата.

Метки: **FACT** (подтверждено кодом), **INFERENCE**, **ASSUMPTION**, **NOT_IMPLEMENTED**, **NOT_VERIFIED**, **RECOMMENDATION**.

---

## 1. Назначение и область

Контракт фиксирует: что считается прогнозом, как определяется его идентичность и зрелость, какие записи допускаются в оценку качества, как формируется парная выборка baseline↔candidate, как считаются метрики и как разделяются режимы `replay`/`shadow` и модели `rolling_7_day_mean`/`adaptive_baseline` (Variant B). Документ обязателен для реализации UI-4.1 (read-model) и UI-4.2+ (API, экраны) без переопределения формул и правил выборки.

Вне области: запуск shadow/replay/reconcile/monitor, изменение прогнозного ядра, сценарные расчёты, финансовая оценка, SQLite.

## 2. Терминология предметной области

| Термин | Значение | Источник |
|---|---|---|
| Snapshot | неизменяемая запись прогноза | **FACT** `ShadowSnapshot`, `src/forecasting/shadow/store.ts` |
| Reconciliation | запись сопоставления прогноза с фактом | **FACT** `ReconciliationRecord` |
| Mode | `replay` \| `shadow` | **FACT** `ShadowMode` |
| ModelId | `rolling_7_day_mean` (production baseline) \| `adaptive_baseline` (candidate, Variant B) | **FACT** `ModelId`, `MODEL_VERSIONS` |
| Horizon | `1` \| `3` (теневой режим) | **FACT** `SHADOW_HORIZONS = [1, 3]` |
| Origin / Target | дата доступной истории / дата прогноза | **FACT** |
| Maturity | зрелость: `target_date ≤ последняя подтверждённая дата факта` | **FACT** `pipeline.ts:lastConfirmedDate` |
| Fact | фактическое значение canonical CSV | **FACT** |
| Provenance | происхождение и версия данных | **FACT** `read-models.overviewModel.provenance` |

## 3. Контракты источников данных

| Источник | Контракт | Ограничения |
|---|---|---|
| canonical CSV `data/processed/forecasting/7745/canonical_daily_delivered_orders.csv` | 8 колонок фиксированного порядка, `shop_no=7745`, `metric=qty_orders_delivered`, `source_slice_id=20624`, календарные даты, целые неотрицательные значения | **FACT** `src/server/sources.ts:readHistory`; семантика `PROVISIONAL` |
| `data/shadow/7745/forecasts.jsonl` | `ShadowSnapshot[]`, fail-closed чтение | **FACT** `readSnapshots()` |
| `data/shadow/7745/reconciliations.jsonl` | `ReconciliationRecord[]` | **FACT** `readReconciliations()` |
| `data/shadow/7745/errors.jsonl` | `ShadowError[]` (может отсутствовать) | **FACT** `readShadowErrors()` |
| `data/shadow/7745/manifest.json` | `ShadowManifest`, строгая валидация, статусы `OK`/`NOT_AVAILABLE`/`CORRUPTED` | **FACT** `readManifest()` |

## 4. Идентичность снапшота

**FACT** (`store.ts:snapshotId`):

```text
snapshot_id = SHA256(model_id | model_version | horizon | origin_date | target_date | input_data_version)
input_data_version = SHA256(канонизированная история date=value до origin)
```

- В идентичность входят: модель, версия, горизонт, origin, target, версия входных данных.
- **Не входят:** `mode`, `dataset_checksum`, `generated_at`, `run_id`, `status`, `forecast_value`.
- **FACT:** `mode` не входит в `snapshot_id` → теоретически возможно совпадение ID для `replay` и `shadow` при прочих равных полях; `appendSnapshot` в этом случае вернёт **CONFLICT** (fail-closed, `ShadowConflictError`), если содержимое отличается.
- **RECOMMENDATION (UI-4.1+):** не менять формулу ID (данные уже записаны), но в оценке обязательно добавлять `mode` в ключ выборки и отдельно диагностировать CONFLICT-записи.

**Гарантии:** `appendSnapshot` — append-only; повтор с идентичным содержимым → no-op; расхождение → CONFLICT и запись в `errors.jsonl` (**FACT** `store.ts:appendSnapshot`).

## 5. Идентичность reconciliation

**FACT** (`ReconciliationRecord`): `snapshot_id`, `run_id`, `model_id`, `horizon`, `target_date`, `forecast_value`, `actual`, `absolute_error`, `signed_error`, `reconciled_at`.

- **Отсутствуют** (восстанавливаются только через snapshot): `mode`, `origin_date`, `model_version`, `variant`, `input_data_version`, `dataset_checksum`.
- Связь прогноз↔факт: **только** `snapshot_id`; факт берётся из canonical CSV по `target_date` (**FACT** `pipeline.ts:reconcile`).
- Защита от повторов: `existing` set по `snapshot_id` (**FACT**).
- Отсутствующий snapshot → запись не классифицируется как shadow (**FACT** `reconciliationsModel.unknownSnapshots`).
- **INFERENCE:** при отсутствии/дублировании snapshot корректная атрибуция mode/model_version невозможна → запись исключается из оценки и попадает в диагностику.

## 6. Зрелость прогноза

| Статус | Условие | Источник |
|---|---|---|
| `PENDING` | `target_date > последняя подтверждённая дата факта` | **FACT** `reconcile()` |
| `RECONCILED` | есть запись reconciliation с известным snapshot | **FACT** |
| `MISSING_ACTUAL` | `target_date ≤ lastDate`, но факта нет | **FACT** `ShadowError{MISSING_ACTUAL}` |
| `FALLBACK` | `snapshot.status = FALLBACK` (поправка не применена) | **FACT** `SnapshotStatus` |
| `INVALID` | `snapshot.status = INVALID` | **FACT** |
| `CONFLICT` | `SNAPSHOT_CONFLICT` в `errors.jsonl` | **FACT** |
| `UNKNOWN` | mode/model/запись не распознаны | **NOT_IMPLEMENTED** (в текущем API нет отдельного статуса) |

**Разделение полей (обязательно для UI-4):** `computeStatus` (OK/FALLBACK/INVALID) · `factStatus` (PENDING/RECONCILED/MISSING_ACTUAL) · `sourceStatus` (freshness/manifestStatus) · `evaluationEligibility` (eligible/excluded + reason). Смешивать их в одно поле запрещено.

## 7. Допуск записи в оценку

| # | Условие | В основную оценку | Отдельно | Причина |
|---|---|---|---|---|
| 1 | `status=OK`, есть reconciliation, `forecast_value ≠ null` | **да** | — | базовая допустимая запись |
| 2 | `status=FALLBACK` | нет | да (fallback-диагностика) | прогноз не применён |
| 3 | `status=INVALID` | нет | да (invalid-диагностика) | некорректный вход |
| 4 | `forecast_value = null` | нет | да | ошибка не определена |
| 5 | reconciliation отсутствует, target зрелый | нет | да (MISSING_ACTUAL/ожидание) | нет пары прогноз↔факт |
| 6 | reconciliation без snapshot | нет | да (`unknownSnapshots`) | атрибуция режима невозможна |
| 7 | повреждённый JSONL | **fail-closed** (запрос отклоняется) | — | целостность хранилища |
| 8 | неизвестная модель/режим | нет | да (UNKNOWN) | не классифицируется автоматически |
| 9 | дубль `snapshot_id` | нет | да (CONFLICT) | неоднозначность |
| 10 | `forecast_value` в snapshot ≠ в reconciliation | нет | да (CONFLICT) | расхождение источника |
| 11 | разные `actual` для одной пары | нет | да (CONFLICT) | неоднозначный факт |
| 12 | `mode=replay` | да, **в отдельную replay-выборку** | — | смешение с shadow запрещено |

Записи не удаляются: они остаются доступными для диагностики (**RECOMMENDATION**: отдельный endpoint/секция «исключённые»).

## 8. Режимы replay и shadow

- **FACT:** разделение реализовано в `shadowForecastsModel` (`totals` по режиму + `modeTotals`), `overviewModel` (`shadow`/`replay` раздельно) и `reconciliationsModel` (фильтр `mode`, `unknownSnapshots`).
- **FACT (критично):** `monitor()` фильтрует записи **только** по `model_id` и `horizon` — без `mode` → агрегаты смешивают replay и shadow.
- **Правило UI-4:** любая метрика обязана иметь явный `mode`; агрегаты без `mode` в UI-4 не используются как итоговые.

## 9. Производственный baseline и candidate

- Baseline: `rolling_7_day_mean`, версия `rolling-7-day-mean/v1` (**FACT** `MODEL_VERSIONS`).
- Candidate: `adaptive_baseline`, версия `adaptive-baseline/v1+variantB`, `variant = "B"` (**FACT**).
- Candidate **не** является production-моделью; автоматическая замена baseline запрещена.
- Разные `model_version` не объединяются в один показатель без отдельного правила (**RECOMMENDATION**: агрегировать только по конкретной версии).

## 10. Парная оценка

**Ключ пары (предложение):**

```text
pair_key = (mode, horizon, origin_date, target_date, input_data_version)
```

**Требуется дополнительно проверить:** `dataset_checksum` (одинаковый источник факта), `actual` (одно и то же фактическое значение), `model_version` (не смешивать версии).

**Условия допуска пары:**

1. оба прогноза существуют и имеют одинаковые `mode`, `horizon`, `origin_date`, `target_date`, `input_data_version`;
2. оба имеют `status = OK` и `forecast_value ≠ null`;
3. оба имеют reconciliation с одинаковым `actual`;
4. отсутствуют дубли/конфликты по `snapshot_id`;
5. `dataset_checksum` совпадает (иначе пара исключается как несопоставимая).

**FACT:** текущие данные допускают формирование парной выборки: 3 508 снапшотов (3 500 replay + 8 shadow), 3 502 reconciliation, конфликтов нет (`errors.jsonl` отсутствует). Для каждой пары (origin,target,horizon) существуют обе модели (проверено тестом UI-2 «одинаковые входные данные»).

**Счётчики (обязательны в DTO):** `baselineN`, `candidateN`, `pairedN`, `excludedBaselineN`, `excludedCandidateN`, `unmatchedN`, `conflictN`.

**INFERENCE:** метрики отдельной модели допустимы на независимой выборке (с явным `n`); сравнение моделей — **только** на парной выборке.

## 11. Метрики и формулы

| Метрика | Формула | Единицы | Выборка | Условия доступности |
|---|---|---|---|---|
| MAE | `mean(abs(forecast − actual))` | заказы | парная (для сравнения) / модельная (для отчёта) | ≥ 1 наблюдение, все `forecast` конечны |
| WAPE | `sum(abs(forecast − actual)) / sum(abs(actual)) × 100` | % | то же | знаменатель > 0 |
| Bias | `mean(forecast − actual)` | заказы | то же | ≥ 1 наблюдение |
| Underforecast | `count(forecast < actual)` | шт. | то же | — |
| Overforecast | `count(forecast > actual)` | шт. | то же | — |
| Exact | `count(forecast = actual)` | шт. | то же | — |

**UI-формат:** MAE/Bias — 2 знака; WAPE — 2 знака с `%`; счётчики — целые. Все метрики сопровождаются `n`, `mode`, `horizon`, `model_id`, `model_version`, периодом и `generatedAt`.

## 12. Политика null и нуля

1. **NULL ≠ 0** (для фактов и прогнозов).
2. Пустая выборка → `null` + статус `NOT_AVAILABLE` (не 0).
3. `sum(abs(actual)) = 0` → WAPE = `null`, статус `NOT_AVAILABLE`.
4. **FACT (критично):** текущий `monitor()` возвращает `wape: 0` при нулевом знаменателе (`pipeline.ts`) — нарушение контракта; в UI-4 использовать собственную реализацию метрик, `monitor()` — только как диагностический источник.
5. `forecast_value = null` не участвует в MAE/Bias/WAPE и в счётчиках under/over (**FACT:** текущий `monitor()` приводит `null` через `as number` — риск искажения счётчиков).
6. Отсутствующий факт не создаётся искусственно.

## 13. Происхождение данных

- `fileChecksum` (байты CSV) ≠ `normalizedChecksum` (нормализованные точки) — **FACT** `readHistory()`.
- `freshness ∈ {MATCH, STALE, NOT_CONFIRMED}`; `manifestStatus ∈ {OK, NOT_AVAILABLE, CORRUPTED}` — **FACT** `overviewModel.provenance`.
- Совпадение checksum **не** подтверждает бизнес-семантику: `PROVISIONAL` сохраняется.
- В UI-4 provenance обязателен для каждой метрики (источник, версия, дата формирования, checksum).

## 14. Предложение DTO API

| Endpoint | Назначение | Query | DTO (ключевое) |
|---|---|---|---|
| `GET /api/v1/forecasts` | прогнозы и зрелость | `mode` (обяз., `shadow`/`replay`), `horizon` (1/3), `model` (`rolling_7_day_mean`/`adaptive_baseline`), `limit` (≤1000), `from`/`to` (по `target_date`) | `items[{snapshotId, mode, modelId, modelVersion, variant, horizon, originDate, targetDate, forecastValue, computeStatus, factStatus, eligibility, reason}]`, `totals`, `provenance` |
| `GET /api/v1/forecasts/quality` | метрики качества | `mode` (обяз.), `horizon`, `paired` (bool) | `metrics[{modelId, modelVersion, mode, horizon, n, mae, wape, bias, under, over, exact, wapeStatus}]`, `paired{pairedN, excludedBaselineN, excludedCandidateN, unmatchedN, conflictN}`, `provenance` |
| `GET /api/v1/forecasts/errors` | диагностика исключений | `mode`, `limit`, `code` | `items[{snapshotId?, code, reason, mode, modelId, horizon, originDate, targetDate}]`, `counts` |

Envelope: `ok` / `not_available` / `error`; `error.eventId` обязателен. Пагинация — `limit` + `before` (по `target_date`). Повреждённый источник → `503 DATA_SOURCE_CORRUPTED`; пустой источник → `not_available`. Только GET.

## 15. Обработка ошибок

| Ситуация | Ответ |
|---|---|
| повреждённый JSONL | `error DATA_SOURCE_CORRUPTED`, 503 |
| отсутствующий manifest | `manifestStatus = NOT_AVAILABLE` (не ошибка), freshness `NOT_CONFIRMED` |
| повреждённый manifest | `manifestStatus = CORRUPTED`, freshness `NOT_CONFIRMED` |
| неизвестный `mode`/`horizon`/`model` в query | `400 INVALID_QUERY` |
| пустая выборка | `not_available` с `reason` |
| CONFLICT записи | не ошибка API; отражается в `conflictN` и в `/forecasts/errors` |

## 16. Матрица тестов

| # | Сценарий | Ожидание |
|---|---|---|
| 1 | только baseline | candidate `NOT_AVAILABLE` |
| 2 | только candidate | baseline `NOT_AVAILABLE` |
| 3 | replay + shadow | раздельные выборки, ни одна метрика не смешивает режимы |
| 4–7 | разные target/origin/horizon/input_data_version | пара не образуется (`unmatchedN`) |
| 8 | разные model_version | не объединять без правила |
| 9 | оба зрелые | пара допускается, `pairedN` > 0 |
| 10 | один pending | не входит в парную оценку |
| 11–12 | FALLBACK / INVALID | исключены из основной оценки, видны в диагностике |
| 13 | `forecast_value = null` | ошибка не считается |
| 14 | нет reconciliation | факт не создаётся |
| 15 | reconciliation без snapshot | `unknownSnapshots`, не shadow |
| 16–17 | дубли snapshot/reconciliation | обнаружены, `conflictN` |
| 18 | разные `actual` в паре | `CONFLICT` |
| 19 | WAPE denominator = 0 | `null` / `NOT_AVAILABLE` |
| 20 | пустая выборка | `NOT_AVAILABLE` |
| 21–22 | повреждённый JSONL / manifest | fail-closed / отдельный статус |
| 23 | stale source | предупреждение provenance |
| 24–25 | неизвестная модель / режим | `UNKNOWN`, не включать автоматически |

Дополнительно: unit-тесты чистых функций метрик; тесты подготовки выборки; API-контрактные тесты; frontend-рендеринг (null, empty, error, stale); XSS; PII; регрессия UI-2/UI-3.

## 17. Правила отображения в интерфейсе

1. Каждая метрика подписана: `mode`, `model`, `horizon`, `n`, период, `generatedAt`, provenance.
2. Replay визуально отделён и помечен «историческая диагностика, не доказательство работы теневого режима».
3. `null`/`NOT_AVAILABLE` отображаются как `[Н/Д]`, не как 0.
4. Baseline и candidate показаны раздельно; победитель не объявляется без заранее определённого критерия.
5. Исторические проценты Stage 3.4.x не переносятся в live-метрики.
6. Финансовые выводы отсутствуют.
7. Семантика факта — `PROVISIONAL` на всех экранах.

## 18. Известные ограничения

- `monitor()` смешивает режимы и возвращает `0` при нулевом знаменателе — **FACT**.
- `ReconciliationRecord` не хранит `mode`/`model_version`/`origin_date`/`input_data_version`/`dataset_checksum` — восстановление только через snapshot — **FACT**.
- `mode` не входит в `snapshot_id` — **FACT** (риск CONFLICT при пересечении режимов).
- Нет статуса `UNKNOWN` в API — **NOT_IMPLEMENTED**.
- Нет парной выборки и счётчиков `pairedN`/`excluded*` — **NOT_IMPLEMENTED**.
- Список аномалий (305 outlier flags) не связан с датами — **NOT_IMPLEMENTED**.
- SQLite read-only API — **NOT_IMPLEMENTED**.
- p10/p90, сценарии, финансовый эффект — **NOT_IMPLEMENTED**.
- Браузерная адаптивность — **NOT_VERIFIED** (UI-7).

## 19. Требования к будущей реализации

1. `src/server/forecast-evaluation.ts` — чистые функции: `eligibleRecords()`, `buildPairs()`, `computeMetrics()`, `wapeOrNull()`; без файлового IO — **RECOMMENDATION**.
2. Расширить read-model: `forecastsQualityModel({mode, horizon, paired})`, `forecastErrorsModel({mode, code, limit})` — **RECOMMENDATION**.
3. Ввести раздельные поля статусов (`computeStatus`, `factStatus`, `sourceStatus`, `eligibility`) — **RECOMMENDATION**.
4. Новые endpoints (раздел 14) + тесты + обновление `api-contract.md`.
5. Не изменять `snapshot_id`, JSONL-формат, baseline, Variant B, семантику `PROVISIONAL`.
6. Любое изменение существующих агрегатов `monitor()` — отдельная задача с обоснованием (сейчас не трогать).

## 20. Версия контракта и правила изменений

- Версия `forecast-eval/v1`; изменения — только через новую версию с описанием причины и влияния на ранее рассчитанные метрики.
- Запрещено менять формулы, правила eligibility и парности «на месте» без версии.
- Любое расхождение кода и контракта фиксируется в аудите, код не правится молча.
- При появлении фактических данных с пропусками правила не смягчаются: отсутствующие значения остаются отсутствующими.
---

## 21. Уточнения UI-4.0.1 (C-2…C-5)

Версия контракта остаётся `forecast-eval/v1`: базовые формулы, правила eligibility и разделение режимов не изменялись. Уточнены терминология, идентичность пары, классификация конфликтов и неизвестных записей.

### 21.1. Идентичность пары и совместимость версий (C-2)

**FACT** (`src/forecasting/shadow/store.ts:MODEL_VERSIONS`, `snapshotId`):

| Сущность | Определение |
|---|---|
| `snapshot_identity` | `SHA256(model_id \| model_version \| horizon \| origin_date \| target_date \| input_data_version)` |
| `baseline_identity` | `model_id = rolling_7_day_mean` **и** `model_version = rolling-7-day-mean/v1` **и** `variant = null` |
| `candidate_identity` | `model_id = adaptive_baseline` **и** `model_version = adaptive-baseline/v1+variantB` **и** `variant = "B"` |
| `pair_identity` | `(mode, horizon, origin_date, target_date, input_data_version)` |

**Почему `model_version` не входит в `pair_identity`** (INFERENCE): baseline и candidate всегда имеют разные версии; включение версии в общий ключ сделало бы пару невыполнимой по построению. Версия проверяется **отдельно для каждого участника**.

**Две независимые идентичности участников (CONTRACT REQUIREMENT).** `snapshot_identity` **не** является общим ключом пары: у baseline и candidate в него входят разные `model_id` и `model_version`. Поиск выполняется независимо:

1. найти baseline-запись по `snapshot_identity(model_id=rolling_7_day_mean, model_version=rolling-7-day-mean/v1, variant=null, horizon, origin, target, input_data_version)`;
2. найти candidate-запись по `snapshot_identity(model_id=adaptive_baseline, model_version=adaptive-baseline/v1+variantB, variant="B", horizon, origin, target, input_data_version)`;
3. проверить, что обе записи принадлежат одному `pair_identity`;
4. проверить уникальность **каждого** участника (ровно одна запись на идентичность);
5. только после этого формировать пару.

**Семантика `dataset_checksum` (FACT + CONTRACT REQUIREMENT).**

| Поле | Что характеризует | FACT |
|---|---|---|
| `input_data_version` | история, доступная модели **до `origin_date`**; формат `sha256(date=value…)` | **FACT** `store.ts:inputDataVersion` |
| `dataset_checksum` | **нормализованный** canonical-набор (`date\tvalue`) **на момент запуска**, а не байты файла | **FACT** `cli/shadow.ts:53` (`sha256(rows.map(date\\tvalue))`), `runner.ts:101` |
| `manifest.dataset_checksum` | тот же нормализованный набор последнего запуска | **FACT** (совпадает с текущим: `8f2b1818…`) |

**FACT (данные):** в `forecasts.jsonl` присутствуют **2 различных** `dataset_checksum` (`d413286e…` — 905 дней, `8f2b1818…` — 906 дней) при 877 уникальных `input_data_version`. Это подтверждает: `dataset_checksum` может включать данные, появившиеся **позже** `origin_date`, и не является доказательством идентичности входных данных прогноза.

**Правило сравнения (CONTRACT REQUIREMENT):**

| Ситуация | Решение |
|---|---|
| `input_data_version` различаются | пара **не формируется** → `unmatchedN` |
| `input_data_version` совпадают, `actual` совпадают, `dataset_checksum` различаются | пара **допускается**, помечается `DATASET_VERSION_DIFFERS` (предупреждение provenance, **не** исключение) |
| `actual` различаются | `CONFLICT_ACTUAL` → исключить |
| `dataset_checksum` отсутствует/не строка | `UNKNOWN_DATASET_VERSION` → исключить из парной оценки, показать в диагностике |

**INFERENCE:** разные `dataset_checksum` сами по себе **не** доказывают разные входные данные прогноза; решающим является `input_data_version` (и совпадение `actual`).

**Порядок проверок пары (обязателен для реализации):**

| # | Проверка | Не выполнено → |
|---:|---|---|
| 1 | оба snapshot найдены по `snapshot_identity` | `unmatchedN` |
| 2 | `mode` совпадает и ∈ {`replay`,`shadow`} | `UNKNOWN_MODE` → исключить |
| 3 | `horizon` совпадает и ∈ {1,3} | `unmatchedN` |
| 4 | `origin_date`, `target_date` совпадают | `unmatchedN` |
| 5 | `input_data_version` совпадает | `unmatchedN` |
| 6 | `dataset_checksum` — по правилу выше | различие → `DATASET_VERSION_DIFFERS` (допускается); отсутствие → исключить |
| 7 | baseline проходит `baseline_identity` | `EXCLUDED_MODEL_VERSION` |
| 8 | candidate проходит `candidate_identity` | `EXCLUDED_MODEL_VERSION` |
| 9 | `status = OK` у обоих, `forecast_value ≠ null` | `EXCLUDED_STATUS` / `EXCLUDED_NULL_FORECAST` |
| 10 | reconciliation есть у обоих, `actual` совпадает | `MISSING_ACTUAL` / `CONFLICT_ACTUAL` |
| 11 | нет дублей `snapshot_id` и дублей reconciliation | `CONFLICT_DUPLICATE` |
| 12 | техническая зрелость достигнута (21.2) | `PENDING` |

**Поведение при новой версии модели (RECOMMENDATION):** записи с `model_version`, отличной от ожидаемой, не смешиваются с текущими; они попадают в `EXCLUDED_MODEL_VERSION` и показываются отдельно. Автоматическое объединение версий запрещено.

**NOT_IMPLEMENTED:** в коде нет ни `pair_identity`, ни проверок 1–12; `isSnapshotRecord` не проверяет `mode`, `model_version`, `variant`, `status` (**FACT** `store.ts:isSnapshotRecord`).

### 21.2. Техническая доступность факта и бизнес-семантика (C-3)

| Понятие | Определение | Текущее состояние |
|---|---|---|
| **Technical fact availability / technical maturity** | дата присутствует в валидированном canonical CSV; значение прошло проверку схемы, даты и числового домена; источник доступен; значение можно использовать для технического сопоставления | **FACT:** выполняется (`readHistory`, `sources.ts`) |
| **Business semantic confirmation** | правила формирования метрики утверждены владельцем данных; известны перерасчёты, возвраты, корректировки, семантика даты | **NOT_VERIFIED** — не подтверждено |

**Терминология:** в коде функция называется `lastConfirmedDate` (`pipeline.ts`) — имя сохраняется без изменений. Термин контракта — `technicalFactCutoff`: последняя дата массива валидированной истории, техническая граница доступности факта.

**Правила:**

1. `PROVISIONAL` не меняется; техническая зрелость **не** повышает статус источника.
2. `technicalFactCutoff` не подтверждает бизнес-семантику и не делает показатель бизнес-фактом.
3. Техническая зрелость допускает вычисление ошибки, но не подтверждает достоверность бизнес-интерпретации.
4. Каждая метрика качества обязана нести отметку `PROVISIONAL` (ASSUMPTION: владелец процесса подтвердит семантику отдельно).
5. Reconciliation и pipeline не изменяются.

### 21.3. PersistedErrors, DetectedConflicts, UnknownRecords (C-4, C-5)

| Категория | Определение | Источник |
|---|---|---|
| `PersistedErrors` | записи, фактически сохранённые в `errors.jsonl` | **FACT:** только `MISSING_ACTUAL` (`pipeline.ts`) и `SNAPSHOT_CONFLICT` (`store.ts:appendSnapshot`) |
| `DetectedConflicts` | конфликты, обнаруженные при анализе текущих источников | **NOT_IMPLEMENTED** — проверок нет |
| `UnknownRecords` | записи, которые невозможно однозначно классифицировать | **NOT_IMPLEMENTED** |

**FACT:** отсутствие `errors.jsonl` означает лишь отсутствие сохранённых записей. Оно **не** доказывает отсутствие дублей, несовпадающих `forecast_value`/`actual`/`dataset_checksum` и неоднозначных связей. Поэтому `conflictN` нельзя выводить из наличия/отсутствия файла.

**Обязательные независимые проверки при построении выборки (RECOMMENDATION):**

| Проверка | Обнаружимо текущими валидаторами? | Требуется |
|---|---|---|
| дубли `snapshot_id` в `forecasts.jsonl` | нет | логика read-model |
| дубли reconciliation по `snapshot_id` | нет | логика read-model |
| reconciliation без snapshot | частично (`unknownSnapshots` в `reconciliationsModel`) | расширение DTO |
| snapshot без reconciliation | нет | логика read-model |
| `forecast_value` в snapshot ≠ в reconciliation | нет | логика read-model |
| разные `actual` для одной пары | нет | логика read-model |
| разные `dataset_checksum` у пары | нет | логика read-model |
| неизвестный `mode` | нет (`isSnapshotRecord` не проверяет `mode`) | расширение классификации |
| неизвестный `model_id`/версия | нет | классификация |
| неизвестный `status` | нет | классификация |

**Классификация `UNKNOWN`:**

| Вид | Условие | Обнаружение сейчас | Поведение |
|---|---|---|---|
| `UNKNOWN_MODE` | `mode` ∉ {`replay`,`shadow`} | не обнаруживается | исключить из оценки, показать в диагностике |
| `UNKNOWN_MODEL` | `model_id` неизвестен или версия не поддерживается | не обнаруживается | исключить, `EXCLUDED_MODEL_VERSION` |
| `UNKNOWN_SNAPSHOT` | reconciliation ссылается на отсутствующий snapshot | **FACT:** `unknownSnapshots` (UI-2.2.1) | исключить, не считать shadow |
| `UNKNOWN_RECONCILIATION` | snapshot есть, связь неоднозначна (дубли) | не обнаруживается | исключить, `CONFLICT_DUPLICATE` |
| `UNKNOWN_STATUS` | неизвестное значение статуса | не обнаруживается | исключить, не преобразовывать в `OK` |

**Правила:** неизвестные записи не попадают в основную оценку; значения не подставляются по умолчанию; mode/model не угадываются; неизвестная, но структурно корректная запись **не** трактуется как повреждение файла; повреждённый JSONL по-прежнему fail-closed (`DATA_SOURCE_CORRUPTED`).

**Обработка дублей (CONTRACT REQUIREMENT).** Дубль — две и более записи одного типа с одинаковым `snapshot_id` (snapshot или reconciliation).

| Действие | Разрешено? |
|---|---|
| выбрать первую запись | **запрещено** |
| выбрать последнюю запись | **запрещено** |
| перезаписать/исправить запись | **запрещено** |
| усреднить или объединить значения | **запрещено** |
| сформировать пару с участием дублирующейся идентичности | **запрещено** |
| сохранить все конфликтующие `snapshot_id` и записи для диагностики | **обязательно** |

При обнаружении дубля: идентичность помечается `CONFLICT_DUPLICATE`, все вхождения исключаются из основной и парной оценки, в диагностику попадают `snapshot_id` и количество вхождений (без выбора «победителя»). Причина не выводится из `errors.jsonl`.

### 21.4. Причины исключения (eligibility reasons)

`ELIGIBLE` · `PENDING` · `EXCLUDED_STATUS` (FALLBACK/INVALID) · `EXCLUDED_NULL_FORECAST` · `MISSING_ACTUAL` · `UNKNOWN_SNAPSHOT` · `EXCLUDED_MODEL_VERSION` · `UNKNOWN_MODE` · `UNKNOWN_STATUS` · `CONFLICT_DUPLICATE` · `CONFLICT_ACTUAL` · `CONFLICT_FORECAST_VALUE` · `UNKNOWN_DATASET_VERSION` · `SOURCE_CORRUPTED`; предупреждение (не исключение) — `DATASET_VERSION_DIFFERS`.

Четыре статуса не смешиваются: `computeStatus` (OK/FALLBACK/INVALID/UNKNOWN) · `factStatus` (PENDING/RECONCILED/MISSING_ACTUAL) · `sourceStatus` (freshness/manifestStatus) · `evaluationEligibility` (ELIGIBLE/EXCLUDED + reason).

### 21.5. Подтверждённые правила (без изменений)

Различаются три категории: **FACT** — подтверждено существующим кодом; **CONTRACT REQUIREMENT** — обязательное требование спецификации (в коде может отсутствовать); **RECOMMENDATION** — предлагаемое решение.

| Правило | Категория | Основание |
|---|---|---|
| Метрики обязаны иметь явный `mode`; replay и shadow не смешиваются | **CONTRACT REQUIREMENT** | в коде разделение есть в `shadowForecastsModel`/`reconciliationsModel`/`overviewModel` (**FACT**), но `monitor()` смешивает (**FACT**) |
| MAE/Bias/WAPE/under/over/exact — формулы §11 | **CONTRACT REQUIREMENT** | формулы спецификации; реализация оценки отсутствует (**NOT_IMPLEMENTED**) |
| Пустая выборка → `null` + `NOT_AVAILABLE` | **CONTRACT REQUIREMENT** | **NOT_IMPLEMENTED** |
| WAPE при нулевом знаменателе → `null` + `NOT_AVAILABLE` | **CONTRACT REQUIREMENT** | в `monitor()` возвращается `0` (**FACT**, F-2) — расхождение |
| `NULL ≠ 0`; `forecast_value = null` не участвует в ошибке | **CONTRACT REQUIREMENT** | частично подтверждено: `reconcile` пропускает `null` (**FACT**); в `monitor()` счётчики приводят `as number` (**FACT**, F-3) |
| Отсутствующий факт не создаётся | **FACT** | `reconcile()` пишет `MISSING_ACTUAL` |
| Сравнение baseline/candidate — только на парной выборке | **CONTRACT REQUIREMENT** | парная выборка **NOT_IMPLEMENTED** |
| Provenance: `fileChecksum` ≠ `normalizedChecksum`; checksum не подтверждает семантику | **FACT** (первая часть), **CONTRACT REQUIREMENT** (вторая) | `readHistory()` |
| `dataset_checksum` характеризует нормализованный набор на момент запуска | **FACT** | `cli/shadow.ts:53`, `runner.ts:101`; в данных 2 значения |
| Финансовый эффект не подтверждён; порог практической значимости не утверждён; candidate не объявляется победителем; baseline не меняется | **FACT** | отчёты Stage 3.4.5–3.4.7; семантика `PROVISIONAL` |