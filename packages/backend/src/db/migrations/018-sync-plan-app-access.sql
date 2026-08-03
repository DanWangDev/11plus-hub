-- up
-- Re-sync user_app_access for bundle and family plan users.
-- Commit 8189ac3 added story-sleuth to PLAN_APP_SLUGS for these plans
-- but existing users' user_app_access rows were never refreshed.
--
-- This migration deletes and re-inserts app access rows for every
-- active/trial bundle or family subscriber so the access grants
-- match the current plan-to-app-slugs mapping in the codebase.
WITH plan_users AS (
  SELECT DISTINCT user_id, plan
  FROM subscriptions
  WHERE status IN ('active', 'trial')
    AND plan IN ('bundle', 'family')
),
deleted AS (
  DELETE FROM user_app_access
  WHERE user_id IN (SELECT user_id FROM plan_users)
)
INSERT INTO user_app_access (user_id, app_id)
SELECT pu.user_id, a.id
FROM plan_users pu
CROSS JOIN applications a
WHERE a.slug IN ('writing-buddy', 'vocab-master', 'story-sleuth')
ON CONFLICT (user_id, app_id) DO NOTHING;

-- down
-- This is a data sync, not a schema change. There is no destructive
-- rollback — re-running syncAppAccessFromPlan() from the application
-- layer would restore access to the current plan definition.
SELECT 1;
