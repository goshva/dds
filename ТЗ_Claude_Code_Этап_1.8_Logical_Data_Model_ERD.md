# ТЗ для Claude Code — Этап 1.8
# Logical Data Model & ERD курьерской службы

**Проект:** Courier Analytics / Courier Operations Data Model  
**Рабочая директория:** `C:\soft\bun\dds`  
**Этап:** 1.8  
**Название:** Logical Data Model & ERD  
**Режим:** анализ, проектирование, документация и автоматическая самопроверка.  
**Основной результат:** согласованная логическая модель предметной области с ERD, каталогом сущностей/атрибутов/связей, трассировкой доказательств и реестром нерешённых решений.

---

## 0. Главная задача

На основании реальных артефактов этапов 1.1–1.7 построить логическую модель курьерской службы, которая:

1. отражает фактические бизнес-процессы и согласованные бизнес-правила;
2. различает подтверждённые факты, SQL-наблюдения, выводы и проектные предложения;
3. не объявляет SQL JOIN внешним ключом;
4. не превращает `Pool` в `Trip` без подтверждения;
5. не выдумывает отсутствующие источники готовности заказа, зон, тарифов, начислений и выплат;
6. пригодна для последующего проектирования физической схемы, но **не является физической схемой и не запускает миграции**;
7. содержит полную самопроверку и понятный итоговый статус.

Не пытайся искусственно сделать все сущности VERIFIED. Для неизвестного используй `UNKNOWN`, `NOT_VERIFIABLE`, `BUSINESS_DECISION_REQUIRED`, `INFERRED` или эквивалентные статусы из уже принятой терминологии проекта.

---

## 1. Жёсткие ограничения безопасности

### 1.1. Разрешено

- читать исходники, документы, JSON/CSV/MD, SQL definitions и существующие отчёты;
- читать `data/catalog.sqlite` только в read-only режиме;
- создавать новые файлы только в каталогах этапа 1.8;
- создавать локальные скрипты проверки и запускать их;
- выполнять TypeScript compile и локальные тесты;
- проверять целостность созданных JSON/CSV/Markdown/диаграмм;
- использовать уже сохранённые Superset metadata/SQL definitions без повторного запроса к источнику.

### 1.2. Запрещено

- изменять `data/catalog.sqlite`;
- изменять Superset и его объекты;
- выполнять SQL на source databases;
- запускать ETL, backfill, импорт фактических данных;
- применять DDL/migrations;
- создавать production DB;
- экспортировать PII или секреты;
- включать в отчёты имена, email, телефоны, адреса и другие персональные данные;
- менять существующие артефакты этапов 1.1–1.7 без отдельного разрешения;
- удалять файлы;
- выполнять `git commit`, `git push`, reset, rebase или force operations;
- подменять отсутствующие исходные материалы синтетическими данными.

Если в `.env` обнаружены credentials, не выводи их и не копируй в отчёты. Не запускай сетевые проверки только ради формального PASS.

---

## 2. Обязательный Preflight — G0

До проектирования:

1. Проверь `pwd` и Git root.
2. Проверь `git status --short`, текущую ветку и HEAD.
3. Проверь, что рабочая директория соответствует `C:\soft\bun\dds`.
4. Найди ТЗ этапа 1.5, материалы этапов 1.6, 1.6.2 и 1.7.
5. Проверь наличие и актуальность:
   - `docs/phase-01-5/` или фактической директории этапа 1.5;
   - `docs/phase-01-6/`;
   - `docs/phase-01-6-2/`;
   - `docs/phase-01-7/` (если уже создана);
   - `reports/phase-01-6/`;
   - `reports/phase-01-6-2/`;
   - `reports/phase-01-7/`;
   - `analysis_package/`;
   - `src/phase1-7/` и других модулей этапа 1.7, если они существуют.
6. Проверь наличие `data/catalog.sqlite`, backup и manifest.
7. Получи SHA-256 и размер `data/catalog.sqlite` до работы. Если файл отсутствует — зафиксируй это, не создавай новый.
8. Составь `reports/phase-01-8/preflight.json` и `preflight.md`.

### G0 PASS

- репозиторий определён;
- baseline Git сохранён;
- источники, использованные для модели, перечислены;
- существующие файлы этапов 1.1–1.7 не изменены;
- SQLite доступна только read-only или её отсутствие явно отмечено.

