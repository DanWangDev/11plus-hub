-- up
-- Queue for retrying failed OIDC Back-Channel Logout notifications.
-- When oidc-provider's initial BCL POST fails (client unreachable, timeout),
-- the entry is queued here and retried with exponential backoff.
CREATE TABLE bcl_retry_queue (
  id              SERIAL PRIMARY KEY,
  sub             TEXT NOT NULL,
  sid             TEXT NOT NULL,
  client_id       TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',
  next_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bcl_retry_pending
  ON bcl_retry_queue (next_at)
  WHERE status = 'pending';

-- down
DROP TABLE IF EXISTS bcl_retry_queue;
