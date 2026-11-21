# 05. Физическая модель (DRAFT)

**СУБД:** рекомендуется PostgreSQL 15+ (см. `21_adr/ADR-001-database-choice.md`). SQLite — только прототип.

## Типы

| Логический тип | PostgreSQL | SQLite (прототип) |
|---|---|---|
| UUID | uuid | TEXT |
| TEXT | text | TEXT |
| INTEGER | integer | INTEGER |
| BIGINT | bigint | INTEGER |
| BOOLEAN | boolean | INTEGER |
| TIMESTAMPTZ | timestamptz | TEXT |
| DATE | date | TEXT |
| NUMERIC | numeric(14,2) | NUMERIC |
| JSONB | jsonb | TEXT |
| GEOGRAPHY | geography(POLYGON,4326) | TEXT |
| DOUBLE | double precision | REAL |

## Решения

- Время — `timestamptz`, хранение в UTC.
- Деньги — `numeric(14,2)` + `currency`.
- Геоданные — PostGIS `geography`; альтернатива — `jsonb` с GeoJSON, если PostGIS недоступен (TBD BD-018).
- JSON — `jsonb` с JSON Schema валидацией на уровне приложения.
- Append-only события — без UPDATE/DELETE (права БД + триггеры опционально).
- Частичные уникальные индексы — PostgreSQL `WHERE`; в SQLite эмулируются транзакцией.

## Индексы и ограничения

См. `13_indexes_and_constraints.md` и `ddl/postgres/*.sql` (DRAFT).
