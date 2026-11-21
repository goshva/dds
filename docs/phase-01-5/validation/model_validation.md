# Валидация модели (Этап 1.5)

Статус: **PASS**

- [PASS] tables_unique — tables=25, unique=25
- [PASS] every_table_has_pk — у каждой таблицы есть PK
- [PASS] columns_unique_in_table — колонки уникальны
- [PASS] fk_targets_exist — все FK указывают на существующие таблицы/колонки
- [PASS] fk_types_compatible — типы FK совместимы
- [PASS] lifecycle_states_defined — состояния жизненных циклов описаны в таблицах
- [PASS] events_unique — events=58, unique=58
- [PASS] events_payload_nonempty — у всех событий есть payload
- [PASS] events_groups_valid — группы событий корректны
- [PASS] invariants_reference_tables — инвариантов 36, таблицы существуют
- [PASS] mapping_domain_tables_exist — mapping строк=60
- [PASS] direct_mapping_has_source — DIRECT-строки имеют источник
- [PASS] migrations_cover_tables — все таблицы покрыты ровно одной миграцией
- [PASS] json_schemas_valid — JSON Schema конверта и ключевых событий корректны
- [PASS] mermaid_valid — Mermaid-схемы корректны
- [PASS] fixtures_no_pii — fixtures: 15 строк, PII нет
- [PASS] ddl_draft_valid — DDL draft: 25 таблиц, все с пометкой DRAFT
- [PASS] ddl_defaults_quoted — строковые DEFAULT заключены в кавычки
- [PASS] decisions_unique — decisions=24, unique=24
- [PASS] business_rules_present — business_rules=40, agreed=34, tbd=6
- [PASS] writer_paths_allowed — генератор пишет только в docs/phase-01-5
- [PASS] catalog_sqlite_unchanged — counts совпадают с backup
- [PASS] typescript_compile — bunx tsc --noEmit exit 0
- [PASS] model_tests — локальные тесты модели пройдены
- [PASS] docs_no_pii — PII/секретов в артефактах этапа нет
