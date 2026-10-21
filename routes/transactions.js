import { Router } from "express";
import { auth, sendError } from "../lib/auth.js";
import * as txns from "../services/transactions.service.js";

const router = Router();

router.get("/:holdingId", auth, async (req, res) => {
  try { res.json(await txns.listForHolding(req.user.id, req.params.holdingId)); }
  catch (e) { sendError(res, e, e.status); }
});

router.post("/import", auth, async (req, res) => {
  const { transactions } = req.body;
  if (!transactions?.length) return res.status(400).json({ error: "No transactions to import" });
  try { res.json(await txns.importRows(req.user.id, transactions)); }
  catch (e) { sendError(res, e, e.status); }
});

// Registered before "/" handlers that take params so it is never shadowed.
router.post("/cost-basis", auth, async (req, res) => {
  try { res.json(await txns.setCostBasis(req.user.id, req.body)); }
  catch (e) { sendError(res, e, e.status || 400); }
});

router.post("/", auth, async (req, res) => {
  try { res.json(await txns.add(req.user.id, req.body)); }
  catch (e) { sendError(res, e, e.status || 403); }
});

router.delete("/:id", auth, async (req, res) => {
  try { res.json(await txns.remove(req.user.id, req.params.id)); }
  catch (e) { sendError(res, e, e.status); }
});

export default router;
