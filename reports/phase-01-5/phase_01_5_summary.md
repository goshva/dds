# Этап 1.5 — Модель данных курьерской службы: итоговый отчёт

**Дата:** 2026-11-21 · **Режим:** проектирование, локальные артефакты, без миграций и production-запросов.
**Вход:** Phase 1.1–1.4 (read-only). **Выход:** `docs/phase-01-5/` (67 файлов), `src/phase1-5/`, этот отчёт.

---

## 1. Статус: PASS

| Gate | Фаза | Статус | Проверено |
|---|---|---|---|
| G0 | 1.5.0 аудит | PASS | артефакты 1.4 фактически проверены, ограничения зафиксированы |
| G1 | 1.5.1 словарь и правила | PASS | 40 бизнес-правил, 24 открытых решения, 14 терминов |
| G2 | 1.5.2 концептуальная модель | PASS | 8 контекстов, агрегаты, кардинальности, источники истины |
| G3 | 1.5.3 логическая модель | PASS | 25 таблиц с PK/FK/unique/nullability/зерном |
| G4 | 1.5.4 событийная модель | PASS | 58 событий, JSON Schema, идемпотентность, correlation |
| G5 | 1.5.5 физическая модель | PASS | ADR-001, типы, индексы, DDL draft (25 таблиц) |
| G6 | 1.5.6 mapping | PASS | 60 строк mapping, 23 строки source of truth, внешние ID |
| G7 | 1.5.7/1.5.8 миграции, качество | PASS | 10 миграций draft, 36 инвариантов, PII-политики |

`reports/phase-01-5/final_validation.json`: 25/25 проверок PASS, 0 FAIL.
`docs/phase-01-5/validation/model_validation.json`: `catalog_sqlite_unchanged=PASS`, `docs_no_pii=PASS`,
`typescript_compile=PASS`, `model_tests=PASS`.

## 2. Аудит результатов 1.4 (G0)

- Все заявленные артефакты 1.4 найдены; расхождений «заявлено, но отсутствует» нет.
- Git: `main`, HEAD `4fab82d`; коммитов/push нет; файлы 1.1/1.2/1.4 не изменялись.
- Подтверждены ограничения: `order_ready` не подтверждён, справочника зон нет, `area_tt` ≠ зона,
  `sum_paid` ≠ доход, `events_qty` ≠ смены, `+3 hour` не объяснён, 5399/7473 имеют битые метрики.

**Новые находки аудита 1.5** (расширяют доказательную базу, статус `INFERRED`):

| Dataset | Что найдено | Влияние |
|---|---|---|
| 5939 `hr_daily_pers_mentors` | `mentorid`, `mentorfio`, `mentor_at_date`, `trainee_*`, `shift_rn_trainee`, `progul` (невыход), `stake` | прямой источник наставничества и невыходов |
| 7802 `shift_time_breakdown` | `id_shift`, `id_courier`, `dt`, `shopno`, `shift_minutes`, `assembly/delivery/wait/useless_minutes` | зерно «смена курьера за день» |
| 7712 | `shift_opened`, `shift_open_time`, проверки selfie/vehicle/bag | открытие смены |
| 7021 | `shift_type`, `is_night_shift`, `hours_on_schedule`, `has_timesheet` | тип и план смены |
| 3466 `darkstore_time_sheet` | `time_ready`, `time_ready_plan`, `deadline_sbor` | кандидат на `ORDER_READY` (BD-013) |
| 2339 `Перенесенные заказы` | `quantity_batch`, `orders_assignment`, «Скорость переназначения» | частичное подтверждение пакета/переназначений |

Следствие: «Смены» — `PARTIAL` (не `NEEDS_EVENT`): историю можно загрузить из 7802/7021/7712,
но реального времени начала/окончания/перерывов в источниках нет.

## 3. Словарь, правила, решения (G1)

- **Бизнес-правила:** 40 (AGREED 34, TBD 6) — заказы, зоны, ходки, очередь, оплата, наставничество, управление.
- **Открытые решения:** 24 (BD-001…BD-024), все `OPEN`, без подстановки выдуманных значений.
- **Словарь:** 14 терминов со статусами (`AGREED`/`TBD`/`NEW`/`PARTIAL`/`PII`).

Критичные для модели решения:

