# Источники датасетов (из обезличенного SQL)

Сгенерировано: 2026-11-21T21:03:33.726Z

## 5939 — hr_daily_pers_mentors (ch_10.0.112.21)

- CTE: cfo_pu
- физические источники: agile_mart_techaudit.actual_assistant_tt (0), agile_mart_techaudit.hr_daily_pers (0), stage_outer_sources.fio_employee (0)
- неклассифицированные ссылки: pu_tt

## 7802 — shift_time_breakdown (gp_10.0.112.100/dwh)

- CTE: shift_pool, shift_dim, shift_shop, qualified, queue_on_shift, bounds, wait_iv, assembly_iv, pool_queue, delivery_iv, intervals, points, sweep, assigned, covered, shift_time, detail, filtered
- физические источники: agile_mart_operational.shifts (0), agile_mart_operational.pools (0), mart_mixed.darkstore_time (0), agile_mart_operational.courier_queue (0), ods.v_couriers (0), ods.v_tt (0), mart.org_unit_actual (0)
- неклассифицированные ссылки: params

## 7712 — photo_control_shift_bi (gp_10.0.112.100/dwh)

- CTE: last_shop, tasks, tt, org, couriers, flagged, attempts, dates
- физические источники: mart_mixed.darkstore_time (0), ods.v_tasks_settings (0), ods.v_tt (0), report.v_org_unit_actual (0), ods.v_couriers (0), ods.v_couriers_payments_courier_types (0), ods.v_courier_job_type (0), agile_mart_operational.photo_control_shift_attempt (0)
- неклассифицированные ссылки: last_dt

## 7021 — ds_collectors_prod (ch_10.0.112.21)

- CTE: timesheet_raw, timesheet_parts, base
- физические источники: ods.timesheetfact (0), mart_mixed.darkstore_time_sheet (0)
- неклассифицированные ссылки: params, range

## 3466 — darkstore_time_sheet (ch_10.0.112.21/default)

- CTE: нет
- физические источники: dt.date_supply (0), mart_mixed.darkstore_time_sheet (0), report.v_org_unit_actual (0)
- неклассифицированные ссылки: VALUES

## 2339 — Перенесенные заказы (Reports)

- CTE: нет
- физические источники: Loyalty_srv03.dbo.Webcall_log_ui_period (0), Reports.dbo.ksa_time_vw (0)
- неклассифицированные ссылки: нет

## История запросов Superset: 17 записей
