WITH
last_dt AS (
 SELECT
 dt.id_courier,
 max(dt.date_delivery_start) AS dt
 FROM mart_mixed.darkstore_time dt
 WHERE dt.id_courier > 999
 AND dt.id_order = dt.id_general
 GROUP BY dt.id_courier
),
last_shop AS (
 SELECT
 dt.id_courier,
 max(dt.shopno) AS shopno
 FROM mart_mixed.darkstore_time dt
 JOIN last_dt x
 ON x.id_courier = dt.id_courier
 AND x.dt = dt.date_delivery_start
 WHERE dt.id_courier > 999
 AND dt.id_order = dt.id_general
 GROUP BY dt.id_courier
),
tasks AS (
 SELECT
 vts.id_courier,
 max(CASE WHEN vts.id_task = 124 THEN 1 ELSE 0 END) AS task_124,
 max(CASE WHEN vts.id_task = 164 THEN 1 ELSE 0 END) AS task_164,
 max(CASE WHEN vts.id_task = 292 THEN 1 ELSE 0 END) AS task_292,
 max(CASE WHEN vts.id_task = 378 THEN 1 ELSE 0 END) AS task_378
 FROM ods.v_tasks_settings vts
 WHERE vts.id_task IN (124, 164, 292, 378)
 AND vts."active" IS TRUE
 GROUP BY vts.id_courier
),
tt AS (
 SELECT
 "N",
 "name_TT",
 region_tt,
 "Тип"
 FROM ods.v_tt
 where 1=1 and "N">99
),
org AS (
 SELECT
 org_unit_number,
 zone_cluster,
 manager_delivery,
 leader_curators
 FROM report.v_org_unit_actual
 where 1=1 and org_unit_number>99
),
couriers AS (
 SELECT
 c.id_courier,
 c.shopno,
 vt."N" AS tt_number,
 vt."name_TT" AS name_tt,
 vt.region_tt,
 vt."Тип" AS type_tt,
 ou.zone_cluster AS bush_chern,
 ou.manager_delivery AS delivery_manager,
 ou.leader_curators AS leader,
 vc."name" AS name,
 (vc.id::text || ' | ' || vc."name") AS id_name,
 vc."active" AS active,
 cot."name" AS courier_type_name,
 cjt.job_type_name,
 coalesce(t.task_124, 0) AS task_124,
 coalesce(t.task_164, 0) AS task_164,
 coalesce(t.task_292, 0) AS task_292,
 coalesce(t.task_378, 0) AS task_378
 FROM last_shop c
 JOIN tt vt
 ON vt."N" = c.shopno
 LEFT JOIN org ou
 ON ou.org_unit_number = c.shopno
 JOIN ods.v_couriers vc
 ON vc.id = c.id_courier
 AND vc."active" IS TRUE
 JOIN ods.v_couriers_payments_courier_types cot
 ON cot.id = vc.id_courier_type
 JOIN ods.v_courier_job_type cjt
 ON cjt.id = vc.job_type
 LEFT JOIN tasks t
 ON t.id_courier = vc.id
),
flagged AS (
 SELECT
 b.*,
 coalesce(max(b.shift_opened) OVER (
 PARTITION BY b.courier_id
 ORDER BY b.attempt_start, b.attempt_n
 ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
 ), 0) AS later_opened,
 CASE
 WHEN max(b.attempt_n) OVER (
 PARTITION BY b.courier_id, b.attempt_dt
 ) > b.attempt_n THEN 1
 ELSE 0
 END AS retried
 FROM agile_mart_operational.photo_control_shift_attempt b
),
attempts AS (
 SELECT *
 FROM flagged f
),
dates AS (
 SELECT DISTINCT attempt_dt
 FROM flagged
)
SELECT
 1 AS is_attempt,
 c.id_courier AS courier_id,
 c.shopno,
 c.tt_number,
 c.name_tt,
 c.region_tt,
 c.type_tt,
 c.bush_chern,
 c.delivery_manager,
 c.leader,
 c.name,
 c.id_name,
 c.active,
 c.courier_type_name,
 c.job_type_name,
 c.task_124,
 c.task_164,
 c.task_292,
 c.task_378,
 a.attempt_n,
 a.attempt_start,
 a.attempt_dt,
 a.photo_end,
 a.shift_open_time,
 a.shift_opened,
 a.first_try_pass,
 a.has_ai,
 a.later_opened,
 a.retried,
 a.photo_span_sec,
 a.success_sec,
 a.wasted_sec,
 CASE
 WHEN a.shift_opened = 1 THEN a.success_sec / 60.0
 WHEN a.wasted_sec > 0 THEN a.wasted_sec / 60.0
 END AS attempt_min,
 a.photos_cnt,
 a.ai_photos_cnt,
 a.photos_ok,
 a.photos_warning,
 a.photos_failed,
 a.photos_unavailable,
 a.photos_no_ai,
 a.selfie_ok,
 a.selfie_warning,
 a.selfie_failed,
 a.selfie_no_ai,
 a.selfie_first_status,
 a.vehicle_ok,
 a.vehicle_warning,
 a.vehicle_failed,
 a.vehicle_no_ai,
 a.vehicle_first_status,
 a.bag_ok,
 a.bag_warning,
 a.bag_failed,
 a.bag_no_ai,
 a.bag_first_status
FROM attempts a
JOIN couriers c
 ON c.id_courier = a.courier_id

UNION ALL

SELECT
 0 AS is_attempt,
 c.id_courier AS courier_id,
 c.shopno,
 c.tt_number,
 c.name_tt,
 c.region_tt,
 c.type_tt,
 c.bush_chern,
 c.delivery_manager,
 c.leader,
 c.name,
 c.id_name,
 c.active,
 c.courier_type_name,
 c.job_type_name,
 c.task_124,
 c.task_164,
 c.task_292,
 c.task_378,
 NULL::integer AS attempt_n,
 NULL::timestamp AS attempt_start,
 d.attempt_dt,
 NULL::timestamp AS photo_end,
 NULL::timestamp AS shift_open_time,
 NULL::integer AS shift_opened,
 NULL::integer AS first_try_pass,
 NULL::integer AS has_ai,
 NULL::integer AS later_opened,
 0 AS retried,
 NULL::numeric AS photo_span_sec,
 NULL::numeric AS success_sec,
 NULL::numeric AS wasted_sec,
 NULL::numeric AS attempt_min,
 NULL::integer AS photos_cnt,
 NULL::integer AS ai_photos_cnt,
 NULL::integer AS photos_ok,
 NULL::integer AS photos_warning,
 NULL::integer AS photos_failed,
 NULL::integer AS photos_unavailable,
 NULL::integer AS photos_no_ai,
 NULL::integer AS selfie_ok,
 NULL::integer AS selfie_warning,
 NULL::integer AS selfie_failed,
 NULL::integer AS selfie_no_ai,
 NULL::text AS selfie_first_status,
 NULL::integer AS vehicle_ok,
 NULL::integer AS vehicle_warning,
 NULL::integer AS vehicle_failed,
 NULL::integer AS vehicle_no_ai,
 NULL::text AS vehicle_first_status,
 NULL::integer AS bag_ok,
 NULL::integer AS bag_warning,
 NULL::integer AS bag_failed,
 NULL::integer AS bag_no_ai,
 NULL::text AS bag_first_status
FROM couriers c
CROSS JOIN dates d
WHERE c.task_124 = 1