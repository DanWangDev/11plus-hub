-- up
CREATE TABLE applications (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  slug                TEXT UNIQUE NOT NULL,
  url                 TEXT NOT NULL,
  client_id           TEXT UNIQUE NOT NULL,
  client_secret_hash  TEXT NOT NULL,
  redirect_uris       TEXT[] NOT NULL,
  icon_url            TEXT,
  stats_api_url       TEXT,
  status              TEXT NOT NULL DEFAULT 'active',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_applications_client_id ON applications(client_id);
CREATE INDEX idx_applications_slug ON applications(slug);
CREATE INDEX idx_applications_status ON applications(status);

ALTER TABLE applications ADD CONSTRAINT applications_status_check
  CHECK (status IN ('active', 'inactive', 'archived'));

-- down
DROP TABLE IF EXISTS applications;
