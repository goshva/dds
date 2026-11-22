# Техническое задание для Claude Code
# Этап 1.7 — Business Domain Consolidation & Logical Model Refinement

**<ФИО>:** модель данных курьерской службы  
**Рабочая директория:** `/c/soft/bun/dds`  
**Основа:** результаты этапов 1.1–1.6.2 и фактически собранный каталог Superset  
**Режим:** read-only исследование, консолидация предметной области и уточнение логической модели  
**Результат:** уточнённая логическая модель, реестр доказательств и явная карта отсутствующего. Не финальная физическая схема.

---

## 1. ***REMOVED*** и главный принцип

Superset становится **исходной доказательной основой текущей модели**. То, что действительно обнаружено в Superset — датасеты, SQL-определения, поля, метрики, фильтры, временные атрибуты, таблицы и SQL-связи — должно стать исходным каркасом логической модели.

<ФИО>-требования дополняют этот каркас и описывают целевую потребность, но не дают права выдавать отсутствующие в источниках сущности и атрибуты за уже существующие.

Этап должен дать две отдельные картины:

1. **CURRENT SOURCE MODEL** — что прослеживается в Superset, с dataset IDs, SQL evidence и уровнем подтверждения.
2. **TARGET LOGICAL MODEL** — что требуется бизнесу, в том числе то, чего в Superset не найдено или что пока нельзя проверить.

Основная трассировка:

`<ФИО>-процесс → <ФИО>-сущность → Логическая сущность → Атрибут → Источник Superset → Evidence → Confidence → Статус / Gap`

Не заполнять пробелы догадками. Отсутствие evidence показывать явно.

## 2. Исходные материалы

Перед работой изучить существующие артефакты этапов 1.1–1.6.2, в первую очередь:

- каталог и результаты Superset Discovery;
- `reports/phase-01-6-2/final_validation.json`;
- весь комплект `reports/phase-01-6-2/`;
- `docs/phase-01-6-2/`;
- `analysis_package/ANALYST_BRIEF.md` и пять CSV;
- `reports/phase-01-6/query_plan.json`;
- `docs/phase-01-6/13_query_plan.md`;
- `reports/phase-01-6/evidence/sql_forensics.md`;
- `docs/phase-01-6/10_model_impact_assessment.md`;
- артефакты этапа 1.5: бизнес-решения, модель, model validation, DDL draft, JSON Schema, mapping;
- существующие ERD, словари, реестры решений и открытых вопросов.

Сначала найти реальные пути и проверить актуальность. Перечень выше не гарантирует, что каждый файл существует именно по указанному пути. Не пересобирать уже готовые результаты без причины и не перезаписывать пользовательские изменения.

### 2.1. Контрольная точка Superset после этапа 1.6.2

Использовать следующие цифры как baseline, сверив их с локальными отчётами:

| Объект | Значение |
|---|---:|
| Datasets | 3 778 |
| Charts | 19 927 |
| Dashboards | 332 |
| Dataset details | 671 |
| Колонки | 17 216 |
| Строки значений фильтров | 3 264 |
| Relationship candidates | 274 |
| Temporal fields | 3 161 |
| Сетевые запросы последней синхронизации | 1 028, 0 ошибок |
| `FILTER_VALUES` | 177 колонок |
| `SQL_DERIVED` | 1 851 колонка |
| `METADATA_ONLY` | 1 438 колонок |
| `ACTUAL_VALUES` | 0 |

Если baseline в артефактах отличается, не подменять значения молча. Создать таблицу расхождений с источником, датой и объяснением.

### 2.2. Что означает ограничение доступа

На этапе 1.6.2 metadata GET работали, но SQL Lab и `chart_data` оставались недоступны (403/401), а API списка баз данных возвращал `count=0`. Подготовленные 18 SELECT-запросов не были выполнены.

Поэтому:
- не утверждать, что фактические строки данных проверены;
- не вычислять NULL share, cardinality, uniqueness, распределения и покрытие отношений;
- не считать отсутствие выборки доказательством отсутствия сущности;
- все выводы, для которых нужны SELECT, помечать `NOT_VERIFIABLE`;
- query plan считать планом будущей проверки, а не её результатом;
- не обходить RBAC.

### 2.3. Обязательная классификация evidence

Не объединять разные виды свидетельств:

