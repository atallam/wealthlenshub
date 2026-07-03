import { Router } from "express";
import { auth, sendError } from "../lib/auth.js";
import * as shares from "../services/shares.service.js";

const router = Router();

router.get("/", auth, async (req, res) => {
  try { res.json({ shares: await shares.listGranted(req.user.id) }); }
  catch (e) { sendError(res, e); }
});

router.get("/received", auth, async (req, res) => {
  try { res.json({ shared_with_me: await shares.listReceived(req.user.id) }); }
  catch (e) { sendError(res, e); }
});

router.post("/sync", auth, async (req, res) => {
  try { res.json(await shares.syncFromMembers(req.user)); }
  catch (e) { console.error("Share sync error:", e.message); res.json({ synced: 0, error: e.message }); }
});

router.post("/cross-link", auth, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });
  try { res.json(await shares.crossLink(req.user, email)); }
  catch (e) { console.error("Cross-link error:", e.message); res.json({ linked: 0, error: e.message }); }
});

router.post("/", auth, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });
  try { res.json(await shares.share(req.user, email)); }
  catch (e) { sendError(res, e, e.status); }
});

router.put("/:shareId", auth, async (req, res) => {
  try { res.json(await shares.updateRole(req.user.id, req.params.shareId)); }
  catch (e) { sendError(res, e); }
});

router.delete("/:shareId", auth, async (req, res) => {
  try { res.json(await shares.remove(req.user.id, req.params.shareId)); }
  catch (e) { sendError(res, e); }
});

router.get("/shared-portfolio/:ownerId", auth, async (req, res) => {
  try { res.json(await shares.sharedPortfolio(req.user.id, req.params.ownerId)); }
  catch (e) { sendError(res, e, e.status); }
});

export default router;
