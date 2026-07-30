import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Schema-drift detection ──────────────────────────────────────────────────
// A migration file existing in migrations/ doesn't mean it was ever run against
// this Supabase project — that gap (code references a column/table a migration
// added, but the migration was never applied) previously surfaced as a bare
// "Internal server error" with no clue what actually broke. These are known
// Postgres/PostgREST codes for "the column/table this query references doesn't
// exist" — always safe to say out loud (it's our own schema shape, not user
// data), so callers can bypass the generic prod error-collapse for these.
const SCHEMA_DRIFT_CODES = new Set([
  "42703", // Postgres: undefined_column
  "42P01", // Postgres: undefined_table
  "PGRST204", // PostgREST: column not found in schema cache
  "PGRST205", // PostgREST: table not found in schema cache
]);
export function describeDbError(e) {
  const msg = e?.message || "";
  const isSchemaDrift = SCHEMA_DRIFT_CODES.has(e?.code)
    || /column .* does not exist/i.test(msg)
    || /relation .* does not exist/i.test(msg)
    || /schema cache/i.test(msg);
  if (isSchemaDrift) {
    return {
      isSchemaDrift: true,
      friendly: `Database schema is out of date — ${msg}. A migration in migrations/ hasn't been run against this Supabase project yet. Check migrations/README.md for the list and run any missing ones in the Supabase SQL Editor.`,
    };
  }
  return { isSchemaDrift: false, friendly: msg || "Database error" };
}
