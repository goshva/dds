# API-3.3.2-MAP — карта API и подготовка интеграции Forecast

**Дата:** 2026-11-28 · **Режим:** только чтение (аудит; код, тесты и данные не изменялись)

---

## 1. Executive summary

Проведён аудит backend-маршрутов Hono, frontend-потребителей и DTO. Зарегистрировано **10 GET-endpoint'ов**; frontend реально использует **6**; **4** реализованы и не используются приложением (`/api/health`, `/api/v1/forecasts`, `/api/v1/shadow/reconciliations`, `/api/v1/shadow/monitor`). Обнаружено **5 избыточных запросов** на каждый рендер не-overview страницы. Для будущей страницы Forecast достаточны существующие DTO: список прогнозов — `/api/v1/forecasts`, сверка с фактом — `/api/v1/shadow/reconciliations`; объединять их нельзя. Новых API не требуется; ограничения задокументированы.

**Статус: `READY_WITH_LIMITATIONS`** — страница реализуема, но факт и ошибки доступны только для сверенного подмножества, а provenance — только у снапшотов.

## 2. Проверенный Git baseline (FACT)

| Проверка | Значение |
|---|---|
| HEAD / origin/main | `db928062b2464d26d14ea9df4c988c332c8ece9b` (совпадает) |
| Branch | `main` |
| staged / unstaged / untracked | 0 / 1 / 0 (изменён один файл — см. отчёт этапа; коду не принадлежит) |
| Git-операции | не выполнялись |

## 3. Backend API inventory (FACT)

Файл регистрации: `src/server/routes.ts` (127 строк), `export const apiRoutes = new Hono()` (строка 8).

| Метод | Endpoint | Строка | Handler (read-model) | Источник | Query | DTO ответа |
|---|---|---|---|---|---|---|
| GET | `/api/health` | 10 | инлайн | manifest/CSV | — | `{ status, checksums, source }` |
| GET | `/api/v1/overview` | 14 | `overviewModel` (`read-models.ts:341`) | canonical CSV + shadow JSONL | — | `OverviewModel` |
| GET | `/api/v1/history` | 24 | `historyModel` (`:77`) | canonical CSV | `from`, `to`, `limit` | `HistoryModel` |
| GET | `/api/v1/history/coverage` | 36 | `coverageModel` (`:162`) | canonical CSV | — | `CoverageModel` |
| GET | `/api/v1/shadow/forecasts` | 46 | `shadowForecastsModel` (`:230`) | shadow JSONL | `horizon`, `mode`, `limit` | `ShadowForecastsModel` |
| GET | `/api/v1/shadow/reconciliations` | 56 | `reconciliationsModel` (`:293`) | shadow JSONL | `mode`, `horizon`, `limit` | `ReconciliationModel` + `mode`, `unknownSnapshots` |
| GET | `/api/v1/shadow/monitor` | 66 | `monitorModel` (`:324`) | shadow JSONL | — | `MonitorReport` |
| GET | `/api/v1/forecasts/quality` | 76 | `forecastsQualityModel` (`forecasting-read-models.ts:147`) | shadow JSONL + canonical CSV | `mode` (обяз.), `horizon` (обяз.), `paired` | `ForecastsQualityDto` |
| GET | `/api/v1/forecasts` | 90 | `forecastsListModel` (`:194`) | shadow JSONL | `mode` (обяз.), `horizon` (обяз.), `model`, `limit` | `ForecastsListDto` |
| GET | `/api/v1/forecasts/errors` | 106 | `forecastErrorsModel` (`:227`) | shadow JSONL (детекция) | `mode` (обяз.), `code`, `limit` | `ForecastsErrorsDto` |
| * | `/api/*` (catch-all) | 122 | 405-обработчик | — | — | `{ status: "error", … }` |

Валидация и защита (FACT):

