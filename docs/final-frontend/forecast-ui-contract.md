# FINAL-3.2 — UI-контракт страницы «Прогноз»

**Дата:** 2026-11-27 · **Режим:** проектирование, production-код не изменялся · **Проект:** `goshva/dds`

---

## 1. Executive summary

Спроектирована страница «Прогноз» с **двумя независимыми источниками данных**, которые не объединяются в одну таблицу:

1. **Прогнозные снапшоты** — `GET /api/v1/forecasts` (что предсказано, кем, по какой версии данных);
2. **Сверенные результаты** — `GET /api/v1/shadow/reconciliations` (для каких снапшотов доступна сверка с фактом; факт и ошибки вычислены backend).

Ключевые решения: единый `mode`/`horizon` на всю страницу; URL `#forecast/<mode>/<horizon>` без изменения грамматики маршрутизации; независимые состояния блоков; график **не включается**; селектор моделей и фильтр дат **не создаются**; метрики и финансовые выводы отсутствуют.

**Решение:** `READY_WITH_LIMITATIONS` — реализуемо в согласованном scope; ограничения зафиксированы в разделах 7, 10, 18.

## 2. Preflight (FACT)

| Проверка | Результат |
|---|---|
| HEAD | `9a6f9fdb13178352aa25a0584003aeab27425566` |
| origin/main | тот же коммит |
| Branch | `main` |
| Staged | 0 |
| Unstaged | 3 (`docs/ui/reference/pages/history.html`, `src/web/main.ts`, `src/web/pages/history.ts` — результаты FINAL-2/2.1) |
| Untracked | 6 (`docs/final-frontend/`, `tests/web/history.test.ts` и отчёты) |
| API contracts unchanged | да: `/api/v1/forecasts` (routes.ts:90) и `/api/v1/shadow/reconciliations` (routes.ts:56) на месте; `ForecastItemDto` — 12 полей; `ReconciliationModel` — на месте (`read-models.ts:288`) |
| Existing UI architecture unchanged | да: 6 маршрутов, 5 страниц, 6 модулей компонентов |
| External changes detected | нет; `diff.txt` отсутствует (удалён ранее внешним коммитом), не восстанавливался |
| Git-операции | не выполнялись |

## 3. API source mapping

| | Источник №1 | Источник №2 |
|---|---|---|
| Endpoint | `GET /api/v1/forecasts` | `GET /api/v1/shadow/reconciliations` |
| Смысл | созданные прогнозные снапшоты | снапшоты, для которых есть сверка с фактом |
| Параметры | `mode` (обяз.), `horizon` (обяз.), `model` (опц., allowlist), `limit` 1..1000 (по умолч. 200) | `mode` (по умолч. `shadow`), `horizon` (опц., 1|3), `limit` (по умолч. 60) |
| Порядок | последние N записей выборки | последние N записей |
| Полный размер | `total` | `total`; исключённые сверки — `unknownSnapshots` |
| Поля записи | `snapshotId, mode, modelId, modelVersion, variant|null, horizon, originDate, targetDate, forecastValue|null, status, inputDataVersion, generatedAt` | `snapshotId, modelId, horizon, targetDate, forecastValue|null, actual, absoluteError, signedError` |
| Факт | отсутствует | `actual` |
| Ошибки | отсутствуют | `absoluteError`, `signedError` (вычислены backend) |
| Provenance | `provenance: ForecastProvenanceDto` + `meta.checksum` (только фактические поля) | собственного provenance нет: выводятся только `meta.source` и `meta.note` (при наличии); checksum и freshness сверкам не приписываются |
| Пустая выборка | `not_available`, код `NO_RECORDS_FOR_MODE_AND_HORIZON` | при отсутствии сверок — `not_available` (`NO_RECONCILIATIONS`) |

## 4. Data separation

Источники **нельзя объединять**, потому что:

