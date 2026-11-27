# FINAL-1 — preflight-аудит и карта возможностей

**Дата:** 2026-11-27 · **Режим:** только чтение (изменений кода нет; создан только этот отчёт)
**HEAD:** `9a6f9fdb13178352aa25a0584003aeab27425566` («see proto ok») · **origin/main:** тот же · **Ветка:** `main`

---

## 1. FACT — состояние Git

| Проверка | Значение |
|---|---|
| staged / unstaged / untracked | **0 / 0 / 0** — рабочее дерево чистое |
| `git diff --stat c162612..HEAD` | 59 файлов, 2 458 вставок / 6 419 удалений |
| Изменения по областям | `docs/ui` 29 · `src/web` 23 · `tests/web` 2 · `tools/reference` 2 · `diff.txt` 1 · `start-dss.sh` 1 · артефакт `-files --others --exclude-standard` 1 |
| Коммит `9a6f9fd` | включает всю работу TPL-1…TPL-4.5 (документы, README шаблонов, тесты, перегенерированные эталоны, удаление 22 legacy partials) и новый `start-dss.sh` |
| `diff.txt` | отслеживается; в коммите удалено 5 616 строк (артефакт перезаписан внешним процессом) |
| Локальные артефакты | `-files --others --exclude-standard` закоммичен как файл (артефакт прежних shell-команд) |

Все предыдущие staged/unstaged/untracked изменения зафиксированы внешним процессом; незакоммиченных изменений нет. Git-операции этим этапом не выполнялись.

## 2. FACT — фактическая архитектура

| Слой | Состав |
|---|---|
| Маршрутизация | `src/web/routing.ts`: 6 страниц — `overview`, `history`, `quality`, `provenance`, `forecast-quality`, `forecast-diagnostics`; диапазоны `all/30/90/180/365/custom` |
| Точка входа | `src/web/main.ts` (композиция обзора, загрузка данных, состояния) |
| Страницы | `src/web/pages/`: `history.ts` (104), `data-quality.ts` (72), `provenance.ts` (72), `forecast-quality.ts` (172), `forecast-diagnostics.ts` (**348**) |
| Компоненты | `src/web/components/` (6 модулей, до 84 строк): `shell`, `cards`, `charts`, `data`, `states`, `index` |
| Форматирование и безопасность | `src/web/lib/format.ts` (85 строк): `escapeHtml`, `trusted`, `TrustedHtml`, `safeHref`, `isSafeHref`, `statusClass`, `statusLabel`, `formatNumber`, `formatPercent`, `formatDate`, `DssStatus` |
| API | `src/server/routes.ts`: 10 GET endpoints |
| Read-model | `src/server/services/`: `read-models.ts`, `forecasting-read-models.ts` |
| Источники | `src/server/sources.ts`: canonical CSV, shadow JSONL, manifest (fail-closed) |
| Эталоны | `tools/reference/` (10 модулей) → `docs/ui/reference/` (6 страниц, детерминированная генерация) |
| Тесты | `tests/web` 8 файлов, `tests/server` 5 файлов |
| Скрипты | `api:start`, `ui:dev`, `ui:build`, `ui:test`, `forecast:test`; новый `start-dss.sh` (113 строк) |

### API endpoints (FACT)

`/api/health` · `/api/v1/overview` · `/api/v1/history` · `/api/v1/history/coverage` · `/api/v1/shadow/forecasts` · `/api/v1/shadow/reconciliations` · `/api/v1/shadow/monitor` · `/api/v1/forecasts/quality` · `/api/v1/forecasts` · `/api/v1/forecasts/errors`

### Потребители API во frontend (FACT)