- `api.ts` (55 строк): `ok()`, `notAvailable()`, `fail()` — единый envelope `{ status: "ok" | "not_available" | "error", data, meta }`;
- `app.ts` (81): allowlist Origin — `http://127.0.0.1:5173`, `http://localhost:5173` (строки 8–9); same-origin допускается только при точном совпадении с `Host` (loopback); `null` и мусорный origin отклоняются (строки 25–38); при нарушении — `ORIGIN_NOT_ALLOWED` (строка 61);
- изменяющие методы запрещены catch-all'ом `apiRoutes[method]("/api/*")` (строка 122);
- неизвестные query-параметры валидируются парсерами `parseEvaluationMode`, `parseEvaluationHorizon`, `parseOptionalModel`, `parseLimit`; некорректные значения → `INVALID_QUERY` (400).

## 4. Frontend API usage (FACT)

Единственный HTTP-клиент — `src/web/api/client.ts:38` (`fetch`); других `fetch` в `src/web/**` нет (FACT). Реальные вызовы — 8 точек в `src/web/app-render.ts`:

| Endpoint | Frontend-файл:строка | Страница | Параметры | DTO фронта |
|---|---|---|---|---|
| `/api/v1/overview` | `app-render.ts:103` | все, кроме Forecast | — | `Overview` (локальный интерфейс) |
| `/api/v1/forecasts/quality` | `app-render.ts:109` | forecast-quality | `mode`, `horizon` | `QualityDto` |
| `/api/v1/forecasts/quality` | `app-render.ts:122` | forecast-diagnostics | `mode`, `horizon` | `QualityDto` |
| `/api/v1/forecasts/errors` | `app-render.ts:123` | forecast-diagnostics | `mode` | `ForecastErrorsDto` |
| `/api/v1/history` | `app-render.ts:143` | history/quality/provenance/overview | `limit: 1000`, `from`, `to` | `HistoryDto` |
| `/api/v1/history/coverage` | `app-render.ts:144` | history/quality/provenance/overview | — | `CoverageDto` |
| `/api/v1/history` | `app-render.ts:145` | history/quality/provenance/overview | `limit: 1000` | `HistoryDto` |
| `/api/v1/shadow/forecasts` | `app-render.ts:146` | history/quality/provenance/overview | `limit: 20` | `ShadowForecasts` |

Категории:

1. **Реализован и используется (6):** `/api/v1/overview`, `/api/v1/history`, `/api/v1/history/coverage`, `/api/v1/shadow/forecasts`, `/api/v1/forecasts/quality`, `/api/v1/forecasts/errors`.
2. **Реализован, не используется (4):** `/api/health`, `/api/v1/forecasts`, `/api/v1/shadow/reconciliations`, `/api/v1/shadow/monitor`.
3. **Используется частично (2):** `/api/v1/shadow/forecasts` (только `limit=20`, режим не передаётся), `/api/v1/forecasts/quality` (параметр `paired` не используется).
4. **Отсутствует/не подтверждён:** нет.

Маршрут `#forecast/<mode>/<horizon>` существует, но на этапе 3.3.2.1 отдаёт placeholder `NOT_IMPLEMENTED` **без запросов** (FACT, тест `tests/web/app-render.test.ts:107`).

## 5. DTO contract matrix (FACT)

| Backend DTO | Поля, используемые frontend | Поля, не используемые | Совпадение |
|---|---|---|---|
| `ForecastItemDto` (`forecasting-read-models.ts:46`) | — (страница не реализована) | все 12 | нет потребителя |
| `ForecastsListDto` (`:61`) | — | `mode`, `horizon`, `total`, `returned`, `items`, `provenance` | нет потребителя |
| `ForecastProvenanceDto` (`:16`) | частично через `QualityDto.provenance` | `datasetChecksums`, `datasetVersionWarning`, `manifestStatus`, `manifestDatasetChecksum`, `freshness`, `shadowFileChecksums` | частично |
| `ForecastsQualityDto` (`:30`) | `independentMetrics`, `pairedComparison`, `metricDiagnostics`, `sampleStatus`, `interpretabilityStatus`, `warnings`, `availability` | `pairCounters`, `technicalFactCutoff`, `semantics`, `provenance` | используется |
| `ForecastErrorsDto` (`:78`) | `mode`, `total`, `persistedErrorsAvailable`, `items` | — | используется |
| `HistoryModel` / `CoverageModel` | полностью в соответствующих страницах | — | используется |
| `ShadowForecastsModel` | `items` (6 последних), `totals`, `manifestStatus` | `errorsByMode` | частично |
| `ReconciliationModel` (`read-models.ts:288`) | — | `total`, `items`, `mode`, `unknownSnapshots` | нет потребителя |

