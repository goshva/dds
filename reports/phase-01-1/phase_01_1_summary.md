# Сводка Этапа 1.1 — phase_01_1_summary

**Дата:** 2026-11-20 · **Проект:** Courier Analytics — Discovery & SQL Audit
**Режим:** read-only аудит; `data/catalog.sqlite` не изменялась; массовая дозагрузка detail не выполнялась.

---

## Вердикт этапа: **PASS_WITH_BLOCKER**

Код и локальные артефакты приведены в согласованное состояние, но **живые API-проверки
заблокированы**:

1. в `.env` отсутствуют `SUPERSET_PASSWORD` и `SUPERSET_ACCESS_TOKEN`;
2. `api_transport_diagnostics.json` (обновлён 2026-11-20) фиксирует
   `verdict = BLOCKED_TCP`, `tcp.443 = TCP_TIMEOUT` — маршрут/VPN до Superset сейчас недоступен.

Из-за этого `final_validation.json` не подтверждает полноту Discovery
(chart 5 000 / 19 920, dataset 3 767 / 3 771).

---

## Что сделано

### Задача 1 — Discovery
- `SupersetClient.listFull()` переведён на Rison `(page:N,page_size:N)`, читает `.count`,
  проверяет структуру страниц, уникальность ID и дубли; при неполноте — `PaginationError`.
- `discovery.ts` больше не делает массовую загрузку `*_detail`; по умолчанию работает
  read-only, точечно проверяет dashboard/chart detail и классифицирует ошибки.
- Итоговый статус `discovery_summary.json` содержит `complete/incomplete/failed`,
  `api_count`, `downloaded_count`, `unique_ids_count`, `duplicate_rows`; при критических
  ошибках выставляется `process.exitCode = 1`.

### Задача 2 — Диагностика API
- `api_transport_diagnostics.json`: DNS A → TCP/443 → TLS → HTTP `/health` → auth.
- Транспортные категории (DNS/TCP/TLS/timeout/proxy) сохранены в `classifyNetworkError`
  и доступны через `tryGet()`; секреты в отчёты не попадают.

### Задача 3 — Lineage
- Единый snapshot: `lineage_evidence.csv`, `lineage_relations.csv`, `lineage_preview.json`,
  сгенерированный `lineage_quality.md`.
- Факт: **14 426 свидетельств**, **13 037 уникальных связей**, D2C = 9 174, C2D = 3 863.
- `evidence_count` добавлен в `Rel`; сумма `evidence_count` = числу свидетельств.
- Категории `chart_detail`: with datasource = 3 755, without = 11, invalid = 0
  (сумма = 3 766 = total).
- API chart count уникален по ID: 108 charts вне локального каталога.
- `datasets_unused_by_charts_local` = 3 606 (через пересечение множеств, без отрицательных значений).
- CSV экранируется; проверки JSON ↔ CSV выполняются в самом builder и в final validation.
- Расхождение 1757/2645 пересчитано: 1 757 = число chart_detail с непустым `dashboards[]`,
  2 645 = число уникальных пар dashboard|chart; объяснение сохранено с результатами сверки.

### Задача 4 — KPI Matrix (18 показателей)
- `kpi_source_matrix.json` + `.md`: **18 KPI**, статусы FOUND = 9, PARTIAL = 4,
  NOT_FOUND = 1, NOT_VERIFIED = 4; все заявленные поля найдены в detail JSON (18/18).
- `kpi_field_inventory.json`: инвентарь columns/metrics/calculated_columns по 12 датасетам.
- Явно зафиксировано: `sum_order` — не доход курьера; `events_qty` — не явка;
  подтверждённой модели смен/ходок/доступного пула нет.

### Задача 5 — Dataset Detail Loader
- 12/12 приоритетных dataset detail валидны (`output/dataset_details/*.json`).
- Checkpoint восстанавливает summary из файла, сравнивает ID через `String()`,
  обрабатывает ошибку записи отдельного dataset, разделяет `successful_fetch_attempts`
  и `unique_saved_datasets`, фильтрует `permanent_failed` по 12 приоритетным ID.
- `dataset_detail_summary.json`: `verification.all_valid = true`.

### Задача 6 — Final Validation
`final_validation.json`: 8 PASS, 1 FAIL, 0 WARN.
- PASS: SQLite readonly/quick_check, неизменность SQLite vs backup, relations, 12 detail,
  Lineage consistency, KPI 18, отсутствие PII/секретов, наличие отчётов.
- FAIL: полнота Discovery — `chart: downloaded=5000 api=19920`, `dataset: downloaded=3767 api=3771`
  (старый `discovery_summary.json` от 2026-11-19).

---

## Что блокирует полное закрытие

1. **Нет credentials** (`SUPERSET_PASSWORD`/`SUPERSET_ACCESS_TOKEN`) — API-тесты и
   перевыгрузка list невозможны.
2. **`MAX_PAGES`** должен быть ≥ 200 для полной выгрузки 19 920 charts.
3. После появления credentials: `bun src/discovery.ts --skip-relations` →
   `bun src/phase1-1-api-pagination-test.ts` → `bun src/phase1-1-final-validation.ts`.

## Артефакты

```
reports/phase-01-1/
├── api_transport_diagnostics.json
├── api_spot_checks.json
├── api_chart_links_priority.json
├── api_pagination_test.json          (blocked: нет credentials)
├── discovery_corrected.md
├── discovery_test.json               (read-only smoke)
├── lineage_evidence.csv              (14 426)
├── lineage_relations.csv             (13 037)
├── lineage_preview.json
├── lineage_quality.md                (сгенерирован)
├── kpi_source_matrix.json            (18 KPI)
├── kpi_source_matrix.md
├── kpi_field_inventory.json
├── final_validation.json
└── phase_01_1_summary.md
```

Код: `src/superset.ts`, `src/discovery.ts`, `src/phase1-1-dataset-detail-loader.ts`,
`src/phase1-1-lineage.ts`, `src/phase1-1-kpi-catalog.ts`, `src/phase1-1-kpi-fields.ts`,
`src/phase1-1-discovery-test.ts`, `src/phase1-1-api-pagination-test.ts`,
`src/phase1-1-final-validation.ts` — read-only по отношению к SQLite.
