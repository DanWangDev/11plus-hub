-- up
-- Add Stripe identifiers to subscriptions for webhook reconciliation.
ALTER TABLE subscriptions
  ADD COLUMN stripe_customer_id TEXT UNIQUE,
  ADD COLUMN stripe_subscription_id TEXT UNIQUE;

-- Webhook idempotency: prevent double-processing of Stripe events.
CREATE TABLE stripe_processed_events (
  event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- down
DROP TABLE IF EXISTS stripe_processed_events;
ALTER TABLE subscriptions
  DROP COLUMN IF EXISTS stripe_subscription_id,
  DROP COLUMN IF EXISTS stripe_customer_id;