Ключевые nullable-поля, требующие осторожности: `forecastValue: number | null` (NULL ≠ 0), `manifestDatasetChecksum: string | null`, `technicalFactCutoff: string | null`, `snapshotId: string | null` в ошибках.

## 6. Forecast API deep dive (FACT)

### 6.1 `/api/v1/forecasts` (`routes.ts:90`, `forecastsListModel:194`)

`mode` и `horizon` обязательны (`replay|shadow`, `1|3`); `model` — необязательный, ограничен серверным allowlist; `limit` — целое 1..1000, по умолчанию **200**. Возвращаются **последние** N записей выборки (`scoped.slice(-limit)`), `total` — полный размер выборки, `returned` — фактически возвращено. Пустая выборка → `not_available` с кодом `NO_RECORDS_FOR_MODE_AND_HORIZON`. `meta.checksum` = `provenance.shadowFileChecksums.forecasts` либо `NOT_AVAILABLE`.

`ForecastItemDto`: `snapshotId, mode, modelId, modelVersion, variant|null, horizon, originDate, targetDate, forecastValue|null, status, inputDataVersion, generatedAt`. **Нет** `actual`, ошибок, per-record checksum, target metric, p10/p90.

**Вывод:** для таблицы снапшотов DTO достаточно (дата формирования/прогноза, модель, версия, вариант, прогноз, статус, версия входных данных). Для колонок «факт» и «ошибка» — недостаточно.

### 6.2 `/api/v1/forecasts/quality` (`routes.ts:76`, `forecastsQualityModel:147`)

`mode`, `horizon` обязательны; `paired` — необязательный boolean. Поля: `independentMetrics`, `pairedComparison`, `pairCounters`, `metricDiagnostics`, `sampleStatus` (`COMPLETE|PARTIAL|NOT_AVAILABLE`), `interpretabilityStatus` (`NOT_AVAILABLE|INSUFFICIENT|LIMITED|NOT_ASSESSED`), `warnings`, `provenance`, `availability`, `semantics: "PROVISIONAL"`, `technicalFactCutoff`. Назначение: KPI (независимые метрики), таблица парного сравнения, диагностика метрик; графики не предусмотрены DTO. Пересчёт на frontend запрещён.

### 6.3 `/api/v1/shadow/reconciliations` (`routes.ts:56`, `reconciliationsModel:293`)

`mode` — по умолчанию `shadow`, допустимы `shadow|replay`; `horizon` — необязательный `1|3`; `limit` — по умолчанию **60**. Реконсиляции без известного снапшота исключаются и учитываются в `unknownSnapshots`. Записи: `snapshotId, modelId, horizon, targetDate, forecastValue|null, actual, absoluteError, signedError`.

**Ограничения для таблицы сверки:** нет `originDate`, `inputDataVersion`, `modelVersion`, `variant`, `status` — то есть строки сверки нельзя однозначно связать со снапшотами по ключам, кроме `snapshotId`; provenance отсутствует (доступны только `meta.source`/`meta.note`); возвращаются последние N записей.

### 6.4 `/api/v1/forecasts/errors` (`routes.ts:106`, `forecastErrorsModel:227`)

`mode` обязателен (режимный охват, **фильтра по горизонту нет**), `code` и `limit` необязательны. Записи: `source` (`persisted|detected`), `kind`, `snapshotId|null`, `recordType` (`snapshot|reconciliation|file`), `reason`. `persistedErrorsAvailable` обычно `false`: endpoint отдаёт **вычисляемую** диагностику, а не хранилище ошибок. Отсутствие записей не означает отсутствие ошибок.

## 7. Unused API (FACT)