1. Состав записей различается: снапшоты содержат все прогнозы, сверки — только подмножество с готовым фактом.
2. Гарантии доступности различаются: реконсиляции могут отсутствовать при наличии прогнозов и наоборот.
3. Уровень provenance различается: у снапшотов есть проверка версий датасета, у сверок — нет.
4. Объединение по `snapshotId` на frontend создало бы иллюзию, что каждый прогноз уже сверен, и потребовало бы сопоставления, которого API не подтверждает.
5. Ключи сопоставления (mode/horizon/origin/target/inputDataVersion) выведены быть не могут: `originDate`, `inputDataVersion` в сверках отсутствуют.

Следствие: два блока с собственными заголовками, подзаголовками и состояниями; строки одного блока никогда не попадают в другой.

## 5. Информационная архитектура страницы

```text
Оболочка приложения (sidebar, topbar)
└── Заголовок страницы: «Прогноз»
    ├── 1. Переключатели: Replay | Shadow, h1 | h3
    ├── 2. Статус параметров: mode, horizon, источник данных, PROVISIONAL
    ├── 3. Блок «Прогнозные снапшоты» (GET /api/v1/forecasts)
    │      сводка: total, returned, диапазон загруженных прогнозов (не полная история)
    │      таблица: Target date | Origin date | Forecast | Model | Version | Status
    │      детали записи: snapshotId, inputDataVersion, generatedAt, variant
    ├── 4. Блок «Сверенные результаты» (GET /api/v1/shadow/reconciliations)
    │      сводка: total, shown, unknownSnapshots
    │      таблица: Target date | Model | Forecast | Actual | Absolute error | Signed error
    ├── 5. Provenance: freshness, manifestStatus, datasetVersionWarning,
    │      manifestDatasetChecksum, datasetChecksums, shadowFileChecksums
    ├── 6. Переходы: «Качество прогнозов» → #forecast-quality/<mode>/<horizon>,
    │      «Диагностика прогнозирования» → #forecast-diagnostics/<mode>/<horizon>
    └── 7. Семантика и ограничения: qty_orders_delivered, PROVISIONAL, Shadow — изолированный режим
```

## 6. URL contract

**Формат:** `#forecast/<mode>/<horizon>`

| Сегмент | Значения | Обязательность |
|---|---|---|
| 1 | `forecast` | обязателен (иначе маршрут не распознан) |
| 2 | `replay`, `shadow` | обязателен в каноническом виде |
| 3 | `1`, `3` | обязателен в каноническом виде |

**Совместимость с `routing.ts` (FACT):** `parseHash` разбирает hash как `[page, range, from, to]` (`routing.ts:47`), поэтому `#forecast/<mode>/<horizon>` ложится в существующую грамматику без новой схемы: `range` = mode, `from` = horizon — тот же приём, что уже применён к `#forecast-quality/<mode>/<horizon>` и `#forecast-diagnostics/<mode>/<horizon>`.

Поведение:

| Ситуация | Поведение |
|---|---|
| Пустой hash / неизвестная страница | существующий fallback `DEFAULT_PAGE` (`history`) — не изменяется |
| `#forecast` без сегментов | нормализация в `#forecast/replay/1` через `window.location.replace` (без записи в историю) |
| Неизвестный mode (например, `production`) | нормализация в `#forecast/replay/1`; в API такие значения не уходят |
| Неизвестный horizon (2, 7, 14, `x`) | нормализация в `#forecast/replay/1` |
| Лишние сегменты (`#forecast/shadow/3/extra`) | игнорируются при разборе, hash переписывается в канонический |
| Верхний регистр (`#forecast/SHADOW/1`) | нормализация в нижний регистр |
| back/forward | обрабатываются существующим `hashchange`; состояние восстанавливается только из URL |
| reload | состояние полностью восстанавливается из hash; запросы выполняются заново |

Нормализация выполняется чистой функцией в `routing.ts` (например, `normalizeForecastParams`) и покрывается тестами; скрытого переключения режима при ошибке API нет.

## 7. Data contracts (view models)

