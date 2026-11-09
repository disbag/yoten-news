BEGIN;

CREATE TABLE IF NOT EXISTS browsers (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_browsers_user_id ON browsers (user_id);

CREATE TABLE IF NOT EXISTS transfer_codes (
  code_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Неверный код может вообще не существовать, поэтому попытки считаются
-- по браузеру получателя, отдельно от выданных кодов.
CREATE TABLE IF NOT EXISTS transfer_attempts (
  token_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE browsers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON browsers, transfer_codes, transfer_attempts FROM PUBLIC, anon, authenticated;

-- Оставляем старую колонку на время перехода между версиями приложения.
INSERT INTO browsers (token_hash, user_id, created_at, last_seen_at)
SELECT browser_token, id, created_at, last_seen_at FROM users WHERE browser_token IS NOT NULL
ON CONFLICT (token_hash) DO NOTHING;

COMMIT;
