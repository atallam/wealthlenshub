-- 0011_budget_account_aliases.sql
-- "Learn once, remember forever" card/account → member mapping. Seeded from the
-- last-4-digits shown on a statement (every credit-card/bank statement shows
-- these, masked, even Indian ones), confirmed the first time a statement from
-- that card/account is assigned to a member, then used automatically on every
-- future import from the same card/account — a much more reliable signal than
-- scanning the statement text for a name match (which can misfire on "C/O"
-- address lines, joint holders, etc. — see detectMemberFromText in
-- services/budget.service.js).
-- Run after 0010_budget_member_assignment.sql.

CREATE TABLE IF NOT EXISTS budget_account_aliases (
  id          text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id   text NOT NULL,           -- id from portfolio.members (jsonb array)
  bank_key    text NOT NULL DEFAULT '',
  last4       text NOT NULL,           -- last 4 digits of the card/account number, as shown (masked) on the statement
  label       text,                    -- optional human label, e.g. "Priyanka's Axis MY Zone card"
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, bank_key, last4)
);
CREATE INDEX IF NOT EXISTS idx_budget_account_aliases_user ON budget_account_aliases(user_id);
ALTER TABLE budget_account_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "budget_account_aliases_owner" ON budget_account_aliases FOR ALL USING (auth.uid() = user_id);

-- Persist the last-4-digits and resolved bank_key from import time on the
-- statement itself, so a manual reassignment (Statement History's "Assigned
-- to" dropdown) can also seed budget_account_aliases for that card/account,
-- not just an automatic detection at upload time.
ALTER TABLE budget_statements ADD COLUMN IF NOT EXISTS account_last4 text;
ALTER TABLE budget_statements ADD COLUMN IF NOT EXISTS bank_key text;
