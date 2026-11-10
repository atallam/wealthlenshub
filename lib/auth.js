import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { supabase } from "./db.js";

export const IS_PROD = process.env.NODE_ENV === "production";

export async function auth(req, res, next) {
  const hdr = req.headers.authorization;
  if (!hdr || !hdr.startsWith("Bearer ")) return res.status(401).json({ error: "No token" });
  const token = hdr.slice(7);
  if (!token || token.length < 10) return res.status(401).json({ error: "Invalid token" });
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Unauthorized" });
    req.user = user;
    next();
  } catch  {
    return res.status(401).json({ error: "Authentication failed" });
  }
}

export function sendError(res, e, status = 500) {
  console.error(`[${status}]`, e?.message || e);
  // Schema-drift errors (a migration wasn't run against this Supabase project)
  // describe our own schema shape, not user data — safe to show even in prod,
  // and far more actionable than a bare "Internal server error".
  const bypassGeneric = e?.code === "SCHEMA_DRIFT";
  res.status(status).json({
    error: (status >= 500 && IS_PROD && !bypassGeneric)
      ? "Internal server error"
      : (e?.message || "An error occurred"),
    ...(bypassGeneric ? { code: "SCHEMA_DRIFT" } : {}),
  });
}

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please try again later." },
});

// Per-user limits (falls back to IP before auth). Heavier than a normal API call,
// so they sit on top of the global apiLimiter: file parsing and LLM-backed analysis.
const perUser = (req) => req.user?.id || ipKeyGenerator(req);

export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: perUser,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads - please wait a few minutes and try again." },
});

export const analysisLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: perUser,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many analysis requests - please wait a few minutes and try again." },
});

export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please slow down." },
});