| Evidence type | Значение | Допустимая формулировка |
|---|---|---|
| `ACTUAL_DATA` | Значение получено из фактической выборки строк | Наблюдалось в данных; указать запрос и источник |
| `FILTER_VALUES` | Значения из native dashboard filters | Присутствует в доступном списке фильтра; не полное распределение |
| `SQL_DERIVED` | Значение/вариант следует из SQL literal, CASE или выражения | Такая логика есть в SQL; использование строками не доказано |
| `SQL_DEFINITION` | Поле, таблица, JOIN или выражение присутствуют в SQL definition | Есть в определении; физическое существование/наполнение не доказано |
| `METADATA_ONLY` | Только метаданные | Известно имя/описание/тип метаданных, значения не проверены |
| `INFERRED` | ***REMOVED*** из косвенных признаков | Гипотеза |
| `BUSINESS_REQUIREMENT` | ***REMOVED*** или потребность сообщены бизнесом | Требование, не доказательство наличия источника |
| `NOT_FOUND` | Не найдено в указанном охвате поиска | Не найдено в проверенном охвате; не доказывает отсутствия в организации |
| `NOT_VERIFIABLE` | Проверка невозможна | Нельзя сделать вывод о наличии/отсутствии |
| `CONTRADICTED` | Есть прямое противоречащее evidence | Исходное утверждение опровергнуто указанным источником |

`FILTER_VALUES`, `SQL_DERIVED`, `SQL_DEFINITION` и `ACTUAL_DATA` — разные уровни доказательств. `HIGH` confidence в отношении метаданных не означает подтверждение фактического содержимого таблицы.

---

## 3. Уже известные бизнес-правила

Не задавать пользователю повторно вопросы, на которые ниже уже дан ответ. Если Superset противоречит правилу, зафиксировать конфликт, а не исправлять правило самостоятельно.

### 3.1. ***REMOVED*** и ТТ

- Одна зона = одна ТТ (даркстор) плюс прилегающая территория.
- Границы определяются по тепловой карте/плотности заказов, расстоянию и времени доставки.
- Границы утверждает геоотдел.
- Адрес относится к зоне с минимальным временем доставки.
- История изменения границ технически желательна, но не утверждена как обязательное бизнес-требование.
- Справочник/модель зон доставки в Superset ранее не подтверждены.

### 3.2. ***REMOVED***ы и поездки

- «***REMOVED***» — то, что заказал клиент.
- «Поездка» — один маршрут курьера, включающий несколько заказов.
- Целевой размер поездки — 3–5 заказов; 2 допустимы, если готовы только два.
- Если готовых заказов больше пяти, отбор учитывает время готовности, срочность и кратчайший маршрут.
- Группировка автоматическая, с возможностью ручной корректировки.
- Поездка формируется при наличии состава; назначение курьера — отдельный процесс.
- Ответственный может добавлять/удалять заказы после назначения до выезда, с историей.
- После выезда состав неизменяем.
- Одна поездка относится только к одной зоне.
- Состав вручную меняет только куратор.
- 3–5 — не жёсткий DB CHECK.
- Смешение соседних зон без отдельного согласования запрещено.

### 3.3. ***REMOVED*** и смены

- Курьер назначается только после прибытия в даркстор и входа в очередь.
- FIFO.
- Если курьер не готов при вызове, его пропускают и вызывают следующего.
- Отказ от предложенной поездки не допускается.
- Максимальное ожидание не установлено.
- Учитываются начало/окончание смены, перерыв, возвращение.
- ***REMOVED*** — временной интервал; предполагается одна система слотов, но бронирование/отметка выхода не определены.
- Порог no-show не утверждён.
- Поведение пропущенного курьера после возвращения в очередь не определено.

### 3.4. Оплата

- Оплата за доставленный заказ.
- Зависит от зоны и расстояния.
- Начисление после доставки каждого заказа.
- Отменённый заказ не оплачивается; в многозаказной поездке оплачиваются только доставленные заказы.
- Ожидание включено в стоимость заказа; отдельной оплаты простоя нет.
- Штрафов нет.
- Тариф может зависеть от загрузки, формула не утверждена.
- Первые пять смен — ориентир, не универсальный тариф.
- Тарифы и утверждающий их владелец не установлены.
- `sum_order` и `sum_paid` не являются заработком курьера.

### 3.5. Наставничество

- Куратор = наставник.
- Сопровождение длится две недели.
- Оценка учитывает первые пять смен, качество доставки и соблюдение правил.
- Куратор может добавлять заказы в свою группу с учётом нагрузки/доступности.
- Жёсткого лимита стажёров нет; возможное предупреждение необязательно.
- Кто назначает стажёра куратору, не определено.
- Критерии завершения/продления обучения после двух недель требуют уточнения.

### 3.6. SLA и время

