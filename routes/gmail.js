import { Router }          from "express";
import crypto              from "crypto";
import { writeFile, unlink } from "fs/promises";
import { join, dirname }   from "path";
import { tmpdir }          from "os";
import { fileURLToPath }   from "url";
import { google }          from "googleapis";
import { supabase }        from "../lib/db.js";
import { auth, sendError } from "../lib/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { runCasparser }    from "./import_v2.js";
import { applyCasImport, findPriorImport } from "../services/casImport.service.js";
import { takeSnapshot }    from "../lib/snapshot.js";
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

// ── In-process job store for fire-and-forget gmail check-now (P1-1) ─────────
// Keyed by UUID job_id. Entries are never deleted — in-process Map resets on
// restart, which is fine for a short-lived background task. Upgrade to Supabase
// if persistence across restarts is needed (see P2-3 in backlog).
const pendingJobs = new Map();

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

// Smart CAS parser: shared runCasparser() from routes/import_v2.js (single-process password attempts).

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
  const maskedKeys = [...panMap.keys()].map(p => p.slice(0, 5) + "***" + p.slice(-1));
  console.log(`[gmail-cas] ${userId}: panMap has ${panMap.size} entries: [${maskedKeys.join(", ")}], nameMap has ${nameMap.size} entries`);
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
        try {
          const parsed = await runCasparser(tmpFile, ["", ...allPANs]);
          if (parsed.error === "password_incorrect" || parsed.error === "password_required") {
            parseResult = null;
          } else if (parsed.error) {
            importRecord.status        = "skipped";
            importRecord.error_message = `casparser: ${parsed.error}`;
            summary.skipped++;
          } else {
            parseResult = parsed;
          }
        } catch (spawnErr) {
          importRecord.status        = "error";
          importRecord.error_message = `Smart parser unavailable: ${spawnErr.message}`;
          summary.errors.push(importRecord.error_message);
        }
        await unlink(tmpFile).catch(() => {});

        // Same PDF already applied (e.g. NSDL re-sends the monthly mail)? Mark success and move on.
        const statementHash = crypto.createHash("sha256").update(pdfBuffer).digest("hex");
        if (parseResult) {
          const prior = await findPriorImport(userId, statementHash);
          if (prior) {
            importRecord.status = "success"; importRecord.holdings_added = 0; importRecord.holdings_updated = 0;
            importRecord.error_message = `Duplicate of statement imported ${prior.created_at}`;
            summary.skipped++;
            continue;
          }
        }

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

        // Resolve each PAN group to a member, then hand everything to ONE atomic
        // apply_cas_snapshot() call (services/casImport.service.js). Unmatched
        // groups are logged and skipped — never silently assigned to self.
        const matchedMembers = [];
        const accountMap = {};          // holder name → member id
        const holdingsToApply = [];

        for (const [pan, panHoldings] of holdingsByPan) {
          let targetMember = null;
          let matchedBy    = null;
          if (pan !== "__no_pan__" && panMap.has(pan)) { targetMember = panMap.get(pan); matchedBy = "pan"; }
          if (!targetMember) {
            const holderName = (panHoldings[0]?._holder_name || "").trim().toUpperCase();
            if (holderName && nameMap.has(holderName)) { targetMember = nameMap.get(holderName); matchedBy = "name"; }
          }
          if (!targetMember) {
            const label = pan === "__no_pan__" ? "(no PAN)" : pan;
            console.warn(`[gmail-cas] ${userId}: no member matched for PAN ${label} (${panHoldings.length} holdings) — skipping. Add this PAN to a family member in Settings → Members.`);
            summary.errors.push(`No member matched for PAN ${label} — ${panHoldings.length} holdings skipped. Add the PAN in Settings → Members.`);
            continue;
          }
          console.log(`[gmail-cas] ${userId}: PAN ${pan} → member "${targetMember.name}" (${targetMember.id}) via ${matchedBy} — ${panHoldings.length} holdings`);
          matchedMembers.push({ memberId: targetMember.id, memberName: targetMember.name, pan, matchedBy, count: panHoldings.length });
          // Key the account_map by a synthetic holder token so two PAN groups with the
          // same display name can still map to different members.
          const token = `__pan__${pan}`;
          accountMap[token] = targetMember.id;
          for (const h of panHoldings) holdingsToApply.push({ ...h, _holder_name: token });
        }

        let totalAdded = 0, totalUpdated = 0;
        if (holdingsToApply.length) {
          const result = await applyCasImport(userId, {
            holdings:           holdingsToApply,
            account_map:        accountMap,
            depository:         parseResult.depository,
            cas_statement_date: sourceDate,
            cas_period_start:   casPeriodStart,
            cas_period_end:     casPeriodEnd,
            statement_hash:     statementHash,
            import_method:      "gmail_auto",
          });
          totalAdded   = result.inserted_count || 0;
          totalUpdated = result.updated_count  || 0;
          console.log(`[gmail-cas] ${userId}: ${parseResult.depository} ${sourceDate}: +${totalAdded} new, ${totalUpdated} updated, ${result.exited_count || 0} exited, ${result.legacy_retired || 0} legacy retired`);
          takeSnapshot(userId, { source: "cas_import", cas_statement_date: sourceDate }).catch(() => {});
        }

        const added = totalAdded;
        importRecord.status           = "success";
        importRecord.holdings_added   = added;
        importRecord.holdings_updated = totalUpdated;
        importRecord.holdings_skipped = 0;
        importRecord.matched_members  = JSON.stringify(matchedMembers);
        summary.imported += added;
      } catch (err) {
        importRecord.status = "error"; importRecord.error_message = err.message;
        summary.errors.push(err.message);
      } finally {
        // Always stamp processed_at so upsert updates it on conflict too
        importRecord.processed_at = new Date().toISOString();
        const { error: upsertErr } = await supabase
          .from("email_imports")
          .upsert(importRecord, { onConflict: "user_id,email_id" });
        if (upsertErr) {
          // Surface DB errors (e.g. missing column) so they don't silently
          // prevent emails being marked success and cause infinite re-imports.
          console.error(`[gmail-cas] email_imports upsert failed for ${msg.id}:`, upsertErr.message);
          summary.errors.push(`DB upsert error: ${upsertErr.message}`);
        }
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

// ── Fire-and-forget check-now (P1-1) ─────────────────────────────────────────
// autoImportCASForUser can take 2-5 min (PDF fetch + casparser).
// Responding synchronously would exceed Render's 30 s request timeout.
// Solution: return a job_id immediately, run the import in the background,
// and let the client poll GET /gmail/job/:id for the result.
router.post("/check-now", auth, async (req, res) => {
  if (!GMAIL_ENABLED) return res.status(501).json({ error: "Gmail integration not configured" });
  const jobId = crypto.randomUUID();
  pendingJobs.set(jobId, { status: "running", startedAt: Date.now() });
  autoImportCASForUser(req.user.id)
    .then(result => pendingJobs.set(jobId, {
      status: "done",
      result,
      startedAt: pendingJobs.get(jobId)?.startedAt,
      completedAt: Date.now(),
    }))
    .catch(err => pendingJobs.set(jobId, {
      status: "error",
      error: err.message,
      startedAt: pendingJobs.get(jobId)?.startedAt,
      completedAt: Date.now(),
    }));
  res.json({ started: true, job_id: jobId });
});

router.get("/job/:id", auth, (req, res) => {
  const job = pendingJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found or already expired" });
  res.json(job);
});

export default router;