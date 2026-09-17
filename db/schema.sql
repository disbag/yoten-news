-- Требует расширение pgvector (у Neon/Supabase включается одной командой)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS sources (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  rss_url TEXT NOT NULL UNIQUE,
  homepage_url TEXT
);

-- Размерность 384 соответствует модели Xenova/all-MiniLM-L6-v2 (см. src/lib/embeddings.ts)
CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  title TEXT NOT NULL,
  link TEXT NOT NULL UNIQUE,
  published_at TIMESTAMPTZ,
  raw_summary TEXT,
  -- og:description со страницы статьи, если издание не блокирует бота
  -- (см. src/lib/ogTags.ts) — обычно полнее, чем сниппет из RSS. NYT и
  -- Telegraph активно блокируют такие запросы, WaPo и Wired отдают нормально.
  full_description TEXT,
  -- og:image со страницы статьи, по той же логике доступности.
  image_url TEXT,
  ai_summary TEXT,
  -- Более подробный пересказ своими словами (не перевод оригинала) для
  -- модального окна — раскрывает детали, которые короткая версия для ленты
  -- намеренно опускает. См. DETAILED_SUMMARY_PROMPT в src/lib/prompt.ts.
  ai_summary_long TEXT,
  -- Темы новости для фильтра в шапке ленты — модель размечает их при
  -- саммаризации (см. CATEGORIES/CATEGORY_INSTRUCTIONS в src/lib/prompt.ts).
  -- Массив, а не одно значение: новость может относиться сразу к нескольким
  -- темам (напр. Apple Car — technology И auto), но не больше двух (см.
  -- extractCategory). NULL — статья ещё не размечена (см. "other" в
  -- промпте для "не подошла ни одна тема" — это не NULL, а реальное
  -- значение). Намеренно TEXT[] без CHECK — список тем будет расти.
  category TEXT[],
  embedding vector(384),
  -- cluster_id указывает на "первую" статью в группе одинаковых новостей —
  -- один и тот же инфоповод, порог DEDUPE_THRESHOLD (см. src/lib/grouping.ts).
  -- Источник может быть как разным изданием, так и тем же самым (напр. апдейт
  -- той же новости от одного издания) — это единственный уровень группировки:
  -- была ещё более широкая "тема" (topic_id, связанные но не идентичные
  -- статьи, показывались тредом), убрали — она слишком часто склеивала
  -- реально разные новости в одну карточку. Если новость уникальна,
  -- cluster_id == id самой себя.
  cluster_id INTEGER REFERENCES articles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_cluster_id ON articles (cluster_id);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles USING GIN (category);

-- Намеренно без ivfflat/hnsw-индекса на embedding: это приближённый поиск,
-- и при малом числе строк (retention — считанные дни, т.е. сотни-тысячи
-- статей) он либо не даёт выигрыша в скорости, либо (что хуже) требует
-- аккуратной настройки lists/probes под объём данных — иначе дедупликация
-- почти всегда промахивается мимо реальных совпадений. Точный
-- последовательный скан по embedding здесь и корректнее, и быстрее для
-- такого масштаба. Если база вырастет на порядки — тогда стоит вернуться
-- к ivfflat/hnsw и подобрать параметры под реальный объём.
