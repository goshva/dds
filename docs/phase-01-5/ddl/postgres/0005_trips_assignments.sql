-- DRAFT ONLY. НЕ ПРИМЕНЯТЬ. Этап 1.5 — проектирование.
-- Миграция 0005_trips_assignments
-- Назначение: Ходки, состав, история состава, назначения
-- Зависимости: 0002, 0003, 0004
-- Rollback: DROP новых таблиц

CREATE TABLE trips (
  id uuid,
  shop_id uuid NOT NULL,
  zone_id uuid NOT NULL,
  courier_id uuid,
  shift_id uuid,
  external_trip_ref text,
  trip_number text,
  trip_status text DEFAULT 'DRAFT' NOT NULL,
  formed_at timestamptz NOT NULL,
  assigned_at timestamptz,
  departed_at timestamptz,
  returned_at timestamptz,
  completed_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_trips PRIMARY KEY (id),
  CONSTRAINT fk_trips_shop_id FOREIGN KEY (shop_id) REFERENCES shops (id),
  CONSTRAINT fk_trips_zone_id FOREIGN KEY (zone_id) REFERENCES delivery_zones (id),
  CONSTRAINT fk_trips_courier_id FOREIGN KEY (courier_id) REFERENCES couriers (id),
  CONSTRAINT fk_trips_shift_id FOREIGN KEY (shift_id) REFERENCES courier_shifts (id)
);

CREATE TABLE trip_orders (
  id uuid,
  trip_id uuid NOT NULL,
  order_id uuid NOT NULL,
  sequence_no integer NOT NULL,
  added_at timestamptz NOT NULL,
  added_by uuid NOT NULL,
  removed_at timestamptz,
  removed_by uuid,
  removal_reason text,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_trip_orders PRIMARY KEY (id),
  CONSTRAINT fk_trip_orders_trip_id FOREIGN KEY (trip_id) REFERENCES trips (id),
  CONSTRAINT fk_trip_orders_order_id FOREIGN KEY (order_id) REFERENCES orders (id)
);

CREATE TABLE trip_order_membership_history (
  id uuid,
  trip_id uuid NOT NULL,
  order_id uuid NOT NULL,
  action text NOT NULL,
  acted_at timestamptz NOT NULL,
  acted_by uuid NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_trip_order_membership_history PRIMARY KEY (id),
  CONSTRAINT fk_trip_order_membership_history_trip_id FOREIGN KEY (trip_id) REFERENCES trips (id),
  CONSTRAINT fk_trip_order_membership_history_order_id FOREIGN KEY (order_id) REFERENCES orders (id)
);

CREATE TABLE trip_assignments (
  id uuid,
  trip_id uuid NOT NULL,
  courier_id uuid NOT NULL,
  queue_entry_id uuid,
  assigned_at timestamptz NOT NULL,
  assigned_by uuid NOT NULL,
  assignment_status text DEFAULT 'PROPOSED' NOT NULL,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_trip_assignments PRIMARY KEY (id),
  CONSTRAINT fk_trip_assignments_trip_id FOREIGN KEY (trip_id) REFERENCES trips (id),
  CONSTRAINT fk_trip_assignments_courier_id FOREIGN KEY (courier_id) REFERENCES couriers (id),
  CONSTRAINT fk_trip_assignments_queue_entry_id FOREIGN KEY (queue_entry_id) REFERENCES courier_queue_entries (id)
);

