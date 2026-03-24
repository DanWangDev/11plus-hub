-- up
CREATE TABLE learning_events (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id        INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_learning_events_user_id ON learning_events(user_id);
CREATE INDEX idx_learning_events_app_id ON learning_events(app_id);
CREATE INDEX idx_learning_events_type ON learning_events(event_type);
CREATE INDEX idx_learning_events_created_at ON learning_events(created_at);

-- down
DROP TABLE IF EXISTS learning_events;
