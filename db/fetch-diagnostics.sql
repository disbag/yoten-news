-- Счётчики не зависят от семидневного срока хранения самих статей.
CREATE TABLE IF NOT EXISTS source_fetch_diagnostics (
  run_id UUID NOT NULL,
  source_id INTEGER NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (run_id, source_id)
);
CREATE INDEX IF NOT EXISTS source_fetch_diagnostics_time ON source_fetch_diagnostics (observed_at);
CREATE INDEX IF NOT EXISTS source_fetch_diagnostics_source_time ON source_fetch_diagnostics (source_id, observed_at DESC);
CREATE TABLE IF NOT EXISTS source_volume_daily (
  day DATE NOT NULL,
  name TEXT NOT NULL,
  articles INTEGER NOT NULL CHECK (articles >= 0),
  PRIMARY KEY (day, name)
);
-- Те же ограничения доступа, что у остальных служебных таблиц проекта.
ALTER TABLE source_fetch_diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_volume_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON source_fetch_diagnostics, source_volume_daily FROM PUBLIC;
