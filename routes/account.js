import { Router } from "express";
import { auth, strictLimiter, sendError } from "../lib/auth.js";
import * as account from "../services/account.service.js";

const router = Router();

// DELETE /api/account  { confirm_email }
// Permanently erases the signed-in user's data and login. The caller must type their own
// account email, so a stray click or a stolen-but-idle tab can't do it by accident.
router.delete("/", auth, strictLimiter, async (req, res) => {
  const typed = String(req.body?.confirm_email || "").trim().toLowerCase();
  const actual = String(req.user?.email || "").trim().toLowerCase();
  if (!actual || typed !== actual) {
    return res.status(400).json({ error: "Type your account email address to confirm." });
  }
  try {
    res.locals.skipAudit = true;     // the audit trail is being erased with the account
    const result = await account.deleteAccount(req.user.id);
    res.json({ ok: true, deleted_tables: Object.keys(result.deleted).length, files_removed: result.files });
  } catch (e) {
    console.error("[account] delete failed:", e.message);
    if (e.failed) return res.status(500).json({ error: "Could not delete all your data. Your login was kept - please try again.", failed: e.failed });
    sendError(res, e);
  }
});

export default router;
