-- ── WealthLens Budget 2: Goals Table ──────────────────────────────
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS budget_goals (
  id          text PRIMARY KEY,
  user_id     text NOT NULL,
  name        text NOT NULL,
  target      numeric NOT NULL,
  saved       numeric NOT NULL DEFAULT 0,
  due_date    date,
  note        text DEFAULT '',
  color       text DEFAULT '#c9a84c',
  icon        text DEFAULT '🎯',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE budget_goals DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_budget_goals_user ON budget_goals(user_id);
