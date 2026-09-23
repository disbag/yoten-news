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

-- Passkey-аутентификация (WebAuthn) — без паролей и email, один пользователь
-- может иметь несколько passkey (напр. с разных устройств).
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS passkeys (
  -- credential_id — то, что браузер присылает при каждой аутентификации
  -- (WebAuthnCredential.id из @simplewebauthn/server), уже base64url-строка,
  -- глобально уникальна сама по себе — отдельный SERIAL не нужен.
  credential_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  public_key BYTEA NOT NULL,
  -- Счётчик подписей от authenticator — растёт с каждым использованием,
  -- откат назад при следующей аутентификации означает клонированный
  -- credential (защита от replay, см. verifyAuthenticationResponse).
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON passkeys (user_id);

-- Прочитанные карточки ленты — по cluster_id (см. cluster_id выше), т.к.
-- именно кластер, а не отдельная статья, это то, что пользователь видит и
-- открывает как одну карточку.
CREATE TABLE IF NOT EXISTS article_reads (
  user_id INTEGER NOT NULL REFERENCES users(id),
  cluster_id INTEGER NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cluster_id)
);

-- email — нижним регистром (см. normalizeEmail в src/lib/email.ts), NULL у
-- пользователей, которые зарегистрировались только через passkey.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;

-- Задел под вход по одноразовому коду на email. Сейчас не используется:
-- эндпоинты /api/auth/email/request и /verify удалены, пока вход по почте
-- не появится в интерфейсе (живой эндпоинт позволял любому заставить нас
-- слать письма на произвольные адреса) — их код есть в истории git.
-- Не более одного активного кода на адрес (PRIMARY KEY по email), в базе
-- только хэш кода, attempts ограничивает подбор шестизначного кода.
CREATE TABLE IF NOT EXISTS email_login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Эмбеддинг ОДНОГО заголовка — второй сигнал для дедупликации (см.
-- findAndAssignGroup в src/lib/grouping.ts). Эмбеддинг тела (embedding выше)
-- считается по заголовку+началу текста, где заголовок — единицы процентов
-- веса, поэтому один и тот же инфоповод у разных изданий, подающих его с
-- разных ракурсов, даёт низкую похожесть тел (реальный случай: Variety/THR про
-- Оливера и Эллисона — тела 0.62, заголовки 0.83). NULL у статей, собранных
-- до появления колонки, — для них работает только сравнение тел.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS title_embedding vector(384);

-- Порядковые "user-01", "user-02"... для user.name/displayName при passkey-
-- регистрации без ручного ввода имени (см. app/api/auth/register/options).
CREATE SEQUENCE IF NOT EXISTS passkey_user_seq;

-- Галерея картинок статьи (Hearst-издания — Motor Trend, Car and Driver —
-- кладут на страницу отдельную подгалерею /photos с несколькими кадрами,
-- см. extractGallery в src/lib/ogTags.ts). NULL/пусто — обычная одна картинка
-- через image_url, без карусели в FeedCard.tsx.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS image_urls TEXT[];

-- Продолжение саммари под кат "Читать" — показывается сразу ПОСЛЕ ai_summary,
-- в том же месте карточки, и не повторяет его (см. LEAD_AND_MORE_PROMPT в
-- src/lib/prompt.ts). Генерируется одним запросом вместе с ai_summary. NULL —
-- у статей без полного текста (тизеры) и у склеенных статей кластера.
-- ai_summary_long выше — прежний формат (подробный пересказ для модалки,
-- повторявший короткий): больше не заполняется и не показывается.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS ai_summary_more TEXT;

-- RLS без политик на всех таблицах: Supabase автоматически открывает схему
-- public через REST API (PostgREST), и без RLS любой с anon-ключом проекта мог
-- читать/удалять всё, включая users.email и passkeys. Само приложение ходит
-- напрямую под ролью postgres (владелец таблиц, rolbypassrls) — на него RLS не
-- действует, а anon/authenticated без единой политики не видят ни строки.
-- Новую таблицу добавлять сюда же.
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_login_codes ENABLE ROW LEVEL SECURITY;
