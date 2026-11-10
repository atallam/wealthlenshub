/**
 * env.js - boot-time environment check.
 *
 * Importing this module (server.js does, right after dotenv) validates process.env before any
 * route or the Supabase client is created. In production a fatal problem stops the boot with
 * ONE readable message listing everything wrong; in development the same problems are only
 * warnings so local work is not blocked. Soft problems (a feature will be off, a safer mode is
 * available) are always warnings.
 *
 * checkEnv() is pure (takes an env object) so it can be unit-tested.
 */

const isHttpUrl = (v) => { try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; } };

export function checkEnv(env = process.env) {
  const errors = [];
  const warnings = [];
  const has = (k) => String(env[k] ?? "").trim() !== "";
  const isProd = env.NODE_ENV === "production";

  // ── Fatal ───────────────────────────────────────────────────────────────────
  if (!has("SUPABASE_URL")) errors.push("SUPABASE_URL is not set.");
  else if (!isHttpUrl(env.SUPABASE_URL)) errors.push("SUPABASE_URL is not a valid http(s) URL.");
  if (!has("SUPABASE_SERVICE_KEY")) errors.push("SUPABASE_SERVICE_KEY is not set (the API cannot read or write data without it).");

  if (!has("BUDGET_ENCRYPT_KEY")) {
    if (isProd) errors.push("BUDGET_ENCRYPT_KEY is not set: encrypted PAN/DOB/tokens would be unreadable after a restart.");
  } else if (!/^[0-9a-fA-F]{64}$/.test(env.BUDGET_ENCRYPT_KEY)) {
    errors.push("BUDGET_ENCRYPT_KEY must be exactly 64 hex characters (32 bytes).");
  }

  if (has("CORS_ORIGINS")) {
    for (const o of String(env.CORS_ORIGINS).split(",").map((s) => s.trim()).filter(Boolean)) {
      if (o === "*") errors.push('CORS_ORIGINS must not contain "*" (the API sends credentials).');
      else if (!isHttpUrl(o)) errors.push(`CORS_ORIGINS has an invalid origin: ${o}`);
    }
  }
  if (has("CSP_MODE") && !["report-only", "enforce", "off"].includes(env.CSP_MODE.toLowerCase())) {
    errors.push(`CSP_MODE must be report-only, enforce or off (got "${env.CSP_MODE}").`);
  }
  if (has("BODY_SCHEMA_MODE") && !["log", "enforce"].includes(env.BODY_SCHEMA_MODE)) {
    errors.push(`BODY_SCHEMA_MODE must be log or enforce (got "${env.BODY_SCHEMA_MODE}").`);
  }
  if (has("PLAID_CLIENT_ID") !== has("PLAID_SECRET")) errors.push("PLAID_CLIENT_ID and PLAID_SECRET must be set together.");
  if (has("PLAID_ENV") && !["sandbox", "development", "production"].includes(env.PLAID_ENV)) {
    errors.push(`PLAID_ENV must be sandbox, development or production (got "${env.PLAID_ENV}").`);
  }

  // ── Soft ────────────────────────────────────────────────────────────────────
  if (String(env.SETU_ENABLED).trim().toLowerCase() === "true") {
    for (const k of ["SETU_CLIENT_ID", "SETU_CLIENT_SECRET"]) if (!has(k)) warnings.push(`SETU_ENABLED=true but ${k} is not set.`);
    if (!has("SETU_WEBHOOK_SECRET")) warnings.push("SETU_ENABLED=true but SETU_WEBHOOK_SECRET is not set: consent webhooks will be rejected (503).");
    else if (String(env.SETU_WEBHOOK_SECRET).length < 16) warnings.push("SETU_WEBHOOK_SECRET is short; use at least 16 random characters.");
  }
  if (has("VAPID_PUBLIC_KEY") !== has("VAPID_PRIVATE_KEY")) warnings.push("Only one of VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY is set: Web Push is disabled.");
  if (!has("ANTHROPIC_KEY")) warnings.push("ANTHROPIC_KEY is not set: AI features (advisor, concall analysis, statement parsing) are disabled.");
  if (isProd) {
    if ((env.CSP_MODE || "report-only").toLowerCase() !== "enforce") warnings.push(`CSP_MODE is "${env.CSP_MODE || "report-only"}": the Content-Security-Policy is not blocking anything yet.`);
    if ((env.BODY_SCHEMA_MODE || "log") !== "enforce") warnings.push('BODY_SCHEMA_MODE is "log": invalid budget/profile bodies are logged but accepted.');
  }
  return { errors, warnings, isProd };
}

export function assertEnv(env = process.env, log = console) {
  const { errors, warnings, isProd } = checkEnv(env);
  for (const w of warnings) log.warn(`⚠️  env: ${w}`);
  if (errors.length) {
    const msg = `Invalid environment configuration:\n${errors.map((e) => `  - ${e}`).join("\n")}`;
    if (isProd) throw new Error(msg);
    log.warn(`⚠️  (dev) ${msg}`);
  }
}

// Side effect on import so it runs before the Supabase client and routes load. Skipped under
// Vitest, which supplies its own stub env.
if (!process.env.VITEST) assertEnv();