| Endpoint | Потребитель |
|---|---|
| `/api/v1/overview` | `main.ts` |
| `/api/v1/history` | `main.ts` |
| `/api/v1/history/coverage` | `main.ts` |
| `/api/v1/shadow/forecasts` | `main.ts` (секция обзора) |
| `/api/v1/forecasts/quality` | `main.ts` (страница прогнозов и качества) |
| `/api/v1/forecasts/errors` | `main.ts` (диагностика) |
| `/api/v1/forecasts` | **не потребляется** |
| `/api/v1/shadow/reconciliations` | **не потребляется** |
| `/api/v1/shadow/monitor` | **не потребляется** |
| `/api/health` | используется клиентом для статуса источника |

### Состояния интерфейса (FACT)

| Файл | Обработанные состояния |
|---|---|
| `main.ts` | 15 вхождений блоков состояний: загрузка, пустота, ошибка, недоступность, некорректный диапазон |
| `forecast-diagnostics.ts` | `loadingState`, `emptyState`, `errorState`, `forecastDiagnosticsLoading`, `forecastDiagnosticsInvalid`, `not_available` |
| `history.ts` | `emptyState`, `[Н/Д]` для отсутствующих значений |
| `data-quality.ts`, `provenance.ts`, `forecast-quality.ts` | текст `not_available` в ограничениях (без собственных компонентов состояний) |

## 3. CLAIM (из документации, требует проверки при реализации)

- UI-7.1.0/UI-7.1.1: маршрут `#forecast-diagnostics/<mode>/<horizon>` и разделение диагностики по режимам — **косвенно подтверждено** наличием `diagnosticsParams`, страницы и теста `ui-7-1-1-forecast-diagnostics.test.ts` (230 строк).
- Ограничения оценки моделей «h1/h3 — ACCEPT FOR SHADOW MODE, h7/h14 — NEEDS MORE VALIDATION» — из документов; в коде поддержаны только горизонты 1 и 3 (`SUPPORTED_HORIZONS`), h7/h14 отсутствуют.
- «Production readiness не подтверждена», семантика `qty_orders_delivered`/`delivered_orders_daily` — `PROVISIONAL` — соответствует бейджам и текстам страниц.
- `persistedErrorsAvailable=false`, `meta.generatedAt` — время ответа, checksum-предупреждения — соответствуют реализации read-model (проверено ранее в TPL-4.1/4.2, в этом этапе код не перечитывался построчно).

## 4. INFERENCE — карта возможностей и пробелы

| Целевая страница | Состояние | Пробелы для FINAL |
|---|---|---|
| **Overview** | реализован: KPI истории, секция теневого режима, актуальность источника, график истории, таблица наблюдений, календарь полноты | нет KPI «прогноз на ближайший горизонт» и «статус качества прогноза»; график не содержит прогнозной части и границы «факт/прогноз»; нет переходов из KPI с сохранением фильтров |
| **History** | реализован: диапазоны, KPI периода, график с разрывом линии, таблица, формулы, `[Н/Д]` | нет отдельного индикатора полноты в шапке (есть на «Качестве данных»); таблица ограничена 60 строками без постраничности |
| **Forecast (список прогнозов)** | **страницы нет**; endpoint `/api/v1/forecasts` существует и не потребляется | требуется завершить/создать страницу: режимы `replay/shadow`, горизонты h1/h3, модели из данных, прогнозные значения, факт, статус сопоставления, версия модели и входных данных, предупреждения о checksum |
| **Качество прогноза** | реализован (172 строки): независимые метрики, парное сравнение, интерпретируемость, диагностика метрик | нет явного периода оценки; статусы ограничены существующим DTO |
| **Диагностика прогноза** | реализован (348 строк, **нарушает правило 200 строк**): режим/горизонт, качество, диагностические записи, провенанс, состояния | требуется декомпозиция файла; проверка, что ограничения API (`persistedErrorsAvailable`, режимный охват) показаны точно |
| **Теневой режим** | частично: секция на обзоре (`/shadow/forecasts`), данные о pending/reconciled | `/shadow/reconciliations` и `/shadow/monitor` не отображаются; нет отдельного представления мониторинга и статуса checksum |
| **Качество данных и происхождение** | реализованы | без существенных пробелов; согласование формулировок с FINAL-требованиями |

