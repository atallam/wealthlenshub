/**
 * routes/import_cas.js
 * -------------------
 * NEW parallel CAS import route using the casparser Python library.
 * Does NOT modify or replace routes/import.js — existing functionality untouched.
 *
 * Routes:
 *   POST /api/import/detect-casparser   — parse CAS PDF via Python casparser
 *
 * Response shape matches /api/import/detect so the frontend can use
 * the same matching/import flow.
 */

import { Router }             from "express";
import multer                 from "multer";
import { spawn }              from "child_process";
import { writeFile, unlink }  from "fs/promises";
import { join }               from "path";
import { tmpdir }             from "os";
import { randomBytes, createHash } from "crypto";
import { fileURLToPath }      from "url";
import { dirname }            from "path";

import { auth, sendError, uploadLimiter } from "../lib/auth.js";
import { allowExtensions } from "../lib/uploads.js";
import { decrypt }            from "../lib/crypto.js";
import { auditImport }        from "../lib/importLogger.js";
import { getUnlockContextRows } from "../services/import.service.js";
import { getAmfiList } from "../lib/prices.js";
import { enrichMfFromAmfi, reclassifyDematEtfs } from "../lib/casEnrich.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: allowExtensions(["pdf"]),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build list of PAN candidates + pan→memberId map (mirrors casUnlockContext in import.js). */
async function unlockContext(req) {
  const typed = (req.body?.password || "").trim();
  const candidates = typed ? [typed] : [];
  const panToMember = new Map();

  const safeDecrypt = (enc) => {
    try {
      const p = decrypt(enc);
      return p && p !== "[encrypted]" ? p.toUpperCase().trim() : "";
    } catch { return ""; }
  };

  const { prof, port } = await getUnlockContextRows(req.user.id);

  if (prof?.encrypted_pan) {
    const pan = safeDecrypt(prof.encrypted_pan);
    if (pan) candidates.push(pan);
  }
  for (const m of port?.members || []) {
    if (!m?.encrypted_pan) continue;
    const pan = safeDecrypt(m.encrypted_pan);
    if (pan) { panToMember.set(pan, m.id); candidates.push(pan); }
  }

  return { candidates: [...new Set(candidates)], typed: !!typed, panToMember };
}

/** Map holder names → member IDs using extracted PANs. */
function mapHolders(holderNames = [], holderPans = [], panToMember) {
  const map = {};
  holderNames.forEach((name, i) => {
    const pan = (holderPans[i] || "").toUpperCase().trim();
    const memberId = pan && panToMember.get(pan);
    if (memberId) map[name] = memberId;
  });
  // Fallback for single holder
  if (Object.keys(map).length === 0 && holderNames.length === 1) {
    for (const rawPan of holderPans) {
      const memberId = panToMember.get((rawPan || "").toUpperCase().trim());
      if (memberId) { map[holderNames[0]] = memberId; break; }
    }
  }
  return map;
}

/**
 * Run the Python casparser service on a PDF file and return parsed JSON.
 * `password` may be a string or an array of candidates — the script tries them
 * in order inside ONE process (previously each candidate re-spawned Python and
 * re-parsed the PDF: a 4-member family meant up to 5 full parses).
 */