- Московский часовой пояс принят.
- Сдвиг `+3h`, встречавшийся в источниках, не объяснён. Не добавлять глобальный сдвиг.
- Правила времени сборки/доставки ранее обозначались, но точный источник и формулу необходимо найти.
- Пользователь ответил «Нет» на исключение отменённых/возвращённых заказов из SLA. Точная методика их учёта всё ещё не определена.
- `1970-01-01` означает отсутствие даты/значения.
- Критические изменения должны отражаться сразу; менее критичная аналитика может обновляться несколько раз в день.
- Владельцы событий и ответственные роли не названы.

### 3.7. MVP

- Первый экран — общий список заказов.
- MVP может стартовать без автоматического распределения по зонам и без очереди готовности.
- Заработок, посещаемость и обучение — последующие этапы.
- Метрики MVP: ожидание курьера, время от готовности до доставки, доставки на курьера, соблюдение SLA.
- Идентичность заказа/курьера/ТТ и владельцы HR + Operations важны, но мастер-реестры ещё нужно найти.

---

## 4. Обязательные forensic-находки

Перепроверить по evidence-файлам и сохранить их смысл:

1. В полном SQL датасета `3466` (около 35 926 символов) `time_ready` и `time_ready_plan` не обнаружены. Старые упоминания в Superset считать stale/unconfirmed. Нельзя создавать подтверждённый атрибут или event готовности на их основании.
2. `date_for_mentor` в датасете `5939` — stale metadata.
3. `shift_type` в датасете `7021` вычисляется из времени начала/окончания смены picker в `ods.timesheetfact`; `id_courier` отсутствует. <ФИО> не источник смен курьера.
4. Физические кандидаты:
   - `agile_mart_operational.shifts` (`id_shift`, `id_courier`, `id_pool`, `shift_start`, `shift_finish`);
   - `agile_mart_operational.pools` (`id_pool`, `id_order`);
   - `agile_mart_operational.courier_queue` (`queue_in_dttm`, `queue_out_dttm`, `has_order`);
   - `agile_mart_operational.photo_control_shift_attempt`;
   - `mart_mixed.darkstore_time`;
   - `mart_mixed.darkstore_time_sheet` (ранее 121 поле).
5. Наличие таблицы/поля в SQL не доказывает доступность, наполнение, актуальность или семантику объекта.
6. Dataset `7802`: зерно результата — одна строка на `id_shift` из-за `row_number() OVER (PARTITION BY id_shift ...)`; `useless_minutes = shift − wait − assembly − delivery`. `wait_minutes` не приравнивать автоматически к ожиданию курьера в очереди. ROW_NUMBER не доказывает уникальность физического источника.
7. Кандидаты:
   - `arrival_time` в `7006`, `7027`, `7119` — кандидат времени прибытия;
   - `pool_size`, `pickup_seq`, `date_pickuped` — кандидаты размера/порядка/времени получения пула;
   - `shift_N_profit` в `7473` — показатель первых пяти смен, не универсальная модель тарифа или заработка.
8. SQL JOIN не является подтверждённым FK.
9. `sum_order` и `sum_paid` не являются доходом курьера.
10. В 1.6.2 были обнаружены и устранены потенциальные PII-утечки: email в filter values и полные имена сотрудников в названиях chart. Повторить PII scan; не выводить реальные значения в новые отчёты.

---

## 5. Работы этапа

### 5.1. Инвентаризация Superset evidence

Сформировать релевантный для модели каталог:

- dataset ID, имя, описание, database/schema если доступны;
- dashboard ID и название;
- chart ID и название;
- SQL definition, SQL hash и ссылка на evidence;
- таблицы и колонки, упомянутые в SQL;
- метрики и calculated columns;
- native filters и значения с типом evidence;
- temporal fields;
- joins / relationship candidates;
- версия/дата каталога;
- полнота и ограничения доступа.

Не копировать весь каталог заново. Ссылаться на существующие артефакты и выделять релевантные фрагменты.

### 5.2. Bounded contexts

<ФИО> и уточнить следующие предварительные контексты:

- `Order Management`;
- `Darkstore Operations`;
- `Courier Operations`;
- `Geo & Delivery`;
- `Courier Finance`;
- `Mentorship & HR`;
- `Analytics & SLA`.

Для каждого указать назначение, источники Superset, найденные сущности/атрибуты, inferred concepts, gaps, owner (или `OWNER_UNKNOWN`) и MVP scope (`MVP`, `LATER`, `OUT_OF_SCOPE`, `UNDECIDED`). Не создавать сущность только потому, что она названа в контексте.

### 5.3. Entity register

Для каждой сущности:

