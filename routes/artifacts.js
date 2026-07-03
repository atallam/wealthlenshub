import { Router } from "express";
import multer from "multer";
import { auth, sendError, strictLimiter } from "../lib/auth.js";
import * as artifacts from "../services/artifacts.service.js";

// Allowed MIME types for uploaded documents.
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv", "text/plain",
]);

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`File type '${file.mimetype}' is not allowed.`));
  },
});

router.get("/:holdingId", auth, async (req, res) => {
  try {
    res.json(await artifacts.listForHolding(req.user.id, req.params.holdingId));
  } catch (e) { sendError(res, e, e.status || 403); }
});

router.post("/upload", auth, strictLimiter, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const { holdingId, description } = req.body;
  if (!holdingId) return res.status(400).json({ error: "holdingId required" });
  try {
    const result = await artifacts.create(req.user.id, holdingId, req.file, description);
    res.json({ ok: true, ...result });
  } catch (e) { sendError(res, e, e.status || 403); }
});

router.get("/download/:id", auth, async (req, res) => {
  try {
    res.json(await artifacts.getSignedUrl(req.user.id, req.params.id));
  } catch (e) { sendError(res, e, e.status || 403); }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    res.json(await artifacts.remove(req.user.id, req.params.id));
  } catch (e) { sendError(res, e, e.status || 403); }
});

export default router;