| ID | Вопрос | Почему блокирует |
|---|---|---|
| BD-013 | Кто и когда фиксирует готовность заказа | без него `ready_at` = TBD; кандидат `time_ready` |
| BD-008/BD-024 | Формула тарифа и кто утверждает | без них начисления не создаются |
| BD-001 | Кто назначает новичка куратору | влияет на права `mentorship_assignments` |
| BD-016/BD-017 | Мастер-источники заказа и курьера | определяют направление синхронизации |
| BD-018/BD-019 | СУБД и стек/авторизация | DDL не финализируется |
| BD-002/BD-004/BD-012 | Нет курьера, возврат в очередь, отказ | правила очереди и исключений |

## 4. Концептуальная модель (G2)

Контексты: **Operations, Geo, Workforce, Delivery, Finance, Mentorship, Events, Reference**.
Агрегаты: Order, Trip, Shift, DeliveryAttempt, MentorshipAssignment, DomainEvent.
Разделение: данные существующих источников / данные новой ОС / справочники / вычисляемые показатели.
Источники истины зафиксированы в `15_source_of_truth_matrix.csv` (23 атрибута).

## 5. Логическая модель (G3)

**25 таблиц.** Ключевые зерна:

| Таблица | Зерно |
|---|---|
| orders | 1 строка = 1 заказ |
| order_readiness | 1 строка = 1 попытка готовности |
| trips | 1 строка = 1 ходка |
| trip_orders | 1 строка = 1 заказ в ходке (уникален `(trip_id, sequence_no)`) |
| trip_assignments | 1 строка = 1 назначение |
| delivery_attempts | 1 строка = 1 попытка (уникально `(order_id, attempt_no)`) |
| courier_shifts | 1 строка = 1 смена курьера |
| courier_queue_entries | 1 строка = 1 вход в очередь |
| courier_accruals | 1 строка = 1 начисление по попытке доставки |
| mentorship_assignments | 1 строка = 1 назначение наставника |
| domain_events / courier_events | 1 строка = 1 событие (append-only) |

Особенности: внутренние UUID PK, время `timestamptz` (UTC), деньги `numeric(14,2)` + `currency`,
частичные уникальные индексы для активных сущностей, PII-поля отделены, `order_amount_snapshots` — аналитика, не оплата.

## 6. Событийная модель (G4)

**58 событий** в 6 группах: orders 12, zones 6, couriers_shifts 16, trips_assignments 10, finance 8, mentorship 6.
Обязательный конверт: `event_id, event_type, aggregate_type, aggregate_id, occurred_at, recorded_at,
actor_type, actor_id, source_system, source_event_id, correlation_id, causation_id, idempotency_key,
schema_version, payload`.
JSON Schema: конверт + 8 ключевых событий (`ORDER_READY`, `ORDER_DELIVERED`, `TRIP_ASSIGNED`, `TRIP_DEPARTED`,
`COURIER_ACCRUAL_CREATED`, `MENTORSHIP_ASSIGNED`, `SHIFT_STARTED`, `COURIER_JOINED_QUEUE`).
Правила: append-only, поздние события сохраняют оба времени, ошибки не удаляются, payload валидируется.

## 7. Физическая модель (G5)

- **ADR-001:** рекомендуется PostgreSQL 15+ (конкурентная очередь, транзакции, частичные индексы, PostGIS, jsonb);
  SQLite — только локальный прототип. Решение не принято (BD-018).
- Типы, стратегия гео (PostGIS `geography` или `jsonb` GeoJSON), JSON, append-only, партиционирование.
- **DDL draft:** 10 файлов `ddl/postgres/0001…0010` (25 таблиц), каждый с пометкой `DRAFT ONLY`.
- Индексы и частичные уникальности описаны в `13_indexes_and_constraints.md`.

## 8. Mapping и миграции (G6/G7)

- **Mapping Superset→домен:** 60 строк. DIRECT 22, DERIVED 6, INFERRED 25, UNKNOWN 7.
  Ключевые ограничения: `time_ready` (тип не определён), `id_shift` (универсальность не доказана),
  `mentorid` (string, роль не подтверждена), `sum_paid` (не доход курьера), зоны/тарифы/очередь — новых источников нет.
- **Внешние ID:** `id_courier`/`courier_id`/`ID`/`mentorid`, `shopno`/`id_tt`, `external_order_id`, `id_shift`, `id_pool_calc`.
- **План миграций:** 10 шагов `0001_core_reference … 0010_indexes_constraints`, зависимости, rollback/forward-fix,
  проверки до/после. Миграции **не применялись**.
- **Инварианты:** 36 (orders, zones, trips, queue, shifts, finance, mentorship, events) с типом проверки и тестами.

## 9. Безопасность и PII

