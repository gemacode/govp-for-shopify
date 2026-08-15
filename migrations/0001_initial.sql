PRAGMA foreign_keys = ON;

CREATE TABLE shop_installations (
  shop TEXT PRIMARY KEY,
  shop_name TEXT NOT NULL,
  connector_token_ciphertext TEXT NOT NULL,
  connector_token_iv TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'uninstalled')),
  installed_at TEXT NOT NULL,
  uninstalled_at TEXT
);

CREATE TABLE webhook_jobs (
  webhook_id TEXT PRIMARY KEY,
  shop TEXT NOT NULL REFERENCES shop_installations(shop) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  external_order_id TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_shopify_jobs_due ON webhook_jobs(status, next_attempt_at);

CREATE TABLE shopify_govps (
  id TEXT PRIMARY KEY,
  shop TEXT NOT NULL REFERENCES shop_installations(shop) ON DELETE CASCADE,
  external_order_id TEXT NOT NULL,
  order_name TEXT NOT NULL,
  public_code TEXT NOT NULL,
  verify_url TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  UNIQUE(shop, external_order_id)
);

CREATE TABLE compliance_events (
  webhook_id TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  topic TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

