import { Router } from "express";
import { auth, sendError } from "../lib/auth.js";
import { takeSnapshot } from "../lib/snapshot.js";
import * as snapshots from "../services/snapshots.service.js";

const router = Router();

router.post("/", auth, async (req, res) => {
  try {
    const { source = "manual", cas_statement_date = null } = req.body;
    const result = await takeSnapshot(req.user.id, { source, cas_statement_date });
    res.json(result.snapshot ? { snapshot: result.snapshot } : result);
  } catch (e) { console.error("Snapshot error:", e); sendError(res, e); }
});

router.get("/", auth, async (req, res) => {
  try { res.json({ snapshots: await snapshots.list(req.user.id, req.query.months ?? 24) }); }
  catch (e) { console.error("Snapshots fetch error:", e); sendError(res, e); }
});

router.delete("/:id", auth, async (req, res) => {
  try { res.json(await snapshots.remove(req.user.id, req.params.id)); }
  catch (e) { sendError(res, e); }
});

export default router;
