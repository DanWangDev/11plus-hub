-- up
-- Ensure each user has at most one active/trial subscription.
-- Clean up duplicates first: keep the most recent active subscription per user.
DELETE FROM subscriptions s
WHERE s.id NOT IN (
  SELECT DISTINCT ON (user_id) id
  FROM subscriptions
  WHERE status IN ('active', 'trial')
  ORDER BY user_id, created_at DESC
)
AND s.status IN ('active', 'trial');

CREATE UNIQUE INDEX idx_subscriptions_user_active
  ON subscriptions(user_id)
  WHERE status IN ('active', 'trial');

-- down
DROP INDEX IF EXISTS idx_subscriptions_user_active;
