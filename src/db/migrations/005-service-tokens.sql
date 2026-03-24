-- up
CREATE TABLE service_tokens (
  id            SERIAL PRIMARY KEY,
  app_id        INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,
  scopes        TEXT[] DEFAULT '{}',
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_tokens_app_id ON service_tokens(app_id);
CREATE INDEX idx_service_tokens_token_hash ON service_tokens(token_hash);

-- down
DROP TABLE IF EXISTS service_tokens;
