# UI-7.1 — Спецификация: Forecast Errors & Diagnostics

**Проект:** DSS — DarkStore AI Forecast Engine
**Этап:** UI-7.1 (тот же эпик, что UI-7.0.x)
**Основание:** `docs/ui/ui-7-1-0-discovery-audit.md`
**Статус:** спецификация (реализация не выполнена; кнопки/данные — на существующих источниках)
**Дата:** 27 ноября 2026

> Термины и контракты — по `ui-7-1-0-discovery-audit.md`. Источник истины — `src/server/forecast-evaluation.ts` и `src/server/services/forecasting-read-models.ts`.

---

## 1. Назначение

Дать оператору/аналитику **прозрачный раздел диагностики прогнозов**: что исключено из оценки и почему, где конфликты данных, чего не хватает (pending), и в каком состоянии источники (manifest, checksums, persisted-ошибки).

Раздел должен честно передавать три *разных* типа состояния, которые сейчас смешаны в одном `/forecasts/errors`:

- **A. Persisted errors** — ошибки, записанные в `errors.jsonl` (источник отсутствует → `NOT_AVAILABLE`);
- **B. Computed diagnostics** — диагностика, вычисляемая `evaluate()` на каждом запросе (available / partial);
- **C. Operational status** — состояние источников/файлов/версий (avail / partial).

---

## 2. Пользовательские задачи (jobs-to-be-done)

1. «Почему по этой выборке мало пар и я не могу сравнить модели?» → `pairCounters` + `eligibilityDiagnostics` (по причинам).
2. «Сколько прогнозов ожидает факта (pending) и когда будут сверены?» → `pendingN` + список snapshot с `target_date`.
3. «Почему конкретный прогноз попал в исключение?» → per-snapshot `reason` `EligibilityReason`.
4. «Есть ли конфликты в хранилище (дубликаты/сироты/reconciliation mismatch)?» → списки + счётчики.
5. «Почему replay-страница показывает STALE при `OK`-снапшотах?» → `provenance.datasetVersionWarning` + пояснение (N-1).
6. «Есть ли зафиксированные ошибки в `errors.jsonl`?» → `persistedErrorsAvailable=false` и явное `NOT_AVAILABLE`.
7. «Что видит система как «неизвестное» (mode/horizon/model/status)?» → `unknownRecords`.

---

## 3. Scope

### В scope (specification)
- Раздел диагностики на странице «Прогнозы и качество» + (опционально) выделенный экран `#/forecast-diagnostics`.
- Сводка (KPI-счётчики), pending, excluded (по причинам), detected-ошибки, конфликты, фильтры, детали по записи, трассировка источников.
- Разделение A/B/C, replay/shadow.
- Документировать расширение API там, где текущего DTO недостаточно.

