# VkusVill Courier Discovery — Bun v0.3

Версия 0.3 — локальный анализ уже собранного каталога Superset. Она не требует входа в Superset и не выполняет запросы к исходным БД.

## Что изменилось после анализа результатов v0.1

В предоставленном `discovery_summary.json` обнаружено:
- 330 Dashboard;
- 5 000 Chart;
- 3 767 Dataset;
- 5 660 HTTP 401 ошибок;
- 3 767 ошибок `dataset_detail`, 1 233 ошибки `chart_detail`;
- 330 ошибок получения связей Dashboard → Charts и 330 Dashboard → Datasets.

Таблица `relations` в SQLite пуста. Следовательно, первая версия собрала списки объектов, но не построила граф связей. Токен истёк во время получения подробностей.

## Требования

- Bun 1.1+
- существующий `catalog.sqlite` от первой версии

## ***REMOVED***

<ФИО> архив. Из корня проекта:

```bash
bun install
```

## ***REMOVED***

<ФИО> к SQLite можно передать первым аргументом или через `CATALOG_DB`.

```bash
# Проверка структуры, объёмов, связей и целостности
bun run audit -- ../data/catalog.sqlite

# Сводка ошибок первой выгрузки
bun run summary -- ../data/discovery_summary.json

# Поиск Dataset по словам в названии, SQL, схеме и каталоге
bun run search -- ../data/catalog.sqlite courier delivery курьер

# Посмотреть конкретную запись
bun run object -- ../data/catalog.sqlite dataset 4732

# Поиск по нескольким важным признакам
bun run search -- ../data/catalog.sqlite id_courier date_delivered courier_id
```

<ФИО> должен указывать на реальный файл. Если проект распакован рядом с папкой `data`, пример `../data/catalog.sqlite` подходит.

## ***REMOVED***

***REMOVED*** `audit` и `summary` печатают JSON в терминал. Для сохранения:

```bash
bun run audit -- ../data/catalog.sqlite > catalog-audit.json
bun run summary -- ../data/discovery_summary.json > discovery-errors.json
bun run search -- ../data/catalog.sqlite courier delivery > courier-datasets.json
```

## Важные ограничения

- `dataset` в каталоге — это метаданные Dataset, не выгруженные строки из исходной БД.
- Наличие SQL в virtual Dataset показывает определение запроса, но не доказывает, что его можно выполнить.
- <ФИО>т проект не выполняет SQL и не пытается обходить ограничения доступа.
- Не передавайте файлы `.env`, cookies, JWT или сессионные токены.
- SQLite открывается в режиме `readonly`; данные каталога не меняются.
- Не удаляйте `-wal` и `-shm` во время работы первой версии или пока SQLite не закрыта корректно.

## Следующий этап

После локального анализа следует исправить получение метаданных:
1. обновлять access token при 401 штатным способом Superset;
2. ограничить параллелизм запросов;
3. повторять только неуспешные detail-запросы;
4. сохранять прогресс после каждого объекта;
5. строить `relations` из dashboard charts/datasets;
6. отдельно проверять приоритетные Dataset и фактическую доступность `chart/data`.

Не запускайте повторное полное обнаружение, пока не проверена текущая SQLite-копия.