```ts
// Источник №1 — снапшоты (поля 1:1 из ForecastItemDto, без добавлений)
type ForecastRowView = {
  snapshotId: string; mode: string; modelId: string; modelVersion: string;
  variant: string | null; horizon: number; originDate: string; targetDate: string;
  forecastValue: number | null; status: string; inputDataVersion: string; generatedAt: string;
};

// Источник №2 — сверки (поля 1:1 из ReconciliationModel.items)
type ReconciledRowView = {
  snapshotId: string; modelId: string; horizon: number; targetDate: string;
  forecastValue: number | null; actual: number; absoluteError: number; signedError: number;
};
```

Правила отображения:

| Значение | Отображение |
|---|---|
| `forecastValue = 0` | `0` |
| `forecastValue = null` | `Н/Д` |
| `actual = 0` | `0` |
| `absoluteError = 0` | `0` |
| `signedError < 0` | отрицательное число со знаком |
| `variant = null` | `—` (недоступен), не пустая строка |
| Дата | локальный формат `ДД.ММ.ГГГГ` через `formatDate` |
| Число | `formatNumber`; ошибки — с одним знаком после запятой |
| Длинный `snapshotId` / `modelId` / checksum | моноширинный текст с переносом (`word-break`), полное значение доступно без обрезки; в таблице — сокращение с доступом к полному значению в деталях |
| `status` | как пришло из API; устройство статусов не интерпретируется |

Запрещено: добавлять `actual`/`error` в снапшоты, вычислять ошибки, выводить «точность», средние, рейтинги моделей, проценты.

**Диапазон дат относится только к загруженной выборке.** Endpoint возвращает ограниченное число последних записей (`limit`), а не полную историю, поэтому подписи «Вся история», «Полный период прогнозирования», «История модели» запрещены. Допустимо: «Диапазон загруженных прогнозов», «Период в текущей выборке», «От … до … в загруженных записях». При отсутствии записей диапазон не показывается.

## 8. State contracts

Каждый блок имеет собственное состояние; состояние одного не влияет на другой.

| Состояние | Снапшоты | Сверенные результаты |
|---|---|---|
| LOADING | `loadingState`; прошлые строки не показываются | `loadingState`; независимо |
| OK | таблица + `returned`/`total` + provenance источника | таблица + `total` + `unknownSnapshots` |
| EMPTY | успешный ответ (`status = ok`) с пустым набором, если API его возвращает; **не подменяет** `not_available` | успешный ответ с `total = 0`; **не подменяет** `not_available` |
| NOT_AVAILABLE | API вернул `not_available`, код `NO_RECORDS_FOR_MODE_AND_HORIZON`: «для выбранных режима и горизонта прогнозов нет»; это не ошибка модели и не пустая выборка | API вернул `not_available`, код `NO_RECONCILIATIONS`: «сверок для выбранных параметров нет» |
| ERROR | безопасное сообщение + `eventId` (без stack trace) | то же |
| WARNING | `datasetVersionWarning`, `freshness = STALE/NOT_CONFIRMED`, `manifestStatus = CORRUPTED` | `unknownSnapshots > 0` — «исключено сверок без известного снапшота: N» |

Четыре обязательные комбинации:

| Снапшоты | Сверки | Ожидаемое поведение |
|---|---|---|
| OK | OK | оба блока с данными |
| OK | ERROR / NOT_AVAILABLE | список прогнозов остаётся доступным |
| ERROR / NOT_AVAILABLE | OK | блок сверок остаётся доступным |
| NOT_AVAILABLE | NOT_AVAILABLE | каждый блок показывает своё состояние, страница не «падает» |

**Защита от устаревших ответов (двухуровневая).**

*Уровень 1 — поколение выбора (selection generation).* Один идентификатор на всю страницу: увеличивается при смене `mode`, `horizon`, при переходе между маршрутами и любом изменении выбора. Ответы предыдущего поколения не применяются ни одним блоком.

*Уровень 2 — независимая последовательность запросов блока.* Отдельные счётчики `snapshotsRequestSeq` и `reconciliationsRequestSeq`: новый запрос увеличивает счётчик **только своего блока**, поэтому параллельные запросы двух блоков не инвалидируют друг друга.

