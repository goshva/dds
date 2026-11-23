-- Migration 001: базовые таблицы DarkStore AI Forecast Engine (SQLite-first MVP).
--
-- Правила переносимости (см. docs/forecasting/audit-report.md §4):
--   * даты — TEXT в ISO YYYY-MM-DD, время — ISO-8601 UTC;
--   * никаких SQLite-специфичных DEFAULT/триггеров и логики в схеме;
--   * natural key наблюдения НЕ содержит run_id (run_id — атрибут строки);
--   * отсутствующие значения — NULL; статусы достоверности/качества обязательны.

-- Дарксторы -------------------------------------------------------------------
CREATE TABLE shops (
    shop_no     TEXT PRIMARY KEY,
    name        TEXT,
    city        TEXT,
    cluster_id  TEXT,
    opened_at   TEXT,
    tz          TEXT,
    created_at  TEXT
);

-- Запуски импорта -------------------------------------------------------------
CREATE TABLE extraction_runs (
    run_id          INTEGER PRIMARY KEY,
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    mode            TEXT NOT NULL,
    period_from     TEXT,
    period_to       TEXT,
    shop_no         TEXT REFERENCES shops (shop_no),
    tool_version    TEXT,
    manifest_path   TEXT,
    manifest_sha256 TEXT,
    rows_raw        INTEGER,
    rows_loaded     INTEGER,
    quality_status  TEXT CHECK (quality_status IN ('full', 'partial', 'truncated', 'none')),
    status          TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    notes           TEXT
);

-- Неизменённые исходные артефакты ---------------------------------------------
CREATE TABLE raw_extractions (
    raw_id          INTEGER PRIMARY KEY,
    run_id          INTEGER NOT NULL REFERENCES extraction_runs (run_id),
    source_kind     TEXT NOT NULL,
    source_ref      TEXT NOT NULL,
    payload         TEXT NOT NULL,
    payload_sha256  TEXT NOT NULL UNIQUE,
    bytes           INTEGER NOT NULL,
    loaded_at       TEXT NOT NULL
);

-- Аудит действий --------------------------------------------------------------
CREATE TABLE audit_log (
    log_id      INTEGER PRIMARY KEY,
    at          TEXT NOT NULL,
    actor       TEXT NOT NULL,
    action      TEXT NOT NULL,
    entity      TEXT NOT NULL,
    entity_id   TEXT,
    before_json TEXT,
    after_json  TEXT
);

-- Дневные показатели ----------------------------------------------------------
-- natural key наблюдения: (shop_no, date, slice_id, dimension_1, dimension_2, metric, transform_version)
CREATE TABLE daily_metrics (
    metric_id         INTEGER PRIMARY KEY,
    shop_no           TEXT NOT NULL REFERENCES shops (shop_no),
    date              TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    slice_id          INTEGER NOT NULL,
    chart_id          INTEGER,
    dataset_id        INTEGER,
    dimension_1       TEXT NOT NULL DEFAULT '',
    dimension_2       TEXT NOT NULL DEFAULT '',
    metric            TEXT NOT NULL,
    metric_kind       TEXT NOT NULL CHECK (metric_kind IN ('additive', 'ratio')),
    value             REAL,
    unit              TEXT,
    evidence_status   TEXT NOT NULL CHECK (evidence_status IN ('actual', 'derived', 'estimated', 'planned', 'assumed', 'unknown')),
    data_status       TEXT NOT NULL CHECK (data_status IN ('full', 'partial', 'truncated', 'none')),
    run_id            INTEGER REFERENCES extraction_runs (run_id),
    source_file       TEXT,
    request_sha256    TEXT,
    transform_version TEXT NOT NULL,
    loaded_at         TEXT NOT NULL,
    UNIQUE (shop_no, date, slice_id, dimension_1, dimension_2, metric, transform_version)
);

CREATE INDEX idx_daily_metrics_series ON daily_metrics (shop_no, date, metric);
CREATE INDEX idx_daily_metrics_metric_date ON daily_metrics (metric, date);
CREATE INDEX idx_daily_metrics_run ON daily_metrics (run_id);
CREATE INDEX idx_daily_metrics_slice ON daily_metrics (slice_id, date);