**API-пробелы (FACT/INFERENCE):**
1. Per-record `EligibilityReason` и полные списки конфликтов — в API отсутствуют → отображать нельзя (ограничение, не пробел реализации).
2. p10/p90 и доверительные интервалы — в API отсутствуют → **не отображать**.
3. h7/h14 — не поддерживаются → не показывать.
4. Реконсиляции и мониторинг доступны по API, но не имеют потребителя → требуется страница/секция.
5. Финансовые показатели отсутствуют → не выводить.

**Соответствие ограничениям стека:** React/Vue/новые фреймворки не используются; SQLite — только серверная; HTML формируют TypeScript-компоненты; `lib/format.ts` — единственная точка экранирования; генерация эталонов — `tools/reference/`.

## 5. NOT_VERIFIED

- фактическая визуальная отрисовка текущего HEAD в браузере (в этом этапе браузер не запускался);
- полнота данных, возвращаемых `/api/v1/forecasts`, `/shadow/reconciliations`, `/shadow/monitor` на реальном хранилище (endpoints не вызывались: это отдельные read-only проверки, запланированные в FINAL-3/FINAL-4);
- актуальность ограничений UI-7.1.0/7.1.1 в части, не покрытой тестами;
- влияние нового `start-dss.sh` на сценарии запуска (файл не изучался построчно).

## 6. Предлагаемый объём работ

| Этап | Содержание | Затрагиваемые файлы (план) |
|---|---|---|
| FINAL-2 | History: полнота в шапке, периоды, мобильные таблицы, состояния | `src/web/pages/history.ts`, `src/web/main.ts`, тесты |
| FINAL-3 | Forecast: новая страница списка прогнозов (режим/горизонт/модель/факт/сопоставление/версии) + график «факт + прогноз» с границей | `src/web/pages/forecast.ts` (новый), `src/web/routing.ts` (маршрут `forecast` через существующий allowlist-механизм), `src/web/main.ts`, тесты |
| FINAL-4 | Quality/Diagnostics: декомпозиция `forecast-diagnostics.ts` (< 200 строк), точные статусы и ограничения API | `src/web/pages/forecast-diagnostics.ts` (+ выделенные части), тесты |
| FINAL-5 | секция теневого режима: реконсиляции и мониторинг, KPI-переходы, согласованность, адаптивность | `src/web/main.ts`, `src/web/pages/*`, `src/web/components/*` (без новых зависимостей) |
| FINAL-6 | Финальный аудит: тесты, tsc, build, генерация эталонов, PII gate, браузерные проверки 6 ширин | отчёт |

Ограничения для всех этапов: не менять прогнозную математику, API-контракты без доказанной необходимости, JSONL/SQLite и данные; файлы ≤ 200 строк; состояния loading/empty/error/not_available обязательны; факт и прогноз визуально различимы; NULL не превращается в 0; `PROVISIONAL` сохраняется.

## 7. Рекомендация

**Готов к FINAL-2** (`READY_WITH_LIMITATIONS`).

Условия и известные ограничения:

- рабочее дерево чистое, конфликтов с внешними изменениями нет — можно начинать реализацию;
- `forecast-diagnostics.ts` (348 строк) превышает проектное правило и должен быть декомпозирован в FINAL-4;
- страница Forecast отсутствует и требует создания маршрута; при этом `/api/v1/forecasts` уже реализован, то есть API-пробела нет;
- реконсиляции и мониторинг теневого режима доступны по API, но не отображаются — это работа FINAL-5;
- p10/p90, h7/h14, per-record причины исключения и финансовые показатели в API отсутствуют и не должны появляться в интерфейсе.

**Остановка: FINAL-1 завершён, реализация не начата; ожидается разрешение на FINAL-2.**
