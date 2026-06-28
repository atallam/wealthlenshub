import rateLimit from "express-rate-limit";
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
  } catch (e) {
    return res.status(401).json({ error: "Authentication failed" });
  }
}

export function sendError(res, e, status = 500) {
  console.error(`[${status}]`, e?.message || e);
  res.status(status).json({
    error: (status >= 500 && IS_PROD)
      ? "Internal server error"
      : (e?.message || "An error occurred"),
  });
}

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please try again later." },
});

export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please slow down." },
});
