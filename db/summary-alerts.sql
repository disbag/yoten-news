-- Очередь только окончательных ошибок качества, независимо от жизни статьи.
CREATE TABLE IF NOT EXISTS summary_quality_alerts (
  link TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  delivery_attempts INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE summary_quality_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON summary_quality_alerts FROM PUBLIC;
