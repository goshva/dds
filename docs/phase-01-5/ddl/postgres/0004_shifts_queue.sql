-- DRAFT ONLY. НЕ ПРИМЕНЯТЬ. Этап 1.5 — проектирование.
-- Миграция 0004_shifts_queue
-- Назначение: Слоты (опц.), смены, очередь
-- Зависимости: 0001
-- Rollback: DROP новых таблиц

CREATE TABLE work_slots (
  id uuid,
  shop_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity integer,
  status text DEFAULT 'OPEN' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_work_slots PRIMARY KEY (id),
  CONSTRAINT fk_work_slots_shop_id FOREIGN KEY (shop_id) REFERENCES shops (id)
);

CREATE TABLE courier_shifts (
  id uuid,
  courier_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  work_slot_id uuid,
  external_shift_id text,
  shift_type text,
  is_night_shift boolean,
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  shift_status text DEFAULT 'PLANNED' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_courier_shifts PRIMARY KEY (id),
  CONSTRAINT fk_courier_shifts_courier_id FOREIGN KEY (courier_id) REFERENCES couriers (id),
  CONSTRAINT fk_courier_shifts_shop_id FOREIGN KEY (shop_id) REFERENCES shops (id),
  CONSTRAINT fk_courier_shifts_work_slot_id FOREIGN KEY (work_slot_id) REFERENCES work_slots (id)
);

CREATE TABLE courier_queue_entries (
  id uuid,
  courier_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  arrived_at timestamptz NOT NULL,
  queue_sequence bigint NOT NULL,
  queue_status text DEFAULT 'WAITING' NOT NULL,
  ready_for_assignment_at timestamptz,
  skipped_at timestamptz,
  closed_at timestamptz,
  skip_reason text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_courier_queue_entries PRIMARY KEY (id),
  CONSTRAINT fk_courier_queue_entries_courier_id FOREIGN KEY (courier_id) REFERENCES couriers (id),
  CONSTRAINT fk_courier_queue_entries_shop_id FOREIGN KEY (shop_id) REFERENCES shops (id),
  CONSTRAINT fk_courier_queue_entries_shift_id FOREIGN KEY (shift_id) REFERENCES courier_shifts (id)
);

