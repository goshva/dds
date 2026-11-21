-- DRAFT ONLY. НЕ ПРИМЕНЯТЬ. Этап 1.5 — проектирование.
-- Миграция 0001_core_reference
-- Назначение: Магазины, адреса, курьеры, внешние ID
-- Зависимости: нет
-- Rollback: DROP новых таблиц (пустые)

CREATE TABLE shops (
  id uuid,
  external_source_id text,
  code text NOT NULL,
  name text NOT NULL,
  address_id uuid,
  timezone text DEFAULT 'Europe/Moscow',
  status text DEFAULT 'ACTIVE' NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_shops PRIMARY KEY (id),
  CONSTRAINT uq_shops_code UNIQUE (code),
  CONSTRAINT fk_shops_address_id FOREIGN KEY (address_id) REFERENCES addresses (id)
);

CREATE TABLE addresses (
  id uuid,
  country_code text DEFAULT 'RU',
  region text,
  city text,
  street text,
  house text,
  building text,
  apartment text,
  postal_code text,
  latitude double precision,
  longitude double precision,
  geocode_source text,
  geocode_confidence numeric(14,2),
  normalized_hash text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_addresses PRIMARY KEY (id)
);

CREATE TABLE couriers (
  id uuid,
  external_hr_id text,
  external_user_id text,
  display_name text,
  courier_type text,
  employment_type text,
  operational_status text DEFAULT 'PENDING' NOT NULL,
  is_blocked boolean DEFAULT false NOT NULL,
  hired_at timestamptz,
  terminated_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_couriers PRIMARY KEY (id)
);

CREATE TABLE courier_external_ids (
  id uuid,
  courier_id uuid NOT NULL,
  source_system text NOT NULL,
  external_id text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_courier_external_ids PRIMARY KEY (id),
  CONSTRAINT fk_courier_external_ids_courier_id FOREIGN KEY (courier_id) REFERENCES couriers (id)
);

