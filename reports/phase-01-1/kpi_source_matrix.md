# KPI-каталог: операционные KPI ↔ источники данных

**Этап 1.1, задача 4.** Дата: 20 ноября 2026 г.  
**Метод:** SQL и поля извлечены из фактического содержимого датасетов (`dataset.sql` в `data/catalog.sqlite`, readonly) + привязки charts/dashboards из API (`api_chart_links_priority.json`) + детали из `api_spot_checks.json`.  
*****REMOVED***:** ни одно поле не выдумано — в `fields` только подстроки, реально найденные в SQL датасета. Confidence: **HIGH** = выражение/поле прямо в SELECT; **MEDIUM** = косвенные признаки.

---

## Сводная матрица KPI → датасеты

| # | KPI (операционный) | Основные датасеты | Доп. датасеты | Confidence |
|---|--------------------|-------------------|---------------|------------|
| 1 | Объём заказов | 4732, 7006, 7024, 7027, 7119 | — | HIGH |
| 2 | Просрочка / SLA | 4732, 7006, 7024, 7027, 7119 | — | HIGH |
| 3 | Время доставки (duration) | 4732, 7006, 7024, 7027, 7119 | — | HIGH |
| 4 | Время сборки заказа | 4732, 7119 | 7006, 7024, 7027 (MEDIUM) | HIGH/MEDIUM |
| 5 | Суммы заказов (GMV/paid) | 4732 | — | HIGH |
| 6 | Маршрутизация: расстояние/время между точками | 7006, 7024, 7027, 7119 | — | HIGH |
| 7 | Флаги качества/аномалий | 7119 | — | MEDIUM |
| 8 | Численность / активность курьеров (HR) | 5797, 7465, 7473, 7775 | — | HIGH |
| 9 | Продуктивность курьера (заказы/смены) | 5797, 7465 | — | HIGH |
| 10 | Онлайн/событийная активность (день/неделя) | 5247, 5399 | — | HIGH |
| 11 | Баланс миграции курьеров между зонами | 7293 | — | HIGH |

---

## Детализация по датасетам

### 4732 · darkstore_ts_partners_new (virtual, ClickHouse ch_10.0.15.240/default, 127 колонок)
Charts: 13 · Dashboards: 717 «Показатели проекта Аптеки», 983 «Показатели проекта Рестораны», 1054 «Показатели проекта Цветы_архив»
- **Объём заказов** [HIGH]: `id_order`, `order_status`
- **Просрочка/SLA** [HIGH]: `sla_order_time`, `date_supply_until`
- **Время доставки** [HIGH]: `date_delivery_start`, `date_delivered`, `date_supply`
- **Время сборки** [HIGH]: `date_collect_start`, `date_collected`, `date_printed`
- **Суммы (GMV/paid)** [HIGH]: `sum_order`, `sum_paid`, `sum_paid_disc`

### 7006 / 7024 / 7027 · cargo_main2/3/4 (virtual, Greenplum gp_10.0.112.100/dwh, logs_mart)
Charts: 17 / 5 / 0 · Dashboard: 1472 «Метрики маршрутизатора»
- **Объём заказов** [HIGH]: `id_order`, `status_name`
- **Просрочка/SLA** [HIGH]: `is_late` (7006, 7027), `sla_order_time`, `date_supply_until`
- **Время доставки** [HIGH]: `date_delivery_start`, `date_delivered`, `date_supply`
- **Маршрутизация** [HIGH]: `parcel_id`, `cluster_id`, `duration_from_previous` (7006, 7024), `distance_from_previous` (7024, 7027), `arrival_time`; источник `ab_logs_mart_routing_results_v1`
- **Время сборки** [MEDIUM]: только `date_collected`

### 7119 · cargo_flags (virtual, ClickHouse ch_10.0.112.21, 55 колонок)
Charts: 0 (прямых потребителей через datasource_id нет; используется как витрина флагов)
- **Флаги качества/аномалий** [MEDIUM→фактические поля]: `plan_arrival_before_deadline`, `fact_minutes_late`, `fact_arrival_before_deadline`, `planned_late`, `flag_is_near_deadline`, `plan_late_minute`, `fact_seq`, `plan_seq`, `release_to_first_assignment`, `pool_size`, `late_orders_cnt_in_pool`
- Плюс полный набор заказных метрик как у 4732 (объём, SLA, доставка, сборка) [HIGH]

### 5797 · hr_couriers (virtual, ClickHouse ch_10.0.15.240/agile_mart_techaudit, 65 колонок)
Charts: 54 · Dashboards: 1228 «HR Dashboard Доставки», 1124 «HR верхнеуровневый»
- **Численность/активность HR** [HIGH]: `id_courier`, `active`, `event_hiring`, `event_date`, `date_dismissed`, `uvol`, `pause_days`, `second_hire`, `repeated_hire`, `exp_days`, `exp_months`, `job_type_name`, `region_name`
- **Продуктивность** [HIGH]: `cnt_orders`, `orders_after_hire`, `days_with_orders`, `enough_shifts_flg`

### 7465 · hr_couriers_5shifts / 7473 · hr_couriers_five_shifts (ClickHouse, agile_mart_techaudit)
Charts: 0 / 15 · Dashboard: 1228 «HR Dashboard Доставки»
- Те же HR-KPI [HIGH]; у 7473 дополнительно `last_order_date`, `day_number`, `leader`, `feature_tt`, `name_tt` (5-сменный график)

### 7775 · all_couriers_list (virtual, ClickHouse, 11 колонок)
Charts: 1 · Источник: `default.v_couriers`
- **Справочник активной базы** [HIGH]: `"Активный"` (`case active=1`), `"Бан"` (`case is_blocked`), `"Тип занятости"`, `"Тип курьера"`, `date_add`
- ⚠️ Содержит персональные поля (`phone`, `INN`) — **не выгружать значения в отчёты** (PII)

### 5247 / 5399 · courier_logs_agg_couriers_daily / _week (Greenplum dwh, agile_mart_techaudit)
Charts: 1 / 1 · Dashboard: 1079 «Отчет по логам МП курьера_архив»
- **Событийная активность** [HIGH]: `events_qty`, `max_day`/`max_week`, `days_count`/`week_count`, `max_day_event_qty`, `count_distinct_day_no`, `sum_events_qty_all_days` (аналогично week)

### 7293 · hr_couriers_zone_balance (virtual, ClickHouse, 8 колонок)
Charts: 1 · Источник: `agile_mart_techaudit.hr_delivery` (`zone_changed=1`)
- **Баланс миграции зон активности** [HIGH]: `positive_flow` (в Green), `negative_flow`, `balance = pos − neg`, `positive_pct/negative_pct` от дневного максимума; шкала зон: Green/Yellow/Orange/Red/Тишина/Lost

---

## Пробелы и ограничения

1. **Три датасета без прямых charts** (7027, 7119, 7465): либо используются через other-datasource charts (не подтверждено локально), либо являются вспомогательными витринами. Требуется разбор chart query_context после полной дозагрузки charts.
2. **Metric-слой Superset не исследован:** каталог `dataset.metrics[]` в list-payload пуст; нормативные определения KPI (metric_name/expression) станут доступны только после загрузки `dataset_detail` (см. discovery_corrected.md).
3. **7 019 уникальных chart-ссылок дашбордов, из них 4 569 вне усечённого каталога** — полная декомпозиция KPI→chart доступна лишь для приоритетных 12 датасетов (108 charts из API).
4. Confidence «HIGH» означает наличие поля в SQL, но **не** согласованность бизнес-определения KPI — определение должно быть верифицировано с владельцами дашбордов.