Если нет полного пакета этапа 1.7, не выдумывай его. Продолжай на доступных источниках со статусом `PARTIAL_INPUTS`.

---

## 3. Источники истины и приоритет

Используй источники в следующем порядке:

1. Явные бизнес-правила пользователя из документов/протоколов.
2. Подтверждённые результаты исследований и решений этапов 1.5–1.7.
3. SQL definitions Superset и metadata — только как evidence присутствия полей/выражений/таблиц.
4. SQL-derived values и dashboard filters — как косвенные свидетельства, не как фактические распределения.
5. Имена колонок, JOIN, эвристические связи — только как гипотезы.

Для каждого утверждения сохраняй `evidence_id`, тип доказательства, источник, статус и уверенность.

### Запрещённые выводы

- SQL JOIN ≠ FK.
- Наличие `id_*` ≠ доказанная уникальность или ссылка.
- `FILTER_VALUES` ≠ полное распределение фактической таблицы.
- `SQL_DERIVED` ≠ наблюдаемые строки источника.
- отсутствие поля в одном dataset SQL ≠ отсутствие процесса во всей организации.
- `sum_order` и `sum_paid` ≠ заработок курьера.
- `events_qty` ≠ явка курьера.
- `shift_N_profit` ≠ универсальная тарифная модель или ledger.
- `zone_cluster`, `inactivity_zone`, `cluster_id` ≠ одна сущность DeliveryZone.

---

## 4. Зафиксированные бизнес-правила — применять без повторного опроса

### 4.1. Заказы, пул и поездка

- «Заказ» — заказ клиента.
- «Поездка» — один выезд курьера с несколькими заказами.
- Целевой размер группы — 3–5 заказов.
- 2 заказа допустимы, если готовы только два.
- Если готово больше пяти — отбор по времени готовности, срочности и кратчайшему маршруту.
- Группировка автоматическая, возможна ручная корректировка.
- Поездка формируется после появления состава; назначение курьера — отдельный процесс.
- Куратор может менять состав после назначения и до выезда; все изменения должны иметь историю.
- После выезда состав неизменяем.
- Одна поездка — одна зона.
- Состав меняет только куратор.
- 3–5 — бизнес-ориентир, не DB CHECK.
- Смешение соседних зон — только с отдельным разрешением.

### 4.2. Очередь и смены

- Курьер назначается после прибытия в ТТ и входа в очередь.
- Очередь FIFO.
- Если курьер не готов при вызове — его пропускают и вызывают следующего.
- Отказ от предложенной поездки не допускается.
- Максимальное ожидание не утверждено.
- Нужно учитывать начало/окончание смены, перерыв и возвращение.
- Смена — временной интервал.
- Есть план одного slot system, но booking vs check-in не выяснено.
- No-show thresholds не утверждены.
- Поведение пропущенного курьера при возвращении в очередь не определено.

### 4.3. Зоны

- Одна зона = одно ТТ и окружающая территория.
- Границы зависят от heatmap/плотности заказов, расстояния и времени доставки.
- Гео-отдел утверждает границы.
- Адрес относится к зоне с минимальным временем доставки.
- История изменения границ технически желательна, но не была обязательным бизнес-требованием.
- Источник справочника delivery zones пока не найден.

### 4.4. Оплата

- Оплата за каждый доставленный заказ.
- Зависит от зоны и расстояния.
- Начисление после доставки каждого заказа.
- Отменённый заказ не оплачивается.
- В поездке с несколькими заказами оплачиваются только доставленные.
- Ожидание включено в стоимость заказа; отдельной оплаты простоя нет.
- Штрафов нет.
- Возможная зависимость тарифа от нагрузки; формула не утверждена.
- Первые пять смен — референс, не универсальный тариф.
- Тарифы и утверждающий владелец неизвестны.
- `sum_order` / `sum_paid` не являются доходом курьера.

### 4.5. Наставничество

- Куратор — наставник.
- Сопровождение — две недели.
- Оценка по первым пяти сменам, качеству доставки и соблюдению правил.
- Куратор может добавлять заказы в свою группу с учётом нагрузки/доступности.
- Жёсткого лимита стажёров нет; можно предусмотреть предупреждение.
- Кто назначает стажёра куратору — неизвестно.
- Критерии завершения/продления после двух недель требуют уточнения.

