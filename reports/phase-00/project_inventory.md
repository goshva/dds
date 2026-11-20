# Этап 0 — Инвентаризация проекта

Дата: 2026-11-20. Режим: только чтение (SQLite readonly, без обращений к Superset).

## 1. Структура проекта

```text
dds/
├── package.json          # vkusvill-courier-discovery v0.3.0, Bun, type=module
├── tsconfig.json
├── .env.example          # SUPERSET_URL, credentials, PAGE_SIZE=100, MAX_PAGES=50, SQLITE_PATH
├── src/                  # 6 модулей (см. ниже)
├── data/
│   ├── catalog.sqlite    # 1 839 284 224 байт; WAL; quick_check/integrity_check = ok
│   └── inspect-catalog.ts
├── docs/                 # FIRST_WAVE_PLAN, ANALYSIS_FROM_FIRST_RUN, ACCESS_MATRIX
├── output/               # raw JSON первой выгрузки + details
│   ├── charts.json (71 MB), datasets.json, dashboards.json
│   ├── courier_candidates.json, discovery_summary.json
│   ├── chart_details/     3 766 файлов
│   ├── dashboard_details/   330 файлов
│   └── dataset_details/     0 файлов  ← пусто (все detail'ы 401)
├── audit.txt / audit_flds.txt / audit_4732.txt   # результаты v0.3 CLI
└── backups/
    └── catalog-before-discovery.sqlite  (создан на этом этапе)
```

## 2. Реализованные модули (src/)

| Модуль | Назначение | Ключевые факты из кода |
|---|---|---|
| `config.ts` | Загрузка `.env` | Требует `SUPERSET_URL` (HTTPS кроме localhost); `PAGE_SIZE=100`, `MAX_PAGES=50`; `SQL_EXECUTION_ENABLED` объявлен в `.env.example`, **в коде не читается** |
| `superset.ts` | HTTP-клиент | Auth: `POST /api/v1/security/login` (username/password/provider, refresh) или готовый JWT `SUPERSET_ACCESS_TOKEN`; заголовок `Bearer`; CSRF `GET /api/v1/security/csrf_token/` (не фатален при ошибке). Пагинация: `GET /api/v1/{resource}/?q=(page:N,page_size:M)` до пустой страницы / `collected>=count` / неполной страницы. `tryGet` глотает ошибки, возвращая `{ok:false,status}` |
| `store.ts` | SQLite-каталог | `objects(object_type,object_id,title,payload_json,collected_at)` PK(type,id); `relations(5 полей + collected_at)` PK из 5 полей; `journal_mode=WAL`; upsert ON CONFLICT |
| `discovery.ts` | Онлайн-выгрузка v0.1 | Список + detail для dashboard/chart/dataset; detail пишется и в `output/*_details/*.json`, и в SQLite как `{type}_detail`; связи — только через `GET /api/v1/dashboard/{id}/charts|datasets`; классификатор кандидатов — подстроки по JSON + score |
| `cli.ts` | Локальный анализ v0.3 (без сети) | Команды `audit`, `summary`, `search`, `object`; SQLite открывается **readonly**; `search` ищет по title/table/schema/catalog/description/sql c эвристическим score |
| `index.ts` | Онлайн-точка входа | Команды `health`, `discovery`, `report` |

## 3. CLI-команды

```bash
bun run audit -- <catalog.sqlite>          # структура, объёмы, связи, quick_check
bun run summary -- <discovery_summary.json> # сводка ошибок первой выгрузки
bun run search -- <catalog.sqlite> <terms…> # поиск dataset по названию/SQL/схеме
bun run object -- <catalog.sqlite> <type> <id>
bun run index.ts health|discovery|report   # онлайн-режим (требует .env)
```

## 4. Тесты

Автотестов в проекте нет (`package.json` → только audit/summary/search/object/help).

## 5. Ограничения и расхождения (документация vs код vs данные)

1. **`dataset_detail` полностью отсутствует** (0 объектов). README/ANALYSIS это подтверждают: 3 767 × HTTP 401. SQL приоритетных датасетов доступен только из **list**-payload (поле `$.sql` есть у 3 514 из 3 767 dataset; kinds: virtual 3 213, physical 554).
2. **`relations` пуста**: связи пытались брать только из `/dashboard/{id}/charts|datasets`, которые дали 401. При этом **в `dashboard_detail` поле `$.result.position_json` заполнено у 329/330** и **в `chart_detail` поле `$.result.datasource_id` заполнено у 3 755/3 766** → граф Dashboard→Chart→Dataset восстанавливается локально, без API (этап 4).
3. Один dashboard_detail без position_json; 11 chart_detail без datasource_id — кандидаты на точечное обновление.
4. `audit.txt` содержит устаревшую статистику первой волны (в нём нет `chart_detail`/`dashboard_detail`); актуальные цифры собраны на этом этапе.
5. Классификатор кандидатов (`discovery.ts`) — подстроковый, с известными ложными срабатываниями (см. ANALYSIS_FROM_FIRST_RUN); требует улучшения на этапе 2.
6. `SQL_EXECUTION_ENABLED` нигде не реализован — механизма выполнения SQL нет (для этапа 5 это блокер, фиксируется).
7. README предупреждает: не удалять `-wal`/`-shm` при активной записи. На момент проверки WAL пуст, записей нет.
8. Пагинация `list()` ограничена `MAX_PAGES=50` при `PAGE_SIZE=100` → максимум 5 000 объектов на ресурс. Ровно столько и получено по chart — **выборка chart может быть усечена лимитом** (countSuperset не перепроверялся). Требует проверки на этапе 1.

## 6. Вывод

Проект собран, CLI работает, каталог читается и целостен, бэкап создан. Основная работа впереди: точечное получение `dataset_detail`, восстановление `relations` из локальных detail, аудит SQL приоритетных датасетов.
