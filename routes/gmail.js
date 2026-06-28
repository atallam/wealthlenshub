import { Router } from "express";
import { google } from "googleapis";
import { supabase } from "../lib/db.js";
import { auth, sendError } from "../lib/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { pdfjsLib, _pdfjsFontPath, parseNSDLCASStatement } from "../lib/parsers.js";

const router = Router();

const GMAIL_ENABLED = !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);

const CAS_SENDERS = [
  "cas@nsdl.co.in", "casrequest@cams.com", "mfcentral@nsdl.co.in",
  "kfintech@kfintech.com", "nsdl@nsdl.co.in",
];

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
      try { const pan = decrypt(m.encrypted_pan).toUpperCase().trim(); if (pan && pan !== "[encrypted]") panMap.set(pan, m); } catch {}
    }
    if (m.name) nameMap.set(m.name.trim().toUpperCase(), m);
  }
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
    const primaryDOB = profile?.encrypted_dob ? decrypt(profile.encrypted_dob) : null;

    const allPANs = [...new Set([...(primaryPAN ? [primaryPAN.toUpperCase()] : []), ...Array.from(panMap.keys())])];
    const allPasswords = [];
    for (const pan of allPANs) {
      allPasswords.push(pan);
      if (primaryDOB) {
        const dobStr = primaryDOB.replace(/-/g, "");
        if (dobStr.length === 8) allPasswords.push(pan + dobStr.slice(6,8) + dobStr.slice(4,6) + dobStr.slice(0,4));
      }
    }

    const fromQuery = CAS_SENDERS.map(s => `from:${s}`).join(" OR ");
    const listRes = await gmail.users.messages.list({ userId: "me", q: `(${fromQuery}) has:attachment filename:pdf`, maxResults: 20 });
    const messages = listRes.data.messages || [];
    summary.checked = messages.length;

    const { data: processed } = await supabase.from("email_imports").select("email_id").eq("user_id", userId);
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

        let rawText = null, succeededPAN = null;
        const tryPasswords = allPasswords.length ? allPasswords : [""];
        for (const pwd of tryPasswords) {
          try {
            const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), standardFontDataUrl: _pdfjsFontPath, useSystemFonts: true });
            loadingTask.onPassword = (cb, reason) => { if (reason === 2) cb(new Error("wrong")); else cb(pwd); };
            const pdf = await loadingTask.promise;
            const pages = [];
            for (let i = 1; i <= pdf.numPages; i++) {
              pages.push(pdf.getPage(i).then(pg => pg.getTextContent()).then(c => {
                return c.items.sort((a,b) => Math.round(b.transform[5])-Math.round(a.transform[5]) || a.transform[4]-b.transform[4]).map(it => it.str).join(" ") + "\n";
              }));
            }
            rawText = (await Promise.all(pages)).join("\n");
            succeededPAN = pwd.slice(0, 10);
            break;
          } catch { /* try next */ }
        }
        if (!rawText) { importRecord.status = "error"; importRecord.error_message = "Could not decrypt — add member PANs in Settings"; summary.errors.push(importRecord.error_message); continue; }
        if (!/consolidated\s*account\s*statement|nsdl|cdsl/i.test(rawText)) { importRecord.status = "skipped"; importRecord.error_message = "Not a CAS statement"; summary.skipped++; continue; }

        const parseResult = parseNSDLCASStatement(rawText);
        if (!parseResult.holdings?.length) { importRecord.status = "skipped"; importRecord.error_message = "No holdings found in CAS"; summary.skipped++; continue; }

        const pdfHolderPANs  = (parseResult.holder_pans  || []).map(p => p.toUpperCase());
        const pdfHolderNames = (parseResult.holder_names || []).map(n => n.trim().toUpperCase());

        let targetMember = null;
        for (const pan of pdfHolderPANs) { if (panMap.has(pan)) { targetMember = panMap.get(pan); break; } }
        if (!targetMember) { for (const name of pdfHolderNames) { if (nameMap.has(name)) { targetMember = nameMap.get(name); break; } } }
        if (!targetMember) { targetMember = members.find(m => (m.relation||"").toLowerCase() === "self") || members[0]; }
        const memberId = targetMember?.id || "self";

        const { data: existing } = await supabase.from("holdings").select("id, name, scheme_code, ticker, units").eq("user_id", userId);
        const existMap = new Map();
        for (const h of existing || []) { const k = (h.scheme_code || h.ticker || h.name || "").toLowerCase(); if (k) existMap.set(k, h); }

        let added = 0, updated = 0, skipped = 0;
        const now = new Date().toISOString();
        for (const h of parseResult.holdings) {
          const key = (h.scheme_code || h.ticker || h.name || "").toLowerCase();
          const match = key ? existMap.get(key) : null;
          if (match) {
            const diff = Math.abs((match.units || 0) - (h.units || 0));
            if (diff > 0.001) {
              await supabase.from("holdings").update({ units: h.units, current_nav: h.current_nav || h.purchase_nav, current_value: h.units * (h.current_nav || h.purchase_nav || 0), price_fetched_at: now }).eq("id", match.id);
              updated++;
            } else { skipped++; }
          } else {
            const newId = `h_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
            await supabase.from("holdings").insert({ id: newId, user_id: userId, member_id: memberId, type: h.type || "MF", name: h.name, ticker: h.ticker || null, scheme_code: h.scheme_code || null, units: h.units || 0, purchase_nav: h.purchase_nav || null, current_nav: h.current_nav || h.purchase_nav || null, purchase_value: h.purchase_value || 0, current_value: h.units * (h.current_nav || h.purchase_nav || 0), start_date: h.start_date || null, created_at: now });
            added++;
          }
        }
        importRecord.status = "success"; importRecord.holdings_added = added; importRecord.holdings_updated = updated; importRecord.holdings_skipped = skipped;
        summary.imported += added; summary.updated += updated;
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
    state: Buffer.from(JSON.stringify({ userId: req.user.id })).toString("base64"),
  });
  res.json({ url });
});

router.get("/callback", async (req, res) => {
  if (!GMAIL_ENABLED) return res.status(501).send("Gmail not configured");
  const { code, state, error: oauthError } = req.query;
  if (oauthError) return res.redirect(`/?gmail_error=${encodeURIComponent(oauthError)}`);
  if (!code || !state) return res.status(400).send("Missing code or state");
  try {
    const { userId } = JSON.parse(Buffer.from(state, "base64").toString("utf8"));
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
