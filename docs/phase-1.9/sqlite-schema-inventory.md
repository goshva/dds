# SQLite schema inventory — Phase 1.9-A

**Сгенерировано:** 2026-11-22T17:31:16.390Z
**Инструмент:** superset-extractor 1.9-A
**Репозиторий:** `C:\soft\bun\dds`

## 1. Найденные SQLite-файлы

| Файл | Размер | Таблиц | Представлений | integrity_check |
|---|---:|---:|---:|---|
| `backups/catalog-before-discovery.sqlite` | 1.71 GiB | 2 | 0 | ok |
| `data/catalog.sqlite` | 1.71 GiB | 2 | 0 | ok |

## 2. Схема файлов

### 2.1. `backups/catalog-before-discovery.sqlite`

SHA-256: `697c4dca238c3c18b6326c26ebe4e544f2c8c5133df26f50ebcc138e0711bace`

| Таблица | Строк | Колонок | FK | Индексы |
|---|---:|---:|---:|---|
| `objects` | 13193 | 5 | 0 | sqlite_autoindex_objects_1 |
| `relations` | 0 | 6 | 0 | sqlite_autoindex_relations_1 |

#### Таблица `objects`

| Колонка | Тип | PK | NOT NULL |
|---|---|---|---|
| `object_type` | TEXT | да | да |
| `object_id` | TEXT | да | да |
| `title` | TEXT | нет | нет |
| `payload_json` | TEXT | нет | да |
| `collected_at` | TEXT | нет | да |

#### Таблица `relations`

| Колонка | Тип | PK | NOT NULL |
|---|---|---|---|
| `parent_type` | TEXT | да | да |
| `parent_id` | TEXT | да | да |
| `child_type` | TEXT | да | да |
| `child_id` | TEXT | да | да |
| `relation_type` | TEXT | да | да |
| `collected_at` | TEXT | нет | да |


### 2.2. `data/catalog.sqlite`

SHA-256: `09e827205ada06b7e395dc3406e49f63eafd33284626269a48fc837529869c0c`

| Таблица | Строк | Колонок | FK | Индексы |
|---|---:|---:|---:|---|
| `objects` | 13193 | 5 | 0 | sqlite_autoindex_objects_1 |
| `relations` | 0 | 6 | 0 | sqlite_autoindex_relations_1 |

#### Таблица `objects`

| Колонка | Тип | PK | NOT NULL |
|---|---|---|---|
| `object_type` | TEXT | да | да |
| `object_id` | TEXT | да | да |
| `title` | TEXT | нет | нет |
| `payload_json` | TEXT | нет | да |
| `collected_at` | TEXT | нет | да |

#### Таблица `relations`

| Колонка | Тип | PK | NOT NULL |
|---|---|---|---|
| `parent_type` | TEXT | да | да |
| `parent_id` | TEXT | да | да |
| `child_type` | TEXT | да | да |
| `child_id` | TEXT | да | да |
| `relation_type` | TEXT | да | да |
| `collected_at` | TEXT | нет | да |

## 2a. Распределение object_type

### `backups/catalog-before-discovery.sqlite`

| object_type | Записей |
|---|---:|
| `chart` | 5000 |
| `dataset` | 3767 |
| `chart_detail` | 3766 |
| `dashboard` | 330 |
| `dashboard_detail` | 330 |

### `data/catalog.sqlite`

| object_type | Записей |
|---|---:|
| `chart` | 5000 |
| `dataset` | 3767 |
| `chart_detail` | 3766 |
| `dashboard` | 330 |
| `dashboard_detail` | 330 |

## 2b. Представления, внешние ключи и связи

- представлений: 0;
- внешних ключей: 0;
- строк в таблице `relations`: 0.

## 3. Основная SQLite DDS

Основная SQLite-база DDS не найдена. Логическая модель DDS этапа 1.8 хранится в файлах:

| Артефакт | Количество |
|---|---:|
| Сущности (`entities.json`) | 39 |
| Атрибуты (`attributes.json`) | 60 |
| Связи (`relationships.json`) | 39 |
| Evidence (`evidence_links.json`) | 40 |
| Решения (`open_decisions.json`) | 37 |
| Документы (`docs/phase-01-8/*.md`) | 14 |

Следовательно, «основная SQLite DDS» на этом этапе отсутствует: DDS-модель — файловая, а не SQLite-база.

## 4. Различия каталога Superset и DDS-модели

| Признак | Каталог Superset | DDS-модель 1.8 |
|---|---|---|
| Хранилище | SQLite `data/catalog.sqlite` | файлы JSON/Markdown |
| Назначение | метаданные Superset | логическая модель данных |
| Сущности | датасеты, чарты, дашборды | бизнес-сущности (ENT-…) |
| Связи | SQL-связи датасетов | логические связи (REL-…) |
| Значения | определения фильтров/метрик | не хранятся |
| Обновление | импорт из Superset | ручная/скриптовая генерация |

## 4a. Модули работы с SQLite

| Файл | Роль |
|---|---|
| `src/store.ts` | запись объектов каталога (`INSERT ... ON CONFLICT`) |
| `src/cli.ts` | чтение каталога для CLI (`readonly`) |
| `src/phase1-audit.ts` | аудит каталога |
| `src/phase1-1-*.ts` | проверки целостности и неизменности |
| `src/phase1-4/validate.ts`, `src/phase1-5/validate.ts`, `src/phase1-6/validate.ts`, `src/phase1-6-2/validate.ts` | сверка SHA-256 и read-only проверки |

## 4b. Миграции и тесты

- отдельного каталога миграций для DDS нет; схема каталога создаётся в `src/store.ts`;
- тесты SQLite: `src/phase1-4/tests/sqlite-readonly.test.ts`, `src/phase1-5/tests/schemas.test.ts`, `src/phase1-6/tests/evidence.test.ts`, `src/phase1-8/tests/model.test.ts`;
- все тесты используют `readonly`-открытие и сверяют неизменность `data/catalog.sqlite`.

## 5. Входные файлы

- `Вставленный текст(20261122-162355).txt`: не найден
- `Вставленный текст(20261122-170117).txt`: не найден

## 6. Безопасность

- PII и секреты в этот документ не выгружались;
- SQLite открывался только в режиме `readonly`;
- HTTP-запросы к Superset не выполнялись.
