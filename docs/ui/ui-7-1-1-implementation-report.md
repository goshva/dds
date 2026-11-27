# UI-7.1.1 — Implementation Report: Forecast Diagnostics UI (Fallback)

**Проект:** DSS — DarkStore AI Forecast Engine
**Этап:** UI-7.1.1 (fallback-реализация на существующем read-only API)
**Дата:** 27 ноября 2026
**Основание:** задание UI-7.1.1; документы `docs/ui/ui-7-1-0-discovery-audit.md`, `ui-7-1-specification.md`, `ui-7-1-data-contract-matrix.md`.

---

## 1. Summary

Реализована отдельная страница диагностики прогнозирования `#forecast-diagnostics/<mode>/<horizon>` на существующих read-only endpoint `/api/v1/forecasts/quality` и `/api/v1/forecasts/errors`. Backend, DTO, routes, forecasting core, JSONL, manifest, canonical CSV не изменялись. Страница честно разделяет:

- **A. Persisted errors** — `errors.jsonl` отсутствует → явно `NOT_AVAILABLE`, не «0 ошибок»;
- **B. Computed diagnostics** — quality (агрегаты) и errors (detected-диагностика) из API;
- **C. Operational status** — provenance (manifest/freshness/checksums) из DTO quality.

Frontend-метрики не пересчитываются; отсутствующие значения (`null`, `n=0`, `NOT_AVAILABLE`) подаются как `[Н/Д]`/`NOT_AVAILABLE`, а не нулём. Все API-строки экранируются.

**Итоговый вердикт: ACCEPTED WITH LIMITATIONS** (см. §14).

---

## 2. Initial Git state

| Параметр | Значение |
|---|---|
| Дата | 2026-11-27 |
| Branch | `main` |
| HEAD (preflight) | `5bce18a1e83e4c3e89faa45aebab04abcbd6cc36` (`disign`) = `origin/main` |
| Staged | пусто |
| Unstaged | пусто |
| Untracked | пусто |
| Рабочее дерево | чистое |

**Примечание:** HEAD сдвинулся относительно состояния из аудита UI-7.1.0 (`3c3dba0`) — появился коммит `5bce18a «disign»`, включающий правки UI-7.0.2.1. Изменения закоммичены пользователем; в ходе UI-7.1.1 история не переписывалась.

`errors.jsonl` отсутствовал на старте и на финише (не создавался). `AGENTS.md`/`KODA.md` отсутствуют — действуют инструкции родительского контекста и задания.

---

## 3. Changed files

Только файлы из allowlist:

| Файл | Тип | Назначение |
|---|---|---|
| `src/web/pages/forecast-diagnostics.ts` | создан | Страница диагностики: блоки A–E, сборка `forecastDiagnosticsPage`, helper-состояния |
| `src/web/routing.ts` | изменён | `PAGES` + `forecast-diagnostics`; `isForecast` включает его; новая `diagnosticsParams()` |
| `src/web/main.ts` | изменён | Обработка маршрута `forecast-diagnostics`: параллельные запросы quality+errors, обработка invalid, `generatedAt` |
| `tests/web/ui-7-0-1-routing.test.ts` | изменён | Тесты `diagnosticsParams` и `PAGES` |
| `tests/web/ui-7-1-1-forecast-diagnostics.test.ts` | создан | 25 тестов страницы диагностики |
| `docs/ui/ui-7-1-1-implementation-report.md` | создан | Настоящий отчёт |

Проверено (FACT): `git status --short` показывает ровно перечисленные файлы; ни backend, ни CSS, ни существующие документы UI-7.1.0 не изменялись.

---

## 4. API contracts actually used

Сверено с исполняемым кодом (`src/server/routes.ts`, `src/server/services/forecasting-read-models.ts`). Документация UI-7.1.0 подтверждена; доверяем коду при расхождениях.