```ts
let selectionGeneration = 0;
let snapshotsRequestSeq = 0;
let reconciliationsRequestSeq = 0;

function onSelectionChanged(): void {
  selectionGeneration++;          // старые ответы обоих блоков становятся неприменимы
}

async function loadSnapshots(params: Selection): Promise<void> {
  const generation = selectionGeneration;
  const requestId = ++snapshotsRequestSeq;      // счётчик только своего блока
  const result = await api.get<ForecastsListDto>("/api/v1/forecasts", params);
  if (generation !== selectionGeneration) return;        // сменился выбор страницы
  if (requestId !== snapshotsRequestSeq) return;         // у блока есть более новый запрос
  renderSnapshots(result);
}

async function loadReconciliations(params: Selection): Promise<void> {
  const generation = selectionGeneration;
  const requestId = ++reconciliationsRequestSeq; // независимый счётчик
  const result = await api.get<ReconciliationModel>("/api/v1/shadow/reconciliations", params);
  if (generation !== selectionGeneration) return;
  if (requestId !== reconciliationsRequestSeq) return;
  renderReconciliations(result);
}
```

Параллельный сценарий (обязательный): выбор не менялся; `loadSnapshots` и `loadReconciliations` запущены одновременно; каждый увеличил **свой** счётчик, поэтому ни один ответ не считается устаревшим; оба блока независимо переходят в OK; `generation` одинаков и равен текущему.

При смене `mode`/`horizon` оба блока немедленно переводятся в LOADING, их прежние данные удаляются, и generation увеличивается. Таймеры, polling, повторные запросы и сложная система отмены не добавляются.

## 9. Provenance

**Прогнозные снапшоты.** Проvenance берётся из соответствующего ответа: `provenance` (`freshness`, `manifestStatus`, `datasetVersionWarning`, `manifestDatasetChecksum`, `datasetChecksums`, `shadowFileChecksums`) и `meta.checksum`. Показываются только фактически предоставленные поля.

**Сверенные результаты.** Собственного provenance у ответа нет, поэтому выводятся только фактические поля ответа: `meta.source` и `meta.note` (второе — только при наличии). Жёстко задавать `shadow_jsonl` запрещено: endpoint поддерживает `mode=shadow` и `mode=replay`, источник определяется значением ответа. Если `meta.source` отсутствует или невалиден — нейтральная подпись «Источник не указан». Сверкам **не приписываются** checksum-проверка, `freshness` и любые утверждения о версии датасета: этих полей API не предоставляет.

Пометка в блоке сверок: «Источник: <значение meta.source>» либо «Источник не указан», и при наличии — `meta.note`.

| Значение | UI |
|---|---|
| `freshness = MATCH` | «Версия данных совпадает» |
| `freshness = STALE` | «Версия данных устарела относительно manifest» (WARNING) |
| `freshness = NOT_CONFIRMED` | «Версия данных не подтверждена» (WARNING) |
| `manifestStatus = OK` | «Manifest доступен» |
| `manifestStatus = NOT_AVAILABLE` | «Manifest недоступен» |
| `manifestStatus = CORRUPTED` | «Manifest повреждён» (WARNING) |
| `manifestDatasetChecksum = null` | «Контрольная сумма неизвестна» |
| `datasetVersionWarning = true` | «Обнаружено различие версий набора данных» (WARNING, не ERROR) |
| `datasetChecksums` / `shadowFileChecksums` | список значений моноширинным текстом; `NOT_AVAILABLE` показывается как «недоступна» |

Запрещено: приписывать checksum отдельной строке прогноза; делать выводы «модель точна», «прогноз подтверждён», «данные гарантированно актуальны»; объединять provenance двух источников без указания источника.

## 10. Metric semantics

```text
Целевая метрика: qty_orders_delivered
Семантика: PROVISIONAL
```

Текст на странице: «Семантика целевой метрики предварительная и требует подтверждения владельцем бизнес-процесса».

Дополнительно: «Shadow — изолированный режим наблюдения; данные Shadow не являются production-результатом; страница не подтверждает готовность модели к production».

