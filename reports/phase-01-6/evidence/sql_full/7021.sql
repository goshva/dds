WITH
params AS (
 SELECT
 {% if from_dttm %}
 '{{ from_dttm }}' AS date_from,
 {% else %}
 toDateTime(toStartOfWeek(today(), 1) - INTERVAL 7 DAY) AS date_from,
 {% endif %}

 {% if to_dttm %}
 '{{ to_dttm }}' AS date_to,
 {% else %}
 toDateTime(toStartOfWeek(today(), 1)) AS date_to,
 {% endif %}

 40 AS shift_start_grace_min,
 40 AS shift_end_grace_min
),
timesheet_raw AS (
 SELECT
 trim(toString(ts.employeeId)) AS id_sbor,
 ts.id_tt AS id_tt,
 ts.time_start AS time_start,
 ts.time_end AS time_end,

 if(
 toDate(ts.time_end) > toDate(ts.time_start),
 'Ночной',
 'Дневной'
 ) AS shift_type

 FROM ods.timesheetfact AS ts

 WHERE ts.time_end >= (
 (SELECT date_from FROM params)
 - toIntervalMinute((SELECT shift_start_grace_min FROM params))
 )
 AND ts.time_start <= (
 (SELECT date_to FROM params)
 + toIntervalMinute((SELECT shift_end_grace_min FROM params))
 )
),
timesheet_parts AS (
 SELECT
 id_sbor,
 id_tt,
 time_start,
 time_end,
 shift_type,

 toDate(toStartOfDay(time_start) + toIntervalDay(day_num)) AS date_collected,

 greatest(
 time_start,
 toDateTime(toDate(toStartOfDay(time_start) + toIntervalDay(day_num)))
 ) AS part_start,

 least(
 time_end,
 toDateTime(toDate(toStartOfDay(time_start) + toIntervalDay(day_num))) + INTERVAL 1 DAY
 ) AS part_end,

 greatest(
 dateDiff(
 'second',
 greatest(
 time_start,
 toDateTime(toDate(toStartOfDay(time_start) + toIntervalDay(day_num)))
 ),
 least(
 time_end,
 toDateTime(toDate(toStartOfDay(time_start) + toIntervalDay(day_num))) + INTERVAL 1 DAY
 )
 ) / 3600.0,
 0
 ) AS hours_on_schedule

 FROM timesheet_raw

 ARRAY JOIN range(
 toUInt32(dateDiff('day', toDate(time_start), toDate(time_end)) + 1)
 ) AS day_num
),
base AS (
 SELECT
 row_number() OVER (
 ORDER BY
 dts.date_collected,
 dts.id_order,
 dts.id_assemblysheet,
 dts.id_sbor,
 dts.id_tt,
 dts.qty_collected,
 dts.collection_time_all,
 dts.date_set_cell
 ) AS base_row_num,

 dts.date_collected AS date_collected_dt,
 toDate(dts.date_collected) AS date_collected,

 dts.sbor AS sbor,
 dts.user_code AS user_code,
 dts.id_sbor AS id_sbor,

 dts.id_tt AS id_tt,
 dts.shopno AS shopno,
 dts.name_tt AS name_tt,
 dts.region_tt AS region_tt,
 dts.pom AS pom,
 dts.feature_sbor AS feature_sbor,

 dts.id_order AS id_order,
 dts.id_assemblysheet AS id_assemblysheet,
 dts.is_collected AS is_collected,
 dts.date_set_cell AS date_set_cell,
 dts.qty_collected AS qty_collected,

 dts.collection_time_all AS collection_time_all,
 dts.collection_time_real_sec_sheet AS collection_time_real_sec_sheet,
 dts.slots AS slots,
 dts.sla_order_time AS sla_order_time,
 
 dts.date_order AS date_order,
 dts.date_supply AS date_supply,
 dts.date_supply_untill AS date_supply_untill,

 dts.order_status AS order_status,
 dts.id_service AS id_service,
 dts.id_source AS id_source,
 dts.order_type AS order_type,
 dts.date_status_10 AS date_status_10,
 dts.sla_delivery_time_all AS sla_delivery_time_all,
 dts.sla_collection_time_all AS sla_collection_time_all,
 dts.darkkitchen_closed AS darkkitchen_closed,
 dts.date_f_status_3_5 AS date_f_status_3_5,

 if(
 dts.order_status = 'Успешно завершен'
 AND 
 (
 (
 dts.id_service = 3 
 AND dts.id_source = 80 
 AND dts.order_type = 14
 AND dts.date_status_10 > dts.date_supply_untill
 )
 OR 
 (
 dts.id_service = 3 
 AND (dts.id_source <> 80 OR dts.order_type <> 14)
 AND dts.date_status_10 > dts.date_supply
 )
 OR 
 (
 dts.id_service <> 3
 AND dts.date_order >= (dts.date_supply_untill - coalesce(dts.sla_delivery_time_all, 0) * 60)
 AND dts.collection_time_all > dts.sla_collection_time_all
 )
 OR 
 (
 dts.id_service <> 3
 AND dts.darkkitchen_closed > 0
 AND dts.collection_time_all > dts.sla_collection_time_all
 )
 OR 
 (
 dts.id_service <> 3
 AND (dts.darkkitchen_closed = 0 OR dts.darkkitchen_closed IS NULL)
 AND dts.date_order < (dts.date_supply_untill - coalesce(dts.sla_delivery_time_all, 0) * 60)
 AND coalesce(dts.date_set_cell, dts.date_f_status_3_5) > (dts.date_supply_untill - coalesce(dts.sla_delivery_time_all, 0) * 60)
 )
 ),
 1,
 0
 ) AS is_overdue

 FROM mart_mixed.darkstore_time_sheet AS dts
 PREWHERE
 dts.date_collected >= (SELECT date_from FROM params)
 AND dts.date_collected <= (SELECT date_to FROM params)

 WHERE dts.is_collected = 1
 AND dts.feature_tt = 'ДаркСтор'
 AND dts.partner IS NULL
 and user_code not in ('0', '111111')
)
 SELECT
 b.base_row_num AS base_row_num,

 b.date_collected AS date_collected,
 b.date_collected_dt AS date_collected_dt,

 b.sbor AS sbor,
 b.user_code AS user_code,
 b.id_sbor AS id_sbor,

 b.id_tt AS id_tt,
 b.shopno AS shopno,
 b.name_tt AS name_tt,
 b.region_tt AS region_tt,
 b.pom AS pom,
 b.feature_sbor AS feature_sbor,

 b.id_order AS id_order,
 b.id_assemblysheet AS id_assemblysheet,
 b.is_collected AS is_collected,
 b.date_set_cell AS date_set_cell,
 b.qty_collected AS qty_collected,

 b.collection_time_all AS collection_time_all,
 b.collection_time_real_sec_sheet AS collection_time_real_sec_sheet,
 b.slots AS slots,
 b.sla_order_time AS sla_order_time,
 
 b.date_order AS date_order,
 b.date_supply AS date_supply,
 b.date_supply_untill AS date_supply_untill,

 b.order_status AS order_status,
 b.id_service AS id_service,
 b.id_source AS id_source,
 b.order_type AS order_type,
 b.date_status_10 AS date_status_10,
 b.sla_delivery_time_all AS sla_delivery_time_all,
 b.sla_collection_time_all AS sla_collection_time_all,
 b.darkkitchen_closed AS darkkitchen_closed,
 b.date_f_status_3_5 AS date_f_status_3_5,

 b.is_overdue AS is_overdue,

 tp.time_start AS time_start,
 tp.time_end AS time_end,
 tp.part_start AS part_start,
 tp.part_end AS part_end,

 if(tp.id_sbor IS NULL, 0, 1) AS has_timesheet,

 tp.shift_type AS shift_type,

 if(
 tp.shift_type IS NULL,
 NULL,
 toUInt8(tp.shift_type = 'Ночной')
 ) AS is_night_shift,

 tp.hours_on_schedule AS hours_on_schedule,

 row_number() OVER (
 PARTITION BY b.base_row_num
 ORDER BY
 if(tp.id_sbor IS NULL, 1, 0),
 tp.part_start DESC,
 tp.part_end DESC,
 tp.time_start DESC
 ) AS join_row_num, 

 row_number() OVER (
 PARTITION BY
 tp.id_sbor,
 tp.id_tt,
 tp.date_collected,
 tp.shift_type,
 tp.part_start,
 tp.part_end
 ORDER BY
 b.date_collected_dt,
 b.id_order,
 b.id_assemblysheet,
 b.base_row_num
 ) AS hours_row_num 

 FROM base AS b

 LEFT JOIN timesheet_parts AS tp
 ON b.id_sbor = tp.id_sbor
 AND b.id_tt = tp.id_tt
 AND b.date_collected = tp.date_collected
 AND b.date_collected_dt >= tp.part_start - toIntervalMinute((SELECT shift_start_grace_min FROM params))
 AND b.date_collected_dt < tp.part_end + toIntervalMinute((SELECT shift_end_grace_min FROM params))