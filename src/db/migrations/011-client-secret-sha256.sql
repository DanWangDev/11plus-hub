-- up
-- Add SHA-256 client secret column for OIDC token endpoint auth (IdentityServer pattern).
-- bcrypt is overkill for machine-generated secrets; SHA-256 is fast and secure.
ALTER TABLE applications ADD COLUMN client_secret_sha256 TEXT;

-- Also fix the status constraint to include 'deleted' for soft-delete support
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE applications ADD CONSTRAINT applications_status_check
  CHECK (status IN ('active', 'inactive', 'archived', 'deleted'));

-- down
ALTER TABLE applications DROP COLUMN IF EXISTS client_secret_sha256;
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE applications ADD CONSTRAINT applications_status_check
  CHECK (status IN ('active', 'inactive', 'archived'));
