# Migrations

Everything here lives in this folder. Apply in the order below against the Supabase Postgres
database. Each file is idempotent (`IF NOT EXISTS` / `DO $$` guards), so re-running is safe.
There is no applied-state tracking, so on an **existing** database run only the files you have
not run yet (the Supabase SQL Editor's history is the record).

## Fresh install - run in this order

1. `database.sql` - original base schema (portfolio, holdings, artifacts, transactions). *Legacy:* its RLS and `artifacts` shape are superseded by the next two files and by 0009.
2. `hub_migration.sql` - canonical tables, RLS policies and indexes.
3. `budget_migration.sql` - budget statements / transactions / categories.
4. `transactions_migration.sql` - `transactions` table + `user_id`.
5. `gmail_migration.sql` - `email_imports` (Gmail CAS auto-import).
6. `fx_rate_migration.sql` - drops the stale default on `usd_inr_rate`.
7. `security_migration.sql` - enables RLS on all user-data tables, `import_logs`.
8. `keepalive_migration.sql` - keep-alive RPC (stops the free Supabase project pausing).
9. The numbered files `0009` ... `0035`, in order (table below).

## Numbered migrations

Two numbers are used twice (`0010`, `0011`). Within each pair the files are independent of each
other, so either order works.

| # | File | Purpose |
|---|------|---------|
| 0009 | `0009_reconcile_artifacts_and_security.sql` | Reconciles schema drift: adds/backfills `artifacts.user_id`, aligns RLS. |
| 0010 | `0010_add_liabilities_column.sql` | `portfolio.liabilities` (without it, portfolio upserts fail with PGRST204). |
| 0010 | `0010_budget_member_assignment.sql` | `budget_statements.member_id` - attribute a statement to a family member. |
| 0011 | `0011_budget_account_aliases.sql` | `budget_account_aliases`: card/account last-4 -> member, so repeat imports auto-assign. |
| 0011 | `0011_drop_portfolio_sharing.sql` | Removes the unused portfolio-sharing feature. |
| 0012 | `0012_concall_analyses.sql` | Earnings-call analysis cache. |
| 0013 | `0013_cash_events.sql` | Cash-event support on `transactions`. |
| 0014 | `0014_fd_currency.sql` | Multi-currency Fixed Deposits. |
| 0015 | `0015_insurance_fields.sql` | Insurance columns on `holdings`. |
| 0016 | `0016_watchlist.sql` | Watchlist of tickers not yet owned. |
| 0017 | `0017_concall_holding_id_text.sql` | No-op (superseded by the fix inside 0012). |
| 0018 | `0018_holdings_user_id_backfill.sql` | Ensures `holdings.user_id` exists and is populated. |
| 0019 | `0019_holdings_import_method.sql` | `holdings.import_method`. |
| 0020 | `0020_audit_logs.sql` | Universal audit trail. |
| 0021 | `0021_budget_goals.sql` | Budget goals. |
| 0022 | `0022_holdings_cas_import_columns.sql` | Columns for the Gmail CAS auto-import cron. |
| 0023 | `0023_email_imports_matched_members.sql` | `email_imports.matched_members`. |
| 0024 | `0024_push_subscriptions.sql` | Web Push subscriptions. |
| 0025 | `0025_notifications.sql` | In-app notifications. |
| 0026 | `0026_budget_category_essential.sql` | `budget_categories.is_essential`. |
| 0027 | `0027_setu_connections.sql` | Setu Account Aggregator tables. Run before `SETU_ENABLED=true`. |
| 0028 | `0028_fd_maturity.sql` | Explicit post-maturity lifecycle for FDs. |
| 0029 | `0029_cas_natural_key.sql` | **CAS import rewrite** - keyed, atomic `apply_cas_snapshot()`. **Required**: the server refuses CAS imports without it. |
| 0030 | `0030_transaction_ledger.sql` | Transaction ledger; powers `/api/analytics` (XIRR, FIFO lots). After 0029. |
| 0031 | `0031_ledger_inference.sql` | Infers BUY/SELL from monthly statements. After 0030. |
| 0032 | `0032_budget_category_member_limits.sql` | Per-member category limits. |
| 0033 | `0033_budget_transaction_splits.sql` | Split transactions between family members. |
| 0034 | `0034_cas_multi_statement.sql` | Multi-statement CAS import. After 0031. |
| 0035 | `0035_cas_retire_overlap.sql` | "Keep newest only" for a fund listed by two depositories. After 0034. |

`tests/migrationsDocs.test.js` fails if a `.sql` file is added here without a row above, or a row
points at a file that does not exist.

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