### 4.6. SLA и время

- Базовая временная зона — Москва.
- Причина +3 часа в некоторых SQL transformations не выяснена.
- Не добавлять +3 часа глобально.
- `1970-01-01` означает отсутствие даты.
- Пользователь ответил «Нет» на исключение отменённых/возвращённых заказов из SLA; не исключать их автоматически.
- Точный расчёт отмен/возвратов всё ещё требует определения.
- Критические изменения должны появляться сразу; менее критичная аналитика может обновляться несколько раз в день.

### 4.7. MVP

- Первый экран — общий список заказов.
- MVP может стартовать без автоматического распределения зон и готовой очереди.
- Заработок, посещаемость и обучение — последующие фазы.
- MVP метрики:
  - ожидание курьера;
  - ready-to-delivery;
  - deliveries per courier;
  - SLA compliance.

---

## 5. Обязательные технические findings, которые нужно перепроверить по файлам

Используй эти выводы как ориентиры, но сверь с первичными артефактами этапа 1.6.2/1.7, если они присутствуют.

1. `7802 shift_time_breakdown` содержит SQL references:
   - `agile_mart_operational.shifts`;
   - `agile_mart_operational.pools`;
   - `agile_mart_operational.courier_queue`.
2. В SQL 7802 встречаются `id_shift`, `id_courier`, `id_pool`, `shift_start`, `shift_finish`, `pool_start`, `pool_finish`, `queue_in_dttm`, `queue_out_dttm`, `first_delivery_dttm`, `has_order`.
3. В cargo datasets встречаются `id_order`, `id_general`, `id_pool`, `courier_id_darkstore`, route/timestamp/distance fields. Их идентичность и семантика не окончательно установлены.
4. `pool_size` вычисляется в одном из cargo datasets через count distinct `id_general` по `id_pool`; это поддерживает понятие группы заказов, но не доказывает `Pool = Trip`.
5. В SQL dataset 3466 нет `time_ready` и `time_ready_plan`; есть кандидаты `date_set_cell`, `date_f_status_3_5`, `date_collect_start`, `date_collected`, `date_collected_plan`, `is_collected`.
6. Dataset 7021 — timesheet сборщиков; `id_courier` отсутствует. Не использовать его как CourierShift.
7. Dataset 5939 содержит HR mentor/trainee fields, но courier-specific applicability не подтверждена.
8. `7473` содержит `shift_1_profit` … `shift_5_profit`, но это не tariff/accrual ledger.
9. `zone_cluster`, `inactivity_zone`, `cluster_id` — разные семантики; delivery polygon master не подтверждён.
10. Некоторые SQL datasets применяют +3 hour к разным полям неодинаково; не нормализовать timestamps глобальным сдвигом.

Если первичный артефакт противоречит пункту — зафиксируй конфликт и не скрывай его.

---

## 6. Целевая логическая модель

Создай модель в двух слоях:

### 6.1. Observed Source Concepts

Только понятия, реально обнаруженные в SQL/metadata, с источниками и ограничениями:

- Order;
- Darkstore / TT;
- Courier;
- DeliveryJob / Delivery;
- Pool;
- CourierShift;
- QueueRecord / QueueEntry;
- Route / RoutingResult;
- Assembly timestamps / Assembly stage;
- CourierAppEvent aggregate;
- PhotoControlAttempt;
- HR Courier status;
- HR Mentorship attributes.

Не называй эти source concepts VERIFIED physical entities без фактической проверки схемы и данных.

### 6.2. Target Logical Domain Model

Рассмотри следующие целевые сущности. Каждую разрешается исключить, объединить или разделить только с документированным обоснованием:

**Operations**
- `Order`
- `OrderItem` (только если есть подтверждение line-item источника; иначе gap)
- `Darkstore`
- `Courier`
- `Delivery`
- `Trip`
- `TripOrder`
- `CourierAssignment`
- `QueueEntry`
- `CourierShift`
- `ShiftBreak`
- `ShiftSlot` (lifecycle unresolved)
- `ReadyEvent` (source missing)
- `AssemblyEvent`
- `Route`
- `DeliveryZone`
- `ZoneBoundaryVersion` (design proposal, not business mandate)
- `Address`
- `AddressToZoneAssignment`

