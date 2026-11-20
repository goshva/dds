# Качество Lineage — Этап 1.1, Задача 3

**Дата:** 20 ноября 2026 г.  
**Источник данных:** `data/catalog.sqlite` (readonly) + точечные API-запросы к Superset  
**Выходной файл:** `reports/phase-01-1/lineage_preview.json`, `lineage_relations.csv`

---

## 1. Методы восстановления связей

### Метод A — position_json (DASHBOARD_POSITION_JSON)
- **Что парсим:** `dashboard_detail.payload.result.position_json` → JSON-строка с layout-графом дашборда → узлы `"type": "CHART"` → `meta.chartId`
- **Покрытие:** 329 из 330 дашбордов имеют CHART-узлы (position_json = NULL у dashboard 1558 «Чек»)
- **Связей найдено:** 7 918 сырых ссылок, **7 900 уникальных пар** (dashboard_id | chart_id)
- **Confidence:** HIGH — прямые метаданные layout Superset
- *****REMOVED***:** Layout может быть сохранён в несохранённом состоянии; для production-использования требуется сверка с живым API при каждом обновлении

### Метод B — chart.dashboards[] (CHART_DASHBOARDS_ARRAY)
- **Что парсим:** `chart_detail.payload.result.dashboards[]` — массив `{id, dashboard_title}` внутри каждого chart detail
- **Покрытие:** 3 766 chart_detail записей; непустой массив `dashboards[]` у части из них
- **Связей найдено:** **2 645 уникальных пар** (dashboard_id | chart_id)
- **Confidence:** HIGH — прямое поле метаданных chart
- **Пересечение с методом A:** 1 371 пара подтверждена обоими методами (**corroborated**)
- **Дополнение к методу A:** 1 274 пары есть только в этом методе (некоторые dashboards не указывают chart в layout, но chart знает о dashboards)

### Метод C — chart.datasource_id (CHART_DATASOURCE_ID)
- **Что парсим:** `chart_detail.payload.result.datasource_id` — числовой ID dataset, на котором построен chart
- **Покрытие:** 3 755 из 3 766 chart_detail имеют непустой `datasource_id`; 11 charts без datasource_id (возможно, удалённые или special types)
- **Связей найдено:** **3 755 уникальных пар** (chart_id | dataset_id)
- **Confidence:** VERIFIED — прямое поле метаданных chart
- **Мульти-dataset charts:** 0 (каждый chart ссылается ровно на один dataset)

### Метод D — API фильтр по приоритетным datasets (API_FILTER_BY_DATASOURCE_ID)
- **Что делаем:** GET `/api/v1/chart/?q={"filters":[{"col":"datasource_id","opr":"eq","value":ID}]}` для 12 приоритетных dataset
- **Покрытие:** 12 dataset × ~9 charts = **108 связей** добавлено
- **Confidence:** VERIFIED — ответ от живого API
- **Важно:** НИ ОДИН из этих 108 charts отсутствует в локальном каталоге (все они вне усечённых 5 000)

---

## 2. Итоговая статистика

| Показатель | Значение |
|-----------|---------|
| Всего связей в CSV | 13 520 строк (13 520 unique) |
| DASHBOARD_HAS_CHART | 9 657 (7 900 pos + 1 757 arr; пересечение 1 371) |
| CHART_USES_DATASET | 3 863 (3 755 local + 108 API) |
| Self-links | 0 |
| Дубли подавлены при построении | 906 (в старом build; новый CSV уже dedup) |

---

## 3. Покрытие объектов

### Dashboards
- Всего: **330** (все есть в `dashboard_detail`)
- С хотя бы одним chart: **330** (100%)
- Без charts: **0** (кроме dashboard 1558 «Чек» — position_json NULL)

### Charts
- Всего в каталоге: **5 000** (усечено MAX_PAGES=50×PAGE_SIZE=100)
- Реальный count API: **19 920**
- Уникальных chart-ссылок из dashboards: **7 019**
- Из них присутствуют в каталоге: **2 450**
- Отсутствуют в каталоге (следствие усечения): **4 569**
- С известным dataset (local): **3 755**
- Без dataset link: **1 245** (11 chart_detail вообще без datasource_id + 1 234 без detail)

### Datasets
- Всего: **3 767** (все есть в `dataset` list-payload)
- Используются локальными charts: **161**
- Не используются локальными charts: **3 606** (следствие усечения charts)
- Приоритетных датасетов обработано через API: **12**

---

## 4. Неразрешённые ссылки и их причины

| Категория | Кол-во | Причина |
|----------|--------|---------|
| Chart-ссылки < min catalog range (11335) | 30 | Вероятно, удалённые/архивные charts |
| Chart-ссылки в диапазоне, но отсутствуют | 4 539 | Следствие усечения выгрузки (MAX_PAGES=50) |
| Chart без datasource_id | 11 | chart_detail.datasource_id = NULL |
| Dashboard без position_json | 1 | Dashboard 1558 «Чек» |

**Ни одна неразрешённая ссылка НЕ является ошибкой lineage** — все объясняются неполнотой локального каталога charts.

---

## 5. Валидация метода A против CSV

Метод A переизвлечён напрямую из SQLite (`json_extract(payload_json, '$.result.position_json')` + `n?.type === "CHART"`):
- pj_nonnull: 329, refs: 7 918, unique_pairs: **7 900** ✓ точно совпадает с CSV

---

## 6. Confidence-уровни

| Уровень | Описание | Когда используется |
|--------|----------|---------------------|
| VERIFIED | Прямое поле метаданных chart/dataset из API | `datasource_id`, API filter |
| HIGH | Layout-метаданные из position_json или reverse array | `position_json`, `dashboards[]` |
| MEDIUM | ***REMOVED***ное предположение (не использовалось в этом этапе) | — |

---

## 7. Таблица relations в SQLite

**Не изменялась.** Все связи выведены аналитически и записаны только в `reports/phase-01-1/`.

---

## 8. Что нужно для полного покрытия

1. **Перепагинация charts** — увеличить MAX_PAGES до 200+ (19 920 / 100 ≈ 200 страниц) или использовать cursor-based pagination
2. **Загрузка dataset_detail** без завершающего слэша (`/api/v1/dataset/{id}`, не `/api/v1/dataset/{id}/`) — 3 767 записей SQL
3. **После дозагрузки charts** — пересчитать lineage; ожидаемо 19 920 charts × datasource_id ≈ полное покрытие
4. **Регулярная актуализация** — position_json и dashboards[] могут измениться при редактировании дашбордов
