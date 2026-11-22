# 04. Анализ данных о сменах (7802, 7712, 7021)

## 7802 — shift_time_breakdown (gp_10.0.112.100/dwh)
- Тип: virtual; schema `agile_mart_operational`; колонок 23; SQL 10498 символов.
- Физические источники: agile_mart_operational.shifts, agile_mart_operational.pools, agile_mart_operational.courier_queue, mart_mixed.darkstore_time, ods.v_couriers, ods.v_tt, mart.org_unit_actual.
- **Зерно задокументировано в SQL:** id_shift × ТТ; rn_shift = 1 — одна строка смены; rn_shift_pu = 1 — одна строка смены внутри ПУ (из комментариев SQL датасета)
- Ключевые поля: id_shift, id_courier, dt, shopno, rn_shift, rn_shift_tt, rn_shift_pu, rn_shift_bush, rn_shift_region, rn_shift_tu, shift_minutes, assembly_minutes, delivery_minutes, wait_minutes, useless_minutes.
- ПДн: courier_name.

*****REMOVED***:** зерно «смена × ТТ» и правило `rn_shift = 1` — единственное документированное зерно среди
проверенных датасетов. SQL-форензика подтверждает вычисления: `rn_shift = row_number() OVER (PARTITION BY id_shift ORDER BY shopno NULLS LAST)`,
`shift_minutes = round(shift_raw, 1)`, `useless_minutes = shift_raw - wait_raw - assembly_raw - delivery_raw`
(то есть shift = wait + assembly + delivery + useless). Требуется проверка данных (уникальность id_shift, NULL,
отрицательные значения) — заблокировано.

### Физические таблицы, вскрытые SQL 7802
| Таблица | Колонки | Значение для модели |
|---|---|---|
| `agile_mart_operational.shifts` | id_shift, id_courier, id_pool, shift_start, shift_finish | прямой источник `courier_shifts` (начало/окончание смены) |
| `agile_mart_operational.pools` | id_pool, id_order, pool_start, pool_finish | структура пула и его заказов → кандидат в `trips`/`trip_orders` |
| `agile_mart_operational.courier_queue` | courier_id, id_shift, queue_in_dttm, queue_out_dttm, has_order, first_delivery_dttm, cluster_id | прямой источник `courier_queue_entries` (вход/выход из очереди) |
| `mart_mixed.darkstore_time` | id_order, id_general, shopno, date_order | заказный источник |

## 7712 — photo_control_shift_bi (gp_10.0.112.100/dwh)
- Факт пишет DAG в `agile_mart_operational.photo_control_shift_attempt`.
- `shift_open_time` — время события фотоконтроля начала смены, `shift_opened` — признак 0/1.
- `id_shift` отсутствует → прямая связь с 7802 по ключу смены невозможна.

*****REMOVED***:** источник годится для подтверждения факта открытия смены, но не как мастер смен.

## 7021 — ds_collectors_prod (ch_10.0.112.21)
- Описание: «Отчет по выработке сборщиков в дарксторах».
- `id_courier` отсутствует; есть `id_sbor`, `id_assemblysheet`, `qty_collected`.
- `shift_type`, `is_night_shift` относятся к сменам **сборщиков**.

*****REMOVED*** (опровержение Этапа 1.5):** использование 7021 для `courier_shifts.shift_type` **некорректно**.
Поле `shift_type` следует исключить из источников модели курьерских смен (статус CONTRADICTED).
