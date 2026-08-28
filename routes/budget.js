import { Router } from "express";
import multer from "multer";
import { auth, sendError, IS_PROD } from "../lib/auth.js";
import * as budget from "../services/budget.service.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.get("/banks", auth, async (req, res) => {
  try { res.json(budget.listBanks()); } catch (e) { sendError(res, e); }
});

router.post("/upload", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  try {
    res.json(await budget.uploadStatement(req.user.id, req.file, req.body, IS_PROD));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
    console.error("Budget upload error:", e.message); sendError(res, e);
  }
});

router.post("/debug-pdf", auth, upload.single("file"), async (req, res) => {
  // Dev-only: disabled in production to prevent exposure of internal parsing internals
  if (IS_PROD) return res.status(404).json({ error: "Not found" });
  if (!req.file) return res.status(400).json({ error: "No file" });
  const ext = req.file.originalname.split(".").pop().toLowerCase();
  if (ext !== "pdf") return res.status(400).json({ error: "PDF only" });
  try { res.json(await budget.debugPdf(req.user.id, req.file, req.body)); }
  catch (e) { sendError(res, e); }
});

router.get("/statements", auth, async (req, res) => {
  try { res.json(await budget.listStatements(req.user.id)); } catch (e) { sendError(res, e); }
});
router.delete("/statements/:id", auth, async (req, res) => {
  try { res.json(await budget.deleteStatement(req.user.id, req.params.id)); } catch (e) { sendError(res, e); }
});
router.patch("/statements/:id/member", auth, async (req, res) => {
  try { res.json(await budget.updateStatementMember(req.user.id, req.params.id, req.body.member_id)); } catch (e) { sendError(res, e); }
});

router.get("/transactions", auth, async (req, res) => {
  try { res.json(await budget.listTransactions(req.user.id, req.query)); } catch (e) { sendError(res, e); }
});
router.patch("/transactions/:id", auth, async (req, res) => {
  const { category } = req.body;
  if (!category) return res.status(400).json({ error: "category required" });
  try { res.json(await budget.setTxnCategory(req.user.id, req.params.id, category)); } catch (e) { sendError(res, e); }
});
router.post("/recategorise", auth, async (req, res) => {
  const { ids, category } = req.body;
  if (!ids?.length || !category) return res.status(400).json({ error: "ids and category required" });
  if (ids.length > 500) return res.status(400).json({ error: "Too many IDs (max 500)" });
  try { res.json(await budget.recategorise(req.user.id, ids, category)); } catch (e) { sendError(res, e); }
});
// Re-run keyword auto-categorisation over existing transactions (e.g. after seeding
// default categories that didn't exist at import time, or after editing a category's
// keyword list). Defaults to only touching "Other" transactions — pass
// { only_other: false } to re-run over everything.
router.post("/recategorise-all", auth, async (req, res) => {
  try { res.json(await budget.recategoriseAll(req.user.id, { onlyOther: req.body?.only_other !== false })); } catch (e) { sendError(res, e); }
});

router.get("/categories", auth, async (req, res) => {
  try { res.json(await budget.listCategories(req.user.id)); } catch (e) { sendError(res, e); }
});
router.post("/categories", auth, async (req, res) => {
  const { name, keywords, icon, color, monthly_limit, is_essential } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  try { res.json(await budget.createCategory(req.user.id, name, keywords, icon, color, monthly_limit, is_essential)); } catch (e) { sendError(res, e); }
});
router.put("/categories/:id", auth, async (req, res) => {
  const { name, keywords, icon, color, monthly_limit, is_essential } = req.body;
  try { res.json(await budget.updateCategory(req.user.id, req.params.id, name, keywords, icon, color, monthly_limit, is_essential)); } catch (e) { sendError(res, e); }
});
router.delete("/categories/:id", auth, async (req, res) => {
  try { res.json(await budget.deleteCategory(req.user.id, req.params.id)); } catch (e) { sendError(res, e); }
});

router.get("/analytics", auth, async (req, res) => {
  const { month, from, to } = req.query;
  // "alltime" sentinel → explicit null range (no date filter)
  const rangeFrom = from === "alltime" ? null : (from || undefined);
  const rangeTo   = from === "alltime" ? null : (to   || undefined);
  try { res.json(await budget.analytics(req.user.id, month, { from: rangeFrom, to: rangeTo })); } catch (e) { sendError(res, e); }
});
router.get("/benchmark", auth, async (req, res) => {
  try { res.json(await budget.benchmark(req.query.period)); } catch (e) { sendError(res, e); }
});

// ── Goals (Budget 2) ─────────────────────────────────────────────
router.get("/goals", auth, async (req, res) => {
  try { res.json(await budget.listGoals(req.user.id)); } catch (e) { sendError(res, e); }
});
router.post("/goals", auth, async (req, res) => {
  const { name, target } = req.body;
  if (!name || !target) return res.status(400).json({ error: "name and target required" });
  try { res.json(await budget.createGoal(req.user.id, req.body)); } catch (e) { sendError(res, e); }
});
router.put("/goals/:id", auth, async (req, res) => {
  try { res.json(await budget.updateGoal(req.user.id, req.params.id, req.body)); } catch (e) { sendError(res, e); }
});
router.delete("/goals/:id", auth, async (req, res) => {
  try { res.json(await budget.deleteGoal(req.user.id, req.params.id)); } catch (e) { sendError(res, e); }
});

export default router;

// ── Family Budget — new endpoints ─────────────────────────────────────────────

// Member-scoped analytics (used by FamilyBudgetTab overview)
router.get("/family-analytics", auth, async (req, res) => {
  const { month, member_id, from, to } = req.query;
  try { res.json(await budget.familyAnalytics(req.user.id, member_id || null, month, { from, to })); }
  catch (e) { sendError(res, e); }
});

// Member-scoped transactions (same as /transactions but filters via statement join)
router.get("/family-transactions", auth, async (req, res) => {
  try { res.json(await budget.familyTransactions(req.user.id, req.query)); }
  catch (e) { sendError(res, e); }
});

// Merchant rollup for current period (top 20 by spend)
router.get("/merchants", auth, async (req, res) => {
  const { month, member_id, from, to } = req.query;
  try { res.json(await budget.merchantRollup(req.user.id, member_id || null, month, { from, to })); }
  catch (e) { sendError(res, e); }
});

// Recurring transaction detection (last 12 months, any 2+ months = flagged)
router.get("/recurring", auth, async (req, res) => {
  const { member_id } = req.query;
  try { res.json(await budget.detectRecurring(req.user.id, member_id || null)); }
  catch (e) { sendError(res, e); }
});
