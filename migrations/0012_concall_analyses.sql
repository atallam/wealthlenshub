-- 0012_concall_analyses.sql
-- Concall (earnings call) analysis cache.
--
-- Stores Claude-generated structured analysis of earnings call transcripts
-- per holding per quarter. Auto-sourced or manually uploaded by the user.
-- Results are cached for 90 days; the API checks analysed_at before re-running.
--
-- Safe to run multiple times (all guards use IF NOT EXISTS / DO $$ blocks).

BEGIN;

-- 1. Main table
CREATE TABLE IF NOT EXISTS concall_analyses (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  holding_id      text        NOT NULL,   -- matches holdings.id (text, format h_xxx)
  user_id         uuid        NOT NULL,

  -- Quarter / quarter identification
  quarter         text        NOT NULL,  -- e.g. "Q1 FY26", "Q4 FY25"
  quarter_date    date        NOT NULL,  -- approximate period-end date for sorting

  -- Composite score (0–10) and signal
  score           numeric(4,2),          -- weighted composite of sub-scores
  signal          text,                  -- CONFIRMS | NEUTRAL | CHALLENGES | BREAKS (thesis signal)

  -- Sub-scores (0–10 each)
  score_guidance  numeric(4,2),          -- forward guidance quality / clarity
  score_tone      numeric(4,2),          -- management tone: confidence, defensiveness
  score_clarity   numeric(4,2),          -- Q&A quality, transparency
  score_surprise  numeric(4,2),          -- positive/negative surprises vs expectations

  -- Structured output (Claude JSON, stored as jsonb for queryability)
  bull_points     jsonb,                 -- array of { point, evidence } objects
  bear_points     jsonb,                 -- array of { point, evidence } objects
  guidance        jsonb,                 -- { revenue, margins, capex, commentary }
  key_risks       jsonb,                 -- array of strings
  summary         text,                  -- 2-3 sentence human-readable digest

  -- Transcript provenance
  source_provider text,                  -- nse | bse | screener | motleyfool | manual
  source_url      text,                  -- where the transcript came from (if auto)
  transcript_chars int,                  -- char count before truncation (audit / debug)

  -- Cache control
  analysed_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + INTERVAL '90 days'),

  -- Housekeeping
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 2. FKs (guarded so re-runs don't error)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'concall_analyses_holding_id_fkey'
  ) THEN
    ALTER TABLE concall_analyses
      ADD CONSTRAINT concall_analyses_holding_id_fkey
      FOREIGN KEY (holding_id) REFERENCES holdings(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'concall_analyses_user_id_fkey'
  ) THEN
    ALTER TABLE concall_analyses
      ADD CONSTRAINT concall_analyses_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3. Unique constraint: one analysis per holding per quarter (upsert target)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'concall_analyses_holding_quarter_uq'
  ) THEN
    ALTER TABLE concall_analyses
      ADD CONSTRAINT concall_analyses_holding_quarter_uq
      UNIQUE (holding_id, quarter);
  END IF;
END $$;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_concall_holding    ON concall_analyses(holding_id);
CREATE INDEX IF NOT EXISTS idx_concall_user       ON concall_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_concall_expires    ON concall_analyses(expires_at);
CREATE INDEX IF NOT EXISTS idx_concall_quarter    ON concall_analyses(holding_id, quarter_date DESC);

-- 5. RLS
ALTER TABLE concall_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS concall_analyses_owner ON concall_analyses;
CREATE POLICY concall_analyses_owner ON concall_analyses
  FOR ALL USING (auth.uid() = user_id);

COMMIT;
