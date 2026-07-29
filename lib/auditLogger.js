/**
 * auditLogger.js — Universal audit trail middleware for WealthLens Hub.
 *
 * Mount ONCE in server.js before all route handlers:
 *   import { auditMiddleware } from "./lib/auditLogger.js";
 *   app.use("/api/", auditMiddleware);
 *
 * Captures every mutating request (POST/PUT/PATCH/DELETE) and writes a row
 * to `audit_logs` after the response is sent. Fire-and-forget — never blocks
 * the response or throws to the client.
 *
 * Routes can enrich the log entry via res.locals:
 *   res.locals.auditAction      = "HOLDING_DELETE";    // override action label
 *   res.locals.auditEntityType  = "holding";
 *   res.locals.auditEntityId    = req.params.id;
 *   res.locals.auditBefore      = { ...existingRecord }; // for UPDATE/DELETE
 */

import { supabase } from "./db.js";

// ── Action label resolver ────────────────────────────────────────────────────
// Maps METHOD + path pattern → human-readable action name.
// Patterns are checked top-to-bottom; first match wins.
const ACTION_RULES = [
  // Holdings
  { method: "POST",   pattern: /^\/api\/holdings\/import/,       action: "HOLDINGS_IMPORT",      entity: "holding" },
  { method: "POST",   pattern: /^\/api\/holdings/,               action: "HOLDING_CREATE",        entity: "holding" },
  { method: "PUT",    pattern: /^\/api\/holdings\/([^/]+)$/,     action: "HOLDING_UPDATE",        entity: "holding" },
  { method: "DELETE", pattern: /^\/api\/holdings\/([^/]+)$/,     action: "HOLDING_DELETE",        entity: "holding" },

  // Transactions
  { method: "POST",   pattern: /^\/api\/transactions\/import/,   action: "TRANSACTIONS_IMPORT",   entity: "transaction" },
  { method: "POST",   pattern: /^\/api\/transactions/,           action: "TXN_ADD",               entity: "transaction" },
  { method: "DELETE", pattern: /^\/api\/transactions\/([^/]+)$/, action: "TXN_DELETE",            entity: "transaction" },

  // Portfolio
  { method: "POST",   pattern: /^\/api\/portfolio/,              action: "PORTFOLIO_CREATE",      entity: "portfolio" },
  { method: "PUT",    pattern: /^\/api\/portfolio/,              action: "PORTFOLIO_UPDATE",      entity: "portfolio" },

  // Profile
  { method: "PUT",    pattern: /^\/api\/profile/,                action: "PROFILE_UPDATE",        entity: "profile" },

  // Asset types
  { method: "POST",   pattern: /^\/api\/asset-types/,            action: "ASSET_TYPE_CREATE",     entity: "asset_type" },
  { method: "PUT",    pattern: /^\/api\/asset-types/,            action: "ASSET_TYPE_UPDATE",     entity: "asset_type" },
  { method: "DELETE", pattern: /^\/api\/asset-types/,            action: "ASSET_TYPE_DELETE",     entity: "asset_type" },

  // Portfolio shares
  { method: "POST",   pattern: /^\/api\/shares/,                 action: "SHARE_GRANT",           entity: "share" },
  { method: "DELETE", pattern: /^\/api\/shares/,                 action: "SHARE_REVOKE",          entity: "share" },

  // Artifacts (documents)
  { method: "POST",   pattern: /^\/api\/artifacts/,              action: "ARTIFACT_UPLOAD",       entity: "artifact" },
  { method: "DELETE", pattern: /^\/api\/artifacts/,              action: "ARTIFACT_DELETE",       entity: "artifact" },

  // Prices / snapshots
  { method: "POST",   pattern: /^\/api\/prices\/refresh/,        action: "PRICES_REFRESH",        entity: "price" },
  { method: "POST",   pattern: /^\/api\/snapshots/,              action: "SNAPSHOT_CREATE",       entity: "snapshot" },

  // SnapTrade
  { method: "POST",   pattern: /^\/api\/snaptrade\/import/,      action: "SNAPTRADE_IMPORT",      entity: "snaptrade" },
  { method: "POST",   pattern: /^\/api\/snaptrade\/connect/,     action: "SNAPTRADE_CONNECT",     entity: "snaptrade" },
  { method: "DELETE", pattern: /^\/api\/snaptrade/,              action: "SNAPTRADE_DISCONNECT",  entity: "snaptrade" },

  // Plaid
  { method: "POST",   pattern: /^\/api\/plaid\/exchange/,        action: "PLAID_CONNECT",         entity: "plaid" },
  { method: "POST",   pattern: /^\/api\/plaid\/sync/,            action: "PLAID_SYNC",            entity: "plaid" },

  // AI Advisor
  { method: "POST",   pattern: /^\/api\/ai\/chat/,               action: "AI_QUERY",              entity: "ai" },

  // Budget
  { method: "POST",   pattern: /^\/api\/budget/,                 action: "BUDGET_ACTION",         entity: "budget" },
  { method: "DELETE", pattern: /^\/api\/budget/,                 action: "BUDGET_DELETE",         entity: "budget" },

  // Alerts
  { method: "POST",   pattern: /^\/api\/alerts/,                 action: "ALERT_CREATE",          entity: "alert" },
  { method: "PUT",    pattern: /^\/api\/alerts/,                 action: "ALERT_UPDATE",          entity: "alert" },
  { method: "DELETE", pattern: /^\/api\/alerts/,                 action: "ALERT_DELETE",          entity: "alert" },

  // Watchlist
  { method: "POST",   pattern: /^\/api\/watchlist/,              action: "WATCHLIST_ADD",         entity: "watchlist" },
  { method: "DELETE", pattern: /^\/api\/watchlist/,              action: "WATCHLIST_REMOVE",      entity: "watchlist" },

  // FD
  { method: "POST",   pattern: /^\/api\/fd/,                     action: "FD_ACTION",             entity: "fd" },
  { method: "PUT",    pattern: /^\/api\/fd/,                     action: "FD_UPDATE",             entity: "fd" },
  { method: "DELETE", pattern: /^\/api\/fd/,                     action: "FD_DELETE",             entity: "fd" },

  // Import (catch-all)
  { method: "POST",   pattern: /^\/api\/import/,                 action: "DATA_IMPORT",           entity: "import" },

  // Cron (internal)
  { method: "POST",   pattern: /^\/api\/cron/,                   action: "CRON_TRIGGER",          entity: "cron" },

  // Fallback
  { method: "POST",   pattern: /^\/api\//,                       action: "API_POST",              entity: null },
  { method: "PUT",    pattern: /^\/api\//,                       action: "API_PUT",               entity: null },
  { method: "PATCH",  pattern: /^\/api\//,                       action: "API_PATCH",             entity: null },
  { method: "DELETE", pattern: /^\/api\//,                       action: "API_DELETE",            entity: null },
];

function resolveAction(method, path) {
  for (const rule of ACTION_RULES) {
    if (rule.method === method && rule.pattern.test(path)) {
      return { action: rule.action, entity: rule.entity };
    }
  }
  return { action: `${method}_UNKNOWN`, entity: null };
}

// ── Sanitize body for storage ────────────────────────────────────────────────
// Strips sensitive fields, truncates large strings, limits array length.
const SENSITIVE_KEYS = new Set([
  "password", "token", "secret", "key", "pan", "aadhar",
  "access_token", "refresh_token", "authorization",
]);

function sanitizeBody(body, maxLen = 2000) {
  if (!body || typeof body !== "object") return null;
  try {
    const cleaned = JSON.parse(JSON.stringify(body, (k, v) => {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) return "[REDACTED]";
      if (typeof v === "string" && v.length > 500) return v.slice(0, 500) + "…";
      if (Array.isArray(v) && v.length > 20) return v.slice(0, 20); // cap arrays
      return v;
    }));
    const str = JSON.stringify(cleaned);
    if (str.length > maxLen) return { _truncated: true, _preview: str.slice(0, maxLen) };
    return cleaned;
  } catch {
    return null;
  }
}

// ── Core log writer ──────────────────────────────────────────────────────────
export async function writeAuditLog({
  userId,
  action,
  entityType = null,
  entityId = null,
  method,
  path,
  statusCode,
  beforeSnapshot = null,
  afterSnapshot = null,
  ipAddress = null,
  userAgent = null,
  durationMs = null,
}) {
  try {
    await supabase.from("audit_logs").insert({
      user_id:         userId,
      action,
      entity_type:     entityType,
      entity_id:       entityId ? String(entityId) : null,
      method,
      path,
      status_code:     statusCode,
      before_snapshot: beforeSnapshot,
      after_snapshot:  afterSnapshot,
      ip_address:      ipAddress,
      user_agent:      userAgent,
      duration_ms:     durationMs,
    });
  } catch (err) {
    // Audit logging must never surface errors to users.
    console.error("[auditLogger] Failed to write audit log:", err.message);
  }
}

// ── Express middleware ───────────────────────────────────────────────────────
const MUTABLE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Paths to skip entirely (read-only, high-frequency, or internal health checks)
const SKIP_PATTERNS = [
  /^\/api\/forex/,
  /^\/api\/mf\/nav/,
  /^\/api\/mf\/search/,
  /^\/api\/stock\/search/,
  /^\/api\/stock\/info/,
  /^\/api\/etf\/search/,
  /^\/api\/benchmark/,
  /^\/api\/audit-logs/,     // don't log the audit log reads themselves
];

export function auditMiddleware(req, res, next) {
  // Only intercept mutating methods
  if (!MUTABLE_METHODS.has(req.method)) return next();

  // Skip noisy / irrelevant paths
  if (SKIP_PATTERNS.some(p => p.test(req.path))) return next();

  const startTime = Date.now();

  // Intercept res.json to capture response status after it's set
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    const result = originalJson(body);

    // Fire-and-forget after response is sent
    setImmediate(() => {
      const userId = req.user?.id;
      if (!userId) return; // unauthenticated requests don't get logged

      const { action, entity } = resolveAction(req.method, req.path);

      // Routes can override via res.locals
      const finalAction     = res.locals.auditAction     || action;
      const finalEntityType = res.locals.auditEntityType || entity;
      const finalEntityId   = res.locals.auditEntityId   || req.params?.id || null;
      const beforeSnapshot  = res.locals.auditBefore     || null;

      // Build after snapshot from request body (sanitized)
      // For AI queries, only log a token count hint, not the full prompt
      let afterSnapshot = null;
      if (finalAction === "AI_QUERY") {
        const msgs = req.body?.messages;
        afterSnapshot = { message_count: Array.isArray(msgs) ? msgs.length : 0 };
      } else {
        afterSnapshot = sanitizeBody(req.body);
      }

      writeAuditLog({
        userId,
        action:          finalAction,
        entityType:      finalEntityType,
        entityId:        finalEntityId,
        method:          req.method,
        path:            req.path,
        statusCode:      res.statusCode,
        beforeSnapshot:  beforeSnapshot ? sanitizeBody(beforeSnapshot) : null,
        afterSnapshot,
        ipAddress:       req.ip || req.headers["x-forwarded-for"] || null,
        userAgent:       req.headers["user-agent"] || null,
        durationMs:      Date.now() - startTime,
      });
    });

    return result;
  };

  next();
}
