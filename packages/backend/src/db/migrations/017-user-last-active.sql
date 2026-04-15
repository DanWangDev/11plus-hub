-- up
-- Track per-user last activity time (any authenticated request or OIDC token grant)
-- for admin visibility into which accounts are actually being used.
ALTER TABLE users ADD COLUMN last_active_at TIMESTAMPTZ;

CREATE INDEX idx_users_last_active_at ON users(last_active_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- Backfill from audit_log so existing users show sensible values on day one.
-- This is best-effort history — after deploy, updates flow from the auth
-- middleware and the OIDC grant.success event.
-- AuditActions.LOGIN = 'login', AuditActions.REGISTER = 'register'.
UPDATE users u
SET last_active_at = sub.latest
FROM (
  SELECT actor_id, MAX(created_at) AS latest
  FROM audit_log
  WHERE action IN ('login', 'register')
    AND actor_id IS NOT NULL
  GROUP BY actor_id
) sub
WHERE u.id = sub.actor_id;

-- down
DROP INDEX IF EXISTS idx_users_last_active_at;
ALTER TABLE users DROP COLUMN IF EXISTS last_active_at;