| Endpoint | Почему не используется | Потенциал |
|---|---|---|
| `/api/health` | приложение не показывает health отдельно (использует `overview.meta`) | индикатор доступности источника |
| `/api/v1/forecasts` | страница Forecast не реализована | основной источник блока «Прогнозы моделей» |
| `/api/v1/shadow/reconciliations` | нет потребителя | единственный источник факта и ошибок |
| `/api/v1/shadow/monitor` | нет потребителя | мониторинг теневого режима (вне scope 3.3.2.2) |

## 8. Redundant requests (FACT + INFERENCE)

`renderApp()` после `forecast`-ветки всегда выполняет `/api/v1/overview` (строка 103), а затем блок `Promise.all` (строки 143–146) из **четырёх** запросов для всех «остальных» страниц.

| Страница | Запросы | Используются | Избыточные |
|---|---|---|---|
| Overview | overview + history(range), coverage, fullHistory, shadow | overview, history, shadow | coverage (1) |
| History | + те же 4 | overview, history(range), coverage | fullHistory, shadow (2) |
| Quality (данные) | + те же 4 | overview, coverage, fullHistory | history(range), shadow (2) |
| Provenance | + те же 4 | overview | history(range), coverage, fullHistory, shadow (4) |
| Forecast quality | overview + quality | overview, quality | — |
| Forecast diagnostics | overview + quality + errors | overview, quality, errors | — |
| Forecast (placeholder) | нет | — | — (уже исправлено в HARDENING) |

**Итого 9 избыточных запросов** распределены по 4 страницам (1+2+2+4). Влияние (INFERENCE): лишние чтения CSV/JSONL, рост времени открытия Provision/Quality, лишние записи в логах; ошибки неиспользуемых запросов могут переводить блок в `not_available` без необходимости. **Рекомендации (не выполнялись):** строить набор запросов по странице, а не единым `Promise.all`; вынести `shadow/forecasts` только в Overview, `fullHistory` — только в Quality; рассмотреть `/api/health` вместо `overview` для статуса источника.

## 9. Data availability limitations (FACT + INFERENCE)

1. **Факт и ошибки** — только для сверенных записей и только через `/shadow/reconciliations`; «все прогнозы с фактом» получить нельзя (FACT).
2. **Provenance** — только у снапшотов и качества; сверкам checksum/freshness приписывать нельзя (FACT).
3. **Фильтр по датам и пагинация** — отсутствуют; сервер отдаёт последние N (FACT).
4. **Выбор модели** — только значения из серверного allowlist; иначе `INVALID_QUERY` (FACT).
5. **p10/p90, доверительные интервалы, h7/h14, финансовые эффекты, per-record eligibility reasons** — в API отсутствуют (FACT).
6. **`unknownSnapshots > 0`** — сигнал о неполноте сверки, должен отображаться (INFERENCE).
7. **Per-record checksum** отсутствует → построчное сопоставление версий данных невозможно (FACT).

## 10. Forecast integration blueprint (INFERENCE)

| Блок | Endpoint | Обязательные параметры | Независимость | Loading | Empty / not_available | Error | Ограничения |
|---|---|---|---|---|---|---|---|
| Снапшоты прогнозов | `/api/v1/forecasts` | `mode`, `horizon` | отдельный запрос | `loadingState` | `NO_RECORDS_FOR_MODE_AND_HORIZON` | `errorState` | последние 200; без факта/ошибок |
| Сверка с фактом | `/api/v1/shadow/reconciliations` | `mode`, `horizon` | отдельный запрос | `loadingState` | `NO_RECONCILIATIONS` | `errorState` | подмножество; `unknownSnapshots` |
| Провенанс | поле `provenance` ответа снапшотов | — | вместе со снапшотами | — | `NOT_AVAILABLE` | — | не переносится на сверки |
| Переходы | `#forecast-quality/<mode>/<horizon>`, `#forecast-diagnostics/<mode>/<horizon>` | — | — | — | — | — | существующие маршруты |

Блоку «Качество моделей» отдельный запрос на странице Forecast **не требуется**: метрики вынесены на `#forecast-quality`. Диагностика — на `#forecast-diagnostics`. Недостающие поля перечислены в разделе 9; новых API не предлагается, пробелы фиксируются как ограничения.

