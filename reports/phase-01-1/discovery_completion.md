# Discovery completion — Этап 1.1

Сгенерировано: 2026-11-21T06:01:32.221Z
Статус: **OK**

## Сверка summary ↔ фактические файлы

| Ресурс | Файл | Строк (факт) | Уникальных ID | Дубликатов | summary downloaded | summary api_count | Статус summary |
|---|---|---:|---:|---:|---:|---:|---|
| dashboard | `output/dashboards.json` | 331 | 331 | 0 | 331 | 331 | complete |
| chart | `output/charts.json` | 19924 | 19924 | 0 | 19924 | 19924 | complete |
| dataset | `output/datasets.json` | 3776 | 3776 | 0 | 3776 | 3776 | complete |

## Временные метки

- started_at: 2026-11-20T21:33:38.331Z
- finished_at: 2026-11-20T21:39:40.179Z
- mode: read-only
- status: ok

## Detail

- spot checks: attempted=4, ok=4, failed=0
- endpoint_errors: 0
- 12 dataset details valid: 12/12
- dataset_detail_summary.all_valid: true

## SQLite (readonly)

- quick_check: ok
- counts: {"chart":5000,"chart_detail":3766,"dashboard":330,"dashboard_detail":330,"dataset":3767}
- relations: 0
- note: SQLite list усечён (историческая выгрузка); полный каталог — в output/*.json

## Проверки

- duplicate ids: dashboard=0, chart=0, dataset=0
- rows without id: dashboard=0, chart=0, dataset=0
- summary ↔ fact mismatches: нет

Вывод: summary подтверждён фактическими файлами и уникальностью ID.