Запрещено: рубли, выручка, прибыль, экономия, ROI, финансовый эффект; повышение семантики до подтверждённой; дополнительные бизнес-метрики.

## 11. Component contract

Переиспользуются существующие компоненты (новых не требуется):

| Компонент | Назначение в FINAL-3 |
|---|---|
| `pageHeader` (`shell.ts`) | заголовок «Прогноз», подзаголовок, бейджи PROVISIONAL/состояния |
| `card` (`cards.ts`) | контейнеры блоков снапшотов, сверок, семантики |
| `dataTable` (`data.ts`) | обе таблицы (обёртка `.ds-table-wrap` даёт внутренний скролл) |
| `kpiGrid` (`cards.ts`) | сводка: `total`, `returned`, `unknownSnapshots`, диапазон дат |
| `provenanceDrawer` (`cards.ts`) | блок provenance и детали записи |
| `statusBadge` (`cards.ts`) | статусы WARNING/NOT_AVAILABLE/PROVISIONAL |
| `loadingState`, `emptyState`, `errorState` (`states.ts`) | состояния блоков |
| `trusted`, `escapeHtml`, `safeHref`, `formatDate`, `formatNumber`, `statusClass` (`format.ts`) | безопасный вывод и ссылки |

Новые компоненты: **не требуются**. Если `src/web/pages/forecast.ts` превысит разумный размер, допускается выделение `src/web/pages/forecast-sections.ts` (только презентационные функции блоков, ≤200 строк) — это условная позиция allowlist.

## 12. Responsive layout

**Desktop (≥1024):** заголовок → переключатели в одну строку → два блока карточек друг под другом → provenance → переходы → семантика.

**Mobile (≤768):** переключатели переносятся в две строки без горизонтальной прокрутки страницы; таблицы сохраняют внутренний скролл (`ds-table-wrap`); KPI-сетка перестраивается в одну колонку; provenance сворачивается (`provenanceDrawer`); длинные идентификаторы переносятся, не обрезаясь.

Запрещено: горизонтальный overflow страницы на 390/360 px; перекрытие переключателей контентом; обрезка значения без доступа к полному тексту; цвет как единственный носитель статуса.

## 13. Security

- все значения API выводятся через `escapeHtml` (внутри компонентов) либо как обычный текст; `modelId`, `variant`, `snapshotId`, `status`, checksum не помечаются доверенными;
- доверенные слоты ограничены существующим списком (11 имён); новых не вводится;
- ссылки формируются только через `safeHref` и существующие маршруты (`#forecast-quality/...`, `#forecast-diagnostics/...`);
- DTO проходят существующую runtime-валидацию `validateResult`; невалидный envelope → `INVALID_RESPONSE`, состояние ERROR;
- запрещены `innerHTML` для значений API, inline-обработчики, `eval`, динамические URL вне allowlist;
- PII не выводится: страница не использует `dimension_*` и сырые записи.

## 14. Test contract

**Routing (route helpers):** `#forecast/replay/1`, `#forecast/replay/3`, `#forecast/shadow/1`, `#forecast/shadow/3`; неизвестный mode; неизвестный horizon; лишние сегменты; пустой hash; нормализация; reload; back/forward.

**Снапшоты:** валидный ответ; пустая выборка; `not_available`; `error`; неверный DTO; `forecastValue = 0`; `forecastValue = null`; длинный `snapshotId`/`modelId`; отсутствующий `variant`; неизвестный `status`.

**Сверки:** валидный ответ; пустой результат; `forecastValue = 0`/`null`; `actual = 0`; `absoluteError = 0`; положительный и отрицательный `signedError`; `unknownSnapshots > 0`; API unavailable; API error.

**Независимость состояний:** 4 комбинации из раздела 8; смена mode; смена horizon; ответ старого запроса после нового (гонка); отсутствие stale data.

**Provenance:** `MATCH`, `STALE`, `NOT_CONFIRMED`; `manifestStatus` OK/NOT_AVAILABLE/CORRUPTED; `null` checksum; `NOT_AVAILABLE` checksum; `datasetVersionWarning` true/false.

