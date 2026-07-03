import { Router } from "express";
import { auth, sendError } from "../lib/auth.js";
import * as portfolio from "../services/portfolio.service.js";

const router = Router();

router.get("/", auth, async (req, res) => {
  try { res.json(await portfolio.get(req.user)); }
  catch (e) { sendError(res, e); }
});

router.post("/", auth, async (req, res) => {
  try { res.json(await portfolio.save(req.user.id, req.body)); }
  catch (e) { sendError(res, e); }
});

export default router;