- `entity_id` — стабильный ID;
- `canonical_name`, `business_name_ru`;
- `bounded_context`;
- definition и business purpose;
- source status и evidence type;
- source dataset IDs;
- source table/column candidates;
- grain;
- identity candidate;
- relationships;
- confidence;
- MVP scope;
- open questions;
- decision status.

Статусы источника:
`FOUND_IN_SUPERSET_SQL`, `FOUND_IN_SUPERSET_METADATA`, `FOUND_IN_FILTER_VALUES`, `FOUND_AS_SQL_DERIVED`, `INFERRED_FROM_MULTIPLE_SOURCES`, `BUSINESS_REQUIRED_NOT_FOUND`, `NOT_VERIFIABLE`, `CONTRADICTED`, `NOT_IN_SCOPE`.

Confidence: `HIGH`, `MEDIUM`, `LOW`, `NONE`. Обязательно описывать, что именно подтверждено. Не использовать `HIGH` как синоним фактической проверки строк.

### 5.4. Attribute register

Для каждого атрибута:

- entity;
- canonical name и русское название;
- семантика;
- тип данных, только если достоверно известен;
- nullable/required (`UNKNOWN`, если не доказано);
- dataset ID, table, SQL expression, column;
- evidence type;
- transform/expression;
- temporal semantics/timezone, если установлены;
- status/confidence;
- PII classification;
- MVP relevance;
- validation required;
- notes/open questions.

Отдельно классифицировать:
- физическое поле источника;
- SQL alias;
- calculated field;
- бизнес-атрибут, который нужен, но не найден;
- метрику/агрегат.

Не превращать `SUM`, `COUNT` и KPI в атрибуты OLTP-сущности без обоснования.

### 5.5. Relationship register

Для каждого отношения указать source/target entity, cardinality candidate, join columns, SQL evidence, join type/expression, тип отношения (прямое/вычисленное/косвенное), FK evidence, confidence и проверки.

Статусы:
`SQL_JOIN_CANDIDATE`, `KEY_CANDIDATE`, `BUSINESS_RELATIONSHIP_REQUIRED`, `INFERRED_RELATIONSHIP`, `VERIFIED_BY_DATA`, `NOT_VERIFIABLE`, `CONTRADICTED`.

`VERIFIED_BY_DATA` на этом этапе запрещён без фактической выборки и достаточных проверок. Совпадение имён `id_*` не доказывает FK.

### 5.6. Grain и identity

Для каждой сущности определить предполагаемое зерно, candidate natural/surrogate key, evidence, возможную составную идентичность и нужные проверки SELECT. Неизвестное зерно обозначать `UNKNOWN`.

Особо различать:
- заказ и строку заказа;
- заказ и поездку;
- поездку и пул;
- назначение и факт доставки;
- курьера и смену;
- смену и слот;
- очередь и событие входа/выхода;
- начисление и выплату;
- тариф и фактический заработок.

### 5.7. Gap register — обязательный центральный результат

Создать `GAP_REGISTER.md` и `gap_register.json`. Для каждого gap:

- `gap_id`;
- domain / business concept;
- required_for (`MVP`/`LATER`);
- what is missing;
- what was searched / search scope;
- search evidence;
- gap type / status;
- business impact;
- data model impact;
- required source or owner;
- resolution action;
- blocking stage;
- decision owner;
- notes.

Типы:
`NOT_FOUND_IN_SUPERSET`, `NOT_VERIFIABLE_ACCESS`, `NOT_IN_METADATA`, `BUSINESS_RULE_MISSING`, `MASTER_DATA_MISSING`, `EVENT_SOURCE_MISSING`, `IDENTITY_UNRESOLVED`, `SEMANTICS_UNRESOLVED`, `OWNER_UNKNOWN`, `CONFLICTING_EVIDENCE`.

Обязательно проверить следующие направления:

