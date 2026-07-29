-- 0010_budget_member_assignment.sql
-- Lets a bank/credit-card statement be attributed to a family member (the
-- same member records already stored in portfolio.members / holdings.member_id).
-- Run after 0009_reconcile_artifacts_and_security.sql.

ALTER TABLE budget_statements ADD COLUMN IF NOT EXISTS member_id text;

COMMENT ON COLUMN budget_statements.member_id IS
  'References an id in portfolio.members (jsonb array) for the user who owns this row. '
  'Nullable: statements uploaded before this column existed, or where auto-detection found '
  'no confident match and the user has not yet assigned one, are left unassigned ("Unassigned").';
