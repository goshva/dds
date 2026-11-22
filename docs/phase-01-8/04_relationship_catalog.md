# 04 — Relationship Catalog

**Сгенерировано:** 2026-11-22T15:07:15.503Z  
**Всего связей:** 39

## 1. Каталог

| ID | From | To | Имя | Cardinality | Optionality | Kind | Статус | Confidence | Evidence | Обоснование |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REL-001 | ENT-TRIP | ENT-TRIP-ORDER | contains | 1:N | UNKNOWN | BUSINESS_CONCEPT | BUSINESS_RULE | HIGH | EVD-015, EVD-016 | Поездка содержит несколько заказов по бизнес-определению. |
| REL-002 | ENT-TRIP-ORDER | ENT-ORDER | refers_to | N:1 | UNKNOWN | INFERRED | INFERRED_RELATIONSHIP | LOW | EVD-003 | id_pool и id_order встречаются в одном SQL; состав не доказан. |
| REL-003 | ENT-COURIER-ASSIGNMENT | ENT-TRIP | assigns | N:1 | UNKNOWN | INFERRED | INFERRED_RELATIONSHIP | LOW | EVD-003 | courier_id_darkstore и id_pool встречаются в одном SQL. |
| REL-004 | ENT-TRIP | ENT-COURIER | assigned_courier | N:1 | UNKNOWN | INFERRED | INFERRED_RELATIONSHIP | LOW | EVD-003 | Курьер связан с поездкой через назначение. |
| REL-005 | ENT-COURIER-SHIFT | ENT-COURIER | worked_by | N:1 | UNKNOWN | SQL_JOIN | SQL_JOIN_CANDIDATE | MEDIUM | EVD-002 | id_courier и id_shift присутствуют в SQL 7802. |
| REL-006 | ENT-QUEUE-ENTRY | ENT-COURIER | queued_by | N:1 | UNKNOWN | SQL_JOIN | SQL_JOIN_CANDIDATE | MEDIUM | EVD-002 | courier_id и queue_in_dttm присутствуют в SQL 7802. |
| REL-007 | ENT-DELIVERY | ENT-ORDER | delivers | N:1 | UNKNOWN | INFERRED | INFERRED_RELATIONSHIP | MEDIUM | EVD-001, EVD-003 | date_delivered и id_order присутствуют в одном SQL. |
| REL-008 | ENT-ORDER | ENT-DARKSTORE | fulfilled_at | N:1 | UNKNOWN | SQL_JOIN | SQL_JOIN_CANDIDATE | MEDIUM | EVD-001 | shopno присутствует в SQL заказов. |
| REL-009 | ENT-COURIER | ENT-DARKSTORE | works_at | N:1 | UNKNOWN | INFERRED | INFERRED_RELATIONSHIP | LOW | EVD-011 | shopno и id_courier присутствуют в HR-датасете. |
| REL-010 | ENT-READY-EVENT | ENT-ORDER | ready_for | 1:1 | UNKNOWN | BUSINESS_CONCEPT | NOT_VERIFIABLE | NONE | EVD-001 | Событие готовности требуется бизнесом, но источник не найден. |
| REL-011 | ENT-ASSEMBLY-EVENT | ENT-ORDER | assembled_for | N:1 | UNKNOWN | INFERRED | INFERRED_RELATIONSHIP | MEDIUM | EVD-001 | date_collect_start и date_collected присутствуют в SQL. |
| REL-012 | ENT-ORDER | ENT-ADDRESS | delivered_to | N:1 | UNKNOWN | INFERRED | INFERRED_RELATIONSHIP | LOW | EVD-032 | Адрес доставки подразумевается, но мастер-реестр не подтверждён. |
| REL-013 | ENT-ADDRESS | ENT-DELIVERY-ZONE | belongs_to | N:1 | UNKNOWN | BUSINESS_CONCEPT | NOT_VERIFIABLE | NONE | EVD-009 | Правило привязки адреса к зоне есть, источник не найден. |
| REL-014 | ENT-DELIVERY-ZONE | ENT-DARKSTORE | served_by | 1:1 | UNKNOWN | BUSINESS_CONCEPT | BUSINESS_RULE | HIGH | EVD-009 | Одна зона = одна ТТ плюс территория. |
| REL-015 | ENT-TARIFF | ENT-COURIER-ACCRUAL | prices | 1:N | UNKNOWN | BUSINESS_CONCEPT | NOT_VERIFIABLE | NONE | EVD-029 | Тариф определяет начисление, но источник не найден. |
| REL-016 | ENT-COURIER-ACCRUAL | ENT-DELIVERY | accrued_for | 1:1 | UNKNOWN | BUSINESS_CONCEPT | NOT_VERIFIABLE | NONE | EVD-018 | Начисление за доставленный заказ; ledger не найден. |
| REL-017 | ENT-COURIER-ACCRUAL | ENT-PAYOUT | paid_in | N:1 | UNKNOWN | BUSINESS_CONCEPT | NOT_VERIFIABLE | NONE | EVD-028 | Начисление и выплата — разные сущности. |
| REL-018 | ENT-HR-MENTORSHIP | ENT-COURIER | mentors | N:1 | UNKNOWN | INFERRED | INFERRED_RELATIONSHIP | LOW | EVD-006 | mentorid присутствует в HR-датасете. |
| REL-019 | ENT-COURIER-EVENT | ENT-COURIER | logged_for | N:1 | UNKNOWN | SQL_JOIN | SQL_JOIN_CANDIDATE | MEDIUM | EVD-008 | courier_id присутствует в агрегате событий. |
| REL-020 | ENT-SLA-METRIC | ENT-ORDER | measured_on | N:1 | UNKNOWN | INFERRED | INFERRED_RELATIONSHIP | MEDIUM | EVD-038 | SLA-поля присутствуют в SQL заказов. |
| REL-021 | ENT-TRIP-ORDER | ENT-TRIP | belongs_to | N:1 | UNKNOWN | BUSINESS_CONCEPT | BUSINESS_RULE | HIGH | EVD-015 | Состав принадлежит поездке. |
| REL-022 | ENT-COURIER-ASSIGNMENT | ENT-COURIER | assigns_courier | N:1 | UNKNOWN | INFERRED | INFERRED_RELATIONSHIP | LOW | EVD-003 | Назначение связывает курьера и поездку. |
| REL-023 | ENT-POOL | ENT-TRIP | maps_to | UNKNOWN | UNKNOWN | MAPPING | INFERRED_RELATIONSHIP | LOW | EVD-003 | Pool — наблюдаемое понятие; Trip — бизнес-поездка; равенство не доказано. |
| REL-024 | ENT-QUEUE-EVENT | ENT-QUEUE-ENTRY | event_of | N:1 | UNKNOWN | INFERRED | INFERRED_RELATIONSHIP | LOW | EVD-033 | События вызова/пропуска подразумеваются, но event log не найден. |
| REL-025 | ENT-SHIFT-BREAK | ENT-COURIER-SHIFT | break_of | N:1 | UNKNOWN | INFERRED | NOT_VERIFIABLE | NONE | EVD-002 | Перерыв упоминается бизнесом, но отдельная сущность не найдена. |
| REL-026 | ENT-SHIFT-SLOT | ENT-COURIER-SHIFT | planned_as | 1:1 | UNKNOWN | BUSINESS_CONCEPT | NOT_VERIFIABLE | NONE | EVD-034 | Слот и смена — разные понятия; процесс не определён. |
| REL-027 | ENT-ROUTE | ENT-TRIP | route_of | 1:1 | UNKNOWN | INFERRED | INFERRED_RELATIONSHIP | LOW | EVD-026 | Маршрут и поездка связаны, но соответствие не доказано. |
| REL-028 | ENT-PHOTO-CONTROL | ENT-COURIER-SHIFT | photo_of | N:1 | UNKNOWN | INFERRED | INFERRED_RELATIONSHIP | LOW | EVD-012 | Фото-контроль связан со сменой, но связь не доказана. |
| REL-029 | ENT-ORDER-STATUS | ENT-ORDER | status_of | N:1 | UNKNOWN | INFERRED | INFERRED_RELATIONSHIP | MEDIUM | EVD-014 | Статус относится к заказу. |
| REL-030 | ENT-HR-COURIER-STATUS | ENT-COURIER | status_of | N:1 | UNKNOWN | INFERRED | INFERRED_RELATIONSHIP | MEDIUM | EVD-011 | HR-статус относится к курьеру. |
| REL-031 | ENT-MENTORSHIP-ASSESSMENT | ENT-HR-MENTORSHIP | assesses | N:1 | UNKNOWN | BUSINESS_CONCEPT | NOT_VERIFIABLE | NONE | EVD-019 | Оценка обучения требуется бизнесом, источник не найден. |
| REL-032 | ENT-TRIP-COMPOSITION-CHANGE | ENT-TRIP | change_of | N:1 | UNKNOWN | BUSINESS_CONCEPT | BUSINESS_RULE | HIGH | EVD-016 | Изменения состава должны иметь историю. |
| REL-033 | ENT-COURIER-ASSIGNMENT | ENT-TRIP-ORDER | assignment_scope | 1:N | UNKNOWN | PROPOSED | PROPOSED | LOW | EVD-015 | Назначение может относиться к поездке, а не к отдельному заказу. |
| REL-034 | ENT-BUSINESS-EVENT | ENT-SOURCE-SYSTEM | emitted_by | N:1 | UNKNOWN | PROPOSED | PROPOSED | LOW | EVD-037 | Единая модель событий не обоснована. |
| REL-035 | ENT-EVIDENCE-REFERENCE | ENT-SOURCE-SYSTEM | references | N:1 | UNKNOWN | PROPOSED | PROPOSED | HIGH | EVD-021 | Технический реестр evidence. |
| REL-036 | ENT-TARIFF | ENT-TARIFF-VERSION | has_versions | 1:N | UNKNOWN | BUSINESS_CONCEPT | BUSINESS_RULE | HIGH | EVD-018, EVD-029 | Тарифы должны быть версионируемыми; конкретная модель версий не подтверждена. |
| REL-037 | ENT-TARIFF-VERSION | ENT-TARIFF-RULE | contains_rules | 1:N | UNKNOWN | BUSINESS_CONCEPT | BUSINESS_RULE | MEDIUM | EVD-018, EVD-029 | Правила расчёта входят в версию тарифа; формула не утверждена. |
| REL-038 | ENT-COURIER-ACCRUAL | ENT-ACCRUAL-LINE | has_lines | 1:N | UNKNOWN | BUSINESS_CONCEPT | PROPOSED | LOW | EVD-018 | Начисление за доставленный заказ; детализация по строкам — проектное предложение. |
| REL-039 | ENT-PAYOUT | ENT-PAYOUT-LINE | has_lines | 1:N | UNKNOWN | BUSINESS_CONCEPT | PROPOSED | LOW | EVD-028 | Выплата состоит из строк; источник не подтверждён. |