### `/api/v1/forecasts/quality?mode=&horizon=`
- `mode` ∈ {replay,shadow} обязателен; `horizon` ∈ {1,3} обязателен.
- Используется для блока B (агрегаты, метрики, предупреждения) и блока D (provenance).
- **Фактический клиентский DTO (`QualityDto.provenance`)** содержит: `datasetChecksums`, `datasetVersionWarning`, `manifestStatus`, `freshness`, `shadowFileChecksums`.
  - **Расхождение (FACT):** серверный `ForecastProvenanceDto` содержит `manifestDatasetChecksum`, но клиентский тип `QualityDto` в `pages/forecast-quality.ts` его **не объявляет**. Чтобы не расширять beyond-allowlist файл, поле не выводится — в блоке D стоит явное примечание «manifest dataset_checksum доступен через API, но не в клиентском DTO». Не подменяем отсутствие догадкой.
- `meta.generatedAt` подписан как время формирования ответа API (не дата наблюдения данных).

### `/api/v1/forecasts/errors?mode=&code=&limit=`
- `mode` обязателен; `horizon` **не поддерживается** — список относится ко всему режиму.
- `ForecastErrorItemDto`: `source`, `kind`, `snapshotId`, `recordType`, `reason`. Поля `identity` нет.
- `persistedErrorsAvailable` присутствует в DTO (сервер всегда `false`), но не гарантирован в каждом сценарии (`not_available` → нет `data`); страница читает его только при `status=ok`.
- Пустой набор → API возвращает `not_available` (reason `NO_DETECTED_DIAGNOSTICS`), не пустой DTO. Страница показывает это как «Диагностических записей нет… Это не «ошибок нет»», а **не** как «0 ошибок».

### `/api/v1/overview`, `/api/health`
Используются только косвенно: `overview.meta.generatedAt` подставляется как последний fallback для `generatedAt`; `/api/health` страницей напрямую не вызывается (общая оболочка/состояние источника).

---

## 5. Page structure and UX behavior

Маршрут: `#forecast-diagnostics/<mode>/<horizon>`. Разбор — `diagnosticsParams()` (отдельно от `forecastParams`, чтобы различать валидный/невалидный ввод):

- пустые сегменты → `shadow / 1` (`invalid=false`);
- `replay`/`shadow` и `1`/`3` — валидны;
- любой другой → безопасные значения + `invalid=true` → страница показывает `errorState` «Некорректные параметры диагностики» (INVALID_PARAMS).

Блоки:

- **A. Состояние диагностики:** режим, горизонт, независимые статусы quality/errors, `meta.generatedAt` с явной подписью. При загрузке — `loadingState` (в `main.ts` до запросов).
- **B. Качество прогноза:** KPI из `pairCounters` (pairedN, pendingN, excludedBaseline/CandidateN, conflictN, unknownN), `sampleStatus`, `interpretabilityStatus`; таблица `independentMetrics`; предупреждения API с человекочитаемой расшифровкой. `NOT_AVAILABLE`/`null`/`n=0` → `[Н/Д]`, не 0.
- **C. Обнаруженные диагностические записи:** таблица `source/kind/snapshotId/recordType/reason`; постоянное пояснение «Диагностические записи возвращаются для выбранного режима целиком. API не поддерживает фильтрацию этого списка по горизонту»; бейдж persisted journal; отдельные состояния: успех / успешный пустой набор / not_available / error.
- **D. Provenance и Shadow Mode:** manifest status, freshness, dataset checksums, shadow file checksums, предупреждение о версии данных; расшифровка freshness без вывода о корректности модели.
- **E. Ограничения диагностики:** persisted journal недоступен; per-record eligibility reasons не предоставляются; полная детализация конфликтов недоступна; ошибки API ≠ ошибки модели; pending ≠ failed.

Навигация: страница добавлена в `PAGES` и отображается в sidebar (пункт «Диагностика прогнозирования»).

### Мобильная адаптация (изменение в ходе работы)
Первичная реализация кладла длинные тексты в `statusBadge`. У `.ds-badge` в дизайн-системе `white-space: nowrap` → на mobile бейдж выходил за viewport и давал горизонтальный скролл body. **CSS не менялся (вне allowlist)** — вместо этого длинные подписи из бейджей убраны: бейдж несёт только короткий код (`DATASET_VERSION_DIFFERS`, `SINGLE_VERSION`, `Journal: N/A`, `SHADOW`/`REPLAY`, `h1`/`h3`), расшифровка — обычным текстом с переносом. После правки горизонтальный overflow на 390px устранён (визуально подтверждено скриншотом).

