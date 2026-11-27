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

---

## Быстрый старт (новый компьютер)

### 1. Требования

| Компонент | Минимальная версия | Windows | Ubuntu / Linux |
|---|---|---|---|
| [Bun](https://bun.sh) | 1.1+ | ✅ `winget install oven.bun` | ✅ `curl -fsSL https://bun.sh/install | bash` |
| Node.js | *не нужен* | — | — |

> Bun — единственный runtime проекта. Node.js / npm / yarn не требуются.

### 2. Клонировать и установить

```bash
# Клонировать репозиторий
git clone <repo-url>
cd dds

# Установить зависимости (Hono, Vite, типы)
bun install
```

### 3. Подготовить данные

DSS UI читает данные из **трёх независимых источников**. Каждый можно отсутствовать —
страница покажет «данные недоступны» вместо падения.

| Источник | Путь | Нужен для | Формат |
|---|---|---|---|
| **Canonical CSV** | `data/processed/forecasting/7745/canonical_daily_delivered_orders.csv` | История заказов, Качество данных, Обзор | CSV, колонки `date, shop_no, metric, value, source_slice_id, source_dataset_id, source_run_id, quality_status` |
| **Shadow-хранилище** | `data/shadow/7745/` | Теневой режим, Прогнозы и качество | `forecasts.jsonl`, `reconciliations.jsonl`, `errors.jsonl`, `manifest.json` |
| **SQLite-каталог** | `data/catalog.sqlite` | Только CLI-команды (`audit`, `search`, `object`) | SQLite (read-only) |

> **Важно:** `catalog.sqlite` **не** является источником данных для DSS UI.
> Веб-панель читает canonical CSV и Shadow-файлы; SQLite нужен только утилитам анализа.

Минимальная структура:

```
data/
├── processed/forecasting/7745/
│   └── canonical_daily_delivered_orders.csv   ← источник истории (обязателен для UI)
├── shadow/7745/
│   ├── forecasts.jsonl                        ← источник прогнозов и качества
│   ├── reconciliations.jsonl
│   ├── errors.jsonl
│   └── manifest.json
└── catalog.sqlite                             ← только для CLI-команд
```

> Если canonical CSV отсутствует, API вернёт `DATA_SOURCE_UNAVAILABLE`, и страницы
> «История»/«Качество»/«Обзор» покажут состояние «данные недоступны».
> Если пуст `data/shadow/7745/`, страница «Прогнозы и качество» вернёт `NOT_AVAILABLE`.

Сгенерировать canonical CSV из SQLite (если каталог уже есть):

```bash
bun run forecast:canonical --shop 7745
```


### 4. Запустить

#### Вариант A: CLI только (локальный анализ)

```bash
# Проверка структуры и целостности SQLite
bun run audit -- data/catalog.sqlite

# Сводка ошибок первой выгрузки
bun run summary -- data/discovery_summary.json

# Поиск Dataset по ключевым словам
bun run search -- data/catalog.sqlite courier delivery курьер

# Конкретная запись
bun run object -- data/catalog.sqlite dataset 4732
```

#### Вариант B: API + Frontend (интерактивная панель DSS)

Открыть **два терминала**.

**Терминал 1 — API-сервер (Hono):**

```bash
bun run api:start
# → [dss-api] read-only API on http://127.0.0.1:8787
```

**Терминал 2 — Frontend (Vite dev):**

```bash
bun run ui:dev
# → VITE v8.3.8 ready on http://127.0.0.1:5173
```

Открыть в браузере: **http://127.0.0.1:5173**

> Vite автоматически проксирует `/api/v1/*` и `/api/health` на API-сервер (port 8787).

#### Вариант C: Production-сборка

```bash
# Собрать фронтенд
bun run ui:build
# → dist/web/index.html

# Запустить API + встроенный HTTP-сервер с фронтендом
bun run api:start
# → фронтенд отдаётся из dist/web, API — 127.0.0.1:8787
```

### 5. Тесты

```bash
# Все тесты (server + web + forecasting)
bun test

# Только UI-тесты
bun run ui:test

# Тесты forecasting
bun run forecast:test
```

---

## Требования

- Bun 1.1+
- существующий `catalog.sqlite` от первой версии

## Важные ограничения

- `dataset` в каталоге — это метаданные Dataset, не выгруженные строки из исходной БД.
- Наличие SQL в virtual Dataset показывает определение запроса, но не доказывает, что его можно выполнить.
- Проект не выполняет SQL и не пытается обходить ограничения доступа.
- Не передавайте файлы `.env`, cookies, JWT или сессионные токены.
- SQLite открывается в режиме `readonly`; данные каталога не меняются.
- Не удаляйте `-wal` и `-shm` во время работы первой версии или пока SQLite не закрыта корректно.

## Конфигурация

Проект читает переменные окружения из `.env` (или `.env.example` для подсказок). Основные:

| Переменная | Описание | По умолчанию |
|---|---|---|
| `SUPERSET_URL` | URL Superset (для извлечения данных) | — |
| `SUPERSET_USERNAME` | Логин Superset | — |
| `SUPERSET_PASSWORD` | Пароль Superset | — |
| `SUPERSET_ACCESS_TOKEN` | JWT-токен (если доступен) | — |
| `DSS_API_PORT` | Порт API-сервера | `8787` |
| `HTTP_TIMEOUT_SECONDS` | Таймаут HTTP-запросов | `30` |
| `PAGE_SIZE` | Размер страницы Superset API | `100` |
| `SQLITE_PATH` | Путь к SQLite-каталогу | `./data/catalog.sqlite` |

Создайте `.env` из примера:

```bash
cp .env.example .env
```

## Структура проекта

```
dds/
├── src/
│   ├── server/          # Hono API-сервер (read-only)
│   │   ├── index.ts     # Точка входа `bun run api:start`
│   │   ├── app.ts       # Hono-приложение, middleware безопасности
│   │   ├── routes.ts    # GET-маршруты API
│   │   └── services/    # Read-models (forecasting-read-models, read-models)
│   ├── web/             # Frontend (Vite)
│   │   ├── main.ts      # Hash-роутинг, render-цикл
│   │   ├── components/  # Атомарные UI-компоненты (TSX-аналоги)
│   │   ├── pages/       # Композиции страниц
│   │   ├── api/client.ts # API-клиент
│   │   ├── styles/      # CSS-токены и компоненты
│   │   └── templates/   # HTML-partial (визуальная спецификация)
│   └── forecasting/     # Forecasting pipeline (не менять!)
├── tests/               # Тесты (server + web + forecasting)
├── data/                # SQLite-каталог и сырые данные
├── docs/ui/             # Аудит и отчёты UI
├── tools/               # Утилиты извлечения (Superset extractor)
├── vite.config.ts       # Vite 8 + proxy /api → Hono
└── package.json         # Скрипты: api:start, ui:dev, ui:build, ui:test
```

## Следующий этап

После локального анализа следует исправить получение метаданных:
1. обновлять access token при 401 штатным способом Superset;
2. ограничить параллелизм запросов;
3. повторять только неуспешные detail-запросы;
4. сохранять прогресс после каждого объекта;
5. строить `relations` из dashboard charts/datasets;
6. отдельно проверять приоритетные Dataset и фактическую доступность `chart/data`.

Не запускайте повторное полное обнаружение, пока не проверена текущая SQLite-копия.
