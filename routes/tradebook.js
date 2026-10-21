/**
 * routes/tradebook.js — broker tradebook import (exact cost basis for demat stocks).
 *
 *   POST /api/tradebook/preview   multipart: file (+ member_id)   → reconciliation, writes nothing
 *   POST /api/tradebook/commit    multipart: file (+ member_id)   → inserts new orders (idempotent)
 *
 * The file is re-uploaded for commit, so the server never trusts client-parsed rows.
 */
import { Router } from "express";
import multer from "multer";
import { auth, sendError } from "../lib/auth.js";
import { auditImport } from "../lib/importLogger.js";
import { xlsxBufferToCSV } from "../lib/parsers.js";
import * as tb from "../services/tradebook.service.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function fileToCsv(file) {
  if (!file) { const e = new Error("No file uploaded"); e.status = 400; throw e; }
  const ext = file.originalname.split(".").pop().toLowerCase();
  if (ext === "csv" || ext === "txt") return file.buffer.toString("utf8");
  if (ext === "xlsx") return xlsxBufferToCSV(file.buffer);
  if (ext === "xls") { const e = new Error("Legacy .xls isn't supported — open it in Excel, save as .xlsx or .csv, and retry."); e.status = 400; throw e; }
  const e = new Error("Upload a .csv or .xlsx tradebook"); e.status = 400; throw e;
}

router.post("/preview", auth, upload.single("file"), async (req, res) => {
  try {
    const csv = await fileToCsv(req.file);
    res.json(await tb.preview(req.user.id, { csv, memberId: req.body?.member_id || null }));
  } catch (e) { sendError(res, e, e.status); }
});

router.post("/commit", auth, auditImport("TRADEBOOK"), upload.single("file"), async (req, res) => {
  try {
    const csv = await fileToCsv(req.file);
    const out = await tb.commit(req.user.id, { csv, memberId: req.body?.member_id || null, filename: req.file.originalname });
    res.locals.importStats = { rowsIn: out.fills_parsed, rowsOk: out.inserted, rowsFailed: out.errors.length };
    res.json(out);
  } catch (e) { sendError(res, e, e.status); }
});

export default router;
