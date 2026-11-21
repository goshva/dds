-- DRAFT ONLY. НЕ ПРИМЕНЯТЬ. Этап 1.5 — проектирование.
-- Миграция 0002_orders
-- Назначение: Заказы, суммы, история статусов, готовность
-- Зависимости: 0001
-- Rollback: DROP новых таблиц

CREATE TABLE orders (
  id uuid,
  external_order_id text NOT NULL,
  source_system text NOT NULL,
  shop_id uuid NOT NULL,
  delivery_address_id uuid,
  customer_reference text,
  order_status text DEFAULT 'RECEIVED' NOT NULL,
  priority text,
  order_created_at timestamptz NOT NULL,
  accepted_at timestamptz,
  collection_started_at timestamptz,
  collected_at timestamptz,
  ready_at timestamptz,
  delivery_started_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  returned_at timestamptz,
  sla_due_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_orders PRIMARY KEY (id),
  CONSTRAINT fk_orders_shop_id FOREIGN KEY (shop_id) REFERENCES shops (id),
  CONSTRAINT fk_orders_delivery_address_id FOREIGN KEY (delivery_address_id) REFERENCES addresses (id)
);

CREATE TABLE order_amount_snapshots (
  id uuid,
  order_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency text DEFAULT 'RUB' NOT NULL,
  amount_type text NOT NULL,
  source_system text NOT NULL,
  captured_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_order_amount_snapshots PRIMARY KEY (id),
  CONSTRAINT fk_order_amount_snapshots_order_id FOREIGN KEY (order_id) REFERENCES orders (id)
);

CREATE TABLE order_status_history (
  id uuid,
  order_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  changed_at timestamptz NOT NULL,
  changed_by_type text,
  changed_by_id uuid,
  source_system text NOT NULL,
  source_event_id text,
  reason text,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_order_status_history PRIMARY KEY (id),
  CONSTRAINT fk_order_status_history_order_id FOREIGN KEY (order_id) REFERENCES orders (id)
);

CREATE TABLE order_readiness (
  id uuid,
  order_id uuid NOT NULL,
  ready_at timestamptz NOT NULL,
  ready_source text NOT NULL,
  ready_actor_type text,
  ready_actor_id uuid,
  confirmation_status text DEFAULT 'CONFIRMED' NOT NULL,
  attempt_no integer DEFAULT 1 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_order_readiness PRIMARY KEY (id),
  CONSTRAINT fk_order_readiness_order_id FOREIGN KEY (order_id) REFERENCES orders (id)
);