**Finance**
- `Tariff`
- `TariffVersion`
- `TariffRule`
- `CourierAccrual`
- `AccrualLine`
- `Payout`
- `PayoutLine`

**HR / Mentorship**
- `CourierMentorship`
- `MentorshipAssessment`
- `CourierStatusHistory`

**Shared / Audit**
- `BusinessEvent` (только если обоснована единая модель; не навязывать)
- `EntityChangeLog` / `TripCompositionChange`
- `SourceSystem`
- `DataEvidenceReference`

Важно: `Trip` и `Pool` должны быть разными концептами в модели до подтверждения эквивалентности. Можно показать потенциальную mapping relationship с `INFERRED`.

---

## 7. Что нужно создать

Все новые артефакты помести в `docs/phase-01-8/`, `reports/phase-01-8/`, `src/phase1-8/` или согласованные проектные каталоги. Сначала изучи существующую структуру и следуй ей.

### 7.1. Документы (минимум 12)

1. `01_logical_model_overview.md`
   - цели и границы модели;
   - bounded contexts;
   - assumptions;
   - observed vs target model;
   - non-goals.
2. `02_entity_catalog.md`
   - полный каталог сущностей;
   - назначение;
   - grain;
   - identity candidates;
   - lifecycle;
   - status/confidence.
3. `03_attribute_catalog.md`
   - атрибуты каждой сущности;
   - тип на логическом уровне;
   - required/optional;
   - source/evidence;
   - confidence;
   - PII classification.
4. `04_relationship_catalog.md`
   - связи;
   - cardinality;
   - optionality;
   - source evidence;
   - status;
   - rationale.
5. `05_order_lifecycle.md`
   - жизненный цикл заказа;
   - подтверждённые события;
   - unresolved ready state.
6. `06_trip_pool_assignment.md`
   - различие Trip/Pool;
   - TripOrder;
   - assignment отдельно от состава;
   - curator changes before departure;
   - immutable composition after departure.
7. `07_queue_shift_lifecycle.md`
   - очередь, FIFO, skip, return;
   - Shift, ShiftBreak, ShiftSlot;
   - неутверждённые правила.
8. `08_zone_address_model.md`
   - TT + territory;
   - geo approval;
   - address-to-zone assignment;
   - boundary versioning как предложение;
   - различие zone_cluster/inactivity_zone/cluster_id.
9. `09_finance_model.md`
   - tariff versioning;
   - accrual per delivered order;
   - cancellations;
   - partial delivery in trip;
   - payout;
   - явно неизвестные формулы.
10. `10_mentorship_model.md`
    - curator/mentor/trainee;
    - two-week period;
    - first-five-shifts evaluation;
    - HR evidence caveats.
11. `11_event_and_audit_model.md`
    - события и аудит изменений;
    - append-only vs mutable state;
    - кто меняет состав поездки;
    - idempotency recommendations.
12. `12_open_decisions_and_gaps.md`
    - открытые решения;
    - impact;
    - owner role if known;
    - what evidence/decision closes gap.
13. `13_model_validation_report.md`
    - проверки, результаты, blockers.
14. `README.md`
    - навигация по модели и статус.

### 7.2. Диаграммы (минимум 6 Mermaid)

1. `diagrams/01_context_map.mmd`
2. `diagrams/02_operations_erd.mmd`
3. `diagrams/03_finance_erd.mmd`
4. `diagrams/04_hr_mentorship_erd.mmd`
5. `diagrams/05_order_trip_lifecycle.mmd`
6. `diagrams/06_queue_shift_lifecycle.mmd`
7. `diagrams/07_source_to_target_mapping.mmd` (желательно)

Диаграммы должны соответствовать каталогам. Не добавляй FK notation для неподтверждённых связей: помечай связи как `INFERRED`, `PROPOSED`, `BUSINESS_RULE` или `VERIFIED_SQL_RELATION` (последний термин только если доказано именно то, что заявлено).

### 7.3. Машиночитаемые файлы (минимум 8)

1. `logical_model.json`
2. `entities.json`
3. `attributes.json`
4. `relationships.json`
5. `evidence_links.json`
6. `open_decisions.json`
7. `model_validation.json`
8. `model_manifest.json`

Сохраняй стабильные IDs: `ENT-...`, `ATT-...`, `REL-...`, `EVD-...`, `DEC-...`. Не переиспользуй ID для другого объекта.

