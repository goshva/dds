# 09 — Finance Model

**Сгенерировано:** 2026-11-22T15:07:15.503Z

## 1. <ФИО>-правила оплаты

1. Оплата за каждый доставленный заказ.
2. Зависит от зоны и расстояния.
3. Начисление после доставки каждого заказа.
4. Отменённый заказ не оплачивается.
5. В поездке с несколькими заказами оплачиваются только доставленные.
6. Ожидание включено в стоимость заказа; отдельной оплаты простоя нет.
7. Штрафов нет.
8. Возможная зависимость тарифа от нагрузки; формула не утверждена.
9. Первые пять смен — референс, не универсальный тариф.
10. Тарифы и утверждающий владелец неизвестны.
11. `sum_order` / `sum_paid` не являются доходом курьера.

## 2. Сущности финансов

| ID | Имя | Слой | Статус | Confidence | ***REMOVED*** | Grain |
| --- | --- | --- | --- | --- | --- | --- |
| ENT-TARIFF | Tariff | TARGET_LOGICAL | BUSINESS_REQUIRED_NOT_FOUND | NONE | KEEP | Одна строка на тариф; версии. |
| ENT-COURIER-ACCRUAL | CourierAccrual | TARGET_LOGICAL | BUSINESS_REQUIRED_NOT_FOUND | NONE | KEEP | Одна строка на начисление; не подтверждено. |
| ENT-ACCRUAL-LINE | AccrualLine | TARGET_LOGICAL | DESIGN_PROPOSAL | NONE | NEW | Одна строка на компонент начисления. |
| ENT-PAYOUT | Payout | TARGET_LOGICAL | NOT_FOUND_IN_SUPERSET | NONE | KEEP | Одна строка на выплату/период. |
| ENT-PAYOUT-LINE | PayoutLine | TARGET_LOGICAL | DESIGN_PROPOSAL | NONE | NEW | Одна строка на компонент выплаты. |
| ENT-TARIFF-VERSION | TariffVersion | TARGET_LOGICAL | BUSINESS_REQUIRED_NOT_FOUND | NONE | NEW | Одна строка на версию тарифа. |
| ENT-TARIFF-RULE | TariffRule | TARGET_LOGICAL | BUSINESS_REQUIRED_NOT_FOUND | NONE | NEW | Одна строка на правило версии тарифа. |

## 3. Процессы

| ID | Процесс | Шаги | <ФИО> | Timestamps | Источник |
| --- | --- | --- | --- | --- | --- |
| PRC-011 | Начисление и выплата | Начисление за доставку → Формирование выплаты → Выплата | AccrualCreated, PayoutCreated | accrued_at, paid_at | BUSINESS_REQUIREMENT |

## 4. Предлагаемая модель

- `Tariff` + `TariffVersion` + `TariffRule` — версионируемый тариф; формула open.
- `CourierAccrual` + `AccrualLine` — начисление за доставленный заказ.
- `Payout` + `PayoutLine` — выплата; источник не найден.

## 5. Что нельзя утверждать

- `shift_N_profit` — аналитика первых пяти смен, не универсальный тариф и не ledger.
- `sum_order` / `sum_paid` — суммы заказа/оплаты, не заработок курьера.
- `events_qty` — не явка курьера.
- Начисление и выплата не разделены на подтверждённые источники.
- Нет версии тарифов, effective dates и владельца утверждения.

## 6. Что нужно от Finance

1. Где тарифы, версии и даты действия?
2. Где факт начисления за конкретный доставленный заказ?
3. Где факт выплаты курьеру?
4. Как утверждается тариф и как фиксируется изменение формулы?