## 11. Test coverage (FACT)

| Файл | Строк | Покрытие |
|---|---:|---|
| `tests/server/api.test.ts` | 115 | envelope, базовые маршруты |
| `tests/server/hardening.test.ts` | 556 | Origin/Host, 405, некорректные query, даты |
| `tests/server/forecasting-read-models.test.ts` | 214 | парсеры mode/horizon/model/limit, DTO прогнозов |
| `tests/server/forecast-evaluation.test.ts` | 795 | расчёты оценки (backend) |
| `tests/server/ui-3.test.ts` | 135 | read-model данных |
| `tests/web/app-render.test.ts` | 154 | dispatch, отсутствие запросов для Forecast |
| `tests/web/forecast-quality.test.ts` | 223 | страница качества |
| `tests/web/ui-7-1-1-forecast-diagnostics.test.ts` | 230 | диагностика |
| `tests/web/api-client.test.ts` | 64 | клиент, таймаут, `INVALID_RESPONSE` |
| прочие (`history`, `forecast-routing`, `ui-3`, `ui`, `ui-7-0-1-routing`, `reference-generation`, `templates-partials`) | 1 172 | страницы, маршруты, эталоны |

Пробелы (INFERENCE): нет тестов, фиксирующих **соответствие** frontend-вызовов backend-маршрутам; нет тестов использования `/api/v1/forecasts`, `/shadow/reconciliations`, `/shadow/monitor` со стороны UI (страница не реализована). Список необходимых тестов для 3.3.2.2: независимая загрузка двух блоков, `not_available` обоих кодов, `unknownSnapshots > 0`, NULL vs 0, provenance только снапшотов, отсутствие запросов при некорректном маршруте.

## 12. Risks and blockers

| Приоритет | Риск | Влияние |
|---|---|---|
| P1 | Факт/ошибки только через сверки (подмножество, другие ключи) | нельзя показать «полную» таблицу прогноз+факт; требуется явная пометка |
| P1 | Нет серверного фильтра дат/пагинации | UI может показать только последние N записей |
| P2 | 9 избыточных запросов | latency, лишняя нагрузка, ложные `not_available` |
| P2 | `model`-allowlist | селектор моделей может давать `INVALID_QUERY` |
| P2 | `/shadow/monitor` и `/api/health` не используются | функциональность мониторинга недоступна пользователю |
| P3 | Ошибки: `persisted` vs `detected` легко спутать | неверная интерпретация диагностики |

**Блокеров реализации нет** (FACT): все четыре Forecast-endpoint'а зарегистрированы и покрыты серверными тестами.

## 13. Recommended implementation sequence

1. Блок снапшотов (`/forecasts`) — таблица + provenance + состояния (без факта/ошибок).
2. Блок сверок (`/shadow/reconciliations`) — независимый запрос, `unknownSnapshots`, факт и ошибки из backend.
3. Независимые loading/error/empty каждого блока (без общего счётчика запросов).
4. Переходы на `#forecast-quality/<mode>/<horizon>` и `#forecast-diagnostics/<mode>/<horizon>`.
5. Тесты (список в разделе 11), эталонная страница, браузерная проверка.
6. Отдельным согласованием (при необходимости): серверный фильтр дат/пагинация, per-record checksum — как новый API-контракт, вне текущего scope.

## 14. Final audit

- Backend: 10 маршрутов + catch-all; изменяющие методы запрещены; Origin allowlist активен (FACT).
- Frontend: 1 HTTP-клиент, 8 вызовов, 6 используемых endpoint'ов, 4 неиспользуемых (FACT).
- DTO: 8 структур проверено по исходникам; расхождений «frontend ожидает поле, которого нет» для существующих страниц не найдено (FACT).
- Forecast API: 4 endpoint'а описаны; ограничения зафиксированы (FACT).
- Изменений кода, тестов, DTO, read-models, API, Vite-конфигурации и данных не вносилось; Git-операции не выполнялись (FACT).
