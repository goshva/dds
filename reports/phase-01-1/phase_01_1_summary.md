# Сводка Этапа 1.1 — phase_01_1_summary

**Дата:** 2026-11-21 · **Проект:** Courier Analytics — Discovery & SQL Audit
**Режим:** read-only; каталоги не пересобирались; `data/catalog.sqlite` не изменялась.

---

## Итоговые статусы (final_validation.json)

| Статус | Значение |
|---|---|
| `LOCAL_VALIDATION` | **PASS** |
| `API_TRANSPORT_CURRENT` | **BLOCKED_TCP** |
| `API_AUTH_LAST_SUCCESS` | **PASS** |
| `API_AUTH_CURRENT` | **NOT_TESTED** |
| `DISCOVERY_COMPLETENESS` | **PASS** |
| `LINEAGE_INTERNAL_CONSISTENCY` | **PASS** |
| `LINEAGE_REFERENCE_QUALITY` | **WARN** (findings) |
| `KPI_EVIDENCE` | **PASS** |
| `OVERALL_STATUS` | **PASS_WITH_BLOCKER** |

Итог прогона: 11 PASS, 0 FAIL, 1 WARN, 1 BLOCKED, 1 NOT_TESTED.

- `API_AUTH_LAST_SUCCESS` подтверждён Discovery: `status=ok`, detail spot checks 4/4,
  2026-11-20T21:33:38Z — 2026-11-20T21:39:40Z.
- `API_AUTH_CURRENT = NOT_TESTED`: повторный login в текущем прогоне не выполнялся
  из-за `BLOCKED_TCP`; текущая авторизация не помечена как PASS.
- `API_TRANSPORT_CURRENT = BLOCKED_TCP` (TCP_TIMEOUT) — без повторного сетевого обращения.

## 1. Discovery: PASS

| Ресурс | API count | Сохранено | Уникальных ID | Дубликатов | Страниц | Статус |
|---|---:|---:|---:|---:|---:|---|
| dashboard | 331 | 331 | 331 | 0 | 4 | complete |
| chart | 19 924 | 19 924 | 19 924 | 0 | 200 | complete |
| dataset | 3 776 | 3 776 | 3 776 | 0 | 38 | complete |

- Ошибок API 0; detail spot checks 4/4; read-only; `--skip-relations`.
- Сверка summary ↔ фактические `output/*.json`: `discovery_completion.md`.
- SQLite остаётся историческим снимком (330/5 000/3 767, relations = 0) и не изменялась.
- Файлы `output/dashboards.json`, `output/charts.json`, `output/datasets.json` не изменялись.

## 2. Lineage: внутренняя согласованность PASS, качество ссылок WARN

### LINEAGE_INTERNAL_CONSISTENCY = PASS

**48 010 свидетельств**, **33 592 уникальные связи** (D2C = 13 832, C2D = 19 760);
сумма `evidence_count` = 48 010; CSV ↔ JSON согласованы; дублей ключей нет.

| Метод | Свидетельств |
|---|---:|
| DASHBOARD_POSITION_JSON (detail + spot) | 7 919 |
| CHART_DASHBOARDS_ARRAY (detail + spot) | 2 646 |
| CHART_LIST_DASHBOARDS_ARRAY (list) | 13 821 |
| CHART_DATASOURCE_ID (detail + spot) | 3 756 |
| CHART_LIST_DATASOURCE_ID (list) | 19 760 |
| API_FILTER_BY_DATASOURCE_ID (API) | 108 |

### LINEAGE_REFERENCE_QUALITY = WARN (findings)

| Категория | Кол-во |
|---|---:|
| unresolved dashboard refs | 318 |
| unresolved dataset refs | 45 |
| unresolved chart refs | 6 |
| chart с расхождением dashboard sets | 2 |
| chart→dataset конфликты detail/list | 0 |
| charts без dataset | 164 |
| charts без dashboard | 9 268 |
| datasets не используются локальными charts | 1 109 |

Детали и примеры: `lineage_reference_quality.md`. Ссылки **не обозначаются** архивными
или удалёнными без отдельного подтверждения источником.

`lineage_evidence.csv` и `lineage_relations.csv` в этом прогоне не перезаписывались
(SHA256 до/после совпадают).

## 3. KPI Source Matrix: PASS

- **18 KPI**, `evidence_verified = 18/18`: FOUND 9, PARTIAL 4, NOT_FOUND 1, NOT_VERIFIED 4.
- Полный каталог как контекст: 3 776 dataset, 3 220 с SQL; все 12 приоритетных присутствуют;
  расхождений `sql_length` detail ↔ list нет.
- Статусы не повышались из-за новых датасетов; `kpi_source_matrix.json` не изменялся в этом прогоне.
- Сохранены ограничения: `sum_order` — не доход курьера; `events_qty` — не явка;
  подтверждённой модели смен, ходок и доступного пула нет.

## 4. Final Validation: PASS_WITH_BLOCKER

Проверено: TypeScript compilation (`bunx tsc --noEmit` = 0), SQLite readonly/quick_check,
неизменность SQLite vs backup, relations, 12 dataset detail, полнота Discovery,
Lineage internal consistency, Lineage reference quality, KPI 18, PII/секреты, отчёты.

## 5. Оставшиеся замечания

1. **API_TRANSPORT_CURRENT = BLOCKED_TCP** — маршрут/VPN до Superset недоступен на момент
   проверки; повторный login не выполнялся (`API_AUTH_CURRENT = NOT_TESTED`).
2. **LINEAGE_REFERENCE_QUALITY = WARN** — 318 unresolved dashboard refs, 45 unresolved
   dataset refs, 6 unresolved chart refs, 2 chart с расхождением dashboard sets.
   Требуется подтверждение источником, прежде чем называть их архивными/удалёнными.
3. Полный SQL/columns-покрытие есть только по 12 приоритетным detail; остальные dataset
   покрыты контекстным сканом SQL.

## Артефакты

```
reports/phase-01-1/
├── api_transport_diagnostics.json
├── api_spot_checks.json
├── api_chart_links_priority.json
├── api_pagination_test.json
├── discovery_corrected.md
├── discovery_completion.md
├── discovery_test.json
├── lineage_evidence.csv            (48 010, не изменялся)
├── lineage_relations.csv           (33 592, не изменялся)
├── lineage_preview.json
├── lineage_quality.md              (internal consistency + reference quality)
├── lineage_reference_quality.md    (детализация findings)
├── kpi_source_matrix.json
├── kpi_source_matrix.md
├── kpi_field_inventory.json
├── final_validation.json
└── phase_01_1_summary.md
```
