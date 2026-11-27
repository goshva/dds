# FINAL-3.1 — проверенный API-контракт страницы «Прогноз»

**Источник:** `src/server/routes.ts`, `src/server/services/forecasting-read-models.ts`, `src/server/services/read-models.ts`, `src/web/api/client.ts` (чтение кода, без изменений)

---

## 1. Envelope (FACT)

```ts
type ApiResult<T> = ApiOk<T> | ApiNotAvailable | ApiErrorBody
ApiOk<T>          = { status: "ok"; data: T; meta: ApiMeta }
ApiNotAvailable   = { status: "not_available"; data: null; meta: ApiMeta }
ApiErrorBody      = { status: "error"; error: { code; message; eventId } ; meta: ApiMeta }
ApiMeta           = { generatedAt: string; source: string; readOnly: true; checksum?: string; note?: string }
```

`meta.generatedAt` — время формирования ответа, не время создания прогноза. `validateResult` в клиенте отбрасывает неожиданный формат (`INVALID_RESPONSE`).

## 2. `GET /api/v1/forecasts` (FACT)

| Параметр | Обязательность | Допустимые значения | Поведение |
|---|---|---|---|
| `mode` | обязателен | `replay`, `shadow` | иначе `INVALID_QUERY` |
| `horizon` | обязателен | `1`, `3` | иначе `INVALID_QUERY` |
| `model` | необязателен | allowlist модели | неизвестное значение → `INVALID_QUERY` |
| `limit` | необязателен | целое 1..1000 (по умолчанию 200) | вне диапазона → `INVALID_QUERY` |

Поведение: выборка — снапшоты выбранного `mode` + `horizon`, сервер возвращает **последние** `limit` записей; `total` — полное число в выборке. Пустая выборка → `not_available`, код `NO_RECORDS_FOR_MODE_AND_HORIZON`, источник `shadow_jsonl:<mode>:h<horizon>`. В `meta.checksum` передаётся `provenance.shadowFileChecksums.forecasts` либо `NOT_AVAILABLE`.

### `ForecastsListDto`

```ts
{ mode: "replay"|"shadow"; horizon: number; total: number; returned: number;
  items: ForecastItemDto[]; provenance: ForecastProvenanceDto }
```

### `ForecastItemDto` — доступные поля

| Поле | Тип | Примечание |
|---|---|---|
| `snapshotId` | string | идентификатор снапшота |
| `mode` | string | должен совпадать с запрошенным режимом |
| `modelId` | string | идентификатор модели |
| `modelVersion` | string | версия модели |
| `variant` | string \| null | может отсутствовать |
| `horizon` | number | 1 или 3 |
| `originDate` | string | дата происхождения прогноза |
| `targetDate` | string | целевая дата |
| `forecastValue` | number \| null | NULL — отсутствие прогноза, не ноль |
| `status` | string | статус снапшота |
| `inputDataVersion` | string | версия входных данных |
| `generatedAt` | string | время генерации снапшота |

**Отсутствуют:** `actual`, `absoluteError`, `signedError`, `datasetChecksum`, `target`, `targetMetric`, признаки p10/p90, доверительные интервалы.

### `ForecastProvenanceDto` (общий для прогнозов и качества)

```ts
{ datasetChecksums: string[]; datasetVersionWarning: boolean;
  manifestStatus: "OK"|"NOT_AVAILABLE"|"CORRUPTED";
  manifestDatasetChecksum: string|null;
  freshness: "MATCH"|"STALE"|"NOT_CONFIRMED";
  shadowFileChecksums: Record<string,string> }
```

## 3. `GET /api/v1/shadow/reconciliations` (FACT)

| Параметр | Значение по умолчанию | Ограничение |
|---|---|---|
| `mode` | `shadow` | `shadow` \| `replay` |
| `horizon` | не задан (все) | только `1` или `3` |
| `limit` | 60 | по правилам `parseLimit` |

Поведение: реконсиляции без известного снапшота исключаются (`unknownSnapshots` — их число); записи фильтруются по режиму снапшота и горизонту; сервер возвращает последние `limit`.

### `ReconciliationModel & { mode; unknownSnapshots }`

| Поле записи | Тип | Примечание |
|---|---|---|
| `snapshotId` | string | связь со снапшотом |
| `modelId` | string | модель |
| `horizon` | number | 1 или 3 |
| `targetDate` | string | целевая дата |
| `forecastValue` | number \| null | NULL допустим |
| `actual` | number | фактическое значение |
| `absoluteError` | number | **вычислено backend** |
| `signedError` | number | **вычислено backend** |

Это единственный источник, где факт, прогноз и ошибка доступны согласованно и без расчётов на frontend.

## 4. `GET /api/v1/forecasts/quality` (FACT, для перехода)

`mode`, `horizon`, `paired` (опциональный boolean). Возвращает `ForecastsQualityDto`: `independentMetrics`, `pairedComparison`, `pairCounters`, `metricDiagnostics`, `sampleStatus`, `interpretabilityStatus`, `warnings`, `provenance`, `availability`, `semantics: "PROVISIONAL"`, `technicalFactCutoff`. Метрики считает backend.

## 5. `GET /api/v1/forecasts/errors` (FACT)

`mode` (обязателен), `code`, `limit`. `ForecastErrorsDto`: `{ mode, total, persistedErrorsAvailable, items: [{ source: "persisted"|"detected", kind, snapshotId|null, recordType, reason }] }`. Persistent errors обычно недоступны — это диагностика, а не хранилище ошибок.

## 6. Невозможные UI-сценарии (FACT)

1. Факт и ошибка в таблице по `/api/v1/forecasts` — полей нет.
2. Фильтр по датам на сервере — параметров нет; допустима только клиентская фильтрация загруженных записей с явной пометкой.
3. Пагинация «страницами» — сервер отдаёт последние N; постраничность возможна только по загруженному набору.
4. Выбор произвольной модели — ограничен allowlist сервера.
5. h7/h14, p10/p90, доверительные интервалы, финансовые эффекты — отсутствуют.
6. Per-record checksum — отсутствует; версия датасета доступна только на уровне ответа (`provenance`).
7. Сравнение моделей по паре — доступно только через готовые парные метрики `/forecasts/quality`; самостоятельное сопоставление записей не выполняется.

## 7. Вопросы, не решаемые без изменения backend

1. Добавить `actual`/`error` в `ForecastItemDto` (сейчас доступно только через реконсиляции и лишь для сверенных записей).
2. Серверный фильтр по диапазону дат и пагинация для `/forecasts`.
3. Per-record `dataset_checksum` для сопоставления версий данных по строкам.
4. Единый идентификатор целевой метрики в DTO (сейчас семантика задаётся документально, `semantics: "PROVISIONAL"`).

## 8. Вывод

- Страница «Прогноз» реализуема **без изменения API** в следующем честном виде:

- блок списка прогнозов — `/api/v1/forecasts` (модель, версии, variant, origin/target, статус, `forecastValue` с NULL ≠ 0);
- блок «Факт и прогноз» — `/api/v1/shadow/reconciliations` (факт, прогноз, абсолютная и знаковая ошибка из API);
- провенанс и предупреждения — `provenance` ответа (`datasetVersionWarning`, `manifestStatus`, `freshness`, checksum файлов);
- переходы — на `#forecast-quality/<mode>/<horizon>` и `#forecast-diagnostics/<mode>/<horizon>`;
- метрики, pairing и финансовые выводы на странице не считаются и не показываются.
