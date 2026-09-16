import { Router } from "express";
import { auth, sendError } from "../lib/auth.js";
import { auditImport } from "../lib/importLogger.js";
import * as holdings from "../services/holdings.service.js";
import { previewCasImport } from "../services/casImport.service.js";

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

// Diff a parsed CAS against what is already stored — nothing is written.
// Returns per-row status (new / changed / unchanged / reentered / older), rows that
// would be marked exited, cross-source overlaps, legacy rows and whether this exact
// statement (by content hash) was already imported.
router.post("/import/preview", auth, async (req, res) => {
  const { holdings: rows } = req.body;
  if (!rows?.length) return res.status(400).json({ error: "No holdings to preview" });
  try { res.json(await previewCasImport(req.user.id, req.body)); }
  catch (e) { sendError(res, e, e.status || 500); }
});

router.post("/import", auth, auditImport("HOLDINGS_IMPORT"), async (req, res) => {
  const { holdings: rows } = req.body;
  if (!rows?.length) return res.status(400).json({ error: "No holdings to import" });
  try {
    const { _cas_statement_date, ...result } = await holdings.importHoldings(req.user.id, { ...req.body, import_method: "manual_upload" });
    res.locals.importStats = { rowsIn: rows.length, rowsOk: (result.inserted_count || 0) + (result.updated_count || 0), rowsFailed: result.error_count || 0 };
    res.json(result);
    // Fire-and-forget after responding (snapshot + background price backfill).
    holdings.runPostImport(req.user.id, _cas_statement_date);
  } catch (e) { sendError(res, e, e.status || 500); }
});

router.post("/", auth, async (req, res) => {
  try { res.json(await holdings.create(req.user.id, req.body)); }
  catch (e) { sendError(res, e); }
});

router.put("/:id", auth, async (req, res) => {
  try { res.json(await holdings.update(req.user.id, req.params.id, req.body)); }
  catch (e) { sendError(res, e, e.status || 500); }
});

router.delete("/:id", auth, async (req, res) => {
  try { res.json(await holdings.remove(req.user.id, req.params.id)); }
  catch (e) { sendError(res, e, e.status || 500); }
});

export default router;
