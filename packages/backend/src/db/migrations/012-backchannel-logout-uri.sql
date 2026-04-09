-- up
-- Add backchannel_logout_uri for OIDC Back-Channel Logout support.
-- When a user logs out at the hub, oidc-provider sends a signed logout_token
-- JWT to each client's backchannel_logout_uri to invalidate their session.
ALTER TABLE applications ADD COLUMN backchannel_logout_uri TEXT;

-- down
ALTER TABLE applications DROP COLUMN IF EXISTS backchannel_logout_uri;
