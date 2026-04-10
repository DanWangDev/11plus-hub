-- up
CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  username        TEXT UNIQUE NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT,
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'student',
  parent_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  google_id       TEXT UNIQUE,
  email_verified  BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
CREATE INDEX idx_users_parent_id ON users(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_users_role ON users(role);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Check constraint for role values
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('student', 'parent', 'admin'));

-- down
DROP TRIGGER IF EXISTS users_updated_at ON users;
DROP FUNCTION IF EXISTS update_updated_at();
DROP TABLE IF EXISTS users;
