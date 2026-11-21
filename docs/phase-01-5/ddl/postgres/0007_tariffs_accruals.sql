-- DRAFT ONLY. НЕ ПРИМЕНЯТЬ. Этап 1.5 — проектирование.
-- Миграция 0007_tariffs_accruals
-- Назначение: Тарифы, начисления, корректировки
-- Зависимости: 0006
-- Rollback: компенсирующие записи; DROP только пустых таблиц

CREATE TABLE tariff_versions (
  id uuid,
  name text NOT NULL,
  zone_id uuid,
  shop_id uuid,
  distance_from_m integer,
  distance_to_m integer,
  order_type text,
  base_amount numeric(14,2) NOT NULL,
  currency text DEFAULT 'RUB' NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  status text DEFAULT 'DRAFT' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_tariff_versions PRIMARY KEY (id),
  CONSTRAINT fk_tariff_versions_zone_id FOREIGN KEY (zone_id) REFERENCES delivery_zones (id),
  CONSTRAINT fk_tariff_versions_shop_id FOREIGN KEY (shop_id) REFERENCES shops (id)
);

CREATE TABLE courier_accruals (
  id uuid,
  courier_id uuid NOT NULL,
  order_id uuid NOT NULL,
  delivery_attempt_id uuid NOT NULL,
  trip_id uuid,
  tariff_version_id uuid,
  calculation_basis jsonb,
  amount numeric(14,2) NOT NULL,
  currency text DEFAULT 'RUB' NOT NULL,
  accrual_status text DEFAULT 'PENDING' NOT NULL,
  earned_at timestamptz NOT NULL,
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_courier_accruals PRIMARY KEY (id),
  CONSTRAINT fk_courier_accruals_courier_id FOREIGN KEY (courier_id) REFERENCES couriers (id),
  CONSTRAINT fk_courier_accruals_order_id FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT fk_courier_accruals_delivery_attempt_id FOREIGN KEY (delivery_attempt_id) REFERENCES delivery_attempts (id),
  CONSTRAINT fk_courier_accruals_trip_id FOREIGN KEY (trip_id) REFERENCES trips (id),
  CONSTRAINT fk_courier_accruals_tariff_version_id FOREIGN KEY (tariff_version_id) REFERENCES tariff_versions (id)
);

CREATE TABLE accrual_adjustments (
  id uuid,
  accrual_id uuid NOT NULL,
  adjustment_type text NOT NULL,
  amount_delta numeric(14,2) NOT NULL,
  reason text NOT NULL,
  approved_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_accrual_adjustments PRIMARY KEY (id),
  CONSTRAINT fk_accrual_adjustments_accrual_id FOREIGN KEY (accrual_id) REFERENCES courier_accruals (id)
);

