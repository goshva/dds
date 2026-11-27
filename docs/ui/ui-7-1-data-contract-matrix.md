# UI-7.1 — Data Contract Matrix: Forecast Errors & Diagnostics

**Проект:** DSS — DarkStore AI Forecast Engine
**Основание:** `ui-7-1-0-discovery-audit.md`, `ui-7-1-specification.md`
**Формат:** `| UI-поле | API-поле | Источник | Правило | Доступность | Ограничение |`

**Легенда «Доступность»:**
- `OK` — доступно сейчас (IMPLEMENTED);
- `PARTIAL` — доступно как агрегат/косвенно;
- `NOT_AVAILABLE` — источника нет (`errors.jsonl` отсутствует);
- `REQUIRES_IMPLEMENTATION` — нужно расширение API (R-1..R-4).

---

## 1. Фильтры и параметры запроса

| UI-поле | API-поле | Источник | Правило | Доступность | Ограничение |
|---|---|---|---|---|---|
| Mode (replay/shadow) | `mode` (query) | `parseEvaluationMode` | Обязателен; ∈ {replay,shadow}; иначе 400 | OK | Нельзя суммировать replay+shadow |
| Horizon (1/3) | `horizon` (query) | `parseEvaluationHorizon` | Обязателен; ∈ {1,3}; иначе 400 | OK | Только 1 и 3 |
| Model (опция) | `model` (query) | `parseOptionalModel` | ∈ {rolling_7_day_mean,adaptive_baseline} или пусто | OK (только `/forecasts`) | Нет в `/quality`/`/errors` |
| Limit | `limit` (query) | `parseLimit` | 1..1000 | OK | cap=1000 |
| Kind-фильтр | `code` (query) | `/forecasts/errors` | Свободная строка по `kind` | OK | Только `/errors` |

---

## 2. Раздел A — Persisted errors

| UI-поле | API-поле | Источник | Правило | Доступность | Ограничение |
|---|---|---|---|---|---|
| Флаг доступности | `persistedErrorsAvailable` | `/forecasts/errors` (константа) | Сейчас всегда `false` | OK (флаг) / NOT_AVAILABLE (данные) | В коде hardcoded `false` |
| Список persisted-ошибок | — | `errors.jsonl` | Файл отсутствует | NOT_AVAILABLE | Файл не читается этим endpoint; не создавать |
| Статус файла (MISSING/EMPTY/PRESENT) | — | `readJsonl` (ENOENT→[]) | Не различает | REQUIRES_IMPLEMENTATION (R-3) | API не отличает отсутствие/пусто |
| Количество persisted-ошибок | — | `errors.jsonl` | Нет источника | NOT_AVAILABLE | Не показывать «0» |

**Правило отображения:** при `persistedErrorsAvailable=false` → badge `NOT_AVAILABLE`, текст «источник `errors.jsonl` отсутствует», **не** «0 ошибок».

---

## 3. Раздел B — Computed diagnostics (summary)

| UI-поле | API-поле | Источник | Правило | Доступность | Ограничение |
|---|---|---|---|---|---|
| Paired N | `pairCounters.pairedN` | `evaluate().summaries[].pairCount` | парное пересечение моделей | OK | на срез (mode,horizon) |
| Pending N | `pairCounters.pendingN` | `eligibility → PENDING` | `target_date > technicalFactCutoff(=2026-11-23)` | OK | агрегат |
| Excluded baseline N | `pairCounters.excludedBaselineN` | eligibility BASELINE | `eligibility !== ELIGIBLE` | OK | агрегат |
| Excluded candidate N | `pairCounters.excludedCandidateN` | eligibility CANDIDATE | то же | OK | агрегат |
| Conflict N | `pairCounters.conflictN` | `classifyConflicts` | сумма конфликтов | OK | агрегат |
| Unknown N | `pairCounters.unknownN` | `classifyUnknown` | unknown mode/horizon/model/status | OK | агрегат |
| Interpretability | `interpretabilityStatus` | `interpretabilityOf` | NOT_AVAILABLE (pairedN=0) / INSUFFICIENT (1) / LIMITED (>1) | OK | 3+1 состояние |
| Sample status | `sampleStatus` | `computeMetrics` | COMPLETE / PARTIAL | OK | — |
| Метрики baseline | `metrics.baseline.*`, `*Status` | `computeMetrics` | статус NOT_AVAILABLE/OK | OK | — |
| Метрики candidate | `metrics.candidate.*`, `*Status` | `computeMetrics` | NEWS; NOT_IN_SCOPE для baseline-only | OK | — |
| Metric diagnostics | `metricDiagnostics` | `computeMetrics` | excluded reasons агрегатно (NON_FINITE, OVERFLOW) | PARTIAL | только агрегат, без per-record |
| Warnings | `warnings[]` | read-model | `DATASET_VERSION_DIFFERS`, `PENDING_OBSERVATIONS_PRESENT` | OK | предупреждения, не ошибки |

