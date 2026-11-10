-- Один объект наблюдения на ссылку в каждом фиде. Сборщик читает и пишет
-- таблицу служебной ролью, клиент сайта доступа не получает.
CREATE TABLE IF NOT EXISTS fetch_link_coverage (
  source_id integer NOT NULL,
  link text NOT NULL,
  title text NOT NULL,
  published_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  decision text NOT NULL,
  completed_checks integer NOT NULL DEFAULT 0,
  last_completed_run uuid,
  PRIMARY KEY (source_id, link)
);
CREATE INDEX IF NOT EXISTS fetch_link_coverage_seen ON fetch_link_coverage (last_seen_at);
ALTER TABLE fetch_link_coverage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fetch_link_coverage FROM PUBLIC;