function runCasparser(pdfPath, password) {
  return new Promise((resolve, reject) => {
    const scriptPath = join(__dirname, "..", "services", "cas_casparser_service.py");
    const pwArg = Array.isArray(password) ? JSON.stringify(password) : (password ?? "");

    // Try python3 first, fall back to python
    const pythonBin = process.platform === "win32" ? "python" : "python3";

    const child = spawn(pythonBin, [scriptPath, pdfPath, pwArg], {
      timeout: 60_000,   // 60 s limit
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("error", (err) => {
      // If python3 not found on Windows, try python
      if (err.code === "ENOENT" && pythonBin === "python3") {
        const child2 = spawn("python", [scriptPath, pdfPath, pwArg], {
          timeout: 60_000,
          env: { ...process.env },
        });
        let out2 = "", err2 = "";
        child2.stdout.on("data", (c) => { out2 += c.toString(); });
        child2.stderr.on("data", (c) => { err2 += c.toString(); });
        child2.on("error", (e2) => reject(new Error(`Python not found: ${e2.message}`)));
        child2.on("close", (code) => {
          if (code !== 0 && !out2.trim()) {
            return reject(new Error(`casparser service exited ${code}: ${err2.slice(0, 300)}`));
          }
          try { resolve(JSON.parse(out2)); }
          catch { reject(new Error(`Invalid JSON from casparser: ${out2.slice(0, 200)}`)); }
        });
      } else {
        reject(new Error(`Spawn error: ${err.message}`));
      }
    });

    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        return reject(new Error(`casparser service exited ${code}: ${stderr.slice(0, 300)}`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Invalid JSON from casparser: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

// ── Route: POST /detect-casparser ────────────────────────────────────────────

router.post(
  "/detect-casparser",
  auth,
  uploadLimiter,
  auditImport("CASPARSER_DETECT"),
  upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const ext = req.file.originalname.split(".").pop().toLowerCase();
    if (ext !== "pdf") {
      return res.status(400).json({ error: "casparser only supports PDF files" });
    }

    // Write the uploaded PDF to a temp file (Python subprocess needs a file path)
    const tmpFile = join(tmpdir(), `cas_${randomBytes(8).toString("hex")}.pdf`);
    try {
      await writeFile(tmpFile, req.file.buffer);
    } catch (e) {
      return res.status(500).json({ error: `Failed to write temp file: ${e.message}` });
    }

    try {
      const { candidates, typed, panToMember } = await unlockContext(req);

      // One Python process tries "" (unprotected), the typed password, then every stored PAN.
      const passwordsToTry = ["", ...candidates];
      let result = null;
      try {
        const parsed = await runCasparser(tmpFile, passwordsToTry);
        if (parsed.error === "password_incorrect" || parsed.error === "password_required") {
          result = null;
        } else if (parsed.error) {
          await unlink(tmpFile).catch(() => {});
          return res.status(400).json({ error: parsed.error });
        } else {
          result = parsed;
        }
      } catch (spawnErr) {
        await unlink(tmpFile).catch(() => {});
        return res.status(500).json({
          error: `Smart Parser unavailable: ${spawnErr.message}. Ensure Python + casparser are installed.`,
        });
      }

      await unlink(tmpFile).catch(() => {});

      if (!result) {
        // All passwords failed
        if (typed) {
          return res.status(400).json({ error: "password_incorrect", message: "Incorrect password. Check your PAN (uppercase).", needs_password: true });
        }
        if (candidates.length) {
          return res.status(400).json({ error: "password_required", message: "None of your saved PANs unlock this PDF. Enter the holder's PAN.", needs_password: true });
        }
        return res.status(400).json({ error: "password_required", message: "This PDF is password-protected. Enter your PAN to unlock.", needs_password: true });
      }

      // Demat MFs arrive as "HDFC MUTUAL FUND" (AMC only) - resolve the scheme by ISIN.
      // Best effort and time-boxed: a slow AMFI download must never stall or fail an import.
      let amfi = [];
      try {
        amfi = await Promise.race([getAmfiList(), new Promise((r) => setTimeout(() => r([]), 6000))]);
        // Re-type demat ETFs first so they never get an AMFI scheme_code/NAV.
        const e = reclassifyDematEtfs(result.holdings || [], amfi);
        if (e) console.log(`[import_cas] reclassified ${e} demat ETF row(s) MF -> IN_ETF`);
        const n = enrichMfFromAmfi(result.holdings || [], amfi);
        if (n) console.log(`[import_cas] AMFI enrichment: ${n} MF row(s) named/coded by ISIN`);
      } catch (err) { console.warn("[import_cas] AMFI enrichment skipped:", err.message); }
      // ETF re-typing must not depend on the AMFI download succeeding.
      try { reclassifyDematEtfs(result.holdings || [], amfi); } catch { /* best effort */ }

      // Content hash → idempotent re-imports (see casImport.service findPriorImport)
      const statementHash = createHash("sha256").update(req.file.buffer).digest("hex");

      // Build holder→member map using stored PANs
      const holderMemberMap = mapHolders(
        result.holder_names || [],
        result.holder_pans  || [],
        panToMember,
      );

      return res.json({
        holdings:          result.holdings          || [],
        holder_names:      result.holder_names      || [],
        holder_pans:       result.holder_pans       || [],
        format:            result.format            || "CAS (casparser)",
        warnings:          result.warnings          || [],
        reconciliation:    result.reconciliation    || null,
        statement_date:    result.statement_date    || null,
        period_start:      result.period_start      || null,
        period_end:        result.period_end        || null,
        depository:        result.depository        || "",
        statement_hash:    statementHash,
        holder_member_map: holderMemberMap,
        _parser:           "casparser",
      });
    } catch (err) {
      await unlink(tmpFile).catch(() => {});
      console.error("[import_cas] detect-casparser error:", err);
      return sendError(res, err);
    }
  },
);

export default router;
