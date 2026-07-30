# Migrations

Apply these **in numeric order** against the Supabase Postgres database. Each file
is idempotent (`IF NOT EXISTS` / `DO $$` guards) so re-running is safe.

| # | File | Purpose |
|---|------|---------|
| — | `../database.sql` | Original base schema (portfolio, holdings, artifacts, transactions). *Legacy — superseded by hub_migration for RLS.* |
| — | `../hub_migration.sql` | Canonical table definitions + RLS policies + indexes. |
| — | `../budget_migration.sql` | Budget statements/transactions/categories. |
| — | `../transactions_migration.sql` | Transactions table + `user_id`. |
| — | `../gmail_migration.sql` | `email_imports`. |
| — | `../fx_rate_migration.sql` | FX rate column. |
| — | `../security_migration.sql` | Enables RLS on all user-data tables. |
| **0009** | `0009_reconcile_artifacts_and_security.sql` | **Reconciles schema drift:** adds/backfills `artifacts.user_id`, aligns RLS. Run after all of the above. |
| **0010** | `0010_budget_member_assignment.sql` | Adds `budget_statements.member_id` so a statement can be attributed to a family member. Run after 0009. |
| **0011** | `0011_budget_account_aliases.sql` | Adds `budget_account_aliases` (card/account last-4 → member), so imports from the same card/account auto-assign after the first confirmation. Run after 0010. |

## Important: RLS vs. the service key

The server connects with the **service-role key** (`lib/db.js`), which **bypasses
Row-Level Security**. RLS here is *defense-in-depth* only — it protects against
direct DB/anon-key access, not against a bug in the API layer. Authorization for
API requests is enforced in code via `lib/guards.js` (`assertOwnsHolding`,
`assertOwnsArtifact`). Keep both in sync.

## Going forward

New schema changes should be added here as `NNNN_description.sql` (zero-padded,
incrementing) rather than as new top-level `*_migration.sql` files, so ordering
is unambiguous. Consider adopting the Supabase CLI (`supabase migration new`) to
track applied state automatically.
