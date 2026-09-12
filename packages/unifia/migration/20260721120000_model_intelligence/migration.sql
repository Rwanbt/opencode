-- Model Intelligence Registry schema (C01)
--
-- Tables : registry_meta, sources, providers, models, model_aliases,
--          pricing_tiers, model_health, model_source_refs, notices, audit.
--
-- Compatible SQLite (pour usage WAL local) et PostgreSQL (pour usage
-- production futur) — syntaxe portable.
--
-- Pas de secrets, pas de credentials : tout est open data license.

CREATE TABLE IF NOT EXISTS registry_meta (
  schema_version    TEXT PRIMARY KEY,
  generated_at_utc  TEXT NOT NULL,
  registry_id       TEXT NOT NULL,
  generator_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id                  TEXT PRIMARY KEY,
  url                 TEXT NOT NULL,
  type                TEXT NOT NULL CHECK (type IN ('catalog', 'pricing', 'benchmarks', 'metadata')),
  license_code        TEXT,
  license_file_url    TEXT,
  copyright_notice    TEXT,
  parser_version      TEXT NOT NULL,
  confidence_level    TEXT NOT NULL CHECK (confidence_level IN ('official', 'community', 'unverified')),
  rollback_policy     TEXT NOT NULL CHECK (rollback_policy IN ('disable', 'fallback_to_cache', 'manual_review')),
  policy_doc_ref      TEXT,
  deprecated          INTEGER NOT NULL DEFAULT 0,
  deprecation_reason  TEXT
);

CREATE TABLE IF NOT EXISTS providers (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  sdk                 TEXT,
  api_base_url        TEXT,
  env_vars_json       TEXT NOT NULL DEFAULT '[]',
  capabilities_json   TEXT NOT NULL,
  modalities_json     TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('active', 'deprecated', 'experimental')),
  deprecation_reason  TEXT,
  added_at_utc        TEXT NOT NULL,
  removed_at_utc      TEXT,
  docs_url            TEXT,
  privacy_policy_ref  TEXT,
  region_policy_json  TEXT NOT NULL,
  aliases_json        TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS models (
  id                   TEXT NOT NULL,
  provider_id          TEXT NOT NULL REFERENCES providers(id),
  canonical_name       TEXT NOT NULL,
  family               TEXT,
  aliases_json         TEXT NOT NULL DEFAULT '[]',
  capabilities_json    TEXT NOT NULL,
  modalities_json      TEXT NOT NULL,
  context_window_json  TEXT NOT NULL,
  reasoning_json       TEXT NOT NULL,
  tool_use_json        TEXT NOT NULL,
  temperature_json     TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('alpha', 'beta', 'active', 'deprecated', 'quarantined')),
  deprecation_reason   TEXT,
  lifecycle_stage      TEXT NOT NULL CHECK (lifecycle_stage IN ('discovered', 'metadata_validated', 'probed', 'low_risk_eligible', 'general_eligible', 'trusted_by_domain', 'deprecated', 'quarantined')),
  release_date_utc     TEXT,
  retirement_date_utc  TEXT,
  pricing_json         TEXT NOT NULL,
  health_json          TEXT NOT NULL,
  provenance_json      TEXT NOT NULL,
  last_seen_at_utc     TEXT NOT NULL,
  PRIMARY KEY (provider_id, id)
);

CREATE INDEX IF NOT EXISTS idx_models_status ON models(status);
CREATE INDEX IF NOT EXISTS idx_models_lifecycle ON models(lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id);

CREATE TABLE IF NOT EXISTS model_aliases (
  alias                TEXT PRIMARY KEY,
  canonical_provider   TEXT NOT NULL,
  canonical_model      TEXT NOT NULL,
  deprecated           INTEGER NOT NULL DEFAULT 0,
  replaced_by_provider TEXT,
  replaced_by_model    TEXT
);

CREATE TABLE IF NOT EXISTS pricing_tiers (
  model_provider      TEXT NOT NULL,
  model_id            TEXT NOT NULL,
  threshold_tokens    INTEGER NOT NULL,
  input_price         REAL NOT NULL,
  output_price        REAL NOT NULL,
  FOREIGN KEY (model_provider, model_id) REFERENCES models(provider_id, id),
  PRIMARY KEY (model_provider, model_id, threshold_tokens)
);

CREATE TABLE IF NOT EXISTS model_health (
  model_provider      TEXT NOT NULL,
  model_id            TEXT NOT NULL,
  last_check_utc      TEXT NOT NULL,
  availability_score  REAL NOT NULL,
  latency_p50_ms      REAL,
  latency_p95_ms      REAL,
  error_rate_1h       REAL NOT NULL,
  rate_limit_json     TEXT,
  notes               TEXT,
  FOREIGN KEY (model_provider, model_id) REFERENCES models(provider_id, id),
  PRIMARY KEY (model_provider, model_id)
);

CREATE TABLE IF NOT EXISTS model_source_refs (
  model_provider     TEXT NOT NULL,
  model_id           TEXT NOT NULL,
  source_id          TEXT NOT NULL REFERENCES sources(id),
  observed_at_utc    TEXT NOT NULL,
  source_version     TEXT NOT NULL,
  field_hashes_json  TEXT NOT NULL,
  FOREIGN KEY (model_provider, model_id) REFERENCES models(provider_id, id),
  PRIMARY KEY (model_provider, model_id, source_id)
);

CREATE TABLE IF NOT EXISTS notices (
  source_id          TEXT PRIMARY KEY REFERENCES sources(id),
  license_code       TEXT,
  copyright_notice   TEXT,
  license_file_url   TEXT,
  confidence_level   TEXT NOT NULL,
  url                TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  timestamp_utc  TEXT NOT NULL,
  action         TEXT NOT NULL,
  before_hash    TEXT,
  after_hash     TEXT,
  details_json   TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit(timestamp_utc);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit(action);

CREATE TABLE IF NOT EXISTS snapshots (
  schema_version    TEXT PRIMARY KEY,
  generated_at_utc  TEXT NOT NULL,
  registry_id       TEXT NOT NULL,
  snapshot_json     TEXT NOT NULL,
  snapshot_hash     TEXT NOT NULL,
  generator_version TEXT NOT NULL
);