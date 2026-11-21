# 12. Правила целостности и инварианты

Инвариантов: **36**. Типы проверок: DB_CONSTRAINT, PARTIAL_INDEX, TRANSACTION, APPLICATION, TEST.

| ID | Область | ***REMOVED*** | Тип | Таблицы | Источник |
|---|---|---|---|---|---|
| INV-ORD-01 | orders | Внешний заказ уникален по (source_system, external_order_id) | DB_CONSTRAINT | orders | ТЗ 9.1.1 |
| INV-ORD-02 | orders | delivered_at не раньше order_created_at | TEST | orders | ТЗ 9.1.3 |
| INV-ORD-03 | orders | ready_at не раньше начала/окончания сборки без явного исключения | TEST | orders | ТЗ 9.1.4 |
| INV-ORD-04 | orders | Статус DELIVERED требует подтверждённого события доставки | TRANSACTION | orders, delivery_attempts | ТЗ 9.1.5 |
| INV-ORD-05 | orders | Отмена/возврат не удаляют заказ из истории | APPLICATION | orders, order_status_history | ТЗ 9.1.6 |
| INV-ZON-01 | zones | Активная зона принадлежит одной торговой точке | DB_CONSTRAINT | delivery_zones | ТЗ 9.2.1 |
| INV-ZON-02 | zones | Активная зона утверждена географическим отделом | APPLICATION | delivery_zones | ТЗ 9.2.2 |
| INV-ZON-03 | zones | Изменение текущих границ не переписывает зону сформированной ходки | APPLICATION | trips, delivery_zones | ТЗ 9.2.4 |
| INV-ZON-04 | zones | Адрес на границе относится к зоне с минимальным временем доставки; при конфликте — исключение | APPLICATION | orders, delivery_zones | ТЗ 9.2.5-9.2.6 |
| INV-TRP-01 | trips | Все активные заказы ходки принадлежат одной зоне и одному даркстору | TRANSACTION | trips, trip_orders, orders | ТЗ 9.3.1 |
| INV-TRP-02 | trips | Один заказ входит только в одну активную ходку | PARTIAL_INDEX | trip_orders | ТЗ 9.3.2 |
| INV-TRP-03 | trips | Один курьер не имеет две активные ходки без отдельного решения | PARTIAL_INDEX | trips, trip_assignments | ТЗ 9.3.3 |
| INV-TRP-04 | trips | Состав после выезда неизменяем | TRANSACTION | trips, trip_orders | ТЗ 9.3.4 |
| INV-TRP-05 | trips | Система запрещает автоматическое добавление шестого заказа без спец. разрешения | APPLICATION | trip_orders | ТЗ 9.3.9 |
| INV-QUE-01 | queue | FIFO по монотонной queue_sequence в пределах магазина/очереди | TRANSACTION | courier_queue_entries | ТЗ 9.4.1 |
| INV-QUE-02 | queue | В очередь можно попасть только после отметки прибытия | APPLICATION | courier_queue_entries | ТЗ 9.4.2 |
| INV-QUE-03 | queue | Курьер с неактивной/завершённой сменой не получает назначение | TRANSACTION | courier_shifts, trip_assignments | ТЗ 9.4.3 |
| INV-QUE-04 | queue | Повторный вход не создаёт дубликат активной очереди для той же смены | PARTIAL_INDEX | courier_queue_entries | ТЗ 9.4.5 |
| INV-SHF-01 | shifts | ***REMOVED*** принадлежит одному курьеру и одному даркстору | APPLICATION | courier_shifts | ТЗ 9.5.1 |
| INV-SHF-02 | shifts | actual_end_at >= actual_start_at | TEST | courier_shifts | ТЗ 9.5.2 |
| INV-SHF-03 | shifts | Нельзя завершить смену при незакрытой ходке без явной процедуры | TRANSACTION | courier_shifts, trips | ТЗ 9.5.3 |
| INV-SHF-04 | shifts | Перерывы не пересекаются | TEST | courier_shifts, courier_events | ТЗ 9.5.4 |
| INV-FIN-01 | finance | Начисление связано с доставленным заказом и попыткой доставки | DB_CONSTRAINT | courier_accruals | ТЗ 9.6.1 |
| INV-FIN-02 | finance | Идемпотентность не допускает повторного начисления за одну доставку | DB_CONSTRAINT | courier_accruals | ТЗ 9.6.2 |
| INV-FIN-03 | finance | Начисление хранит версию тарифа и параметры расчёта | APPLICATION | courier_accruals | ТЗ 9.6.3 |
| INV-FIN-04 | finance | Сумма — NUMERIC с валютой | DB_CONSTRAINT | courier_accruals, tariff_versions | ТЗ 9.6.4 |
| INV-FIN-05 | finance | Историческое начисление не пересчитывается при изменении тарифа | APPLICATION | courier_accruals, tariff_versions | ТЗ 9.6.5 |
| INV-FIN-06 | finance | Корректировки — отдельные записи | APPLICATION | accrual_adjustments | ТЗ 9.6.6 |
| INV-FIN-07 | finance | Отменённый/недоставленный заказ не получает обычное положительное начисление | APPLICATION | courier_accruals, orders | ТЗ 9.6.7 |
| INV-FIN-08 | finance | sum_paid не используется как сумма начисления курьеру | TEST | courier_accruals | ТЗ 9.6.9 |
| INV-MEN-01 | mentorship | Наставник и новичок — разные курьеры | DB_CONSTRAINT | mentorship_assignments | ТЗ 9.7.1 |
| INV-MEN-02 | mentorship | Одно активное назначение наставника для новичка | PARTIAL_INDEX | mentorship_assignments | ТЗ 9.7.2 |
| INV-MEN-03 | mentorship | Плановый срок — две недели; завершение имеет подтверждающего и дату | APPLICATION | mentorship_assignments | ТЗ 9.7.3-9.7.4 |
| INV-EVT-01 | events | <ФИО> append-only | APPLICATION | domain_events, courier_events | ТЗ 9.8.1 |
| INV-EVT-02 | events | idempotency_key уникален в пределах источника/типа | DB_CONSTRAINT | domain_events, courier_events | ТЗ 9.8.2 |
| INV-EVT-03 | events | occurred_at и recorded_at — разные поля | DB_CONSTRAINT | domain_events, courier_events | ТЗ 9.8.3 |