---

## 8. Структура сущности, атрибута и связи

### Entity JSON

Каждая сущность должна включать:

```json
{
  "id": "ENT-ORDER",
  "name": "Order",
  "bounded_context": "Operations",
  "description": "Customer order",
  "grain": "one record per canonical customer order",
  "identity": {
    "candidate_keys": ["id_order", "id_general"],
    "canonical_key": null,
    "status": "UNRESOLVED"
  },
  "status": "PARTIAL_EVIDENCE",
  "confidence": "MEDIUM",
  "evidence_ids": ["EVD-..."],
  "open_decision_ids": ["DEC-..."],
  "pii_classification": "NONE"
}
```

### Attribute JSON

```json
{
  "id": "ATT-ORDER-STATUS",
  "entity_id": "ENT-ORDER",
  "name": "status",
  "logical_type": "enum",
  "nullable": "UNKNOWN",
  "required": "UNKNOWN",
  "source_fields": [
    {
      "dataset_id": "4732",
      "field": "order_status",
      "evidence_id": "EVD-..."
    }
  ],
  "status": "FOUND_IN_SUPERSET_SQL",
  "confidence": "MEDIUM",
  "pii_classification": "NONE",
  "notes": "Status vocabulary and state machine not approved"
}
```

### Relationship JSON

```json
{
  "id": "REL-TRIP-ORDER",
  "from_entity": "ENT-TRIP",
  "to_entity": "ENT-ORDER",
  "name": "contains",
  "cardinality": "1:N",
  "optionality": "UNKNOWN",
  "relationship_kind": "BUSINESS_CONCEPT",
  "status": "BUSINESS_RULE",
  "confidence": "HIGH",
  "evidence_ids": [],
  "notes": "Trip contains multiple orders by business definition; physical mapping to id_pool is unverified"
}
```

Не копируй эти примеры как доказанные значения, если исходники не подтверждают их. Они задают формат.

---

## 9. Требования к ERD и семантике

1. Раздели bounded contexts Operations, Finance, HR/Mentorship.
2. Покажи shared identifiers как candidate mappings, если master identity не доказана.
3. Раздели:
   - `Trip` — бизнес-поездка;
   - `Pool` — observed source concept;
   - `TripOrder` — состав поездки;
   - `CourierAssignment` — назначение курьера;
   - `Delivery` — результат доставки конкретного заказа.
4. Состав Trip:
   - mutable до departure;
   - после departure immutable;
   - изменение состава только куратором;
   - изменения должны оставлять историю.
5. Не делай `CHECK(order_count BETWEEN 3 AND 5)`.
6. Не ставь `NOT NULL`, `UNIQUE`, FK на поля, чьи свойства не проверены.
7. Не фиксируй `ShiftSlot` как confirmed booking entity.
8. Не делай ReadyEvent эквивалентом `date_set_cell`.
9. Не выводи DeliveryZone из HR inactivity zones.
10. Финансовые сущности не должны использовать `sum_order`/`sum_paid` как earnings.
11. Тарифы должны быть версионируемыми, но конкретная формула остаётся open decision.
12. Для временных атрибутов укажи `timezone_semantics = UNKNOWN` там, где не доказано обратное.

---

## 10. Набор обязательных инвариантов

Добавь их в `model_validation.json` и проверь программно:

- `INV-001`: один `Trip` относится к одной зоне (business rule).
- `INV-002`: состав Trip можно менять только до departure.
- `INV-003`: после departure изменение состава запрещено.
- `INV-004`: состав Trip меняет только curator.
- `INV-005`: CourierAssignment отделён от Trip composition.
- `INV-006`: Trip содержит несколько Orders как бизнес-концепт; минимальный/максимальный размер не является DB hard constraint.
- `INV-007`: в одной Trip не смешиваются зоны без отдельного approval.
- `INV-008`: Courier попадает в assignment только после прибытия в TT и входа в очередь (business rule).
- `INV-009`: FIFO — правило очереди, не предположение о сортировке timestamp без tie-breaker.
- `INV-010`: неготового курьера пропускают; поведение re-entry остаётся open.
- `INV-011`: отменённый заказ не создаёт courier accrual.
- `INV-012`: начисление за delivered order; частично доставленная Trip оплачивается по доставленным заказам.
- `INV-013`: ожидание отдельно не оплачивается.
- `INV-014`: штрафы отсутствуют.
- `INV-015`: тарификация зависит от зоны и расстояния; конкретная формула open.
- `INV-016`: наставничество планируется на две недели; критерии завершения уточняются.
- `INV-017`: не исключать canceled/returned orders из SLA без решения.
- `INV-018`: не применять глобальный +3h.
- `INV-019`: `1970-01-01` — sentinel no-date.
- `INV-020`: SQL JOIN не становится FK автоматически.

