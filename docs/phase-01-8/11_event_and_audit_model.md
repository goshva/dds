# 11 — Event & Audit Model

**Сгенерировано:** 2026-11-22T15:07:15.503Z

## 1. <ФИО> по процессам

| Процесс | Событие |
| --- | --- |
| PRC-001 | OrderCreated |
| PRC-001 | OrderUpdated |
| PRC-001 | OrderCancelled |
| PRC-002 | AssemblyStarted |
| PRC-002 | AssemblyCompleted |
| PRC-002 | OrderReady |
| PRC-003 | TripCreated |
| PRC-003 | TripCompositionChanged |
| PRC-004 | TripOrderAdded |
| PRC-004 | TripOrderRemoved |
| PRC-005 | CourierAssigned |
| PRC-006 | QueueEntered |
| PRC-006 | CourierCalled |
| PRC-006 | CourierSkipped |
| PRC-006 | QueueReturned |
| PRC-007 | TripDeparted |
| PRC-007 | TripCompositionLocked |
| PRC-008 | OrderDelivered |
| PRC-008 | TripPartiallyCompleted |
| PRC-009 | OrderCancelled |
| PRC-009 | OrderReturned |
| PRC-010 | ShiftStarted |
| PRC-010 | BreakStarted |
| PRC-010 | ShiftEnded |
| PRC-011 | AccrualCreated |
| PRC-011 | PayoutCreated |
| PRC-012 | MentorAssigned |
| PRC-012 | MentorshipAssessed |
| PRC-013 | SlaCalculated |

## 2. Сущности событий и аудита

| ID | Имя | Слой | Статус | Confidence | Grain |
| --- | --- | --- | --- | --- | --- |
| ENT-BUSINESS-EVENT | BusinessEvent | TARGET_LOGICAL | NOT_VERIFIABLE | NONE | Одна строка на событие. |
| ENT-TRIP-COMPOSITION-CHANGE | TripCompositionChange | TARGET_LOGICAL | BUSINESS_REQUIRED_NOT_FOUND | NONE | Одна строка на изменение. |
| ENT-SOURCE-SYSTEM | SourceSystem | TARGET_LOGICAL | INFERRED_FROM_MULTIPLE_SOURCES | LOW | Одна строка на систему. |
| ENT-EVIDENCE-REFERENCE | DataEvidenceReference | TARGET_LOGICAL | DESIGN_PROPOSAL | HIGH | Одна строка на evidence. |

## 3. Append-only vs mutable state

- `BusinessEvent` — единая модель событий **не навязывается**; допустима только
  при обосновании. Статус `NOT_VERIFIABLE`.
- `TripCompositionChange` — append-only история изменений состава поездки до выезда.
- `CourierAppEvent` — агрегированный слой телеметрии, не нормализованный event store.
- `EntityChangeLog` — не подтверждён как существующий источник; проектное предложение.

## 4. Кто меняет состав поездки

- Только куратор.
- До выезда: изменение разрешено, должна оставаться история.
- После выезда: изменение запрещено.
- Назначение курьера — отдельный процесс, не часть состава.

## 5. Idempotency recommendations

1. Ключ идемпотентности события: `event_type + entity_id + occurred_at` (при наличии
   стабильного ID).
2. Повторная обработка не должна создавать дубль начисления или изменения состава.
3. Для `TripCompositionChange` — уникальность по `trip_id + change_seq`.
4. Для `CourierAccrual` — уникальность по `order_id + delivered_at` при подтверждении
   зерна.
5. Все рекомендации — проектные, не подтверждённые источником.

## 6. Что не подтверждено

- Единый журнал событий.
- Событие выезда и фиксации состава.
- <ФИО> очереди: вызов, пропуск, возврат, no-show.
- <ФИО> отмены/возврата в SLA.
- Фактическая семантика timestamp в событиях.
