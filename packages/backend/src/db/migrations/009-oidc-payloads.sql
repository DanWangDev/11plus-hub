-- up
CREATE TABLE oidc_payloads (
  id              TEXT NOT NULL,
  type            TEXT NOT NULL,
  payload         JSONB NOT NULL,
  grant_id        TEXT,
  user_code       TEXT,
  uid             TEXT,
  expires_at      TIMESTAMPTZ,
  consumed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_oidc_payloads_id_type ON oidc_payloads(id, type);
CREATE INDEX idx_oidc_payloads_grant_id ON oidc_payloads(grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX idx_oidc_payloads_user_code ON oidc_payloads(user_code) WHERE user_code IS NOT NULL;
CREATE INDEX idx_oidc_payloads_uid ON oidc_payloads(uid) WHERE uid IS NOT NULL;
CREATE INDEX idx_oidc_payloads_expires_at ON oidc_payloads(expires_at) WHERE expires_at IS NOT NULL;

-- down
DROP TABLE IF EXISTS oidc_payloads;