У каждого инварианта должны быть:
- `type`: BUSINESS_RULE / DATA_RULE / DESIGN_GUARD;
- `status`: CHECKED / DOCUMENTED_ONLY / BLOCKED;
- `evidence_ids`;
- `validation_method`;
- `result`.

---

## 11. Самопроверка — G1–G7

### G1 — Completeness

Проверить:
- минимум 12 обязательных документов;
- минимум 6 Mermaid diagrams;
- минимум 8 JSON artifacts;
- все сущности имеют стабильные IDs;
- каждый атрибут привязан к сущности;
- каждая связь ссылается на существующие entity IDs;
- каждый evidence link ссылается на существующий evidence ID;
- каждый open decision имеет уникальный ID.

### G2 — Evidence integrity

Проверить:
- каждое утверждение `FOUND_IN_SUPERSET_SQL` имеет конкретный dataset/source/field;
- каждый `VERIFIED` имеет соответствующий прямой evidence, иначе понизить статус;
- SQL JOIN не маркирован FK;
- `Pool = Trip` не маркирован VERIFIED;
- zone concepts не слиты;
- готовность заказа не объявлена подтверждённой;
- tariff/accrual/payout не объявлены найденными без evidence.

### G3 — Relationship integrity

Проверить:
- все `from_entity` и `to_entity` существуют;
- нет дублирующихся relationship IDs;
- cardinality объяснена;
- relationship kind и status согласованы;
- неподтверждённые связи явно помечены;
- циклы допустимы только с обоснованием.

### G4 — Business invariants

Программно проверить наличие всех INV-001 … INV-020 и их корректную классификацию. Не превращай бизнес-правило в DB constraint без отдельного решения.

### G5 — Diagram consistency

Скриптом проверить:
- Mermaid файлы не пусты;
- упомянутые entity IDs присутствуют в entity catalog;
- связи диаграмм не противоречат relationships.json;
- диаграммы не обозначают неподтверждённые связи как FK;
- все основные bounded contexts отражены.

Если нет Mermaid parser, используй структурную проверку и пометь её как `STATIC_VALIDATION`, не называй полноценным render test.

### G6 — PII and secrets

Проверить все новые файлы:
- email;
- телефоны;
- реальные ФИО;
- адреса;
- access tokens;
- passwords;
- cookies;
- DSN/connection strings.

PII scan должен искать не только очевидные ключи, но и реальные значения, если они присутствуют в источниках. В отчёт записывать только число совпадений и безопасные имена файлов/полей, не сами значения.

Цель: `PII_FINDINGS = 0`, `SECRET_FINDINGS = 0`.

### G7 — Repository and safety integrity

Проверить:
- `data/catalog.sqlite` SHA-256 до/после совпадает;
- backup SHA-256 не изменился;
- Git diff не содержит изменений существующих этапов 1.1–1.7;
- новые файлы ограничены каталогами этапа 1.8;
- migrations = 0;
- source DB queries = 0;
- Superset modifications = 0;
- ETL/backfill = 0;
- commit/push = 0.

Запиши результаты в `reports/phase-01-8/final_validation.json`.

---

## 12. Автоматические проверки и тесты

Создай скрипт `src/phase1-8/validate.ts` (или следуй существующей архитектуре проекта), который проверяет:

1. JSON parse всех machine-readable artifacts.
2. JSON Schema или runtime validation для основных структур.
3. Уникальность всех IDs.
4. Entity references в attributes/relationships/evidence links.
5. Отсутствие orphan attributes.
6. Отсутствие dangling relationships.
7. Наличие evidence у статусов FOUND/VERIFIED.
8. Наличие статусов/уверенности у всех сущностей и связей.
9. Полноту инвариантов INV-001 … INV-020.
10. Mermaid static consistency.
11. Отсутствие forbidden claims:
    - `Pool = Trip` as VERIFIED;
    - `time_ready` as confirmed source;
    - `zone_cluster` as DeliveryZone;
    - `sum_order` as courier earnings;
    - global `+3 hours`;
    - SQL JOIN as FK.