### Вне scope
- Реализация (код, шаблоны, endpoint'ы) — запрещена на этапе 7.1.0.
- Изменение источников/JSONL/manifest/canonical.
- Создание `errors.jsonl`.
- Кэш/ETag/производительность (рекомендация, не реализация).
- Ручной запуск replay/shadow/reconcile/monitor.

---

## 4. Information Architecture

```
Forecast Diagnostics (или секция на «Прогнозы и качество»)
├── 4.1 Filters (mode: replay|shadow [обяз.], horizon: 1|3 [обяз.])
├── 4.2 Summary (KPI)
│     ├── pairedN, pendingN, excludedBaselineN, excludedCandidateN, conflictN, unknownN
│     └── interpretabilityStatus (NOT_AVAILABLE|INSUFFICIENT|LIMITED), sampleStatus
├── 4.3 Pending (ожидание факта)
│     └── список snapshot_id / target_date / model / horizon [требует N-3]
├── 4.4 Excluded (исключённые из оценки, по причинам)
│     ├── таблица EligibilityReason × N [требует N-2]
│     └── список snapshot с reason (детализация)
├── 4.5 Detected diagnostics (B)
│     ├── unknown records (mode/horizon/model/status)
│     ├── conflicts: duplicate / orphan / pair identity / reconciliation mismatch / actual conflict
│     └── (persisted errors) → 4.6
├── 4.6 Persisted errors (A) — NOT_AVAILABLE (errors.jsonl отсутствует)
├── 4.7 Operational status (C)
│     ├── manifest: version, checksum, created_at
│     ├── file availability: forecasts/reconciliations/errors
│     └── dataset checksum(s) + warning (DATASET_VERSION_DIFFERS)
└── 4.8 Traceability — provenance drawer (sources/checksums/asOf)
```

---

## 5. Разделение A / B / C (критично)

| Тип | Определение | Источник | Как отображать |
|---|---|---|---|
| **A. Persisted errors** | Записанные ошибки прогона | `errors.jsonl` | Сейчас `NOT_AVAILABLE`; **запрещено** показывать «0 ошибок» |
| **B. Computed diagnostics** | Вычислено `evaluate()` «на лету» | snapshots+reconciliations | Показывать с отметкой «вычислено сейчас», с `asOf` |
| **C. Operational status** | Состояние источников/версий | manifest/checksums/файлы | Показывать как состояние, не как «ошибку данных» |

**Правило:** UI не смешивает A и B в одном счётчике «ошибок». Persistent-раздел может быть `NOT_AVAILABLE`, при этом B может быть `OK`.

---

## 6. Replay / Shadow

- `mode` обязателен; UI показывает отдельно, **никогда** не суммирует replay+shadow.
- `horizon` обязателен; h1/h3 — отдельные срезы внутри mode.
- Счётчики, списки, метрики — на выборке `(mode, horizon)`.
- Дефолт: `mode=replay`, `horizon=1` (согласовать; сейчас на странице качества дефолт задаёт `routing.ts`).

---

## 7. Требования к API

### 7.1 Уже доступно (IMPLEMENTED)

| Endpoint | Поле | Использование в UI |
|---|---|---|
| `/api/v1/forecasts/quality` | `pairCounters.{pairedN,pendingN,excludedBaselineN,excludedCandidateN,conflictN,unknownN}` | 4.2 Summary |
| | `interpretabilityStatus`, `sampleStatus` | 4.2 |
| | `warnings[]` (`DATASET_VERSION_DIFFERS`, `PENDING_OBSERVATIONS_PRESENT`) | 4.7 |
| | `provenance.{datasetVersionWarning,checksums,asOf}` | 4.8 traceability |
| | `metrics.*Status`, `metricDiagnostics` | 4.2 метрики |
| `/api/v1/forecasts/errors` | `persistedErrorsAvailable` | 4.6 → фикс `false` → `NOT_AVAILABLE` |
| | `total`, `items[].{source:"detected",kind,recordType,identity,reason}` | 4.5 detected (фильтр `kind`) |
| | `kind` (фильтр) | 4.5 |

### 7.2 Требует расширения (REQUIRES_IMPLEMENTATION — не реализуется в 7.1.0)

| # | Разрыв | Требование | Приоритет |
|---|---|---|---|
| R-1 (N-2) | `/forecasts/errors` не отдаёт per-record `EligibilityReason` для excluded (`PENDING`, `EXCLUDED_STATUS`, `EXCLUDED_NULL_FORECAST`, `UNKNOWN_SNAPSHOT`, ...) | Добавить `GET /api/v1/forecasts/exclusions?mode=&horizon=` или поле `eligibilityDiagnostics[]` | High (4.3/4.4) |
| R-2 (N-3) | Нет списков duplicateSnapshotIds / orphanReconciliations / snapshotsWithoutReconciliation / actualConflicts | Расширить `/forecasts/errors` или новый `conflicts` endpoint | Medium-High |
| R-3 (N-4) | `readJsonl` не отличает отсутствие файла от пустого | В read-model: `errorsFileStatus: MISSING|EMPTY|PRESENT`, прокинуть в DTO | Medium (A) |
| R-4 | Нет endpoint статуса файлов | `GET /api/v1/shadow/files` (status per file) или поле в `/quality` | Low |

**Если R-* не реализуются:** спецификация допускает **fallback-вариант**, где 4.3/4.4 показывают только **агрегаты** (счётчики `pairCounters`) с пометкой «детализация по записям недоступна»; 4.3 pending — `pendingN` без списка.

---

## 8. Требования к frontend

### 8.1 Компоненты (переиспользовать)
`kpiGrid`/`kpiCard`, `dataTable`, `statusBadge`, `card`, `chartCard`, `emptyState`, `loadingState`, `errorState`, `provenanceDrawer`. Фильтры mode/horizon — существующий паттерн (`ds-badge`/`chip`).

### 8.2 Страница / маршрут
- Вариант 1 (минимальный): новая секция «Диагностика» внутри `pages/forecast-quality.ts`.
- Вариант 2 (полный): новая страница `pages/forecast-diagnostics.ts` + запись в `PAGES` (`routing.ts`).
- Спецификация не выбирает реализацию; оба варианта — **REQUIRES_IMPLEMENTATION**.

### 8.3 Состояния
- Loading → `loadingState`; пусто → `emptyState` (не «0 ошибок»); ошибка → `errorState` с кодом (без stack).
- `NOT_AVAILABLE` — отдельный badge, отличный от «пусто» и от «0».
- Числа всегда сопровождаются `asOf`/`provenance`.

### 8.4 Безопасность UI
- Экранирование всех значений (`escapeHtml`); `reason` — текст, не HTML.
- Нет абсолютных путей; DTO их не содержит.
- Тайм-ауты (`client` 8s) → `errorState` (TIMEOUT).

---

## 9. Требования к безопасности

- PII: раздел не выводит PII (PII в источниках нет — см. аудит §12).
- `reason` — конкатенация id/полей; разрешено; без файловых путей.
- Persisted errors (A) — только чтение; UI не пишет.
- Сохранять: `no-store`, `nosniff`, `no-referrer`, Host/Origin allowlist.
- Ошибка API → показать код+сообщение, никогда не stack/путь.

---

## 10. Требования к производительности

- Первый рендер ≤ ~1 c на текущем объёме (3.5k записей).
- `limit` для списков ≤1000 (по контракту); показывать «Показано X из total».
- Отдельно документировать: повторное `evaluate()` на каждый запрос (out of scope для оптимизации; рекомендация — кэш по mtime/checksum).

---

## 11. Требования к responsive

- Desktop: KPI-grid + таблицы; Mobile (≤640): KPI в 2 колонки, таблицы → карточки/скролл.
- Таблицы: `dataTable` уже responsive; фильтры — чипы с wrap.
- Long `reason`/`identity` — truncate + title.

---

## 12. Acceptance criteria (для будущей реализации)

- AC-1: `mode`/`horizon` обязательны; при отсутствии — UI требует выбор, ставит дефолт; запрос с невалидными параметрами → `errorState` 400.
- AC-2: Replay и shadow никогда не агрегируются; счётчики показывают выбранный срез.
- AC-3: Секция A показывает `NOT_AVAILABLE` при `persistedErrorsAvailable=false`; **никогда** не «0 ошибок».
- AC-4: Сводка B = `pairCounters` + `interpretabilityStatus` (три состояния + NOT_AVAILABLE) с `asOf`.
- AC-5: Pending показывает `pendingN`; если R-1/R-2 есть — список (snapshot_id/target_date).
- AC-6: Для excluded (если R-1) — таблица причин (`EligibilityReason` × N); иначе — счётчики + пометка «детализация недоступна».
- AC-7: Conflicts (если R-2) — списки по типам + счётчики; иначе — счётчики.
- AC-8: `DATASET_VERSION_DIFFERS` отображается как **предупреждение**, не как ошибка.
- AC-9: `NOT_AVAILABLE` визуально ≠ пусто ≠ 0.
- AC-10: Все значения экранированы; нет путей в тексте.
- AC-11: Mobile: без горизонтального overflow; KPI в 2 колонки.
- AC-12: `asOf`/provenance доступны из раздела (drawer).
- AC-13: UI не пересчитывает eligibility/метрики; только рендер API.

---

## 13. NOT_IMPLEMENTED / NOT_VERIFIED

### NOT_IMPLEMENTED (специфицировано, но не реализовано и не может быть реализовано без отдельного одобрения)
- R-1 per-record `eligibilityDiagnostics` endpoint/поле.
- R-2 списки duplicate/orphan/noReconciliation/actualConflicts.
- R-3 различение MISSING/EMPTY для `errors.jsonl`.
- R-4 endpoint статуса файлов.
- Сама страница/секция диагностики.

### NOT_VERIFIED
- Соответствие `actual` reconciliation ↔ canonical CSV по датам (аудит §6).
- Реальный UX при `SourceError 503` (по коду — `errorState`, браузерно не проверялось).
- `shadow-monitor.json` vs `evaluate()` (не источник API v1).

---

## 14. Открытые вопросы

- **Q-1:** Диагностика — секция существующей страницы или отдельный маршрут `#/forecast-diagnostics`? (влияет на объём реализации).
- **Q-2:** Дефолт `mode`/`horizon` на новом экране — `replay/1`?
- **Q-3:** Per-record exclusion list нужен обязательным (R-1) или достаточно счётчиков для 7.1?
- **Q-4:** Показывать ли pending-список без R-2 (нет списка `snapshotsWithoutReconciliation` в API) — через `/shadow/forecasts` клиентский join? (рекомендуется — только через API, без client-side пересчёта).
- **Q-5:** N-1 «STALE» для replay — правило отображения (предупреждение vs подавление)? Рекомендация: предупреждение «manifest version differs».

---

## 15. Трассируемость к аудиту

| Раздел спец. | Раздел аудита |
|---|---|
| §5 A/B/C | §2, §7 |
| §6 replay/shadow | §2, §5 |
| §7 API | §2, §7, §8 |
| §7.2 R-1..R-4 | §7, §14 (N-2/N-3/N-4) |
| §8 UI | §9 |
| §9 security | §10, §12 |
| §10 perf | §11 |
| §12 AC | §15 |
| §14 Q-1/5 | §14 N-1 |
