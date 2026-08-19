
Gmail · JS
import { Router }          from "express";
import crypto              from "crypto";
import { spawn }           from "child_process";
import { writeFile, unlink } from "fs/promises";
import { join, dirname }   from "path";
import { tmpdir }          from "os";
import { fileURLToPath }   from "url";
import { google }          from "googleapis";
import { supabase }        from "../lib/db.js";
import { auth, sendError } from "../lib/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";
// OLD parser — kept for reference; casparser is used instead (see runCasparser below)
// import { pdfjsLib, _pdfjsFontPath, parseNSDLCASStatement } from "../lib/parsers.js";
 
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
 
const router = Router();
 
// ── OAuth state signing ──────────────────────────────────────────────────────
const STATE_SECRET = process.env.GMAIL_STATE_SECRET || process.env.GMAIL_CLIENT_SECRET || "";
function signState(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", STATE_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function verifyState(state, maxAgeMs = 10 * 60 * 1000) {
  const [payload, sig] = String(state).split(".");
  if (!payload || !sig) throw new Error("Malformed OAuth state");
  const expected = crypto.createHmac("sha256", STATE_SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("Invalid OAuth state signature");
  const { userId, ts } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!userId || !ts || Date.now() - ts > maxAgeMs) throw new Error("Expired OAuth state");
  return { userId };
}
 
const GMAIL_ENABLED = !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
 
// Subject keywords used to find CAS emails.
const CAS_SUBJECT_KEYWORDS = [
  "Consolidated Account Statement",
  "CAS Statement",
  "NSDL e-CAS",
  "CDSL CAS",
  "eCAS Statement",
  "Consolidated Mutual Fund Statement",
  "CAS",
];
 
// ── Smart CAS parser (Python casparser library) ───────────────────────────────
function runCasparser(pdfPath, password) {
  return new Promise((resolve, reject) => {
    const scriptPath = join(__dirname, "..", "services", "cas_casparser_service.py");
    const pythonBin  = process.platform === "win32" ? "python" : "python3";
 
    function spawnWith(bin) {
      const child = spawn(bin, [scriptPath, pdfPath, password ?? ""], {
        timeout: 60_000,
        env: { ...process.env },
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", (c) => { stdout += c.toString(); });
      child.stderr.on("data", (c) => { stderr += c.toString(); });
      child.on("error", (err) => {
        if (err.code === "ENOENT" && bin === "python3") {
          spawnWith("python").then(resolve).catch(reject);
        } else {
          reject(new Error(`Python spawn error: ${err.message}`));
        }
      });
      child.on("close", (code) => {
        if (code !== 0 && !stdout.trim()) {
          return reject(new Error(`casparser exited ${code}: ${stderr.slice(0, 300)}`));
        }
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error(`Invalid JSON from casparser: ${stdout.slice(0, 200)}`)); }
      });
    }
 
    spawnWith(pythonBin);
  });
}
 
function makeGmailOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || `${process.env.RENDER_EXTERNAL_URL || "http://localhost:3000"}/api/gmail/callback`
  );
}
 
async function getGmailClientForUser(userId) {
  const { data: profile } = await supabase.from("profiles").select("gmail_token").eq("id", userId).single();
  if (!profile?.gmail_token) throw new Error("Gmail not connected");
  const tokenData = JSON.parse(decrypt(profile.gmail_token));
  const oauth2 = makeGmailOAuth2Client();
  oauth2.setCredentials(tokenData);
  oauth2.on("tokens", async (tokens) => {
    if (tokens.refresh_token || tokens.access_token) {
      const merged = { ...tokenData, ...tokens };
      await supabase.from("profiles").update({ gmail_token: encrypt(JSON.stringify(merged)) }).eq("id", userId);
    }
  });
  return oauth2;
}
 
async function getMemberPANMap(userId) {
  const { data: portfolio } = await supabase.from("portfolio").select("members").eq("user_id", userId).single();
  const members = portfolio?.members || [];
  const panMap = new Map();
  const nameMap = new Map();
  for (const m of members) {
    if (m.encrypted_pan) {
      try {
        const pan = decrypt(m.encrypted_pan).toUpperCase().trim();
        if (pan && pan !== "[encrypted]") {
          panMap.set(pan, m);
        } else {
          console.warn(`[gmail-cas] Member "${m.name}" encrypted_pan decrypted to empty/placeholder — skipping PAN map entry`);
        }
      } catch (err) {
        console.warn(`[gmail-cas] Could not decrypt PAN for member "${m.name}" (${m.id}): ${err.message}`);
      }
    }
    if (m.name) nameMap.set(m.name.trim().toUpperCase(), m);
  }
  console.log(`[gmail-cas] ${userId}: panMap has ${panMap.size} entries, nameMap has ${nameMap.size} entries`);
  return { members, panMap, nameMap };
}
 