---

## 4. Раздел B — Detected errors (`/forecasts/errors`)

| UI-поле | API-поле | Источник | Правило | Доступность | Ограничение |
|---|---|---|---|---|---|
| Всего | `total` | `/forecasts/errors` | len(отфильтровано) | OK | > limit обрезано в items |
| Item: source | `items[].source` | — | всегда `"detected"` | OK | persisted-ветки нет |
| Item: kind | `items[].kind` | `classifyUnknown`/conflicts | `UNKNOWN_*`, `CONFLICT_*` | OK | фильтр `code` |
| Item: recordType | `items[].recordType` | `classifyConflicts` | snapshot / reconciliation | OK | — |
| Item: identity | `items[].identity` | snapshot_id / pairKey | id записи | OK | не PII |
| Item: reason | `items[].reason` | classify | unknown: `mode/horizon/model_id/model_version/status`; mismatch: имя поля | OK | конкатенация, без значений |
| Unknown mode list | items kind=`UNKNOWN_MODE` | `classifyUnknown` | mode ∉ множества | OK | — |
| Unknown horizon list | items kind=`UNKNOWN_HORIZON` | `classifyUnknown` | horizon ∉ {1,3} | OK | — |
| Unknown model list | items kind=`UNKNOWN_MODEL` | `classifyUnknown` | model_id/variant неизвестны | OK | — |
| Unknown status list | items kind=`UNKNOWN_STATUS` | `classifyUnknown` | status ∉ известных | OK | — |
| Pair identity conflict | items kind=`CONFLICT_PAIR_IDENTITY` | `conflicts.pairIdentityConflicts` | несколько snapshot на одну pair identity | OK | только первая identity? — см. ниже |
| Reconciliation mismatch | items kind=`CONFLICT_RECONCILIATION` | `reconciliationMismatches` | поле не совпало (model_id/horizon/target_date/forecast_value) | OK | reason = поле |

---

## 5. Раздел B — Списки, недоступные в API (требуют расширения)

| UI-поле | API-поле | Источник | Правило | Доступность | Ограничение |
|---|---|---|---|---|---|
| Excluded by reason (per-record) | `eligibilityDiagnostics[]` (нет) | `evaluate().summaries[].eligibilityDiagnostics` | snapshot → EligibilityReason | REQUIRES_IMPLEMENTATION (R-1) | сейчас только агрегаты |
| EligibilityReason enum (17) | — | `EligibilityReason` | список причин | REQUIRES_IMPLEMENTATION (R-1) | не выведен |
| Duplicate snapshots (список) | `conflicts.duplicateSnapshotIds` (нет в API) | `classifyConflicts` | snapshot_id + count | REQUIRES_IMPLEMENTATION (R-2) | только счётчик `duplicateN` |
| Orphan reconciliations (список) | `conflicts.orphanReconciliations` (нет) | `classifyConflicts` | rc без snapshot | REQUIRES_IMPLEMENTATION (R-2) | счётчик `orphanReconciliationN` |
| Snapshots without reconciliation (список) | `conflicts.snapshotsWithoutReconciliation` (нет) | `classifyConflicts` | snapshot без rc | REQUIRES_IMPLEMENTATION (R-2) | агрегат pending |
| Actual conflicts (список) | `conflicts.actualConflicts` (нет) | `classifyConflicts` | конфликт actual по identity | REQUIRES_IMPLEMENTATION (R-2) | нет счётчика в pairCounters |
| Invalid reconciliations (список) | `conflicts.invalidReconciliations` (нет) | `classifyConflicts` | невалидный rc | REQUIRES_IMPLEMENTATION (R-2) | — |
| Non-finite value (per-record) | `excluded reason=NON_FINITE` (нет per-record) | `computeMetrics` | нечисловое значение | REQUIRES_IMPLEMENTATION | только агрегат metricDiagnostics |

---

## 6. Раздел C — Operational status / provenance

