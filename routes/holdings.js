import { Router } from "express";
import { auth, sendError } from "../lib/auth.js";
import { auditImport } from "../lib/importLogger.js";
import * as holdings from "../services/holdings.service.js";

const router = Router();

router.get("/", auth, async (req, res) => {
  try { res.json(await holdings.list(req.user.id)); }
  catch (e) { sendError(res, e); }
});

// Per-holding transaction fetch (lazy load), scoped to the caller.
router.get("/:id/transactions", auth, async (req, res) => {
  try { res.json(await holdings.listTransactions(req.user.id, req.params.id)); }
  catch (e) { sendError(res, e); }
});

router.post("/import", auth, auditImport("HOLDINGS_IMPORT"), async (req, res) => {
  const { holdings: rows } = req.body;
  if (!rows?.length) return res.status(400).json({ error: "No holdings to import" });
  try {
    const { _cas_statement_date, ...result } = await holdings.importHoldings(req.user.id, req.body);
    res.json(result);
    // Fire-and-forget after responding (snapshot + background price backfill).
    holdings.runPostImport(req.user.id, _cas_statement_date);
  } catch (e) { sendError(res, e); }
});

router.post("/", auth, async (req, res) => {
  try { res.json(await holdings.create(req.user.id, req.body)); }
  catch (e) { sendError(res, e); }
});

router.put("/:id", auth, async (req, res) => {
  try { res.json(await holdings.update(req.user.id, req.params.id, req.body)); }
  catch (e) { sendError(res, e); }
});

router.delete("/:id", auth, async (req, res) => {
  try { res.json(await holdings.remove(req.user.id, req.params.id)); }
  catch (e) { sendError(res, e); }
});

export default router;
