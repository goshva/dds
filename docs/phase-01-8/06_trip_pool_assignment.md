# 06 — Trip / Pool / Assignment

**Сгенерировано:** 2026-11-22T15:07:15.503Z

## 1. Ключевое различие

| Концепт | Что это | Статус |
|---|---|---|
| `Trip` | <ФИО>-поездка: один выезд курьера с несколькими заказами | `BUSINESS_RULE` / target |
| `Pool` | Наблюдаемый источник: `id_pool` в SQL Superset | `FOUND_IN_SUPERSET_SQL` |
| `TripOrder` | Состав поездки: связь поездки и заказов | `BUSINESS_RULE` / target |
| `CourierAssignment` | Назначение курьера, отдельно от состава | `BUSINESS_RULE` / target |
| `Delivery` | Результат доставки конкретного заказа | `FOUND_IN_SUPERSET_SQL` |

`Pool` и `Trip` — **разные концепты** до подтверждения эквивалентности.
Потенциальная связь показывается как `INFERRED` / `MAPPING`.

## 2. Сущности

| ID | Имя | Слой | Статус | Confidence | ***REMOVED*** | Grain |
| --- | --- | --- | --- | --- | --- | --- |
| ENT-TRIP | Trip | TARGET_LOGICAL | INFERRED_FROM_MULTIPLE_SOURCES | MEDIUM | KEEP | Одна строка на поездку; не подтверждено. |
| ENT-POOL | Pool | OBSERVED_SOURCE | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | Одна строка на pool; не подтверждено. |
| ENT-TRIP-ORDER | TripOrder | TARGET_LOGICAL | INFERRED_FROM_MULTIPLE_SOURCES | LOW | NEW | Одна строка на пару поездка-заказ; история изменений. |
| ENT-COURIER-ASSIGNMENT | CourierAssignment | TARGET_LOGICAL | INFERRED_FROM_MULTIPLE_SOURCES | LOW | NEW | Одна строка на назначение; не подтверждено. |
| ENT-TRIP-COMPOSITION-CHANGE | TripCompositionChange | TARGET_LOGICAL | BUSINESS_REQUIRED_NOT_FOUND | NONE | NEW | Одна строка на изменение. |

## 3. Связи

| ID | From | To | Cardinality | Kind | Статус | Обоснование |
| --- | --- | --- | --- | --- | --- | --- |
| REL-001 | ENT-TRIP | ENT-TRIP-ORDER | 1:N | BUSINESS_CONCEPT | BUSINESS_RULE | Поездка содержит несколько заказов по бизнес-определению. |
| REL-002 | ENT-TRIP-ORDER | ENT-ORDER | N:1 | INFERRED | INFERRED_RELATIONSHIP | id_pool и id_order встречаются в одном SQL; состав не доказан. |
| REL-003 | ENT-COURIER-ASSIGNMENT | ENT-TRIP | N:1 | INFERRED | INFERRED_RELATIONSHIP | courier_id_darkstore и id_pool встречаются в одном SQL. |
| REL-004 | ENT-TRIP | ENT-COURIER | N:1 | INFERRED | INFERRED_RELATIONSHIP | Курьер связан с поездкой через назначение. |
| REL-021 | ENT-TRIP-ORDER | ENT-TRIP | N:1 | BUSINESS_CONCEPT | BUSINESS_RULE | Состав принадлежит поездке. |
| REL-022 | ENT-COURIER-ASSIGNMENT | ENT-COURIER | N:1 | INFERRED | INFERRED_RELATIONSHIP | Назначение связывает курьера и поездку. |
| REL-023 | ENT-POOL | ENT-TRIP | UNKNOWN | MAPPING | INFERRED_RELATIONSHIP | Pool — наблюдаемое понятие; Trip — бизнес-поездка; равенство не доказано. |
| REL-027 | ENT-ROUTE | ENT-TRIP | 1:1 | INFERRED | INFERRED_RELATIONSHIP | Маршрут и поездка связаны, но соответствие не доказано. |
| REL-032 | ENT-TRIP-COMPOSITION-CHANGE | ENT-TRIP | N:1 | BUSINESS_CONCEPT | BUSINESS_RULE | Изменения состава должны иметь историю. |
| REL-033 | ENT-COURIER-ASSIGNMENT | ENT-TRIP-ORDER | 1:N | PROPOSED | PROPOSED | Назначение может относиться к поездке, а не к отдельному заказу. |

## 4. <ФИО>-правила состава

1. Целевой размер группы — 3–5 заказов; 2 заказа допустимы, если готовы только два.
2. Если готово больше пяти — отбор по времени готовности, срочности и кратчайшему маршруту.
3. Группировка автоматическая, возможна ручная корректировка.
4. Поездка формируется после появления состава; назначение курьера — отдельный процесс.
5. Куратор может менять состав после назначения и до выезда; изменения должны иметь историю.
6. После выезда состав неизменяем.
7. Одна поездка — одна зона.
8. Состав меняет только куратор.
9. 3–5 — бизнес-ориентир, не DB CHECK.
10. Смешение соседних зон — только с отдельным разрешением.

## 5. <ФИО> изменения состава

- `TripCompositionChange` — предлагаемая сущность истории изменений.
- Изменения до выезда: mutable, с записью кто/когда/что изменил.
- После выезда: immutable; изменение запрещено.
- В модели **нет** `CHECK(order_count BETWEEN 3 AND 5)` и нет `NOT NULL`/FK
  на непроверенных полях.

## 6. Что не подтверждено

- Эквивалентность `Pool` и `Trip`.
- Семантика `courier_id_darkstore`: назначенный курьер, курьер на доставке или атрибут факта.
- Фактическая кардинальность `id_general` относительно `id_order`.
- Источник события выезда и фиксации состава.
- Правила смешения зон.