| Область | Что искать | Известное ограничение |
|---|---|---|
| ***REMOVED*** | master source, ID, lifecycle, status, grain | сущность ранее VERIFIED логически; конкретный источник и зерно уточнить |
| Строка заказа | order-item, товар, количество, цена | ранее UNKNOWN |
| Готовность | событие/время ready | `time_ready`/`time_ready_plan` отсутствуют в полном SQL 3466; кандидаты не подтверждены |
| Сборка | начало/окончание, исполнитель, этапы | найти поля/события, не выводить из названий |
| ТТ/даркстор | master registry, stable ID | сущность ранее VERIFIED; master source/ключ доказать |
| Зона | справочник, геометрия, TT link, версии | ранее не подтверждена; нужна бизнесу |
| Адрес | master registry, нормализация, координаты | ранее INFERRED |
| Маршрут | последовательность точек, расстояние, время | логически VERIFIED; источник и зерно проверить |
| Поездка | trip ID, состав, статусы, departure/return | отличить от pool и order |
| Пул | `id_pool`, `id_order`, pickup order | кандидат `agile_mart_operational.pools`; семантика не доказана |
| Назначение | courier↔trip/pool, timestamp, actor | ранее INFERRED |
| ***REMOVED*** | вход, выход, вызов, пропуск, возврат | `courier_queue` кандидат; полной event model нет |
| ***REMOVED*** курьера | start/end, courier, TT, break | `shifts` кандидат; dataset 7021 не источник курьерской смены |
| Слот | планирование/бронь/факт выхода | процесс не определён; отличать от shift |
| Доставка | handover/completion, time, outcome | логически VERIFIED; точный источник/событие проверить |
| Отмена/возврат | event, reason, SLA/payment impact | правила оплаты частично известны; SLA методика не определена |
| Тариф | версии, зона, расстояние, effective dates, approval | источник и владелец не найдены |
| Начисление | per delivered order | целевая сущность нужна, физический источник UNKNOWN |
| Выплата | payout, period, status | отделить от accrual; источник проверить |
| Наставничество | mentor assignment, period, progress, result | `date_for_mentor` stale; подтверждённого источника нет |
| <ФИО> | event type, timestamp, actor, entity, source | единый подтверждённый event log не найден |
| SLA | interval boundaries, exclusions, rules | показатели могут быть в BI, но бизнес-семантика не подтверждена |
| Владельцы | Operations, HR, Geo, Finance owners | известны общие направления, конкретные владельцы неизвестны |

Для каждого пункта определить, действительно ли охват поиска достаточен. Если нет — `NOT_VERIFIABLE` или `PARTIAL`, не `NOT_FOUND`.

Приоритеты:
- `P0_BLOCKER` — нельзя достоверно определить ядро MVP/идентичность;
- `P1_HIGH` — существенно влияет на корректность модели/метрик;
- `P2_MEDIUM` — необходимо для следующих этапов;
- `P3_LOW` — желательное улучшение.

Не повышать приоритет только из-за отсутствия поля в Superset.

---

## 6. Уточнение логической модели

### 6.1. Разделить текущую и целевую модели

- `CURRENT_SOURCE_MODEL` — то, что прослеживается в Superset.
- `TARGET_LOGICAL_MODEL` — то, что необходимо бизнесу, включая отсутствующие элементы.

Не создавать фиктивные физические таблицы. Не проектировать DDL. Не назначать типы, NOT NULL, UNIQUE, FK, CHECK без evidence или утверждённого решения.

### 6.2. Пересмотр модели этапа 1.5

Для каждой из существующих примерно 25 сущностей этапа 1.5 принять решение:
`KEEP`, `MERGE`, `SPLIT`, `RENAME`, `DEFER`, `REMOVE`, `NEEDS_EVIDENCE`.

Сохранить историю и обоснование. Не удалять бизнес-сущность из target model только потому, что её не нашли в Superset: поместить её в `BUSINESS_REQUIRED_NOT_FOUND`.

### 6.3. Обязательные разграничения

Не смешивать:
- `Order` и `OrderItem`;
- `Trip` и `Pool`;
- `Trip` и `CourierAssignment`;
- `CourierShift` и `ShiftSlot`;
- `QueueEntry` и `QueueEvent`;
- `Delivery` и `OrderStatus`;
- `Accrual` и `Payout`;
- `Tariff` и `Earning`;
- `Zone` и `Darkstore`;
- `Address` и `DeliveryPoint`;
- `Mentorship` и HR profile/employment.

### 6.4. Диаграммы

Создать:
- `CURRENT_SOURCE_MODEL.mmd`;
- `TARGET_LOGICAL_MODEL.mmd`;
- `DOMAIN_GAP_VIEW.mmd`;
- при необходимости отдельные ERD по bounded context.

В `CURRENT_SOURCE_MODEL` у каждого элемента должна быть ссылка на evidence ID. В `TARGET_LOGICAL_MODEL` помечать `REQUIRED_NOT_FOUND`, `INFERRED`, `NOT_VERIFIABLE`. В легенде объяснить, что SQL JOIN — кандидат связи, не подтверждённый FK. Не скрывать gaps ради компактности.

---

## 7. Процессы, события и жизненные циклы

Описать:
1. создание/изменение заказа;
2. сборку и переход к готовности;
3. формирование поездки/пула;
4. ручную корректировку состава куратором;
5. назначение курьера;
6. вход в очередь, FIFO, вызов и пропуск;
7. выезд и фиксацию неизменяемого состава;
8. доставку каждого заказа и частичное завершение поездки;
9. отмену/возврат;
10. смену, перерыв, возврат в очередь;
11. начисление и выплату;
12. назначение наставника и оценку обучения;
13. SLA и обновление аналитики.

