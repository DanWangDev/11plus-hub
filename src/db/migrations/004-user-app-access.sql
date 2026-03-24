-- up
CREATE TABLE user_app_access (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id      INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, app_id)
);

CREATE INDEX idx_user_app_access_app_id ON user_app_access(app_id);

-- down
DROP TABLE IF EXISTS user_app_access;