---

## 6. Handling of unavailable/missing data

| Ситуация | Поведение |
|---|---|
| `errors.jsonl` отсутствует | Блок A/C/D/E: persisted journal `NOT_AVAILABLE`; C: «Диагностических записей нет… не «ошибок нет»» |
| `quality` = `not_available` | Блок B: `emptyState` с `reason`; блок D: «Provenance недоступен» |
| `errors` = `not_available` | Блок C: `emptyState` с `reason`, помечено «Это не «ошибок нет»» |
| `errors` = успешный пустой набор | Блок C: «Успешный пустой набор» (отличается от `not_available`) |
| HTTP-ошибка / таймаут | Независимые `errorState` для quality и errors с кодом+eventId |
| `n=0`, `mae=null`, `NaN`, `Infinity` | `[Н/Д]`, не 0 |
| `NOT_AVAILABLE` interpretability/sample | показано как `NOT_AVAILABLE` (бейдж `ds-badge--na`), не как OK/0 |
| неизвестный `manifestStatus`/`freshness` | отображено как есть (`CORRUPTED`→CONFLICT, `NOT_CONFIRMED`→NOT_AVAILABLE) |

Правило «A ≠ B ≠ 0 ≠ пусто» соблюдено: три визуально разные семантики.

---

## 7. Tests and exact results

| Команда | Результат |
|---|---|
| `bunx tsc --noEmit` | OK (0 ошибок) |
| `bun run ui:test` | **417 pass, 0 fail** (12 files) |
| `bun run forecast:test` | **386 pass, 0 fail** (20 files) |
| `bun test` (весь набор) | **967 pass, 4 skip, 0 fail** (50 files, 971 tests) |
| `bun run pii:test` | **23 pass, 0 fail** |

Новые/обновлённые тесты:

- `tests/web/ui-7-1-1-forecast-diagnostics.test.ts` — **25 тестов**: блоки A/B/C/D/E; успешные/not_available/error/empty для каждого endpoint; независимость quality/errors; mode-wide пояснение; отсутствие `identity/asOf/manifestVersion` (negative-check); `meta.generatedAt` подпись; checksum mismatch как warning; неизвестный checksum ≠ success; отсутствующие метрики ≠ 0; XSS для kind/snapshotId/reason и warning-кода; loading/invalid.
- `tests/web/ui-7-0-1-routing.test.ts` — добавлены тесты `diagnosticsParams` (корректный маршрут, replay/shadow, горизонты 1/3, некорректные mode/horizon, прямой deep-link, отсутствие регрессий существующих маршрутов) и проверка `PAGES` (6 ключей).

Тесты используют реальные production-функции (`forecastDiagnosticsPage`, `diagnosticsParams`, `parseHash`), без копирования логики.

**Flaky:** не обнаружено в трёх прогонах UI-набора в ходе сессии; отклонений 0 fail.

---

## 8. Build result

`bun run ui:build` — успешно: 23 модуля, `dist/web/index.html`, CSS 9.91 kB (gzip 2.83), JS 46.67 kB (gzip 14.16), built in 73ms.

---

## 9. Browser verification

Dev-серверы (`api:start` 8787, `ui:dev` 5173) поднимались, `evaluate` в браузере отключён → overflow оценивался визуально по скриншотам.

| Проверка | Результат |
|---|---|
| `#forecast-diagnostics/shadow/1` (desktop) | OK: все блоки, errors=not_available, provenance, ограничения |
| `#forecast-diagnostics/replay/3` (mobile 390) | OK: replay, h3, pairedN 875, LIMITED, metrics 114,13/100,26 |
| `#forecast-diagnostics/shadow/3` (desktop) | OK: n=0 → `[Н/Д]`, interpretability `NOT_AVAILABLE` |
| Mobile overflow (после правки бейджей) | Горизонтальный скролл устранён; контент вписывается, вертикальный скролл обычный |
| API unavailable (API остановлен) | Независимые errorState quality=HTTP_502 и errors=HTTP_502, `generatedAt=NOT_AVAILABLE`, «Provenance недоступен». Источник в topbar = PARTIAL |
| `#overview` | OK (история, теневой режим, provenance) |
| `#quality` | OK (полнота, пропуски, календарь) |
| `#provenance` | OK (источник, версия, семантика) |
| `#history/30` | OK (показатели, график, таблица, формулы) |
| Console errors | 0 на всех проверенных страницах |

