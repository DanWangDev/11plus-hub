-- up
-- Extend subscription statuses to support Stripe billing lifecycle.
-- past_due: payment failed but grace period active (Stripe dunning).
-- incomplete: initial payment not yet confirmed.
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'trial', 'expired', 'cancelled', 'past_due', 'incomplete'));

-- Extend partial unique index to cover past_due (user can only have one
-- non-terminal subscription at a time).
DROP INDEX IF EXISTS idx_subscriptions_user_active;
CREATE UNIQUE INDEX idx_subscriptions_user_active
  ON subscriptions(user_id)
  WHERE status IN ('active', 'trial', 'past_due');

-- down
DROP INDEX IF EXISTS idx_subscriptions_user_active;
CREATE UNIQUE INDEX idx_subscriptions_user_active
  ON subscriptions(user_id)
  WHERE status IN ('active', 'trial');

ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'trial', 'expired', 'cancelled'));