Для каждого процесса: акторы/роли, входные условия, команды/события, state transitions, timestamps, источники, invariants, недостающие атрибуты/события, вопросы владельцу. Неизвестных акторов помечать `OWNER_UNKNOWN`.

Создать Mermaid flowchart/state diagram для ключевых lifecycle. Разделять:
- подтверждено источниками;
- задано бизнесом;
- inferred;
- unresolved.

Запрещено додумывать:
- точное событие готовности заказа;
- семантику `arrival_time` как входа в очередь;
- `wait_minutes` как время ожидания в очереди;
- `pool_size` как размер поездки;
- `pickup_seq` как очередь курьеров;
- `date_pickuped` как назначение;
- курьерскую смену из `shift_type` dataset 7021;
- универсальный тариф из `shift_N_profit`;
- no-show, повторный вход в очередь, SLA отмен/возвратов и процесс назначения наставника.

---

## 8. Решения и бизнес-вопросы

Обновить существующий реестр 24 решений, сохранив ID и историю. Для каждого: исходная формулировка, текущий статус, новое evidence, влияние на модель, варианты/решение, approver, дата/версия, зависимости.

Статусы:
`AGREED`, `READY_FOR_BUSINESS_APPROVAL`, `BUSINESS_DECISION_REQUIRED`, `PARTIAL_EVIDENCE`, `NOT_VERIFIABLE`, `CONTRADICTED`, `DEFERRED`.

Не переводить в `AGREED` только по Superset metadata. <ФИО>-правило утверждает владелец процесса.

Подготовить вопросы для:
- Operations;
- Darkstore;
- Geo;
- Finance;
- HR/Mentorship;
- Data/BI;
- IT/Data Platform.

Если конкретный владелец неизвестен — `OWNER_UNKNOWN`. Не назначать людей по догадке.

---

## 9. MVP readiness и метрики

Первый экран MVP — общий список заказов. Оценить минимальные данные:

- стабильный ID заказа;
- текущий статус;
- ТТ;
- основные timestamps;
- связь с поездкой/пулом, если нужна экрану;
- курьер, если назначен;
- зона, если доступна и подтверждена.

Для каждого поля: `FOUND`, `PARTIAL`, `NOT_FOUND`, `NOT_VERIFIABLE`, `NOT_REQUIRED_FOR_MVP`. Указать dataset/evidence. Не считать MVP автоматически заблокированным из-за отсутствия автоматического распределения зон и очереди — бизнес допускает запуск без них. Описать, какие операции при этом ручные и какие данные нужны.

Метрики MVP:
- ожидание курьера;
- готовность → доставка;
- доставки на курьера;
- SLA compliance.

Для каждой определить формулу только если она утверждена; необходимые события/поля; evidence; исключения; возможность расчёта сейчас. Если формула не определена — `METRIC_DEFINITION_REQUIRED`. Не подставлять общепринятую формулу от себя. Не исключать отмены/возвраты из SLA без отдельного решения.

---

## 10. Безопасность и read-only режим

Обязательно:
- не выводить реальные email, ФИО, телефоны, клиентские адреса, персональные координаты и другие PII;
- не сохранять сырые filter values, если в них может быть PII;
- использовать маскированные/агрегированные примеры или object IDs;
- повторить PII scan новых/изменённых файлов;
- не сохранять секреты, cookies, tokens, session IDs, пароли;
- не обходить Superset RBAC;
- не выполнять SQL и не обращаться к production DB;
- не менять Superset dashboards/charts/datasets/filters/roles/permissions;
- не менять `data/catalog.sqlite`;
- не запускать migrations, ETL, backfill и запись в источники;
- не создавать таблицы в БД.

Разрешено читать локальные артефакты, использовать уже синхронизированный каталог, выполнять безопасные разрешённые metadata GET, запускать локальные валидаторы и тесты, создавать документацию и отчёты этапа 1.7.

---

## 11. Выходные артефакты

Создать `docs/phase-01-7/`:

```text
00_executive_summary.md
01_superset_evidence_baseline.md
02_domain_map.md
03_entity_register.md
04_attribute_register.md
05_relationship_register.md
06_grain_and_identity.md
07_gap_register.md
08_business_processes.md
09_lifecycle_and_events.md
10_mvp_scope.md
11_metric_definitions_and_gaps.md
12_decision_register.md
13_business_questions.md
14_model_refinement_decisions.md
15_data_quality_and_validation.md
16_security_and_pii.md
diagrams/
  CURRENT_SOURCE_MODEL.mmd
  TARGET_LOGICAL_MODEL.mmd
  DOMAIN_GAP_VIEW.mmd
  order_lifecycle.mmd
  trip_lifecycle.mmd
  courier_queue_lifecycle.mmd
  courier_shift_lifecycle.mmd
  accrual_lifecycle.mmd
```