-- Операционные мероприятия (план/факт/проверка) --------------------------------
CREATE TABLE domain_events (
    event_id            INTEGER PRIMARY KEY,
    shop_no             TEXT REFERENCES shops (shop_no),
    event_date          TEXT,
    event_type          TEXT NOT NULL,
    source              TEXT,
    planned_start       TEXT,
    actual_start        TEXT,
    actual_end          TEXT,
    status              TEXT NOT NULL CHECK (status IN ('planned', 'in_progress', 'done', 'not_done', 'unverified')),
    evidence_status     TEXT NOT NULL CHECK (evidence_status IN ('actual', 'derived', 'estimated', 'planned', 'assumed', 'unknown')),
    expected_effect     TEXT,
    verification_result TEXT,
    ledger_note         TEXT,
    created_at          TEXT
);

-- Пустая planned_start не должна позволять дубли: уникальность по выражению, а не по NULL-колонке.
CREATE UNIQUE INDEX idx_domain_events_key ON domain_events (shop_no, event_type, IFNULL(planned_start, ''));

CREATE INDEX idx_domain_events_date ON domain_events (shop_no, event_date);

-- Признаки моделей ------------------------------------------------------------
CREATE TABLE forecast_features (
    feature_id      INTEGER PRIMARY KEY,
    shop_no         TEXT NOT NULL REFERENCES shops (shop_no),
    date            TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    feature         TEXT NOT NULL,
    value           REAL,
    evidence_status TEXT NOT NULL CHECK (evidence_status IN ('actual', 'derived', 'estimated', 'planned', 'assumed', 'unknown')),
    feature_version TEXT NOT NULL,
    computed_at     TEXT NOT NULL,
    UNIQUE (shop_no, date, feature, feature_version)
);

CREATE INDEX idx_forecast_features_lookup ON forecast_features (shop_no, date, feature);

-- Запуски прогнозов -----------------------------------------------------------
CREATE TABLE forecast_runs (
    run_id             INTEGER PRIMARY KEY,
    shop_no            TEXT NOT NULL REFERENCES shops (shop_no),
    created_at         TEXT NOT NULL,
    horizon_days       INTEGER NOT NULL CHECK (horizon_days > 0),
    model_name         TEXT NOT NULL,
    model_version      TEXT NOT NULL,
    target_metric      TEXT NOT NULL,
    features_version   TEXT,
    input_snapshot_id  TEXT,
    status             TEXT NOT NULL CHECK (status IN ('completed', 'insufficient_data', 'failed')),
    notes              TEXT
);

CREATE INDEX idx_forecast_runs_shop ON forecast_runs (shop_no, target_metric, created_at);

-- Результаты прогнозов --------------------------------------------------------
CREATE TABLE forecast_results (
    result_id         INTEGER PRIMARY KEY,
    run_id            INTEGER NOT NULL REFERENCES forecast_runs (run_id),
    target_date       TEXT NOT NULL CHECK (target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    metric            TEXT NOT NULL,
    p10               REAL,
    p50               REAL,
    p90               REAL,
    optimistic        REAL,
    baseline          REAL,
    pessimistic       REAL,
    confidence_status TEXT NOT NULL CHECK (confidence_status IN ('ok', 'low_confidence', 'insufficient_data')),
    UNIQUE (run_id, target_date, metric)
);

-- Оценка точности -------------------------------------------------------------
CREATE TABLE forecast_evaluations (
    eval_id          INTEGER PRIMARY KEY,
    run_id           INTEGER NOT NULL REFERENCES forecast_runs (run_id),
    target_date      TEXT NOT NULL CHECK (target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    metric           TEXT NOT NULL,
    actual_value     REAL,
    predicted_value  REAL,
    absolute_error   REAL,
    percentage_error REAL,
    model_version    TEXT,
    evaluated_at     TEXT NOT NULL,
    UNIQUE (run_id, target_date, metric)
);

-- Сценарии --------------------------------------------------------------------
CREATE TABLE scenarios (
    scenario_id      INTEGER PRIMARY KEY,
    shop_no          TEXT NOT NULL REFERENCES shops (shop_no),
    created_at       TEXT NOT NULL,
    name             TEXT NOT NULL,
    kind             TEXT NOT NULL CHECK (kind IN ('optimistic', 'baseline', 'pessimistic', 'custom')),
    input_parameters TEXT,
    assumptions      TEXT,
    data_status      TEXT NOT NULL CHECK (data_status IN ('full', 'partial', 'truncated', 'none', 'schema_only'))
);

CREATE TABLE scenario_results (
    scenario_result_id INTEGER PRIMARY KEY,
    scenario_id        INTEGER NOT NULL REFERENCES scenarios (scenario_id),
    target_date        TEXT NOT NULL CHECK (target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    metric             TEXT NOT NULL,
    value              REAL,
    capacity_required  REAL,
    capacity_available REAL,
    deficit            REAL,
    UNIQUE (scenario_id, target_date, metric)
);
