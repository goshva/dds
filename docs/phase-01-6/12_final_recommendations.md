# 12. Итоговые рекомендации

## 1. Что реально подтверждено
- Метаданные шести датасетов: типы, колонки, метрики, владельцы (без выгрузки ПДн), SQL-хэши.
- Физические источники: `agile_mart_techaudit.actual_assistant_tt`, `agile_mart_techaudit.hr_daily_pers`,
  `agile_mart_operational.shifts`, `agile_mart_operational.pools`, `agile_mart_operational.courier_queue`,
  `agile_mart_operational.photo_control_shift_attempt`, `mart_mixed.darkstore_time`,
  `mart_mixed.darkstore_time_sheet`, `ods.timesheetfact`, `ods.v_couriers`, `ods.v_tt`,
  `report.v_org_unit_actual`, `Loyalty_srv03.dbo.Webcall_log_ui_period`, `Reports.dbo.ksa_time_vw`.
- Зерно 7802 (смена × ТТ, rn_shift=1) — документировано в SQL.
- Факт фотоконтроля начала смены (7712) пишется DAG в `photo_control_shift_attempt`.
- **Физические схемы, вскрытые SQL:** `agile_mart_operational.shifts` (id_shift, id_courier, id_pool, shift_start, shift_finish),
  `.pools` (id_pool, id_order, pool_start, pool_finish), `.courier_queue` (courier_id, id_shift, queue_in_dttm, queue_out_dttm, has_order),
  `.photo_control_shift_attempt` (courier_id, attempt_dt, attempt_n, attempt_start, shift_opened).
- **Вычисляемые выражения** подтверждены: `rn_shift`, `shift_minutes`, `useless_minutes` (7802);
  `deadline_sbor`, `last_sbor_touch` (3466); `shift_type`, `is_night_shift`, `has_timesheet` (7021); `enough_shifts_for_mentor` (5939).
- **<ФИО> колонки метаданных:** `time_ready`, `time_ready_plan` (3466) и `date_for_mentor` (5939) не формируются SQL датасетов.

## 2. Пригодность источников для production-модели
| Источник | Пригодность | Комментарий |
|---|---|---|
| 7802 shift_time_breakdown | ПРИГОДЕН (схема) | зерно и таблицы shifts/pools/courier_queue подтверждены |
| 7712 photo_control_shift_bi | ЧАСТИЧНО | подтверждает открытие смены, не мастер смен |
| 3466 darkstore_time_sheet | ЧАСТИЧНО | time_ready опровергнут; Jinja-параметры; 121 колонка витрины |
| 5939 hr_daily_pers_mentors | ТОЛЬКО АНАЛИТИКА | справочник помощников ТТ; ПДн; date_for_mentor опровергнут |
| 2339 Перенесенные заказы | ЧАСТИЧНО | лог переносов за месяц; причины переноса полезны для BD-002/BD-012 |
| 7021 ds_collectors_prod | НЕ ПРИГОДЕН для курьеров | данные о сборщиках; shift_type из табеля |

## 3. Подтверждённые связи
Ни одна связь не подтверждена на уровне данных. На уровне **схемы** подтверждены:
`pools.id_order` (пул↔заказ), `shifts.id_pool` (смена↔пул), `courier_queue.id_shift` (очередь↔смена),
`courier_queue.courier_id` (очередь↔курьер). Совместимы по типам: 3466↔4732, 2339↔4732, 7802↔4732.
Опровергнута: 7802↔7021.

## 4. Опровергнутые выводы Этапа 1.5
- **`time_ready` не является источником готовности** — колонка не формируется SQL датасета 3466 (0 вхождений в 35 926 символах).
- 7021 не является источником классификации **курьерских** смен (shift_type вычисляется из табеля сборщиков).
- 2339 не подтверждает модель пакетов/ходок; quantity_batch/orders_assignment не определены в SQL.
- 5939 не подтверждает операционное назначение наставника новичку; date_for_mentor не формируется SQL.

## 5. Что можно вынести на утверждение бизнеса
BD-018 (СУБД), BD-020 (слоты), BD-022 (история зон), BD-023 (сроки хранения) — техническая часть готова.

## 6. Что невозможно закрыть технически
BD-001…BD-017, BD-019, BD-021, BD-024 — требуют бизнес-решения;
BD-013, BD-014, BD-017 — требуют данных после снятия BLOCK-1.

## 7. Изменения в модели 1.5
См. `10_model_impact_assessment.md`: 7 приоритетных корректировок, DDL не изменялся.

## 8. Неподтверждённые таблицы и события
Таблицы без подтверждённого источника: delivery_zones, zone_boundary_versions, work_slots, tariff_versions,
courier_accruals, accrual_adjustments, mentorship_shift_reviews, domain_events.
<ФИО> без источника: все новые операционные (ORDER_READY, очередь, назначения, смены, начисления).

## 9. Что блокирует финализацию DDL
1. BLOCK-1 (SQL Lab 403) — нет проверки данных.
2. Отсутствие тарифной формулы (BD-008/BD-024).
3. Отсутствие справочника зон.
4. Неопределённый мастер-источник заказа/курьера (BD-016/BD-017).
5. Неутверждённая СУБД (BD-018).

## 10. Можно ли переходить к Этапу 1.7
**Условно да** — как к этапу корректировки модели и подготовки финального DDL,
при условии, что Этап 1.7 либо получит доступ к SQL Lab, либо явно зафиксирует работу без проверки данных.
Финализация DDL без снятия BLOCK-1 и без решений BD-008/BD-013/BD-018 невозможна.
