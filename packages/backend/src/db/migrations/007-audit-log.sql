-- up
CREATE TABLE audit_log (
  id            SERIAL PRIMARY KEY,
  actor_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  target_id     INTEGER,
  details       JSONB DEFAULT '{}',
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_actor_id ON audit_log(actor_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

-- down
DROP TABLE IF EXISTS audit_log;
