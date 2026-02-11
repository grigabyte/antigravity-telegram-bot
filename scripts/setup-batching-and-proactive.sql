-- Additional schema for batching + proactive messages
-- Run after scripts/setup-supabase.sql

CREATE TABLE IF NOT EXISTS inbound_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  event_ts BIGINT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbound_events_pending
  ON inbound_events(user_id, chat_id, processed, event_ts);

CREATE TABLE IF NOT EXISTS proactive_jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  job_type TEXT NOT NULL,
  due_at BIGINT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_proactive_jobs_due
  ON proactive_jobs(status, due_at);

CREATE INDEX IF NOT EXISTS idx_proactive_jobs_user
  ON proactive_jobs(user_id, status, due_at);

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'ru-RU';

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS quiet_hours_start SMALLINT DEFAULT 23;

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS quiet_hours_end SMALLINT DEFAULT 9;