export async function checkCasEmail(userId) {
  return autoImportCASForUser(userId);
}
 
async function autoImportCASForUser(userId) {
  const summary = { checked: 0, imported: 0, updated: 0, skipped: 0, errors: [] };
  try {
    const oauth2 = await getGmailClientForUser(userId);
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
 
    const { members, panMap, nameMap } = await getMemberPANMap(userId);
    const { data: profile } = await supabase.from("profiles").select("encrypted_pan, encrypted_dob").eq("id", userId).single();
    const primaryPAN = profile?.encrypted_pan ? decrypt(profile.encrypted_pan) : null;
 
    const allPANs = [...new Set([...(primaryPAN ? [primaryPAN.toUpperCase()] : []), ...Array.from(panMap.keys())])];
 
    const subjectQuery = CAS_SUBJECT_KEYWORDS.map(s => `subject:"${s}"`).join(" OR ");
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: `(${subjectQuery}) has:attachment filename:pdf`,
      maxResults: 50,
    });
    const messages = listRes.data.messages || [];
    summary.checked = messages.length;
 
    // Only skip emails that were successfully imported — errors/skips are retried on next check.
    const { data: processed } = await supabase.from("email_imports").select("email_id").eq("user_id", userId).eq("status", "success");
    const processedIds = new Set((processed || []).map(r => r.email_id));
 
    for (const msg of messages) {
      if (processedIds.has(msg.id)) { summary.skipped++; continue; }
      let importRecord = { user_id: userId, email_id: msg.id, status: "pending" };
      try {
        const fullMsg = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "full" });
        const headers = fullMsg.data.payload?.headers || [];
        importRecord.email_from    = headers.find(h => h.name === "From")?.value || "";
        importRecord.email_subject = headers.find(h => h.name === "Subject")?.value || "";
        importRecord.email_date    = new Date(parseInt(fullMsg.data.internalDate)).toISOString();
 
        const allParts = [];
        const flatten = ps => { for (const p of ps) { allParts.push(p); if (p.parts) flatten(p.parts); } };
        flatten(fullMsg.data.payload?.parts || []);
        const pdfPart = allParts.find(p => p.mimeType === "application/pdf" || (p.filename||"").toLowerCase().endsWith(".pdf"));
        if (!pdfPart) { importRecord.status = "skipped"; importRecord.error_message = "No PDF attachment"; summary.skipped++; continue; }
 
        let pdfBuffer;
        const attachmentId = pdfPart.body?.attachmentId;
        if (attachmentId) {
          const attRes = await gmail.users.messages.attachments.get({ userId: "me", messageId: msg.id, id: attachmentId });
          pdfBuffer = Buffer.from(attRes.data.data, "base64url");
        } else if (pdfPart.body?.data) {
          pdfBuffer = Buffer.from(pdfPart.body.data, "base64url");
        } else { importRecord.status = "skipped"; importRecord.error_message = "Cannot read attachment"; summary.skipped++; continue; }
 
        // ── Smart CAS parser (casparser) ─────────────────────────────────────
        const tmpFile = join(tmpdir(), `cas_${crypto.randomBytes(8).toString("hex")}.pdf`);
        await writeFile(tmpFile, pdfBuffer);
 
        let parseResult = null;
        const passwordsToTry = ["", ...allPANs];
        for (const pwd of passwordsToTry) {
          try {
            const parsed = await runCasparser(tmpFile, pwd);
            if (parsed.error === "password_incorrect" || parsed.error === "password_required") continue;
            if (parsed.error) {
              importRecord.status        = "skipped";
              importRecord.error_message = `casparser: ${parsed.error}`;
              summary.skipped++;
              break;
            }
            parseResult = parsed;
            break;
          } catch (spawnErr) {
            importRecord.status        = "error";
            importRecord.error_message = `Smart parser unavailable: ${spawnErr.message}`;
            summary.errors.push(importRecord.error_message);
            break;
          }
        }
        await unlink(tmpFile).catch(() => {});
 
        if (!parseResult) {
          if (!importRecord.status || importRecord.status === "pending") {
            importRecord.status = "error";
            importRecord.error_message =
              "Could not decrypt PDF — ensure the PAN for every family member " +
              "is saved in Settings → Members.";
            summary.errors.push(importRecord.error_message);
          }
          continue;
        }
        if (!parseResult.holdings?.length) { importRecord.status = "skipped"; importRecord.error_message = "No holdings found in CAS"; summary.skipped++; continue; }
 
        // CAS period metadata
        const casPeriodStart = parseResult.period_start || null;
        const casPeriodEnd   = parseResult.period_end   || parseResult.statement_date || null;
        const sourceDate     = casPeriodEnd;
 
        // ── Per-account member matching (keyed by _pan on each holding) ─────
        // casparser sets _pan = the account-specific owner PAN on every holding.
        // An NSDL family CAS has multiple accounts (one per member), each with its
        // own _pan. Grouping by _pan lets each member's holdings be matched and
        // written independently — fixing the bug where all accounts mapped to the
        // primary holder (holder_pans[0]) and overwrote each other.
        const holdingsByPan = new Map();
        for (const h of parseResult.holdings) {
          const pan = (h._pan || "").toUpperCase().trim() || "__no_pan__";
          if (!holdingsByPan.has(pan)) holdingsByPan.set(pan, []);
          holdingsByPan.get(pan).push(h);
        }
        console.log(`[gmail-cas] ${userId}: CAS has ${holdingsByPan.size} PAN group(s): ${[...holdingsByPan.keys()].join(", ")}`);
 
        let totalAdded = 0;
        const matchedMembers = [];
 
        for (const [pan, panHoldings] of holdingsByPan) {
          // 1. Exact PAN lookup
          let targetMember = null;
          let matchedBy    = null;
          if (pan !== "__no_pan__" && panMap.has(pan)) {
            targetMember = panMap.get(pan);
            matchedBy    = "pan";
          }
 
          // 2. Fallback: match by holder name on the first holding in this group
          if (!targetMember) {
            const holderName = (panHoldings[0]?._holder_name || "").trim().toUpperCase();
            if (holderName && nameMap.has(holderName)) {
              targetMember = nameMap.get(holderName);
              matchedBy    = "name";
            }
          }
 
          // 3. No match — log and SKIP (never silently assign to self)
          if (!targetMember) {
            const label = pan === "__no_pan__" ? "(no PAN)" : pan;
            console.warn(
              `[gmail-cas] ${userId}: no member matched for PAN ${label} ` +
              `(${panHoldings.length} holdings) — skipping. ` +
              `Add this PAN to a family member in Settings → Members.`
            );
            summary.errors.push(
              `No member matched for PAN ${label} — ${panHoldings.length} holdings skipped. ` +
              `Add the PAN in Settings → Members.`
            );
            continue;
          }
 
          const memberId = targetMember.id;
          console.log(`[gmail-cas] ${userId}: PAN ${pan} → member "${targetMember.name}" (${memberId}) via ${matchedBy} — ${panHoldings.length} holdings`);
          matchedMembers.push({ memberId, memberName: targetMember.name, pan, matchedBy, count: panHoldings.length });
 
          // ── Flush-and-fill scoped to this member only ──────────────────────
          const { error: delErr } = await supabase.from("holdings")
            .delete()
            .eq("user_id",   userId)
            .eq("source",    "cas")
            .eq("member_id", memberId);
          if (delErr) throw new Error(`Failed to flush CAS holdings for member ${memberId}: ${delErr.message}`);
 
          // Defensive: also remove legacy gmail_auto rows that predate the source column
          await supabase.from("holdings")
            .delete()
            .eq("user_id",       userId)
            .eq("import_method", "gmail_auto")
            .eq("member_id",     memberId)
            .is("source",        null);
 
          const now = new Date().toISOString();
          const toInsert = panHoldings.map(h => ({
            id:               `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            user_id:          userId,
            member_id:        memberId,
            type:             h.type || "MF",
            name:             h.name,
            ticker:           h.ticker || null,
            scheme_code:      h.scheme_code || null,
            units:            h.units || 0,
            purchase_nav:     h.purchase_nav || null,
            current_nav:      h.current_nav || h.purchase_nav || null,
            purchase_value:   h.purchase_value || 0,
            current_value:    h.units * (h.current_nav || h.purchase_nav || 0),
            start_date:       h.start_date || null,
            source:           "cas",
            import_method:    "gmail_auto",
            source_date:      sourceDate,
            cas_period_start: casPeriodStart,
            cas_period_end:   casPeriodEnd,
            created_at:       now,
          }));
 
          const CHUNK = 100;
          for (let i = 0; i < toInsert.length; i += CHUNK) {
            const { error: insErr } = await supabase.from("holdings").insert(toInsert.slice(i, i + CHUNK));
            if (insErr) throw new Error(`holdings insert error (member ${memberId}): ${insErr.message}`);
          }
          totalAdded += toInsert.length;
        }
 
        const added = totalAdded;
        importRecord.status           = "success";
        importRecord.holdings_added   = added;
        importRecord.holdings_updated = 0;
        importRecord.holdings_skipped = 0;
        importRecord.matched_members  = JSON.stringify(matchedMembers);
        summary.imported += added;
      } catch (err) {
        importRecord.status = "error"; importRecord.error_message = err.message;
        summary.errors.push(err.message);
      } finally {
        await supabase.from("email_imports").upsert(importRecord, { onConflict: "user_id,email_id" });
        await supabase.from("profiles").update({ gmail_last_check: new Date().toISOString() }).eq("id", userId);
      }
    }
  } catch (err) {
    summary.errors.push(err.message);
    console.error(`autoImportCAS failed for ${userId}:`, err.message);
  }
  return summary;
}
 
router.get("/auth", auth, async (req, res) => {
  if (!GMAIL_ENABLED) return res.status(501).json({ error: "Gmail integration not configured" });
  const oauth2 = makeGmailOAuth2Client();
  const url = oauth2.generateAuthUrl({
    access_type: "offline", prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
    state: signState(req.user.id),
  });
  res.json({ url });
});
 
router.get("/callback", async (req, res) => {
  if (!GMAIL_ENABLED) return res.status(501).send("Gmail not configured");
  const { code, state, error: oauthError } = req.query;
  if (oauthError) return res.redirect(`/?gmail_error=${encodeURIComponent(oauthError)}`);
  if (!code || !state) return res.status(400).send("Missing code or state");
  let userId;
  try {
    ({ userId } = verifyState(state));
  } catch (e) {
    return res.redirect(`/?gmail_error=${encodeURIComponent(e.message)}`);
  }
  try {
    const oauth2 = makeGmailOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const gmailProfile = await gmail.users.getProfile({ userId: "me" });
    await supabase.from("profiles").update({
      gmail_token: encrypt(JSON.stringify(tokens)),
      gmail_email: gmailProfile.data.emailAddress,
      gmail_connected_at: new Date().toISOString(),
      gmail_auto_import: true,
    }).eq("id", userId);
    res.redirect("/?gmail_connected=1");
  } catch (err) { res.redirect(`/?gmail_error=${encodeURIComponent(err.message)}`); }
});
 
router.get("/status", auth, async (req, res) => {
  const { data: prof } = await supabase.from("profiles").select("gmail_email,gmail_connected_at,gmail_last_check,gmail_auto_import,gmail_token").eq("id", req.user.id).single();
  const { data: imports } = await supabase.from("email_imports").select("status,holdings_added,holdings_updated,processed_at").eq("user_id", req.user.id).order("processed_at", { ascending: false }).limit(10);
  res.json({ enabled: GMAIL_ENABLED, connected: !!(prof?.gmail_token), gmail_email: prof?.gmail_email || null, connected_at: prof?.gmail_connected_at || null, last_check: prof?.gmail_last_check || null, auto_import: prof?.gmail_auto_import ?? true, recent_imports: imports || [] });
});
 
router.delete("/disconnect", auth, async (req, res) => {
  try {
    const { data: prof } = await supabase.from("profiles").select("gmail_token").eq("id", req.user.id).single();
    if (prof?.gmail_token) { try { const t = JSON.parse(decrypt(prof.gmail_token)); const o = makeGmailOAuth2Client(); o.setCredentials(t); await o.revokeCredentials(); } catch {} }
    await supabase.from("profiles").update({ gmail_token: null, gmail_email: null, gmail_connected_at: null, gmail_auto_import: false }).eq("id", req.user.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 
router.post("/toggle-auto", auth, async (req, res) => {
  await supabase.from("profiles").update({ gmail_auto_import: !!req.body.enabled }).eq("id", req.user.id);
  res.json({ ok: true });
});
 
router.post("/check-now", auth, async (req, res) => {
  if (!GMAIL_ENABLED) return res.status(501).json({ error: "Gmail integration not configured" });
  res.json(await autoImportCASForUser(req.user.id));
});
 
export default router;
 
