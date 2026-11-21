# Исправленная отчётность Discovery (discovery_corrected)

**Этап 1.1, задача 1.** Обновлено: 2026-11-20.
Документ фиксирует исправленную семантику и фактическое состояние после правок
`superset.ts`, `discovery.ts`, `phase1-1-dataset-detail-loader.ts`, `phase1-1-lineage.ts`
и `phase1-1-kpi-catalog.ts`.

---

## 1. Что исправлено в коде

- **Rison-формат `q`.** `SupersetClient.listFull()` использует проверенный формат
  `(page:N,page_size:N)`, а не `JSON.stringify`.
- **Полнота пагинации.** Первый ответ читается как `.count` (ground truth); проверяются
  структура каждой страницы, уникальность ID, дубли и общее число строк. При неполноте
  или дублях выбрасывается `PaginationError`.
- **Read-only Discovery.** Массовая загрузка `*_detail` удалена; остались только
  точечные проверки dashboard/chart (по умолчанию 2). `data/catalog.sqlite` в обычном
  режиме не изменяется; запись возможна только в явном режиме `--build-catalog`.
- **Синтаксис detail.** `GET /api/v1/{resource}/{id}` — без завершающего слэша
  (форма со слэшем даёт 404 в Superset 6.2.4).
- **Ретраи.** 401 → одна переавторизация и повтор исходного запроса через общий
  retry-loop; 429/5xx/network → exponential backoff; `Retry-After` принимается и как
  секунды, и как HTTP-date; после исчерпания повторов 429/5xx помечаются `transient`.
- **Ошибки detail** классифицируются как HTTP 401 / 403 / 429 / 5xx / network / 4xx / other.

## 2. Фактическое состояние каталога (readonly)

| Ресурс | API count | Локальный list | `*_detail` в SQLite | `dataset_details` в output |
|---|---:|---:|---:|---:|
| dashboard | 330 | 330 | 330 | — |
| chart | 19 920 | 5 000 | 3 766 | — |
| dataset | 3 771 | 3 767 | 0 (read-only) | **12 валидных** |

Источник API count: `reports/phase-01-1/api_spot_checks.json`.
`data/catalog.sqlite`: `quick_check = ok`, objects = 13 193, relations = 0;
counts по `object_type` совпадают с `backups/catalog-before-discovery.sqlite`.

### Семантика терминов

| Термин | Значение |
|---|---|
| **Detail** | `dataset_details/<id>.json` — полный ответ API, сохранённый в `output/`, а не в SQLite. |
| **Missing list** | `api_count − local_list_count`: 14 920 chart и 4 dataset не попали в локальный list из-за усечения. |
| **Missing detail** | Для 12 приоритетных dataset — 0; остальные dataset detail не загружались (ограничение ТЗ). |

## 3. Пробел, который остаётся

Живые API-проверки **заблокированы** по двум причинам:

1. в `.env` отсутствуют `SUPERSET_PASSWORD` и `SUPERSET_ACCESS_TOKEN`, поэтому `login()`
   не выполняется;
2. `api_transport_diagnostics.json` (обновлён) фиксирует `verdict = BLOCKED_TCP`,
   `tcp.443 = TCP_TIMEOUT` — маршрут/VPN до `superset.svc.vkusvill.ru` сейчас недоступен.

Как следствие:

- `reports/phase-01-1/api_pagination_test.json` — статус `blocked`;
- `output/discovery_summary.json` — старый (2026-11-19), chart=5 000, dataset=3 767,
  поэтому `final_validation.json` фиксирует `discovery_complete = FAIL`.

После восстановления маршрута и появления валидных credentials достаточно выполнить:

```
bun src/discovery.ts --skip-relations        # read-only, без массового detail
bun src/phase1-1-api-pagination-test.ts      # полная пагинация + сверка с каталогом
bun src/phase1-1-final-validation.ts
```

`MAX_PAGES` для полной выгрузки charts (19 920 / 100 = 200 страниц) должен быть ≥ 200.

## 4. Правильный синтаксис запросов Superset 6.2

- Detail: `GET /api/v1/{resource}/{id}` — **без** завершающего слэша.
- Фильтр списка: `q={"filters":[{"col":"datasource_id","opr":"eq","value":ID}]}`;
  ключ **`opr`** (форма `operator` молча игнорируется).
- Пагинация: `q=(page:p,page_size:100)`; счётчик `.count` — ground truth.
