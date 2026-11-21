-- DRAFT ONLY. НЕ ПРИМЕНЯТЬ. Этап 1.5 — проектирование.
-- Миграция 0003_geo_zones
-- Назначение: ***REMOVED*** и версии границ
-- Зависимости: 0001
-- Rollback: DROP новых таблиц

CREATE TABLE delivery_zones (
  id uuid,
  shop_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  boundary_type text DEFAULT 'UNDEFINED' NOT NULL,
  boundary_geometry geography(POLYGON,4326),
  status text DEFAULT 'DRAFT' NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_delivery_zones PRIMARY KEY (id),
  CONSTRAINT fk_delivery_zones_shop_id FOREIGN KEY (shop_id) REFERENCES shops (id),
  CONSTRAINT uq_delivery_zones_code UNIQUE (code)
);

CREATE TABLE zone_boundary_versions (
  id uuid,
  zone_id uuid NOT NULL,
  version integer NOT NULL,
  boundary_geometry geography(POLYGON,4326) NOT NULL,
  change_reason text NOT NULL,
  created_by uuid NOT NULL,
  approved_by uuid,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_zone_boundary_versions PRIMARY KEY (id),
  CONSTRAINT fk_zone_boundary_versions_zone_id FOREIGN KEY (zone_id) REFERENCES delivery_zones (id)
);

