-- DIS-86: только неопубликованные статьи, отказавшие с no_text.
CREATE TABLE IF NOT EXISTS article_content_repairs (
  link TEXT PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  item JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 3),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'resolved', 'exhausted')),
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 minutes',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  alert_queued_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS article_content_repairs_due ON article_content_repairs(next_attempt_at) WHERE state = 'pending';

-- Очередь сборщика не должна быть доступна через Supabase REST API.
ALTER TABLE article_content_repairs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON article_content_repairs FROM PUBLIC, anon, authenticated;
