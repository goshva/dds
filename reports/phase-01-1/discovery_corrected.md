# Исправленная отчётность Discovery (discovery_corrected)

**Этап 1.1, задача 1.** Обновлено: 2026-11-21.
Документ фиксирует исправленную семантику и состояние после полного read-only Discovery.

---

## 1. Что исправлено в коде

- **Rison-формат `q`:** `SupersetClient.listFull()` использует `(page:N,page_size:N)`, а не `JSON.stringify`.
- **Полнота пагинации:** первый ответ читается как `.count` (ground truth); проверяются структура
  каждой страницы, уникальность ID, дубли и общее число строк; при неполноте — `PaginationError`.
- **Read-only Discovery:** массовая загрузка `*_detail` удалена; остались только точечные
  dashboard/chart detail. `data/catalog.sqlite` не изменяется; запись — только в явном
  режиме `--build-catalog`.
- **Синтаксис detail:** `GET /api/v1/{resource}/{id}` — без завершающего слэша (со слэшем 404).
- **Ретраи:** 401 → одна переавторизация и повтор через общий retry-loop; 429/5xx/network →
  exponential backoff; `Retry-After` — секунды или HTTP-date; после исчерпания повторов
  429/5xx помечаются `transient`.
- **Ошибки detail** классифицируются как HTTP 401 / 403 / 429 / 5xx / network / 4xx / other.

## 2. Фактическое состояние каталога (read-only)

Полный Discovery завершён успешно: **331 dashboard / 19 924 chart / 3 776 dataset**,
0 дубликатов, 0 ошибок API, 242 страницы, точечные detail 4/4.

| Ресурс | API count | Сохранено строк | Уникальных ID | Дубликатов | Страниц | Статус |
|---|---:|---:|---:|---:|---:|---|
| dashboard | 331 | 331 | 331 | 0 | 4 | complete |
| chart | 19 924 | 19 924 | 19 924 | 0 | 200 | complete |
| dataset | 3 776 | 3 776 | 3 776 | 0 | 38 | complete |

Файлы: `output/dashboards.json`, `output/charts.json`, `output/datasets.json`.
Сверка summary ↔ фактические файлы: `reports/phase-01-1/discovery_completion.md`.

`data/catalog.sqlite` остаётся историческим усечённым снимком (list: 330/5 000/3 767,
detail: 330 dashboard / 3 766 chart, relations = 0) и **не изменялся**; полный каталог
живёт в `output/*.json`.

### Семантика терминов

| Термин | Значение |
|---|---|
| **Detail** | `dataset_details/<id>.json` — полный ответ API в `output/`, а не в SQLite. |
| **Missing list** | Разница API count и локального list; после полного Discovery = 0. |
| **Missing detail** | Для 12 приоритетных dataset — 0; остальные detail не загружались (ограничение ТЗ). |

## 3. Текущий блокер среды

Полный Discovery выполнен, когда транспорт был доступен (2026-11-20T21:33–21:39Z).
На момент повторной валидации маршрут/VPN до `superset.svc.vkusvill.ru` недоступен:
`api_transport_diagnostics.json` = `BLOCKED_TCP` (`tcp.443 = TCP_TIMEOUT`), а
`discovery_test` фиксирует `ECONNREFUSED` при повторной попытке login.

Это не влияет на уже собранные артефакты: `DISCOVERY_COMPLETENESS = PASS`,
`API_AUTH = PASS` (подтверждён фактом 4/4 detail spot checks), `API_TRANSPORT` = `BLOCKED`
только на момент проверки. Итог: `OVERALL_STATUS = PASS_WITH_BLOCKER`.

## 4. Правильный синтаксис запросов Superset 6.2

- Detail: `GET /api/v1/{resource}/{id}` — **без** завершающего слэша.
- Фильтр списка: `q={"filters":[{"col":"datasource_id","opr":"eq","value":ID}]}`;
  ключ **`opr`** (форма `operator` молча игнорируется).
- Пагинация: `q=(page:p,page_size:100)`; счётчик `.count` — ground truth.
- Для полной выгрузки 19 924 charts требуется `MAX_PAGES ≥ 200`.