| UI-поле | API-поле | Источник | Правило | Доступность | Ограничение |
|---|---|---|---|---|---|
| Manifest version | `provenance.manifestVersion` (через `/quality`) | `readManifest` | OK / NOT_AVAILABLE / CORRUPTED | OK | fail-closed |
| Manifest checksum | `provenance.datasetChecksum` | `manifest.json` | sha256 | OK | — |
| Dataset version warning | `provenance.datasetVersionWarning` / `warnings` | `buildPairs` | несколько checksum → `DATASET_VERSION_DIFFERS` | OK | N-1: replay STALE |
| Checksums | `provenance.checksums` | `shadowFileChecksums` | по файлам | OK | — |
| asOf | `provenance.asOf` | read-model | timestamp | OK | — |
| File availability per file | — | `readJsonl` | — | REQUIRES_IMPLEMENTATION (R-4) | нет endpoint |
| errors.jsonl status | — | ENOENT→[] | не различает | REQUIRES_IMPLEMENTATION (R-3) | — |

---

## 7. Раздел D — Traceability / Pending детали

| UI-поле | API-поле | Источник | Правило | Доступность | Ограничение |
|---|---|---|---|---|---|
| Pending list (snapshot_id/target_date) | `snapshotsWithoutReconciliation` (нет) | `classifyConflicts` | target>cutoff | REQUIRES_IMPLEMENTATION (R-2) | сейчас `pendingN` |
| Latest forecasts по filtered | `/shadow/forecasts` items | shadow JSONL | — | OK | needed client join? — избегать |
| Source list | `provenance.sources` | read-model | canonical + shadow | OK | — |
| Health | `/api/health` | process | readOnly=true | OK | — |

---

## 8. EligibilityReason (источник-определение, для R-1)

`PENDING`, `EXCLUDED_STATUS`, `EXCLUDED_NULL_FORECAST`, `MISSING_ACTUAL`, `UNKNOWN_SNAPSHOT`, `EXCLUDED_MODEL_VERSION`, `UNKNOWN_MODE`, `UNKNOWN_HORIZON`, `UNKNOWN_STATUS`, `CONFLICT_DUPLICATE`, `CONFLICT_ACTUAL`, `CONFLICT_FORECAST_VALUE`, `CONFLICT_RECONCILIATION`, `CONFLICT_PAIR_IDENTITY`, `UNKNOWN_DATASET_VERSION`, `INVALID_RECONCILIATION`, `SOURCE_CORRUPTED` (17 значений; порядок — по коду `src/server/forecast-evaluation.ts`).

| UI-поле | API-поле | Источник | Правило | Доступность | Ограничение |
|---|---|---|---|---|---|
| Reason код | `EligibilityReason` | — | enum 17 | REQUIRES_IMPLEMENTATION (R-1) | не выведен через API |
| Reason → лейбл | — | — | человекочитаемая подпись | спецификация | не реализовано |

---

## 9. Правила консистентности (инварианты для рендера)

1. **A≠B:** persisted-секция и computed-секция не смешивают числа.
2. **replay≠shadow:** ни одно поле не суммирует два mode.
3. **asOf:** любое число раздела B сопровождается `asOf`.
4. **NOT_AVAILABLE ≠ 0 ≠ пусто:** три разных визуальных состояния.
5. **warnings ≠ errors:** `DATASET_VERSION_DIFFERS` — предупреждение.
6. **Аггрегат vs список:** если R-* не реализован — показывать агрегат + текст «детализация недоступна», не пустой список.
7. **No client recount:** UI не строит списки из `/shadow/forecasts` вместо отсутствующего API (только через R-1/R-2).

---

## 10. Сводная матрица готовности

| Раздел | Обязательные поля | Готовность |
|---|---|---|
| A persisted | `persistedErrorsAvailable` | NOT_AVAILABLE (данные) / OK (флаг) |
| B summary | `pairCounters`, `interpretabilityStatus`, `sampleStatus`, `metricDiagnostics`, `warnings` | OK |
| B detected | `/forecasts/errors` (total/items/kind) | OK (частично) |
| B per-record exclusions | eligibilityDiagnostics | REQUIRES_IMPLEMENTATION (R-1) |
| B conflicts lists | duplicate/orphan/noRecon/actual/invalid | REQUIRES_IMPLEMENTATION (R-2) |
| C status | manifestVersion, datasetChecksum, warnings, checksums, asOf | OK |
| C file status | per-file MISSING/EMPTY/PRESENT | REQUIRES_IMPLEMENTATION (R-3/R-4) |
| D pending details | pending list | REQUIRES_IMPLEMENTATION (R-2) |
