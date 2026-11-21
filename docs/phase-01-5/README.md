# Этап 1.5 — модель данных курьерской службы

Артефакты спроектированы на основе Phase 1.1–1.4 (read-only). Реальные миграции не применялись,
production-БД не создавалась, Superset и `data/catalog.sqlite` не изменялись, commit/push не выполнялись.

## Состав

- `00_scope_and_assumptions.md` — границы и допущения
- `repository_audit.md` — аудит результатов 1.4 (Gate G0)
- `01_business_rules_register.md` — согласованные правила
- `02_business_decisions_register.md`, `business_decisions_register.csv/json` — открытые решения BD-001…BD-024
- `03_domain_glossary.md` — словарь
- `04_logical_data_model.md` — логическая модель
- `05_physical_data_model.md` + `ddl/postgres/*.sql` (DRAFT)
- `06_er_model.mmd`, `07_order_lifecycle.mmd`, `08_trip_and_queue_lifecycle.mmd`, `09_financial_flow.mmd`
- `10_event_catalog.md`, `11_event_catalog.json`, `schemas/`
- `12_integrity_rules.md`, `13_indexes_and_constraints.md`
- `14_superset_mapping.md`, `superset-to-domain-mapping.csv/json`
- `15_source_of_truth_matrix.csv`, `16_external_id_mapping.md/csv`
- `17_migration_plan.md`, `18_migration_matrix.csv`
- `19_security_and_pii.md`, `20_open_questions.md`, `21_adr/`
- `fixtures/` — синтетические данные
- `validation/` — результаты автопроверок
