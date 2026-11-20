# План первой волны реализации

## Цель

Построить безопасный каталог того, что текущая учётная запись реально видит в Superset VkusVill: dashboards, charts, datasets и их связи. Прямого доступа к базам нет, поэтому первая волна — metadata discovery, не raw data extraction.

## Поток

1. Конфигурация из `.env`.
2. Проверка HTTPS endpoint.
3. Авторизация через штатный REST API или предоставленный JWT.
4. Получение списков dashboards/charts/datasets с пагинацией.
5. Получение деталей объектов.
6. Получение dashboard → charts/datasets relationships.
7. Сохранение raw JSON + нормализованного каталога в SQLite.
8. Классификация объектов на courier-related / unrelated / review.
9. Отчёт о разрешениях и недоступных endpoints.

## Ветви исследования

### A. Dashboards
- Название, slug, id, владелец, описание, URL.
- Детали дашборда.
- Список chart definitions.
- Список datasets, используемых дашбордом.
- Поиск слов: курьер, доставка, логистика, смена, SLA, время доставки.

### B. Charts
- Название, id, описание, viz type.
- Dataset reference.
- Query context / params, если отдаются API.
- Не запускать chart data query в первой волне.
- Сохранять найденные поля и метрики только как metadata.

### C. Datasets
- Название, id, schema/table label, database label (если поле доступно).
- Колонки, типы, метрики, calculated columns, описание.
- Связанные charts/dashboards.
- Отмечать dataset как candidate, если встречаются courier/delivery/time/status/zone/shift поля.

### D. Права доступа
- 401: неавторизован/токен истёк.
- 403: учётной записи не хватает разрешения.
- 404: endpoint отключён/не поддерживается/объект скрыт.
- 5xx: серверная ошибка или gateway.
- Не пытаться обходить эти ответы через внутренние endpoint-ы.

## Результаты

- `catalog.sqlite`: нормализованные метаданные.
- `output/*.json`: raw API ответы.
- `courier_candidates.json`: кандидаты с объяснением score.
- `discovery_summary.json`: статистика и ограничения.

## Решение после первой волны

На совместном просмотре `courier_candidates.json` утвердить:
- какие datasets относятся к курьерам;
- какие поля нужны;
- какие поля исключить (товары, SKU, ассортимент, корзины);
- можно ли получить chart data через разрешённый API;
- нужен ли запрос администратору на read-only API/DB export.

## Вне объёма первой волны

- SQL Lab execution.
- Извлечение произвольных строк.
- Обход ограничений доступа.
- ClickHouse ingestion.
- Прогнозирование / ML.
- Изменение объектов Superset.
