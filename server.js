import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { apiLimiter } from "./lib/auth.js";

// ── Route modules ────────────────────────────────────────────────────────────
import portfolioRouter    from "./routes/portfolio.js";
import holdingsRouter     from "./routes/holdings.js";
import transactionsRouter from "./routes/transactions.js";
import profileRouter      from "./routes/profile.js";
import pricesRouter       from "./routes/prices.js";
import aiRouter           from "./routes/ai.js";
import cronRouter         from "./routes/cron.js";
import artifactsRouter    from "./routes/artifacts.js";
import sharesRouter       from "./routes/shares.js";
import snaptradeRouter    from "./routes/snaptrade.js";
import plaidRouter        from "./routes/plaid.js";
import setuRouter         from "./routes/setu.js";
import importRouter       from "./routes/import.js";
import budgetRouter       from "./routes/budget.js";
import snapshotsRouter    from "./routes/snapshots.js";
import kiteRouter         from "./routes/kite.js";
import breezeRouter       from "./routes/breeze.js";
import gmailRouter        from "./routes/gmail.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/api/", apiLimiter);

// ── Serve built React app ────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "dist")));

// ── API routes ───────────────────────────────────────────────────────────────
app.use("/api/portfolio",     portfolioRouter);
app.use("/api/holdings",      holdingsRouter);
app.use("/api/transactions",  transactionsRouter);
app.use("/api/profile",       profileRouter);
app.use("/api",               pricesRouter);       // mounts /api/forex, /api/mf, /api/stock, /api/prices
app.use("/api/ai",            aiRouter);
app.use("/api/cron",          cronRouter);
app.use("/api/artifacts",     artifactsRouter);
app.use("/api/shares",        sharesRouter);
app.use("/api/snaptrade",     snaptradeRouter);
app.use("/api/plaid",         plaidRouter);
app.use("/api/setu",          setuRouter);
app.use("/api/import",        importRouter);
app.use("/api/budget",        budgetRouter);
app.use("/api/snapshots",     snapshotsRouter);
app.use("/api/kite",          kiteRouter);
app.use("/api/breeze",        breezeRouter);
app.use("/api/gmail",         gmailRouter);

// ── Global API error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (req.path.startsWith("/api/")) {
    console.error("Global API error:", req.method, req.path, err.message, err.stack);
    if (res.headersSent) return next(err);
    return res.status(err.status || 500).json({ error: err.message || "Internal server error" });
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