API и dev-серверы после проверки остановлены. Внешний браузер недоступен — использовался встроенный браузер Koda Desktop.

---

## 10. PII result

`bun run pii:test` — 23 pass / 0 fail. `pii:inventory`/gate, пересоздающий `reports/code-review/pii-tracked-inventory.json`, **не запускался** (чтобы не изменять посторонний файл вне allowlist). Вывод: PII-проверка пройдена на уровне доступного безопасного теста; полный inventory-gate не исполнялся (см. §12).

---

## 11. Diff and allowlist verification

- `git diff --check` — ошибок пробелов нет (только CRLF warning).
- `git status --short` — ровно 5 кодовых/тестовых файлов + 1 отчёт, все в allowlist.
- `git rev-parse HEAD` = `5bce18a1e83e4c3e89faa45aebab04abcbd6cc36` — не менялся.
- Data checksums (до = после, источник не трогали):
  - canonical CSV `56069e58…3ba377c5`
  - forecasts.jsonl `e35fe27b…f08a648c`
  - reconciliations.jsonl `32ccd256…38dad146`
  - manifest.json `9d986747…fc10c17d`
  - `errors.jsonl` — отсутствует (не создан).
- Git-мутации (commit/push/reset/rebase/checkout/switch/stash/clean/index) не выполнялись.

---

## 12. Known limitations

- **manifestDatasetChecksum не выведен:** поле есть в серверном DTO, но отсутствует в клиентском `QualityDto.provenance`; расширение клиентского типа потребовало бы правки `pages/forecast-quality.ts` (вне allowlist). В блоке D стоит явное примечание вместо догадки.
- **Per-record eligibility reasons и полные списки конфликтов (duplicate/orphan/noReconciliation/actualConflicts) недоступны** через API → страница показывает только агрегаты и явно перечисляет это ограничение (блок E). Фиктивной детализации нет.
- **Фильтр errors по horizon не поддерживается** — блок C это явно обозначает; фиктивной фильтрации нет.
- **PII inventory-gate** не запускался (пишет в `reports/code-review/…` вне allowlist). Запущен только безопасный `pii:test`.
- **`evaluate` браузера отключён** → overflow проверен визуально, не программно.
- **Flaky:** не выявлено; полный набор стабилен (967/4skip/0fail).

---

## 13. Acceptance criteria matrix