10 политик (`19_security_and_pii.md`): адрес доставки, ФИО, телефон/ИНН, `mentorfio`, финансовые записи,
payload, fixtures, экспорт, секреты. Роли: ADMIN, OPERATIONS_MANAGER, GEO_MANAGER, CURATOR, DISPATCHER,
COURIER, HR, FINANCE, READ_ONLY_ANALYST. В отчётах и fixtures PII — **0** (проверка `docs_no_pii`).

## 10. Автоматические проверки

`docs/phase-01-5/validation/model_validation.json` — 25 проверок, все PASS:

PK у каждой таблицы; уникальность колонок; FK существуют и типы совместимы; состояния жизненных циклов
объявлены; события уникальны и имеют payload; инварианты ссылаются на таблицы; mapping ссылается на
существующие таблицы; DIRECT-mapping имеет источник; миграции покрывают каждую таблицу ровно один раз;
JSON Schema валидны; Mermaid-схемы корректны; fixtures без PII; DDL draft с пометкой и корректными
строковыми DEFAULT; решения уникальны;
генератор пишет только в `docs/phase-01-5`; `catalog.sqlite` не изменена; TypeScript компилируется;
20 локальных тестов пройдено; PII в артефактах нет.

## 11. Тесты

`src/phase1-5/tests/` — 20 тестов, 0 fail: модель (PK/FK/типы/жизненные циклы/миграции/инварианты),
инварианты (даты доставки, смен, наставник ≠ новичок, одно начисление на попытку, одна зона/ТТ в ходке,
шестой заказ, READY требует события, `sum_paid` не источник начисления), JSON Schema, неизменность SQLite
и границы записи.

## 12. Подтверждение ограничений

- Реальные миграции не выполнялись; production-таблицы не создавались; ETL/backfill не запускались.
- Superset не опрашивался и не изменялся.
- `data/catalog.sqlite` не изменена (counts совпадают с backup; запись через readonly отклоняется).
- Файлы Phase 1.1/1.2/1.4 не изменялись; PII не загружалась; `.env`/credentials не менялись.
- Commit/push не выполнялись; пользовательские файлы не удалялись.
- Новые файлы: `docs/phase-01-5/`, `reports/phase-01-5/`, `src/phase1-5/`.

## 13. Файлы

```
docs/phase-01-5/                     67 файлов
  00_scope_and_assumptions.md, repository_audit.md
  01_business_rules_register.md
  02_business_decisions_register.md, business_decisions_register.csv/json
  03_domain_glossary.md
  04_logical_data_model.md, 05_physical_data_model.md, 06_conceptual_model.md
  06_er_model.mmd, 07_order_lifecycle.mmd, 08_trip_and_queue_lifecycle.mmd, 09_financial_flow.mmd
  10_event_catalog.md, 11_event_catalog.json
  12_integrity_rules.md, 13_indexes_and_constraints.md
  14_superset_mapping.md, superset-to-domain-mapping.csv/json
  15_source_of_truth_matrix.csv, 16_external_id_mapping.md/csv
  17_migration_plan.md, 18_migration_matrix.csv
  19_security_and_pii.md, 20_open_questions.md
  21_adr/ADR-001…ADR-004
  ddl/postgres/0001…0010 (DRAFT)
  schemas/event-envelope.schema.json, schemas/events/*.schema.json (8)
  fixtures/*.json (10) + README
  validation/model_validation.json/md, schema_lint.json, coverage_matrix.csv
  README.md

src/phase1-5/                        model.ts, registries.ts, generate.ts, validate.ts, pii.ts
                                     tests/model.test.ts, tests/invariants.test.ts, tests/schemas.test.ts
reports/phase-01-5/                  phase_01_5_summary.md, final_validation.json
```

## 14. Воспроизводимость

```
bun src/phase1-5/generate.ts    # пересобрать docs/phase-01-5 из model.ts + registries.ts
bun src/phase1-5/validate.ts    # проверки + docs/phase-01-5/validation/* + reports/phase-01-5/final_validation.json
bun test src/phase1-5/tests     # 20 тестов модели
bunx tsc --noEmit               # типы
```

## 15. Что дальше

1. Согласовать решения BD-001…BD-024, в первую очередь BD-013, BD-008/BD-024, BD-016/BD-017, BD-018.
2. После выбора СУБД (ADR-001) — финализировать DDL и порядок миграций.
3. После разрешения — отдельный этап загрузки/backfill из подтверждённых источников (не в рамках 1.5).
4. Реализация API/UI курьерской системы — вне этапа 1.5.