**Безопасность:** экранирование `modelId`, `variant`, `snapshotId`, checksum; безопасные hash-ссылки; отсутствие raw HTML injection.

Тесты используют production-функции (`parseHash`, `forecastParams`/`normalizeForecastParams`, `forecastPage`) и реальные фикстуры; логика маршрутизации в тестах не дублируется.

## 15. Visual acceptance

| Viewport | Размер |
|---|---|
| Широкий десктоп | 1440×1000 |
| Десктоп | 1280×900 |
| Ноутбук | 1024×768 |
| Планшет | 768×1024 |
| Мобильный | 390×844 |
| Малый мобильный | 360×800 |

Состояния: Replay h1 · Replay h3 · Shadow h1 · Shadow h3 · snapshots loading · snapshots error · reconciliation unavailable · snapshots OK + reconciliation error · обе секции OK · provenance STALE · manifest CORRUPTED · NULL `forecastValue` · нулевые значения · длинные идентификаторы.

Критерии: нет горизонтального overflow страницы; таблицы читаемы (внутренний скролл допустим); мобильная компоновка корректна; нет перекрытий; переключатели доступны; состояния блоков различимы и не смешиваются; полное значение длинных идентификаторов доступно; предупреждения читаемы и не выглядят ошибками.

## 16. Allowlist FINAL-3.3

| Файл | Действие | Причина | Риск | Строк (план) |
|---|---|---|---|---|
| `src/web/pages/forecast.ts` | создать | страница: два блока, состояния, детали | превышение 200 → выделить `forecast-sections.ts` | ≤200 |
| `src/web/routing.ts` | изменить (PAGES + нормализация) | новый маршрут `forecast` в существующей грамматике | 147 → ≤200 | +8..12 |
| `src/web/main.ts` | изменить минимально (регистрация страницы + два запроса) | точка входа и композиция; бизнес-логика Forecast в нём не размещается | текущие 197 строк: рост недопустим без извлечения; при нехватке места — выделение диспетчеризации в отдельный модуль (имя определяется на preflight FINAL-3.3) | 0..+3 либо извлечение |
| `tests/web/forecast.test.ts` | создать | тесты блоков, состояний, provenance, безопасности | — | ≤200 |
| `tests/web/forecast-routing.test.ts` | создать | тесты URL-контракта и нормализации | — | ≤120 |
| `tools/reference/fixtures/forecast.ts` | создать | синтетическая фикстура эталона | помечена как REFERENCE DATA | ≤80 |
| `tools/reference/render-page.ts` | изменить | `BUILDERS` типизирован по `PageKey` — новая страница обязана быть в реестре | 58 → ≤80 | +3 |
| `tools/reference/generate.ts` | условно | только если потребуется явная регистрация страницы | — | — |
| `docs/ui/reference/index.html`, `docs/ui/reference/pages/forecast.html` | генерируемые | эталоны через `bun tools/reference/generate.ts` | ручная правка запрещена | — |
| `docs/final-frontend/forecast-implementation.md`, `forecast-visual-acceptance.md` | создать | отчёты FINAL-3.3/3.6 | — | — |
| `src/web/pages/forecast-sections.ts` | условно | выделение презентационных секций при риске лимита | не создавать без необходимости | ≤200 |

Не изменяются: `src/server/**`, `src/forecasting/**`, `src/storage/**`, `data/**`, `src/web/api/client.ts` (только использование), `src/web/lib/format.ts` (только использование), `src/web/pages/forecast-diagnostics.ts` (**348 строк, декомпозиция вне scope**), `src/web/pages/history.ts` и другие страницы, `package.json`, `diff.txt` (отсутствует), чужие незакоммиченные изменения.

## 17. Forbidden scope

Изменение forecasting engine, алгоритмов и метрик; запуск replay/shadow/reconcile/monitor/`all`; изменение SQLite, JSONL, CSV, миграций; новые endpoint и изменение API/DTO; прямые запросы к Superset; новые зависимости и фреймворки; frontend-расчёты MAE/WAPE/bias/парных метрик; h7/h14; p10/p90; доверительные интервалы; финансовые показатели; объединение снапшотов и сверок по `snapshotId`; вывод `actual` из истории по предположению; фильтр дат; селектор моделей; серверная пагинация; per-record eligibility reasons и полные списки конфликтов (API их не предоставляет); фиктивные production-данные; повышение семантики метрики; Git-операции.

