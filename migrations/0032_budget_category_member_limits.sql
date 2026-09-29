-- 0032: Per-member overrides for budget category limits
-- budget_categories.monthly_limit keeps meaning "the family total" (used
-- unchanged by the "All" view in FamilyBudgetTab). This table lets a
-- specific family member have their own limit for a category instead —
-- an override, not a replacement. No override for a (category, member)
-- pair means "fall back to the shared family limit" (resolved in
-- services/budget.service.js's getCategoryLimits(), not in SQL).
--
-- No FK to a members table on purpose: family members live in
-- portfolio.members (a jsonb array), not a relational table, so member_id
-- here is just an opaque id matched against that array at read time.

CREATE TABLE IF NOT EXISTS budget_category_limits (
  id            text PRIMARY KEY,
  user_id       text NOT NULL,
  category_id   text NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
  member_id     text NOT NULL,
  monthly_limit numeric NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (user_id, category_id, member_id)
);

ALTER TABLE budget_category_limits DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_budget_cat_limits_user ON budget_category_limits(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_cat_limits_lookup ON budget_category_limits(user_id, member_id);
