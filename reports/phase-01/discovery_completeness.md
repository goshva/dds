# Этап 1 — Discovery Audit

Дата: 2026-11-20T09:50:17.077Z

## 1. Полнота списков

### Локально (SQLite)
```json
[
  {
    "object_type": "chart",
    "records": 5000,
    "unique_ids": 5000
  },
  {
    "object_type": "dashboard",
    "records": 330,
    "unique_ids": 330
  },
  {
    "object_type": "dataset",
    "records": 3767,
    "unique_ids": 3767
  }
]
```

### API (если авторизация успешна)
```json
{
  "dashboard": {
    "status": "skipped",
    "reason": "auth_failed"
  },
  "chart": {
    "status": "skipped",
    "reason": "auth_failed"
  },
  "dataset": {
    "status": "skipped",
    "reason": "auth_failed"
  }
}
```

## 2. Аудит detail

| Тип | List | Detail | Missing | Matched |
|---|---:|---:|---:|---:|
| Dashboard | 330 | 0 | 0 | 330 |
| Chart | 5000 | 0 | 1234 | 3766 |
| Dataset | 3767 | 0 | 3767 | 0 |

### Ошибки предыдущей выгрузки
- Всего: 5661
- По статусам: {"401":5660,"no_status":1}
- По ресурсам: {"chart_detail":1234,"dataset_detail":3767,"dashboard_charts":330,"dashboard_datasets":330}

## 3. Доступность API

| Endpoint | Status | OK |
|---|---:|---:|
| /api/v1/security/csrf_token/ | skipped | ❌ |
| /api/v1/dashboard/ | skipped | ❌ |
| /api/v1/chart/ | skipped | ❌ |
| /api/v1/dataset/ | skipped | ❌ |
| /api/v1/dashboard/1/ | skipped | ❌ |
| /api/v1/chart/1/ | skipped | ❌ |
| /api/v1/dataset/4732/ | skipped | ❌ |
| /api/v1/dashboard/1/charts | skipped | ❌ |
| /api/v1/dashboard/1/datasets | skipped | ❌ |

## 4. Локальная согласованность

- Дубликаты ID: 0
- Повреждённый JSON: 0 типов
- SQL в dataset list: 3514/3 767
- Lineage potential:
  - dashboard_detail с position_json: 329/330
  - chart_detail с datasource_id: 3755/3 766
  - relations таблица пуста: true

## 5. ***REMOVED***ы

```
AUTH: авторизация НЕ удалась — TypeError: ECONNREFUSED: Unable to connect. Is the computer able to access the url?
DASHBOARD: list=330(local)/N/A(API), matched_detail=330, missing_detail=0
CHART: list=5000(local)/N/A(API), matched_detail=3766, missing_detail=1234
DATASET: list=3767(local)/N/A(API), matched_detail=0, missing_detail=3767
SQL доступен в list-payload для 3514 из 3 767 dataset.
Lineage (Dashboard→Chart→Dataset) может быть частично восстановлен локально: 329/330 dashboards имеют position_json, 3755/3 766 charts имеют datasource_id.
REPEAT SCAN: повторный запуск не изменяет SQLite (readonly).
NO FULL RELOAD: полная выгрузка не выполнялась.
```

## 6. Доказательства

- **Подтверждено API**: Авторизация не удалась: TypeError: ECONNREFUSED: Unable to connect. Is the computer able to access the url?
- **Подтверждено локально**: целостность SQLite, уникальность ID, JSON-валидность, SQL в list-payload.
- **Невозможно проверить**: фактическое количество объектов на сервере (если count усечён MAX_PAGES).
- **Отсутствуют**: dataset_detail (0), relations (0).
- **Восстановимо локально**: Dashboard→Chart (из position_json), Chart→Dataset (из datasource_id в chart_detail).
- **Точечные запросы**: 3 767 dataset_detail, 1 234 chart_detail без datasource_id, 1 dashboard_detail без position_json.
- **Блокирующие проблемы**: (1) dataset_detail недоступны; (2) 5 000 chart могут быть усечены лимитом пагинации.
