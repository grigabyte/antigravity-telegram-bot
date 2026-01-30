-- Neuro Copilot Bot - Supabase Schema
-- Run this in Supabase SQL Editor (supabase.com > SQL Editor)

-- Chat history (supports 1M+ tokens)
CREATE TABLE IF NOT EXISTS chat_history (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'model')),
  content TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  is_compressed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_history_user ON chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_timestamp ON chat_history(user_id, timestamp DESC);

-- Long-term memory (facts, preferences, goals)
CREATE TABLE IF NOT EXISTS long_term_memory (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('fact', 'preference', 'goal')),
  content TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_user ON long_term_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_type ON long_term_memory(user_id, type);

-- User settings
CREATE TABLE IF NOT EXISTS user_settings (
  user_id BIGINT PRIMARY KEY,
  insights TEXT DEFAULT '',
  timezone TEXT DEFAULT 'Europe/Moscow',
  last_summary_at BIGINT DEFAULT 0,
  total_messages BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Compressed summaries (for old messages)
CREATE TABLE IF NOT EXISTS chat_summaries (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  summary TEXT NOT NULL,
  messages_compressed INT NOT NULL DEFAULT 0,
  message_range_start BIGINT,
  message_range_end BIGINT,
  original_token_count INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_summaries_user ON chat_summaries(user_id);

-- Last search sources
CREATE TABLE IF NOT EXISTS last_sources (
  user_id BIGINT PRIMARY KEY,
  sources JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Optional: Enable Row Level Security for multi-user setup
-- ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE long_term_memory ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE chat_summaries ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE last_sources ENABLE ROW LEVEL SECURITY;

-- Optional: Create RLS policies
-- CREATE POLICY "Users can only access their own data" ON chat_history
--   FOR ALL USING (auth.uid()::text = user_id::text);
