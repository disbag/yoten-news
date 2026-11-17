-- DIS-86: применить до выкладки нового сборщика. Старые строки остаются
-- NULL: метатеги не доказывают, какой текст использовался для эмбеддинга.
-- Существующие кластеры и векторы не меняются.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS content_chars INTEGER CHECK (content_chars >= 0);
ALTER TABLE articles ADD COLUMN IF NOT EXISTS content_origin TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS content_fingerprint TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS parser_version TEXT;