| AC | Требование | Статус | Комментарий |
|---|---|---|---|
| AC-01 | Новая страница доступна по маршруту | ✅ | `#forecast-diagnostics/<mode>/<horizon>`; запись в `PAGES`, sidebar |
| AC-02 | replay и shadow обрабатываются | ✅ | `diagnosticsParams`, проверено в браузере и тестах |
| AC-03 | quality из действующего API | ✅ | `/api/v1/forecasts/quality`, без пересчёта |
| AC-04 | errors из действующего API | ✅ | `/api/v1/forecasts/errors` |
| AC-05 | Независимые состояния двух endpoint | ✅ | quality=NOT_AVAILABLE при errors=ok и наоборот; независимые errorState |
| AC-06 | mode-wide nature errors обозначена | ✅ | Постоянное пояснение в блоке C; тест |
| AC-07 | `not_available` ≠ «0 ошибок» | ✅ | emptyState с явным текстом; тест |
| AC-08 | Отсутствующие поля не имитируются | ✅ | `identity/asOf/manifestVersion` не выводятся; negative-тест |
| AC-09 | pending отделён от errors | ✅ | KPI «Ожидают факта (pending)», note «pending ≠ ошибка», блок E |
| AC-10 | checksum mismatch как warning | ✅ | Бейдж PENDING `DATASET_VERSION_DIFFERS` + расшифровка |
| AC-11 | freshness ≠ доказательство плохого прогноза | ✅ | Явный текст в блоке D; тест |
| AC-12 | `meta.generatedAt` корректно подписан | ✅ | «Время формирования ответа API», не «дата обновления данных»; тест |
| AC-13 | Нет повторного расчёта метрик на frontend | ✅ | Метрики берутся из DTO как есть |
| AC-14 | Нет неподтверждённых финансовых выводов | ✅ | Финансовых показателей нет |
| AC-15 | Нет фиктивного persisted errors journal | ✅ | `NOT_AVAILABLE`, блок E |
| AC-16 | Нет фиктивной фильтрации errors по horizon | ✅ | Явное пояснение; фильтр не эмулируется |
| AC-17 | Нет XSS через API-данные | ✅ | Всё через `escapeHtml`/компоненты; XSS-тесты |
| AC-18 | Mobile layout не переполняется | ✅ | После правки бейджей горизонтальный overflow устранён (визуально) |
| AC-19 | Существующие страницы не сломаны | ✅ | overview/quality/provenance/history/forecast-quality проверены |
| AC-20 | TypeScript проверка пройдена | ✅ | `tsc --noEmit` OK |
| AC-21 | UI tests пройдены | ✅ | 417 pass / 0 fail |
| AC-22 | Forecasting tests пройдены | ✅ | 386 pass / 0 fail |
| AC-23 | Полный набор тестов либо отклонения описаны | ✅ | 967 pass / 4 skip / 0 fail |
| AC-24 | Production build успешен | ✅ | `ui:build` OK |
| AC-25 | PII gate проверен или причина пропуска | ✅ (с ограничением) | `pii:test` 23 pass; inventory-gate пропущен (вне allowlist) — зафиксировано |
| AC-26 | Изменены только файлы allowlist | ✅ | `git status` подтверждает |
| AC-27 | Git HEAD и пользовательские изменения сохранены | ✅ | HEAD не менялся, дерево было чистым |
| AC-28 | Отчёт реализации создан | ✅ | Этот файл |

---

## 14. Final verdict

**ACCEPTED WITH LIMITATIONS.**

Реализация соответствует заданию: fallback на существующем API, без расширения backend, без пересчёта метрик, без имитации недоступных данных, с явными ограничениями и экранированием. Все обязательные проверки (tsc, ui:test, forecast:test, full bun test, ui:build, pii:test), diff/allowlist/checksum проверены; браузерная проверка (desktop/mobile, direct links, API unavailable, существующие страницы) выполнена.

### NOT IMPLEMENTED
- Вывод `manifestDatasetChecksum` — поле отсутствует в клиентском `QualityDto` (правка вне allowlist).
- Per-record eligibility reasons, полные списки конфликтов — нет в API (осознанно, блок E).
- PII inventory-gate — пропущен намеренно (побочная запись вне allowlist).

### NOT VERIFIED
- Переполнение на других разрешениях (≤360px) — проверено на 390px (mobile) и desktop; промежуточные брейкпоинты визуально не снимались.
- Программное измерение `scrollWidth` (браузерный `evaluate` отключён) — overflow оценён по скриншотам.
- Поведение при экстремально длинных `reason`/`snapshotId` из реальных данных (в источнике их нет).

### Остаточные риски
- N-1 (replay STALE при расхождении manifest/replay checksum) — отображается как warning `DATASET_VERSION_DIFFERS`, не как ошибка; риск ложного восприятия снижен текстом.
- Длинные `reason` в таблице C оборачиваются/скроллятся через `ds-table-wrap` (overflow-x) — на mobile это внутренний скролл таблицы, не body.

### Рекомендации для независимой приёмки
1. Проверить 360px и промежуточные брейкпоинты на реальном устройстве.
2. Прогнать PII inventory-gate отдельно в контролируемом окружении (с восстановлением `reports/code-review/pii-tracked-inventory.json`).
3. При появлении `errors.jsonl` — убедиться, что страница корректно реагирует (код читает `persistedErrorsAvailable` только при `status=ok`).
4. Рассмотреть отдельную задачу API-расширения (R-1/R-2 из UI-7.1.0), после чего добавить per-record причины и списки конфликтов.
