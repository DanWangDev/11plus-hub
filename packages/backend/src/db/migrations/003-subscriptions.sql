-- up
CREATE TABLE subscriptions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan          TEXT NOT NULL DEFAULT 'free',
  status        TEXT NOT NULL DEFAULT 'active',
  features      TEXT[] DEFAULT '{}',
  expires_at    TIMESTAMPTZ,
  assigned_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_plan ON subscriptions(plan);

ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IN ('free', 'writing', 'vocab', 'bundle', 'family'));

ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'trial', 'expired', 'cancelled'));

-- down
DROP TABLE IF EXISTS subscriptions;