Машиночитаемые файлы в `reports/phase-01-7/`:

```text
final_validation.json
phase_01_7_summary.md
evidence_manifest.json
domain_map.json
entity_register.json
attribute_register.json
relationship_register.json
gap_register.json
decision_register.json
mvp_scope.json
metric_register.json
pii_scan.json
model_diff.json
```

Если в проекте уже приняты другие канонические пути/форматы, следовать им и описать mapping. Не дублировать большие файлы без причины.

### 11.1. Формат evidence manifest

```json
{
  "evidence_id": "EV-0172",
  "evidence_type": "SQL_DEFINITION",
  "source_kind": "SUPERSET_DATASET",
  "source_id": "3466",
  "source_name": null,
  "object_path": "schema.table.column",
  "sql_hash": null,
  "location": "catalog artifact / file / JSON pointer",
  "observation": "sanitized concise description",
  "observed_at": null,
  "limitations": ["SQL Lab unavailable", "no actual rows queried"]
}
```

Не выдумывать имя, hash, timestamp или location. Неизвестное — `null` с пояснением.

---

## 12. План выполнения

### Step 0 — Preflight
- Зафиксировать branch, HEAD, git status.
- Убедиться, что пользовательские изменения не будут затронуты.
- Найти фактические пути артефактов 1.1–1.6.2.
- Не использовать reset/checkout/clean.
- Зафиксировать baseline каталога и дату.

### Step 1 — Evidence audit
- <ФИО> комплект 1.6.2 и evidence.
- Сверить контрольные цифры и forensic-находки.
- Разделить metadata, SQL definitions, filter values и actual data.
- Создать evidence manifest.
- Зафиксировать текущие ограничения SQL Lab/DB.
- Не запускать запрещённые SQL-запросы.

### Step 2 — Domain consolidation
- Сформировать bounded contexts.
- Нормализовать терминологию.
- Сопоставить Superset source → business concept → entity.
- Устранить дубли/омонимы, сохранив source names в mapping.
- Не смешивать order, trip, pool и assignment.

### Step 3 — Registers
- Создать entity, attribute, relationship registers.
- Указать grain и candidate identity.
- Каждую запись привязать к evidence.
- Отделить physical fields, aliases, calculated fields и business requirements.
- Не подтверждать FK.

### Step 4 — Gap analysis
- <ФИО> все направления из раздела 5.7.
- Указать охват поиска.
- Присвоить gap type и priority.
- Для каждого определить resolution action и owner либо `OWNER_UNKNOWN`.
- Разделить `NOT_FOUND` и `NOT_VERIFIABLE`.

### Step 5 — Logical model refinement
- Сопоставить сущности с моделью 1.5.
- Создать model diff.
- <ФИО> current, target и gap diagrams.
- Сохранить unresolved links и отсутствующие поля явно.

### Step 6 — Processes, MVP, metrics
- Описать lifecycle и события.
- Развести business requirements и source evidence.
- Оценить MVP data readiness.
- Для каждой метрики указать готовность к расчёту и недостающие события/формулы.

### Step 7 — Decisions and validation
- Обновить 24 решения без потери ID/истории.
- Создать вопросы владельцам.
- Провести JSON/schema validation, Mermaid sanity check, consistency checks.
- Провести PII scan.
- <ФИО>, что запрещённые артефакты не изменены.

---

## 13. Критерии приёмки

### G0 — Repository safety
- Git branch/HEAD/status зафиксированы.
- Пользовательские изменения не затёрты.
- Нет неожиданных изменений вне scope.

### G1 — Evidence integrity
- Ключевые выводы о сущностях/атрибутах/связях имеют evidence ID.
- Тип evidence указан.
- Нет ложных заявлений об `ACTUAL_DATA`.
- `FILTER_VALUES` и `SQL_DERIVED` не представлены как выборка строк.
- `ACTUAL_VALUES=0` отражено, если не появилось нового подтверждённого evidence.
- Недоступность SQL Lab/DB отражена как ограничение, а не отсутствие данных.

### G2 — Domain model
- Bounded contexts описаны.
- Каждая сущность модели 1.5 получила решение или `NEEDS_EVIDENCE`.
- Order/OrderItem, Trip/Pool/Assignment, Shift/ShiftSlot, Accrual/Payout не смешаны без обоснования.
- Grain и identity имеют статус, даже если `UNKNOWN`.

