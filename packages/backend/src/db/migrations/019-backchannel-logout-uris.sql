-- up
-- Set backchannel_logout_uri for apps registered before the REST API
-- supported this field (pre-019). Without this, single-logout silently
-- breaks: the hub's OIDC provider has no URI to POST logout tokens to.
UPDATE applications
SET backchannel_logout_uri = CASE
  WHEN slug = 'story-sleuth' THEN 'https://story-sleuth.labf.app/api/auth/backchannel-logout'
  WHEN slug = 'vocab-master' THEN 'https://vocab-master.labf.app/auth/backchannel-logout'
  WHEN slug = 'writing-buddy' THEN 'https://writing-buddy.labf.app/api/auth/backchannel-logout'
  ELSE backchannel_logout_uri
END
WHERE backchannel_logout_uri IS NULL
  AND slug IN ('story-sleuth', 'vocab-master', 'writing-buddy');

-- down
-- No destructive rollback — the application API can now manage these
-- values. Re-running the app's registration or a manual PATCH would
-- restore whatever URI is correct.
SELECT 1;
