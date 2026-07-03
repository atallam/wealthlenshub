import { Router } from "express";
import { auth, sendError } from "../lib/auth.js";
import * as profile from "../services/profile.service.js";

const router = Router();

router.get("/", auth, async (req, res) => {
  try { res.json(await profile.get(req.user)); }
  catch (e) { sendError(res, e); }
});

router.put("/", auth, async (req, res) => {
  try { res.json(await profile.update(req.user.id, req.body)); }
  catch (e) { sendError(res, e); }
});

router.get("/cas-credentials", auth, async (req, res) => {
  try { res.json(await profile.casCredentials(req.user.id)); }
  catch (e) { sendError(res, e); }
});

router.get("/asset-types", auth, async (req, res) => {
  try { res.json(await profile.listAssetTypes(req.user.id)); }
  catch (e) { sendError(res, e); }
});

router.post("/asset-types", auth, async (req, res) => {
  try { res.json(await profile.createAssetType(req.user.id, req.body)); }
  catch (e) { sendError(res, e); }
});

router.put("/asset-types/:id", auth, async (req, res) => {
  try { res.json(await profile.updateAssetType(req.user.id, req.params.id, req.body)); }
  catch (e) { sendError(res, e); }
});

router.delete("/asset-types/:id", auth, async (req, res) => {
  try { res.json(await profile.removeAssetType(req.user.id, req.params.id)); }
  catch (e) { sendError(res, e); }
});

export default router;