## 18. Risks and decisions

| # | Риск / вопрос | Решение |
|---|---|---|
| 1 | Требование «факт + прогноз + ошибка в одной таблице» невыполнимо на `/forecasts` | два блока, сверки — отдельный источник (раздел 4) |
| 2 | График: снапшоты не содержат `actual`, сверки — подмножество с разными origin/model | **график не включается в FINAL-3**; обоснование: невозможна непрерывная корректная серия без смешения origin и моделей |
| 3 | Селектор моделей | не создаётся: серверный allowlist, риск `INVALID_QUERY` |
| 4 | Фильтр дат | не создаётся: серверных параметров нет |
| 5 | Пагинация | не создаётся: сервер отдаёт последние N; показываются `returned` и `total` |
| 6 | Provenance у сверок отсутствует | явная пометка источника в блоке сверок |
| 7 | `main.ts` 197 строк при лимите 200 | до реализации изучить фактическую структуру `main.ts`, найти существующую точку расширения; если места недостаточно — извлечь маршрутизацию/диспетчеризацию в отдельный модуль; имя модуля не фиксируется заранее; `main.ts` остаётся тонкой точкой входа и композиции; фактическая длина всех изменённых файлов проверяется после реализации, ни один не превышает 200 строк |
| 8 | Смешение режимов | единый `mode` из URL для обоих запросов; смена режима сбрасывает оба блока |
| 9 | Гонки запросов между независимыми блоками | двухуровневая защита: поколение выбора + отдельные счётчики `snapshotsRequestSeq`/`reconciliationsRequestSeq` (раздел 8) |
| 10 | Расхождение provenance двух источников | показывается только provenance снапшотов + пометка для сверок |

## 19. Implementation sequence (FINAL-3.3)

1. `routing.ts`: маршрут `forecast`, `normalizeForecastParams`, доступ к mode/horizon.
2. `pages/forecast.ts`: view-модели, два блока, состояния, provenance, семантика, переходы (первая версия без `forecast-sections.ts`).
3. `main.ts`: регистрация страницы и два независимых запроса с двухуровневой защитой (generation + счётчики блоков); при нехватке места — извлечение диспетчеризации в отдельный модуль (решение принимается на preflight FINAL-3.3).
4. Тесты `forecast-routing.test.ts` и `forecast.test.ts`; прогон `bun test tests/web tests/server`, `bunx tsc --noEmit`, `bun run ui:build`.
5. `tools/reference/fixtures/forecast.ts` + `render-page.ts`; `bun tools/reference/generate.ts`; проверка SHA-256 при повторной генерации.
6. PII gate; браузерная проверка шести viewport и списка состояний; `forecast-visual-acceptance.md`.
7. Итоговый отчёт `forecast-implementation.md`, сверка diff с allowlist.

## 20. Acceptance checklist

- [x] Проверка Git выполнена повторно
- [x] API-контракты перепроверены по исходному коду
- [x] Зафиксированы два независимых источника
- [x] Snapshot-блок отделён от reconciled-блока
- [x] Описаны все отображаемые поля
- [x] Описаны NULL и zero
- [x] Описаны независимые loading/error/empty/not_available
- [x] Описана защита от stale data и гонок
- [x] Описан URL contract и нормализация
- [x] Описаны provenance warnings
- [x] Сохранена семантика PROVISIONAL
- [x] Определена компонентная архитектура (новых компонентов не требуется)
- [x] Определён responsive layout
- [x] Обосновано решение не включать график
- [x] Сформирован точный allowlist FINAL-3.3
- [x] Определён полный набор тестов
- [x] Определены критерии визуальной приёмки
- [x] Задокументированы запреты и ограничения
- [x] Production-код не изменён, Git history не изменена
