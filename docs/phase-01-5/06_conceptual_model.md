# 06. Концептуальная модель

Концептуальный уровень описывает бизнес-контексты, агрегаты, владельцев данных и связи
до того, как они превращаются в таблицы. Источник истины для деталей — `04_logical_data_model.md`
и `06_er_model.mmd`.

---

## 1. ***REMOVED***ы

| ***REMOVED*** | Назначение | Ключевые агрегаты | Владелец данных |
|---|---|---|---|
| Operations | ***REMOVED***ы, ходки, назначения, доставка | Order, Trip, DeliveryAttempt | Operations |
| Geo | Адреса и зоны доставки | Address, DeliveryZone, ZoneBoundaryVersion | Geo |
| Workforce | Курьеры, смены, очередь, доступность | Courier, Shift, QueueEntry | Workforce |
| Delivery | Фактические поездки и результаты | Trip, TripOrder, TripAssignment | Operations |
| Finance | Тарифы, начисления, корректировки | TariffVersion, Accrual, Adjustment | Finance |
| Mentorship | Кураторство и обучение новичков | MentorshipAssignment, ShiftReview | Mentorship |
| Events | Общий журнал фактов | DomainEvent, CourierEvent | Architecture |
| Reference | Справочники (ТТ, статусы, типы) | Shop, статусы, словари | Operations |

## 2. Агрегаты и границы

- **Order** — корень агрегата заказа: статус, времена, адрес, суммы-снимки, история статусов, готовность.
- **Trip** — корень агрегата ходки: состав (`trip_orders`), история состава, назначение, доставки.
  Состав после выезда неизменяем, поэтому `TripOrder` не самостоятельный корень.
- **Shift** — корень агрегата смены: очередь (`courier_queue_entries`) и события курьера.
- **DeliveryAttempt** — фиксирует результат доставки; `Accrual` ссылается на попытку, обеспечивая идемпотентность.
- **MentorshipAssignment** — связывает двух курьеров; оценки смен — дочерние записи.
- **DomainEvent** — технический журнал, не корень бизнес-агрегата.

## 3. Связи и кардинальности (концептуально)

| Связь | Кардинальность | Обязательность | Комментарий |
|---|---|---|---|
| Shop → Address | 1 : 1 | адрес обязателен для ТТ | адрес ТТ |
| Shop → DeliveryZone | 1 : N | зона принадлежит одной ТТ | правило BR-ZON-01 |
| Shop → Order | 1 : N | заказ всегда имеет ТТ | |
| Address → Order | 1 : N | адрес доставки может отсутствовать до назначения | PII |
| Courier → Shift | 1 : N | смена всегда у курьера | |
| Shop → Shift | 1 : N | смена на одной ТТ | |
| Shift → QueueEntry | 1 : N | вход в очередь в рамках смены | активный вход один |
| QueueEntry → TripAssignment | 0..1 : 1 | назначение из очереди | |
| Trip → TripOrder | 1 : N | 2–5 заказов; минимум 2 подтверждён | BR-TRP-02/03 |
| Order → TripOrder | 1 : 0..1 активный | заказ в одной активной ходке | INV-TRP-02 |
| Trip → TripAssignment | 1 : 0..1 активное | одно активное назначение | INV-TRP-03 |
| Order → DeliveryAttempt | 1 : N | попытки нумеруются | уникальность (order, attempt_no) |
| DeliveryAttempt → Accrual | 1 : 0..1 | начисление только за доставку | INV-FIN-02 |
| TariffVersion → Accrual | 1 : N | хранится использованная версия | INV-FIN-03 |
| Courier → MentorshipAssignment (mentor) | 1 : N | наставник ≠ новичок | INV-MEN-01 |
| Courier → MentorshipAssignment (trainee) | 1 : 0..1 активное | одно активное обучение | INV-MEN-02 |
| MentorshipAssignment → ShiftReview | 1 : N | оценка смен | |

## 4. Жизненные циклы

- *****REMOVED***:** RECEIVED → ACCEPTED → COLLECTING → COLLECTED → READY → ASSIGNED → IN_DELIVERY → DELIVERED / CANCELLED / RETURNED / EXCEPTION.
- *****REMOVED***:** DRAFT → FORMED → ASSIGNED → DEPARTED → IN_PROGRESS → RETURNED / COMPLETED / CANCELLED / EXCEPTION.
- *****REMOVED***:** WAITING → OFFERED → ASSIGNED, а также SKIPPED / PAUSED / LEFT / CLOSED.
- *****REMOVED***:** PLANNED → STARTED → ON_BREAK → AVAILABLE → COMPLETED, а также NO_SHOW / CANCELLED.
- **Начисление:** PENDING → APPROVED → PAID, а также ON_HOLD / REVERSED (корректировка отдельной записью).

Схемы: `07_order_lifecycle.mmd`, `08_trip_and_queue_lifecycle.mmd`, `09_financial_flow.mmd`.

## 5. Источники истины

| Данные | Источник истины | Примечание |
|---|---|---|
| ***REMOVED*** и его статус | Внешняя мастер-система (BD-016) | Superset — аналитика |
| Готовность | Новая операционная система | BD-013; кандидат `time_ready` |
| ***REMOVED*** и границы | Справочник Geo + утверждение | нового источника нет |
| Курьер и его идентичность | HR/identity (BD-017) | PII отделён |
| Смены, очередь, ходки, назначения | Новая операционная система | новые события |
| Тарифы и начисления | Finance | BD-008/BD-024 |
| Обучение | Mentorship | исторически 5939 |

Полная матрица — `15_source_of_truth_matrix.csv`.

## 6. Разделение данных

| Категория | Где живёт | Как наполняется |
|---|---|---|
| Данные существующих источников | `orders` (частично), `shops`, `couriers`, `courier_shifts` | backfill после разрешения |
| Данные новой ОС | `trips`, `trip_orders`, `trip_assignments`, `courier_queue_entries`, `order_readiness`, `domain_events` | события в реальном времени |
| Справочники и правила | `delivery_zones`, `tariff_versions`, статусы, словари | утверждение ответственными |
| Вычисляемые показатели | витрины/отчёты вне операционной модели | расчёт из событий |

KPI не хранятся как независимая истина, если вычисляются из событий (ТЗ 4.3).
