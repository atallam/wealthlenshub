import { Router } from "express";
import multer from "multer";
import { auth, sendError, IS_PROD } from "../lib/auth.js";
import * as budget from "../services/budget.service.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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

router.get("/categories", auth, async (req, res) => {
  try { res.json(await budget.listCategories(req.user.id)); } catch (e) { sendError(res, e); }
});
router.post("/categories", auth, async (req, res) => {
  const { name, keywords, icon, color, monthly_limit } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  try { res.json(await budget.createCategory(req.user.id, name, keywords, icon, color, monthly_limit)); } catch (e) { sendError(res, e); }
});
router.put("/categories/:id", auth, async (req, res) => {
  const { name, keywords, icon, color, monthly_limit } = req.body;
  try { res.json(await budget.updateCategory(req.user.id, req.params.id, name, keywords, icon, color, monthly_limit)); } catch (e) { sendError(res, e); }
});
router.delete("/categories/:id", auth, async (req, res) => {
  try { res.json(await budget.deleteCategory(req.user.id, req.params.id)); } catch (e) { sendError(res, e); }
});

router.get("/analytics", auth, async (req, res) => {
  try { res.json(await budget.analytics(req.user.id, req.query.month)); } catch (e) { sendError(res, e); }
});
router.get("/benchmark"