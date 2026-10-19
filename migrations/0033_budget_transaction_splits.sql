-- 0033: Split transactions (member shares) for the Family Budget
-- A transaction with rows here is "split": its amount is shared between family
-- members (e.g. a joint grocery run charged to one card). A transaction with no
-- rows is unsplit and behaves exactly as before (member comes from the parent
-- statement's member_id) — so this migration changes nothing until used.
--
-- Invariant (enforced in services/budget.service.js setSplits(), not in SQL):
--   SUM(amount) over a transaction's splits == budget_transactions.amount
--
-- v1 is member-only: every share inherits the parent transaction's category at
-- read time. The `category` column is reserved for later category-splitting
-- (one order = groceries + electronics) and is not read by analytics yet.
-- member_id is an opaque id from portfolio.members (a jsonb array), so no FK.

CREATE TABLE IF NOT EXISTS budget_transaction_splits (
  id             text PRIMARY KEY,
  transaction_id text NOT NULL REFERENCES budget_transactions(id) ON DELETE CASCADE,
  user_id        text NOT NULL,
  member_id      text NOT NULL,
  category       text,
  amount         numeric NOT NULL CHECK (amount > 0),
  note           text DEFAULT '',
  created_at     timestamptz DEFAULT now(),
  UNIQUE (transaction_id, member_id)
);

ALTER TABLE budget_transaction_splits DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_budget_splits_txn  ON budget_transaction_splits(transaction_id);
CREATE INDEX IF NOT EXISTS idx_budget_splits_user ON budget_transaction_splits(user_id, member_id);
