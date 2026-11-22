{% if from_dttm is defined and from_dttm %}
WITH params AS (
 SELECT
 '{{ from_dttm }}'::timestamp AS d_from,
 ('{{ to_dttm }}'::timestamp::date + 1)::timestamp AS d_to
)
{% else %}
WITH params AS (
 SELECT
 TIMESTAMP '2026-11-01 00:00:00' AS d_from,
 TIMESTAMP '2026-11-02 00:00:00' AS d_to
)
{% endif %}
,
shift_pool AS (
 SELECT
 s.id_shift,
 s.id_courier,
 s.id_pool,
 min(s.shift_start) AS shift_start,
 max(s.shift_finish) AS shift_finish,
 min(p.pool_start) AS pool_start,
 max(p.pool_finish) AS pool_finish
 FROM agile_mart_operational.shifts s
 JOIN agile_mart_operational.pools p
 ON p.id_pool = s.id_pool
 CROSS JOIN params prm
 WHERE s.shift_start >= prm.d_from
 AND s.shift_start < prm.d_to
 AND p.pool_start >= prm.d_from - INTERVAL '1 day'
 AND p.pool_start < prm.d_to + INTERVAL '1 day'
 GROUP BY s.id_shift, s.id_courier, s.id_pool
),
shift_dim AS (
 SELECT
 id_shift,
 id_courier,
 min(shift_start) AS shift_start,
 max(shift_finish) AS shift_finish
 FROM shift_pool
 GROUP BY id_shift, id_courier
),
shift_shop AS (
 SELECT
 s.id_shift,
 dt.shopno
 FROM agile_mart_operational.shifts s
 JOIN agile_mart_operational.pools p
 ON p.id_pool = s.id_pool
 JOIN mart_mixed.darkstore_time dt
 ON dt.id_order = p.id_order
 AND dt.id_general = dt.id_order
 CROSS JOIN params prm
 WHERE s.shift_start >= prm.d_from
 AND s.shift_start < prm.d_to
 AND p.pool_start >= prm.d_from - INTERVAL '1 day'
 AND p.pool_start < prm.d_to + INTERVAL '1 day'
 AND dt.date_order >= prm.d_from - INTERVAL '14 days'
 AND dt.date_order < prm.d_to + INTERVAL '2 days'
 AND dt.shopno IS NOT NULL
 GROUP BY s.id_shift, dt.shopno
),
qualified AS (
 SELECT
 q.courier_id,
 q.cluster_id,
 q.queue_in_dttm,
 q.queue_out_dttm,
 q.first_delivery_dttm
 FROM agile_mart_operational.courier_queue q
 CROSS JOIN params prm
 WHERE q.has_order = 1
 AND q.queue_in_dttm >= prm.d_from - INTERVAL '1 day'
 AND q.queue_in_dttm < prm.d_to + INTERVAL '1 day'
 AND q.courier_id IN (SELECT id_courier FROM shift_dim)
),
queue_on_shift AS (
 SELECT
 sd.id_shift,
 q.queue_in_dttm,
 q.queue_out_dttm,
 q.first_delivery_dttm
 FROM shift_dim sd
 JOIN qualified q
 ON q.courier_id = sd.id_courier
 AND q.queue_in_dttm <= sd.shift_finish
 AND q.queue_out_dttm >= sd.shift_start
),
bounds AS (
 SELECT
 sd.id_shift,
 sd.id_courier,
 sd.shift_finish,
 least(COALESCE(min(q.queue_in_dttm), sd.shift_start), sd.shift_start) AS shift_start_dttm
 FROM shift_dim sd
 LEFT JOIN queue_on_shift q
 ON q.id_shift = sd.id_shift
 GROUP BY sd.id_shift, sd.id_courier, sd.shift_start, sd.shift_finish
),
wait_iv AS (
 SELECT
 b.id_shift,
 greatest(q.queue_in_dttm, b.shift_start_dttm) AS t0,
 least(q.first_delivery_dttm, b.shift_finish) AS t1
 FROM queue_on_shift q
 JOIN bounds b ON b.id_shift = q.id_shift
),
assembly_iv AS (
 SELECT
 b.id_shift,
 greatest(q.first_delivery_dttm, b.shift_start_dttm) AS t0,
 least(q.queue_out_dttm, b.shift_finish) AS t1
 FROM queue_on_shift q
 JOIN bounds b ON b.id_shift = q.id_shift
),
pool_queue AS (
 SELECT
 sp.id_shift,
 sp.id_pool,
 sp.pool_finish,
 min(q.queue_out_dttm) AS queue_out_dttm
 FROM shift_pool sp
 JOIN queue_on_shift q
 ON q.id_shift = sp.id_shift
 AND sp.pool_start >= q.queue_in_dttm
 AND sp.pool_start <= q.queue_out_dttm
 GROUP BY sp.id_shift, sp.id_pool, sp.pool_finish
),
delivery_iv AS (
 SELECT
 b.id_shift,
 greatest(COALESCE(pq.queue_out_dttm, sp.pool_start), b.shift_start_dttm) AS t0,
 least(sp.pool_finish, b.shift_finish) AS t1
 FROM shift_pool sp
 JOIN bounds b ON b.id_shift = sp.id_shift
 LEFT JOIN pool_queue pq
 ON pq.id_shift = sp.id_shift
 AND pq.id_pool = sp.id_pool
),
intervals AS (
 SELECT id_shift, t0, t1, 'wait'::text AS kind FROM wait_iv WHERE t1 > t0
 UNION ALL
 SELECT id_shift, t0, t1, 'assembly' FROM assembly_iv WHERE t1 > t0
 UNION ALL
 SELECT id_shift, t0, t1, 'delivery' FROM delivery_iv WHERE t1 > t0
),
points AS (
 SELECT
 id_shift,
 ts,
 sum(CASE WHEN kind = 'wait' THEN delta ELSE 0 END) AS wait_delta,
 sum(CASE WHEN kind = 'assembly' THEN delta ELSE 0 END) AS assembly_delta,
 sum(CASE WHEN kind = 'delivery' THEN delta ELSE 0 END) AS delivery_delta
 FROM (
 SELECT id_shift, t0 AS ts, kind, 1 AS delta FROM intervals
 UNION ALL
 SELECT id_shift, t1 AS ts, kind, -1 AS delta FROM intervals
 ) x
 GROUP BY id_shift, ts
),
sweep AS (
 SELECT
 id_shift,
 ts,
 sum(wait_delta) OVER (PARTITION BY id_shift ORDER BY ts) AS wait_active,
 sum(assembly_delta) OVER (PARTITION BY id_shift ORDER BY ts) AS assembly_active,
 sum(delivery_delta) OVER (PARTITION BY id_shift ORDER BY ts) AS delivery_active,
 lead(ts) OVER (PARTITION BY id_shift ORDER BY ts) AS next_ts
 FROM points
),
assigned AS (
 SELECT
 id_shift,
 CASE
 WHEN delivery_active > 0 THEN 'delivery'
 WHEN assembly_active > 0 THEN 'assembly'
 WHEN wait_active > 0 THEN 'wait'
 END AS kind,
 extract(epoch FROM (next_ts - ts)) / 60.0 AS minutes
 FROM sweep
 WHERE next_ts IS NOT NULL
 AND (delivery_active > 0 OR assembly_active > 0 OR wait_active > 0)
),
covered AS (
 SELECT
 id_shift,
 kind,
 sum(minutes) AS minutes
 FROM assigned
 GROUP BY id_shift, kind
),
shift_time AS (
 SELECT
 x.id_shift,
 x.id_courier,
 x.shift_start_dttm::date AS shift_date,
 x.shift_start_dttm,
 x.shift_finish AS shift_finish_dttm,
 round(x.shift_raw::numeric, 1) AS shift_minutes,
 round(x.wait_raw::numeric, 1) AS wait_minutes,
 round(x.assembly_raw::numeric, 1) AS assembly_minutes,
 round(x.delivery_raw::numeric, 1) AS delivery_minutes,
 round(x.shift_raw::numeric, 1)
 - round(x.wait_raw::numeric, 1)
 - round(x.assembly_raw::numeric, 1)
 - round(x.delivery_raw::numeric, 1) AS useless_minutes
 FROM (
 SELECT
 b.id_shift,
 b.id_courier,
 b.shift_start_dttm,
 b.shift_finish,
 extract(epoch FROM (b.shift_finish - b.shift_start_dttm)) / 60.0 AS shift_raw,
 COALESCE(w.minutes, 0) AS wait_raw,
 COALESCE(a.minutes, 0) AS assembly_raw,
 COALESCE(d.minutes, 0) AS delivery_raw
 FROM bounds b
 LEFT JOIN covered w
 ON w.id_shift = b.id_shift AND w.kind = 'wait'
 LEFT JOIN covered a
 ON a.id_shift = b.id_shift AND a.kind = 'assembly'
 LEFT JOIN covered d
 ON d.id_shift = b.id_shift AND d.kind = 'delivery'
 ) x
),
detail AS (
 SELECT
 t.shift_start_dttm::date AS dt,
 t.id_shift,
 t.id_courier,
 vc.name AS courier_name,
 ss.shopno,
 vt."name_TT" AS tt_name,
 vt.region_tt AS region,
 vt."Тип" AS tt_type,
 oua.zone_cluster AS bush,
 oua.manager_delivery AS tu,
 oua.leader_curators AS pu,
 t.wait_minutes,
 t.assembly_minutes,
 t.delivery_minutes,
 t.useless_minutes,
 t.shift_minutes
 FROM shift_time t
 LEFT JOIN ods.v_couriers vc
 ON vc.id = t.id_courier
 LEFT JOIN shift_shop ss
 ON ss.id_shift = t.id_shift
 LEFT JOIN ods.v_tt vt
 ON vt."N" = ss.shopno
 LEFT JOIN mart.org_unit_actual oua
 ON oua.org_unit_id = vt.id_tt
),
filtered AS (
 SELECT *
 FROM detail
 WHERE 1 = 1
 {% if filter_values('tt_name', remove_filter=True) %}
 AND tt_name IN {{ filter_values('tt_name', remove_filter=True)|where_in }}
 {% endif %}
 {% if filter_values('region', remove_filter=True) %}
 AND region IN {{ filter_values('region', remove_filter=True)|where_in }}
 {% endif %}
 {% if filter_values('tt_type', remove_filter=True) %}
 AND tt_type IN {{ filter_values('tt_type', remove_filter=True)|where_in }}
 {% endif %}
 {% if filter_values('bush', remove_filter=True) %}
 AND bush IN {{ filter_values('bush', remove_filter=True)|where_in }}
 {% endif %}
 {% if filter_values('tu', remove_filter=True) %}
 AND tu IN {{ filter_values('tu', remove_filter=True)|where_in }}
 {% endif %}
 {% if filter_values('pu', remove_filter=True) %}
 AND pu IN {{ filter_values('pu', remove_filter=True)|where_in }}
 {% endif %}
)
SELECT
 'Итого'::text AS bar_label,
 dt,
 id_shift,
 id_courier,
 courier_name,
 shopno,
 tt_name,
 region,
 tt_type,
 bush,
 tu,
 pu,
 wait_minutes,
 assembly_minutes,
 delivery_minutes,
 useless_minutes,
 shift_minutes,
 row_number() OVER (
 PARTITION BY id_shift
 ORDER BY shopno NULLS LAST
 ) AS rn_shift,
 row_number() OVER (
 PARTITION BY id_shift, pu
 ORDER BY shopno NULLS LAST
 ) AS rn_shift_pu,
 row_number() OVER (
 PARTITION BY id_shift, tu
 ORDER BY shopno NULLS LAST
 ) AS rn_shift_tu,
 row_number() OVER (
 PARTITION BY id_shift, shopno
 ORDER BY shopno NULLS LAST
 ) AS rn_shift_tt,
 row_number() OVER (
 PARTITION BY id_shift, bush
 ORDER BY shopno NULLS LAST
 ) AS rn_shift_bush,
 row_number() OVER (
 PARTITION BY id_shift, region
 ORDER BY shopno NULLS LAST
 ) AS rn_shift_region
FROM filtered