# 16. Внешние идентификаторы

| Сущность | Система | Внешнее поле | Таблица | Колонка | Confidence | Ограничение |
|---|---|---|---|---|---|---|
| courier | Superset/HR | id_courier | courier_external_ids | external_id | MEDIUM | числовой id; сопоставление не доказано |
| courier | Superset | courier_id | courier_external_ids | external_id | MEDIUM | 5247/5399 агрегаты |
| courier | Superset | ID (7775) | courier_external_ids | external_id | MEDIUM | источник истины — BD-017 |
| courier | Superset/HR | mentorid (5939) | courier_external_ids | external_id | LOW | string id; роль — BD-001 |
| shop | Superset | shopno | shops | external_source_id | HIGH | числовой |
| shop | Superset | id_tt | shops | external_source_id | MEDIUM | nullable |
| order | Master | external_order_id | orders | external_order_id | MEDIUM | мастер-источник — BD-016 |
| shift | Superset | id_shift (7802) | courier_shifts | external_shift_id | MEDIUM | string; универсальность не доказана |
| trip | Superset | id_pool_calc | trips | external_trip_ref | LOW | вычисляемый пул |
