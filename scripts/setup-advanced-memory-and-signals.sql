-- Advanced schema: signals, dynamic catalogs, vector memory (RAG)
-- Run after setup-supabase.sql and setup-batching-and-proactive.sql

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS message_signals (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('sticker', 'gif', 'reaction')),
  emotion TEXT NOT NULL,
  intent TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  note TEXT DEFAULT '',
  raw_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_signals_user_created
  ON message_signals(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reaction_catalog (
  id BIGSERIAL PRIMARY KEY,
  emoji TEXT,
  custom_emoji_id TEXT,
  intents TEXT[] NOT NULL DEFAULT ARRAY['ack']::TEXT[],
  weight REAL NOT NULL DEFAULT 1.0,
  cooldown_sec INT NOT NULL DEFAULT 60,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sticker_catalog (
  id BIGSERIAL PRIMARY KEY,
  file_id TEXT NOT NULL,
  set_name TEXT,
  intents TEXT[] NOT NULL DEFAULT ARRAY['ack']::TEXT[],
  weight REAL NOT NULL DEFAULT 1.0,
  cooldown_sec INT NOT NULL DEFAULT 180,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gif_catalog (
  id BIGSERIAL PRIMARY KEY,
  file_id TEXT NOT NULL,
  intents TEXT[] NOT NULL DEFAULT ARRAY['ack']::TEXT[],
  weight REAL NOT NULL DEFAULT 1.0,
  cooldown_sec INT NOT NULL DEFAULT 180,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reaction_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  emoji TEXT,
  custom_emoji_id TEXT,
  intent TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sticker_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  file_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gif_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  file_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reaction_events_user_created
  ON reaction_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sticker_events_user_created
  ON sticker_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gif_events_user_created
  ON gif_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_items_v2 (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'pref', 'goal', 'episode', 'signal')),
  content TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.7,
  source_message_id BIGINT,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_items_v2_user_kind
  ON memory_items_v2(user_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_chunks (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  memory_item_id BIGINT NOT NULL REFERENCES memory_items_v2(id) ON DELETE CASCADE,
  chunk_text TEXT NOT NULL,
  embedding VECTOR(1024) NOT NULL,
  chunk_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- If table already existed with old vector dimension, run this manually:
-- ALTER TABLE memory_chunks
--   ALTER COLUMN embedding TYPE VECTOR(1024)
--   USING (embedding::VECTOR(1024));

CREATE INDEX IF NOT EXISTS idx_memory_chunks_user_created
  ON memory_chunks(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION match_memory_chunks(
  p_user_id BIGINT,
  p_query_embedding VECTOR(1024),
  p_top_k INT DEFAULT 8
)
RETURNS TABLE (
  chunk_id BIGINT,
  memory_item_id BIGINT,
  chunk_text TEXT,
  similarity REAL,
  importance REAL,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
  SELECT
    mc.id AS chunk_id,
    mc.memory_item_id,
    mc.chunk_text,
    (1 - (mc.embedding <=> p_query_embedding))::REAL AS similarity,
    mi.importance,
    mc.created_at
  FROM memory_chunks mc
  JOIN memory_items_v2 mi ON mi.id = mc.memory_item_id
  WHERE mc.user_id = p_user_id
  ORDER BY mc.embedding <=> p_query_embedding
  LIMIT GREATEST(1, LEAST(p_top_k, 30));
$$;

-- Optional seed values (safe re-run)
INSERT INTO reaction_catalog (emoji, intents, weight, cooldown_sec, enabled)
SELECT * FROM (
  VALUES
    ('🔥', ARRAY['celebrate','ack']::TEXT[], 1.0, 60, TRUE),
    ('💙', ARRAY['support']::TEXT[], 1.0, 90, TRUE),
    ('🎯', ARRAY['ack','goal']::TEXT[], 0.8, 60, TRUE)
) AS seed(emoji, intents, weight, cooldown_sec, enabled)
WHERE NOT EXISTS (SELECT 1 FROM reaction_catalog);

CREATE TABLE IF NOT EXISTS metrics_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL DEFAULT 1,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_events_user_created
  ON metrics_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_metrics_events_name_created
  ON metrics_events(metric_name, created_at DESC);