### G3 — Gap visibility
- Все направления из gap analysis включены.
- Для каждого gap есть impact и следующий шаг.
- `NOT_FOUND` и `NOT_VERIFIABLE` разделены.
- <ФИО>-нужные, но отсутствующие сущности видны в target model.

### G4 — Model refinement
- Current и target diagrams разделены.
- SQL JOIN не показан как подтверждённый FK.
- Нет выдуманных типов/constraints/requiredness.
- Model diff объясняет изменения относительно 1.5.

### G5 — Business rules and MVP
- Правила раздела 3 сохранены.
- Неопределённые вопросы не превращены в решения.
- MVP screen и метрики имеют отдельную оценку готовности.
- Для неутверждённых формул указан `METRIC_DEFINITION_REQUIRED`.

### G6 — Security
- PII scan новых файлов выполнен.
- Нет реальных персональных значений и секретов.
- Нет обхода RBAC и SQL execution.

### G7 — Technical validation
- JSON валиден.
- Markdown/ссылки/пути проверены.
- Mermaid валидирован доступным инструментом; если инструмент отсутствует, это явно указано, не заявлять PASS.
- Существующие тесты/TypeScript checks, если применимы, выполнены без unrelated code changes.
- `data/catalog.sqlite` не изменён.
- Superset objects не изменены.
- Нет миграций и запросов к production DB.

Итоговый статус:
- `PASS` — все gates выполнены, существенных ограничений нет;
- `PASS_WITH_BLOCKERS` — консолидация выполнена, но остаются честно описанные блокеры;
- `FAIL` — нарушена безопасность, целостность evidence или обязательные критерии.

Ожидаемый при текущем ограничении доступа статус может быть `PASS_WITH_BLOCKERS`, но Claude Code должен определить его по результатам, а не назначать заранее.

---

## 14. Запреты

- Не создавать/применять SQL migrations.
- Не менять физическую БД или production data.
- Не выполнять SQL в Superset, пока нет разрешённого доступа.
- Не обходить RBAC и не использовать скрытые endpoints.
- Не изменять Superset objects.
- Не менять `data/catalog.sqlite`.
- Не запускать ETL/backfill.
- Не создавать API/backend/frontend/UI.
- Не коммитить и не пушить без отдельной команды.
- Не выдавать гипотезы за факты.
- Не считать SQL JOIN FK.
- Не превращать метрики в поля сущностей без основания.
- Не придумывать `time_ready`, ready event, тариф, SLA-формулу, владельца или физическую таблицу.
- Не добавлять глобальный `+3h`.
- Не исключать отмены/возвраты из SLA самостоятельно.
- Не использовать `sum_order`, `sum_paid` или `shift_N_profit` как универсальный заработок курьера.
- Не удалять бизнес-сущность только потому, что её нет в Superset.

---

## 15. Финальный отчёт Claude Code

В конце вывести:

1. Итоговый статус `PASS / PASS_WITH_BLOCKERS / FAIL`.
2. Что именно из Superset стало основой модели.
3. Количество сущностей/атрибутов/отношений по evidence status.
4. Топ-10 gaps с приоритетом.
5. Какие части MVP можно обеспечить текущими источниками.
6. Какие метрики нельзя честно рассчитать и почему.
7. Какие решения требуют бизнеса и от каких владельцев.
8. Что осталось `NOT_VERIFIABLE` из-за SQL Lab/DB visibility.
9. Какие файлы созданы/обновлены.
10. Результаты PII scan и технической валидации.
11. Подтверждения:
    - `catalog_sqlite_modified=false`;
    - `source_databases_queried=false`;
    - `superset_objects_modified=false`;
    - `migrations_applied=false`;
    - `etl_or_backfill_run=false`;
    - `git_committed=false`;
    - `git_pushed=false`.

Не писать «модель полностью подтверждена». Формулировка должна отражать различие между Superset metadata, бизнес-требованиями и тем, что нельзя проверить без фактических данных.

## 16. Ключевой принцип

**Superset определяет доказательную основу текущей модели. <ФИО> определяет целевую потребность.**

Этап 1.7 должен показать:
- что реально прослеживается в Superset;
- что существует только как SQL-логика или metadata;
- что является гипотезой;
- чего нет в охваченном Superset-каталоге;
- что нельзя проверить из-за ограничений доступа;
- что необходимо бизнесу, даже если источника пока нет.

Не смешивать эти категории. Сделать расхождения управляемыми, трассируемыми и видимыми для следующих этапов.
