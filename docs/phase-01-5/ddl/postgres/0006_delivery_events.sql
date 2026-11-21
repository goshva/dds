-- DRAFT ONLY. НЕ ПРИМЕНЯТЬ. Этап 1.5 — проектирование.
-- Миграция 0006_delivery_events
-- Назначение: Попытки доставки, события курьера и доменные
-- Зависимости: 0002, 0005
-- Rollback: DROP новых таблиц

CREATE TABLE delivery_attempts (
  id uuid,
  order_id uuid NOT NULL,
  trip_id uuid,
  courier_id uuid NOT NULL,
  attempt_no integer NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  result text DEFAULT 'UNKNOWN' NOT NULL,
  failure_reason text,
  proof_reference text,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_delivery_attempts PRIMARY KEY (id),
  CONSTRAINT fk_delivery_attempts_order_id FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT fk_delivery_attempts_trip_id FOREIGN KEY (trip_id) REFERENCES trips (id),
  CONSTRAINT fk_delivery_attempts_courier_id FOREIGN KEY (courier_id) REFERENCES couriers (id)
);

CREATE TABLE courier_events (
  id uuid,
  courier_id uuid NOT NULL,
  shift_id uuid,
  shop_id uuid,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz DEFAULT now() NOT NULL,
  actor_type text,
  actor_id uuid,
  source_system text NOT NULL,
  source_event_id text,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_courier_events PRIMARY KEY (id),
  CONSTRAINT fk_courier_events_courier_id FOREIGN KEY (courier_id) REFERENCES couriers (id),
  CONSTRAINT fk_courier_events_shift_id FOREIGN KEY (shift_id) REFERENCES courier_shifts (id),
  CONSTRAINT fk_courier_events_shop_id FOREIGN KEY (shop_id) REFERENCES shops (id)
);

CREATE TABLE domain_events (
  id uuid,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  event_version integer DEFAULT 1 NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz DEFAULT now() NOT NULL,
  actor_type text,
  actor_id uuid,
  source_system text,
  source_event_id text,
  correlation_id text,
  causation_id text,
  idempotency_key text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_domain_events PRIMARY KEY (id)
);