## 2. Группировка по kind

### BUSINESS_CONCEPT (15)

| ID | From | To | Cardinality | Статус |
| --- | --- | --- | --- | --- |
| REL-001 | ENT-TRIP | ENT-TRIP-ORDER | 1:N | BUSINESS_RULE |
| REL-010 | ENT-READY-EVENT | ENT-ORDER | 1:1 | NOT_VERIFIABLE |
| REL-013 | ENT-ADDRESS | ENT-DELIVERY-ZONE | N:1 | NOT_VERIFIABLE |
| REL-014 | ENT-DELIVERY-ZONE | ENT-DARKSTORE | 1:1 | BUSINESS_RULE |
| REL-015 | ENT-TARIFF | ENT-COURIER-ACCRUAL | 1:N | NOT_VERIFIABLE |
| REL-016 | ENT-COURIER-ACCRUAL | ENT-DELIVERY | 1:1 | NOT_VERIFIABLE |
| REL-017 | ENT-COURIER-ACCRUAL | ENT-PAYOUT | N:1 | NOT_VERIFIABLE |
| REL-021 | ENT-TRIP-ORDER | ENT-TRIP | N:1 | BUSINESS_RULE |
| REL-026 | ENT-SHIFT-SLOT | ENT-COURIER-SHIFT | 1:1 | NOT_VERIFIABLE |
| REL-031 | ENT-MENTORSHIP-ASSESSMENT | ENT-HR-MENTORSHIP | N:1 | NOT_VERIFIABLE |
| REL-032 | ENT-TRIP-COMPOSITION-CHANGE | ENT-TRIP | N:1 | BUSINESS_RULE |
| REL-036 | ENT-TARIFF | ENT-TARIFF-VERSION | 1:N | BUSINESS_RULE |
| REL-037 | ENT-TARIFF-VERSION | ENT-TARIFF-RULE | 1:N | BUSINESS_RULE |
| REL-038 | ENT-COURIER-ACCRUAL | ENT-ACCRUAL-LINE | 1:N | PROPOSED |
| REL-039 | ENT-PAYOUT | ENT-PAYOUT-LINE | 1:N | PROPOSED |

