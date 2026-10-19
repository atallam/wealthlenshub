// Load .env into process.env for local/manual runs (node server.js, a debugger,
// a test that boots the server, etc). No-op in production: Render's startCommand
// runs this file directly and injects real env vars via its own dashboard, and
// there's no .env file in that deployment for this to find.
import "dotenv/config";

import express from "express";
import helmet from "helmet";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { apiLimiter, IS_PROD } from "./lib/auth.js";

// ── Route modules ────────────────────────────────────────────────────────────
import portfolioRouter    from "./routes/portfolio.js";
import holdingsRouter     from "./routes/holdings.js";
import transactionsRouter from "./routes/transactions.js";
import profileRouter      from "./routes/profile.js";
import pricesRouter       from "./routes/prices.js";
import aiRouter           from "./routes/ai.js";
import artifactsRouter    from "./routes/artifacts.js";
import snaptradeRouter    from "./routes/snaptrade.js";
import plaidRouter        from "./routes/plaid.js";
import setuRouter         from "./routes/setu.js";
import importRouter       from "./routes/import.js";
import importV2Router     from "./routes/import_v2.js";    // casparser parallel path
import budgetRouter       from "./routes/budget.js";
import snapshotsRouter    from "./routes/snapshots.js";
import fdRouter           from "./routes/fd.js";
import analyticsRouter    from "./routes/analytics.js";   // XIRR + FIFO lots from the transaction ledger
import concallRouter      from "./routes/concall.js";
import exportRouter       from "./routes/export.js";
import alertsRouter       from "./routes/alerts.js";
import auditRouter       from "./routes/audit.js";
import pushRouter        from "./routes/push.js";
import notificationsRouter from "./routes/notifications.js";
import mfRouter          from "./routes/mf.js";
import newsRouter        from "./routes/news.js";
import { auditMiddleware } from "./lib/auditLogger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

// Trust Render's (and similar reverse-proxy) X-Forwarded-For header so that
// express-rate-limit sees the real client IP rather than the proxy IP.
app.set("trust proxy", 1);

// ── Security headers ─────────────────────────────────────────────────────────
// Helmet sets HSTS, X-Content-Type-Options, frameguard, etc.
// Content-Security-Policy is pinned to the SPA's real origins: its own scripts
// (Vite emits no inline script), Google Fonts, and Supabase. Inline *styles* are
// allowed because the UI uses style={{…}} throughout.
//   CSP_MODE=report-only (default) → violations show in the browser console but
//                                    nothing is blocked — safe to deploy
//   CSP_MODE=enforce               → block violations (switch once the console is clean)
//   CSP_MODE=off                   → no CSP header
// Anything new that loads from another origin (a script CDN, a Plaid/SnapTrade
// embed, an image host that isn't https) must be added here before enforcing.
function supabaseOrigins() {
  const out = ["https://*.supabase.co", "wss://*.supabase.co"];
  try { if (process.env.SUPABASE_URL) { const u = new URL(process.env.SUPABASE_URL); out.push(u.origin, `wss://${u.host}`); } } catch { /* bad URL — wildcard above still applies */ }
  return out;
}
const CSP_MODE = (process.env.CSP_MODE || "report-only").toLowerCase();
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
  imgSrc: ["'self'", "data:", "blob:", "https:"],
  connectSrc: ["'self'", ...supabaseOrigins()],
  workerSrc: ["'self'", "blob:"],
  manifestSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
};
app.use(helmet({
  contentSecurityPolicy: CSP_MODE === "off" ? false : { useDefaults: false, reportOnly: CSP_MODE !== "enforce", directives: cspDirectives },
  crossOriginEmbedderPolicy: false,
}));

// CORS: same-origin by default (the SPA is served from this server). Set
// CORS_ORIGINS (comma-separated) only if a separate frontend origin needs access.
const corsOrigins = (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
if (corsOrigins.length) {
  app.use(cors({ origin: corsOrigins, credentials: true }));
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/api/", apiLimiter);
app.use("/api/", auditMiddleware);   // ── Audit trail (fire-and-forget on all mutating routes)

// ── Health check (P0-2) ──────────────────────────────────────────────────────
// Must be registered BEFORE the static middleware so it is never shadowed by
// the catch-all SPA route. Render uses this path (render.yaml healthCheckPath).
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Serve built React app ────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "dist")));

// ── API routes ───────────────────────────────────────────────────────────────
app.use("/api/portfolio",     portfolioRouter);
app.use("/api/holdings",      holdingsRouter);
app.use("/api/transactions",  transactionsRouter);
app.use("/api/profile",       profileRouter);
app.use("/api",               pricesRouter);       // mounts /api/forex, /api/mf, /api/stock, /api/prices
app.use("/api/ai",            aiRouter);
app.use("/api/artifacts",     artifactsRouter);
app.use("/api/snaptrade",     snaptradeRouter);
app.use("/api/plaid",         plaidRouter);
app.use("/api/setu",          setuRouter);
app.use("/api/import",        importRouter);
app.use("/api/import",        importV2Router);   // casparser route: POST /detect-casparser
app.use("/api/budget",        budgetRouter);
app.use("/api/snapshots",     snapshotsRouter);
app.use("/api/fd",            fdRouter);
app.use("/api/analytics",     analyticsRouter);
app.use("/api/concall",       concallRouter);
app.use("/api/export",        exportRouter);
app.use("/api/alerts",        alertsRouter);
app.use("/api/audit-logs",    auditRouter);
app.use("/api/notifications",  notificationsRouter);
app.use("/api/push",          pushRouter);
app.use("/api/mf",            mfRouter);
app.use("/api",               newsRouter);     // mounts /api/news

// ── Global API error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (req.path.startsWith("/api/")) {
    console.error("Global API error:", req.method, req.path, err.message, err.stack);
    if (res.headersSent) return next(err);
    const status = err.status || 500;
    // Don't leak internal error messages/stack details to clients on 5xx in prod.
    const message = (status >= 500 && IS_PROD) ? "Internal server error" : (err.message || "Internal server error");
    return res.status(status).json({ error: message });
  }
  next(err);
});

// ── Catch-all: serve React SPA ───────────────────────────────────────────────
app.get("*", (_, res) => {
  const indexPath = path.join(__dirname, "dist", "index.html");
  res.sendFile(indexPath, err => {
    if (err) {
      console.error("Failed to serve index.html from:", indexPath, err.message);
      res.status(404).send("Build error — dist/index.html not found.");
    }
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`WealthLens Hub running on port ${PORT}`);
  const SETU_ENABLED = process.env.SETU_ENABLED === "true";
  console.log(`Setu AA: ${SETU_ENABLED ? "ENABLED" : "disabled (set SETU_ENABLED=true to activate)"}`);
});
