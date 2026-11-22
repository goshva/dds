# 01 — Logical Model Overview

**Этап:** 1.8 — Logical Data Model & ERD  
**Сгенерировано:** 2026-11-22T15:07:15.503Z  
**Статус модели:** PASS_WITH_BLOCKERS (см. `13_model_validation_report.md`)

## 1. Цель и границы модели

Логическая модель описывает предметную область курьерской службы на уровне
сущностей, атрибутов и связей. Она опирается на артефакты этапов 1.1–1.7 и
явные бизнес-правила пользователя. Модель **не является физической схемой**:
типы данных, ключи, FK и CHECK-ограничения не утверждаются без проверки данных.

Границы:

- входит: заказы, поездки/пулы, курьеры, смены, очередь, зоны, адреса,
  финансы, наставничество, события и аудит;
- не входит: физический DDL, миграции, ETL, фактические значения источников,
  настройка Superset, интеграционные API.

## 2. Два слоя модели

| Слой | Сущностей | Состав |
| --- | --- | --- |
| OBSERVED_SOURCE | 8 | Pool, AssemblyEvent, OrderStatus, PhotoControlAttempt, CourierAppEvent, HrCourierStatus, HrMentorship, SlaMetric |
| TARGET_LOGICAL | 24 | OrderItem, Trip, TripOrder, CourierAssignment, QueueEvent, ShiftBreak, ShiftSlot, ReadyEvent, DeliveryZone, ZoneBoundaryVersion, Address, AddressToZoneAssignment, MentorshipAssessment, Tariff, CourierAccrual, AccrualLine, Payout, PayoutLine, BusinessEvent, TripCompositionChange, SourceSystem, DataEvidenceReference, TariffVersion, TariffRule |
| BOTH | 7 | Order, Darkstore, Courier, Delivery, QueueEntry, CourierShift, Route |

- **Observed Source Concepts** — понятия, реально обнаруженные в SQL/metadata
  Superset. Это не доказанные физические сущности.
- **Target Logical Domain Model** — целевые сущности, включая те, для которых
  источник не найден. Такие сущности помечены `BUSINESS_REQUIRED_NOT_FOUND`,
  `NOT_VERIFIABLE`, `NOT_FOUND_IN_SUPERSET` или `DESIGN_PROPOSAL`.
- **BOTH** — сущность присутствует и в наблюдаемом, и в целевом слое.

Важно: `Pool` и `Trip` — разные концепты. Их эквивалентность не подтверждена
и в модели не предполагается.

## 3. Bounded contexts

| ID | Контекст | Английское имя | Сущностей | MVP | Владелец |
| --- | --- | --- | --- | --- | --- |
| CTX-ORDER | Заказы и доставка | Order Management | 6 | MVP | OWNER_UNKNOWN |
| CTX-DARKSTORE | Дарксторы и ТТ | Darkstore Operations | 2 | MVP | OWNER_UNKNOWN |
| CTX-COURIER | Курьеры, смены, очередь, поездки | Courier Operations | 11 | MVP | OWNER_UNKNOWN |
| CTX-GEO | География и зоны | Geo & Delivery | 5 | LATER | OWNER_UNKNOWN |
| CTX-FINANCE | Финансы курьеров | Courier Finance | 7 | LATER | OWNER_UNKNOWN |
| CTX-HR | Наставничество и HR | Mentorship & HR | 3 | LATER | OWNER_UNKNOWN |
| CTX-ANALYTICS | Аналитика и SLA | Analytics & SLA | 2 | MVP | OWNER_UNKNOWN |
| CTX-SHARED | Общие и аудит | Shared & Audit | 3 | LATER | OWNER_UNKNOWN |

Контексты разделены по бизнес-ответственности. Пересечение имён сущностей между
контекстами отсутствует; shared-сущности вынесены в `Shared & Audit`.

## 4. Assumptions

1. Бизнес-правила §4 ТЗ этапа 1.8 приняты как входные данные и не перепроверяются
   опросом; они помечены как `BUSINESS_RULE`.
2. SQL definitions Superset — evidence присутствия полей/таблиц, но не evidence
   фактических значений и не доказательство уникальности.
3. `FILTER_VALUES` и `SQL_DERIVED` — косвенные свидетельства, а не распределения.
4. Данные 1.7-исследования по снимку 3 767 датасетов и живая синхронизация 1.6.2
   (3 778 датасетов) относятся к разным контрольным точкам; расхождение не
   трактуется как потеря датасетов.
5. Полный пакет 1.7 в репозитории отсутствует (`docs/phase-01-7/` и
   `reports/phase-01-7/` не созданы), поэтому входные данные имеют статус
   `PARTIAL_INPUTS`; отчёт 1.7 в корне репозитория использован как источник.
6. Отсутствие поля в одном dataset SQL не означает отсутствия процесса в
   организации — это ограничение охвата, а не вывод об организации.

## 5. Observed vs Target

| Показатель | Значение |
| --- | --- |
| Всего сущностей | 39 |
| Только observed | 8 |
| Только target | 24 |
| Оба слоя | 7 |
| Атрибутов | 60 |
| Связей | 39 |
| Evidence links | 40 |
| Открытых решений | 37 |
| Инвариантов | 20 |
| Gaps | 20 |

## 6. Non-goals

- Не проектировать физические таблицы, типы, PK/FK и индексы.
- Не объявлять SQL JOIN внешним ключом.
- Не превращать `Pool` в `Trip` без подтверждения Operations.
- Не выдумывать источники готовности, зон, тарифов, начислений и выплат.
- Не подменять отсутствующие данные синтетическими значениями.
- Не выполнять SELECT к source DB и не менять Superset.

## 7. Навигация

| Документ | Содержание |
|---|---|
| `02_entity_catalog.md` | Каталог сущностей |
| `03_attribute_catalog.md` | Каталог атрибутов |
| `04_relationship_catalog.md` | Каталог связей |
| `05_order_lifecycle.md` | Жизненный цикл заказа |
| `06_trip_pool_assignment.md` | Trip / Pool / назначение |
| `07_queue_shift_lifecycle.md` | Очередь и смены |
| `08_zone_address_model.md` | Зоны и адреса |
| `09_finance_model.md` | Финансовая модель |
| `10_mentorship_model.md` | Наставничество |
| `11_event_and_audit_model.md` | События и аудит |
| `12_open_decisions_and_gaps.md` | Решения и gaps |
| `13_model_validation_report.md` | Самопроверка G1–G10 |
| `README.md` | Навигация и статус |
