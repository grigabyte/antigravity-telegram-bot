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
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

ALTER TABLE proactive_jobs
  DROP CONSTRAINT IF EXISTS proactive_jobs_status_check;

ALTER TABLE proactive_jobs
  ADD CONSTRAINT proactive_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'cancelled'));

ALTER TABLE proactive_jobs
  ADD COLUMN IF NOT EXISTS lease_token TEXT;

ALTER TABLE proactive_jobs
  ADD COLUMN IF NOT EXISTS leased_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_proactive_jobs_due
  ON proactive_jobs(status, due_at);

CREATE INDEX IF NOT EXISTS idx_proactive_jobs_user
  ON proactive_jobs(user_id, status, due_at);

CREATE TABLE IF NOT EXISTS processed_updates (
  id BIGSERIAL PRIMARY KEY,
  update_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  update_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(update_id, user_id, chat_id, update_type)
);

CREATE INDEX IF NOT EXISTS idx_processed_updates_processed_at
  ON processed_updates(processed_at DESC);

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'ru-RU';

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS quiet_hours_start SMALLINT DEFAULT 23;

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS quiet_hours_end SMALLINT DEFAULT 9;