12. PII/secrets scan.
13. SQLite hash unchanged.
14. Git diff scope check.

Создай unit tests. Если в проекте уже есть тестовый runner — используй его. Не добавляй новый dependency только ради этого этапа без необходимости.

### Ожидаемый формат validation

```json
{
  "stage": "1.8",
  "verdict": "PASS_WITH_BLOCKERS",
  "generated_at": "ISO-8601",
  "checks": [
    {
      "id": "G1_COMPLETENESS",
      "status": "PASS",
      "details": "..."
    }
  ],
  "summary": {
    "pass": 0,
    "fail": 0,
    "warn": 0,
    "blocked": 0
  },
  "safety": {
    "catalog_sqlite_modified": false,
    "source_databases_queried": false,
    "superset_objects_modified": false,
    "migrations_applied": false,
    "etl_or_backfill_run": false,
    "git_committed": false,
    "git_pushed": false
  }
}
```

Не копируй нули в итог, а заполняй реальными результатами.

---

## 13. Статусы и правила verdict

- `PASS`: все обязательные gates PASS, критических blockers нет.
- `PASS_WITH_BLOCKERS`: модель и артефакты построены, но остаются бизнес-решения/непроверенные источники.
- `PARTIAL`: не хватает входных данных или не выполнена значимая часть работ.
- `FAIL`: нарушена целостность, есть ошибки ссылок/ID/PII/секретов, изменены запрещённые файлы или нарушены ограничения.

Наличие нерешённых бизнес-вопросов само по себе не означает FAIL, если они корректно отражены и не замаскированы.

---

## 14. Финальный отчёт

Создай `reports/phase-01-8/phase_01_8_summary.md`:

1. итоговый verdict;
2. что реально сделано;
3. количество сущностей, атрибутов, связей, evidence links, decisions;
4. breakdown по bounded context;
5. breakdown по статусам и confidence;
6. список P0/P1 blockers;
7. результаты G0–G7;
8. тесты и compile;
9. PII/secrets scan;
10. подтверждение неизменности SQLite;
11. подтверждение отсутствия source DB queries, migrations, ETL, Superset writes, commit/push;
12. что нужно для этапа 1.9.

Не утверждай, что ERD визуально отрендерена, если проверена только структура Mermaid. Не утверждай, что физические ключи подтверждены, если не выполнялись SELECT.

---

## 15. Порядок выполнения

Работай последовательно, не перескакивай:

1. G0 preflight и baseline.
2. Изучи исходные артефакты и сформируй evidence index.
3. Сформируй observed source concepts.
4. Сформируй target logical entities.
5. Сформируй attribute catalog.
6. Сформируй relationship catalog.
7. Сформируй open decisions.
8. Построй Mermaid diagrams.
9. Создай machine-readable JSON.
10. Реализуй validator и tests.
11. Запусти TypeScript compile.
12. Запусти tests.
13. Запусти validator.
14. Выполни независимую повторную проверку:
    - перечитай все JSON;
    - пересчитай entity/attribute/relationship counts;
    - проверь ссылки;
    - проверь forbidden claims;
    - проверь PII;
    - сравни SQLite hash;
    - проверь Git diff scope.
15. Только после этого создай final report.

Если обнаружена ошибка — исправь её и повтори затронутые проверки. Не отмечай PASS до повторного успешного запуска.

---

## 16. Условия завершения

Этап 1.8 можно считать завершённым только если:

- создана логическая модель и все обязательные документы;
- диаграммы соответствуют JSON catalog;
- evidence traceability проверена;
- все неизвестные и спорные места остались явно неизвестными;
- все 20 инвариантов внесены и проверены;
- автоматический validator проходит;
- TypeScript compile проходит;
- unit tests проходят;
- PII/secrets scan не выявляет утечек;
- SQLite и предыдущие этапы не изменены;
- final_validation.json и summary созданы.

**Главное правило:** лучше честный `PASS_WITH_BLOCKERS` с точным списком нерешённых вопросов, чем искусственный `PASS` за счёт догадок.
