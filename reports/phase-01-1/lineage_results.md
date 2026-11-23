# Lineage — Результаты проверки (23.11.2026)

## Сводка

| Параметр | Значение |
|----------|----------|
| Свидетельств | 48 010 |
| Уникальных связей | 33 592 |
| DASHBOARD_HAS_CHART | 13 832 |
| CHART_USES_DATASET | 19 760 |
| Внутренняя согласованность | **PASS** (все 11 проверок OK) |
| Статус качества ссылок | **FINDINGS** (не FAIL) |

## Ключевые находки

### 1. Unresolved dashboard refs (318)
Charts из `output/charts.json[].dashboards[]` ссылаются на 318 dashboard IDs, которых нет в `output/dashboards.json`. <ФИО> удалённые/архивные дашборды — Superset API возвращает их в chart detail, но сам дашборд уже удалён из каталога.

### 2. Unresolved dataset refs (45)
Charts из `output/charts.json[].datasource_id` ссылаются на 45 dataset IDs, которых нет в `output/datasets.json`. Аналогично — удалённые датасеты.

### 3. Unresolved chart refs (6)
Charts 27732-27737 находятся в `position_json` dashboard 1455, но отсутствуют в `output/charts.json`. Возможная причина: charts добавлены в дашборд через layout, но API list не возвращает (rate limit / pagination).

### 4. Расхождения dashboard sets (2)
- Chart 20940: detail=[1431,1664,736], list=[1431,736]
- Chart 20941: detail=[1431,1664,736], list=[1431,736]
Detail содержит dashboard 1664, которого нет в list — возможно, дашборд удалён после list-запроса.

### 5. Конфликты chart→dataset (0)
Detail и list источники сходятся по datasource_id для всех 19 760 chart.

## Статус

- **PASS**: все 11 проверок внутренней согласованности OK
- **FINDINGS**: 318+45+6 unresolved refs — разрешено ТЗ §4 (не обозначать архивные без подтверждения)
- **Файлы**: `reports/phase-01-1/lineage_evidence.csv`, `lineage_relations.csv`, `lineage_preview.json`, `lineage_quality.md`, `lineage_reference_quality.md`