### SQL_JOIN (4)

| ID | From | To | Cardinality | Статус |
| --- | --- | --- | --- | --- |
| REL-005 | ENT-COURIER-SHIFT | ENT-COURIER | N:1 | SQL_JOIN_CANDIDATE |
| REL-006 | ENT-QUEUE-ENTRY | ENT-COURIER | N:1 | SQL_JOIN_CANDIDATE |
| REL-008 | ENT-ORDER | ENT-DARKSTORE | N:1 | SQL_JOIN_CANDIDATE |
| REL-019 | ENT-COURIER-EVENT | ENT-COURIER | N:1 | SQL_JOIN_CANDIDATE |

### INFERRED (16)

| ID | From | To | Cardinality | Статус |
| --- | --- | --- | --- | --- |
| REL-002 | ENT-TRIP-ORDER | ENT-ORDER | N:1 | INFERRED_RELATIONSHIP |
| REL-003 | ENT-COURIER-ASSIGNMENT | ENT-TRIP | N:1 | INFERRED_RELATIONSHIP |
| REL-004 | ENT-TRIP | ENT-COURIER | N:1 | INFERRED_RELATIONSHIP |
| REL-007 | ENT-DELIVERY | ENT-ORDER | N:1 | INFERRED_RELATIONSHIP |
| REL-009 | ENT-COURIER | ENT-DARKSTORE | N:1 | INFERRED_RELATIONSHIP |
| REL-011 | ENT-ASSEMBLY-EVENT | ENT-ORDER | N:1 | INFERRED_RELATIONSHIP |
| REL-012 | ENT-ORDER | ENT-ADDRESS | N:1 | INFERRED_RELATIONSHIP |
| REL-018 | ENT-HR-MENTORSHIP | ENT-COURIER | N:1 | INFERRED_RELATIONSHIP |
| REL-020 | ENT-SLA-METRIC | ENT-ORDER | N:1 | INFERRED_RELATIONSHIP |
| REL-022 | ENT-COURIER-ASSIGNMENT | ENT-COURIER | N:1 | INFERRED_RELATIONSHIP |
| REL-024 | ENT-QUEUE-EVENT | ENT-QUEUE-ENTRY | N:1 | INFERRED_RELATIONSHIP |
| REL-025 | ENT-SHIFT-BREAK | ENT-COURIER-SHIFT | N:1 | NOT_VERIFIABLE |
| REL-027 | ENT-ROUTE | ENT-TRIP | 1:1 | INFERRED_RELATIONSHIP |
| REL-028 | ENT-PHOTO-CONTROL | ENT-COURIER-SHIFT | N:1 | INFERRED_RELATIONSHIP |
| REL-029 | ENT-ORDER-STATUS | ENT-ORDER | N:1 | INFERRED_RELATIONSHIP |
| REL-030 | ENT-HR-COURIER-STATUS | ENT-COURIER | N:1 | INFERRED_RELATIONSHIP |

### PROPOSED (3)

| ID | From | To | Cardinality | Статус |
| --- | --- | --- | --- | --- |
| REL-033 | ENT-COURIER-ASSIGNMENT | ENT-TRIP-ORDER | 1:N | PROPOSED |
| REL-034 | ENT-BUSINESS-EVENT | ENT-SOURCE-SYSTEM | N:1 | PROPOSED |
| REL-035 | ENT-EVIDENCE-REFERENCE | ENT-SOURCE-SYSTEM | N:1 | PROPOSED |

### MAPPING (1)

| ID | From | To | Cardinality | Статус |
| --- | --- | --- | --- | --- |
| REL-023 | ENT-POOL | ENT-TRIP | UNKNOWN | INFERRED_RELATIONSHIP |

## 3. Запрещённые трактовки

- SQL JOIN не является внешним ключом.
- Наличие `id_*` не доказывает уникальность или ссылочную целостность.
- `VERIFIED_BY_DATA` не используется: фактическая выборка строк не выполнялась.
- Связи `Pool` ↔ `Trip` помечены как `INFERRED` / `MAPPING` и не объявлены
  эквивалентностью.
- Cardinality и optionality без проверки данных помечены `UNKNOWN`.
