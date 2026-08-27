import { Router } from "express";
import { supabase } from "../lib/db.js";
import { fetchUsdInr, mfNav, stockPrice, yahooPrice } from "../lib/prices.js";
import { takeSnapshot } from "../lib/snapshot.js";
import { getCrossingHoldings } from "../lib/stale-holdings.js";
import { sendStaleNudge, sendAlertDigest } from "../services/alert-mailer.js";
import { sendPushToUser, pushEnabled } from "./push.js";
import { insertNotification } from "./notifications.js";

// Concurrency limiter — same pattern as routes/prices.js
async function pLimit(fns, concurrency = 5) {
  const results = []; let i = 0;
  async function worker() { while (i < fns.length) { const idx = i++; results[idx] = await fns[idx]().catch(e => ({ _err: e.message })); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, fns.length) }, worker));
  return results;
}

const router = Router();

function cronAuth(req, res, next) {
  const secret = req.headers["x-cron-secret"];
  if (!secret || secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
  next();
}

router.post("/refresh-all-prices", cronAuth, async (req, res) => {
  const { data: rows } = await supabase.from("holdings").select("user_id");
  const userIds = [...new Set((rows || []).map(r => r.user_id))];
  console.log(`Cron refresh started: ${userIds.length} users`);
  let totalUpdated = 0;
  const results = [];
  for (const userId of userIds) {
    try {
      const { data: holdings } = await supabase.from("holdings").select("id, type, ticker, scheme_code, units, usd_inr_rate").eq("user_id", userId);
      if (!holdings?.length) continue;
      const { rate: usdInr } = await fetchUsdInr();
      const now = new Date().toISOString();
      const tasks = holdings.map(h => async () => {
        let patch = null;
        if (h.type === "MF" && h.scheme_code) { const nav = await mfNav(h.scheme_code); if (nav) patch = { current_nav: nav, current_value: (h.units||0)*nav, price_fetched_at: now }; }
        else if ((h.type === "IN_STOCK" || h.type === "IN_ETF") && h.ticker) { const q = await stockPrice(`${h.ticker.toUpperCase()}.NS`, "NSE"); const price = q?.price ?? await yahooPrice(`${h.ticker.toUpperCase()}.BO`); if (price) patch = { current_price: price, current_value: (h.units||0)*price, price_fetched_at: now }; }
        else if ((h.type === "US_STOCK" || h.type === "US_ETF" || h.type === "US_BOND") && h.ticker) { const q = await stockPrice(h.ticker.toUpperCase()); if (q?.price) patch = { current_price: q.price, current_value: (h.units||0)*q.price, usd_inr_rate: usdInr, price_fetched_at: now }; }
        else if (h.type === "CRYPTO" && h.ticker) { const sym = h.ticker.toUpperCase().includes("-") ? h.ticker.toUpperCase() : `${h.ticker.toUpperCase()}-USD`; const q = await stockPrice(sym); if (q?.price) patch = { current_price: q.price, current_value: (h.units||0)*q.price, usd_inr_rate: usdInr, price_fetched_at: now }; }
        return { h, patch };
      });
      const fetched = await pLimit(tasks, 5);
      let updated = 0;
      for (const item of fetched) {
        if (!item || item._err || !item.patch) continue;
        await supabase.from("holdings").update(item.patch).eq("id", item.h.id);
        updated++;
      }
      // Auto-snapshot (uses shared lib/snapshot.js — includes member & type breakdown)
      try { await takeSnapshot(userId, { source: "cron_refresh" }); }
      catch (snapErr) { console.error(`Snapshot failed for ${userId}:`, snapErr.message); }
      totalUpdated += updated;
      results.push({ userId, updated });
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) { results.push({ userId, error: e.message }); }
  }
  console.log(`Cron complete: ${totalUpdated} holdings updated across ${userIds.length} users`);
  res.json({ users: userIds.length, totalUpdated, results });
});

router.post("/check-cas-email", cronAuth, async (req, res) => {
  try {
    const { checkCasEmail } = await import("./gmail.js");

    // Find all users with Gmail auto-import enabled and a connected Gmail account
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("gmail_auto_import", true)
      .not("gmail_token", "is", null);

    if (error) return res.status(500).json({ error: error.message });

    const userIds = (profiles || []).map(p => p.id);
    console.log(`CAS email cron: checking ${userIds.length} users`);

    const results = [];
    for (const userId of userIds) {
      try {
        const summary = await checkCasEmail(userId);
        results.push({ userId, ...summary });
      } catch (e) {
        results.push({ userId, error: e.message });
      }
    }

    const totals = results.reduce((acc, r) => ({
      imported: acc.imported + (r.imported || 0),
      updated:  acc.updated  + (r.updated  || 0),
      skipped:  acc.skipped  + (r.skipped  || 0),
    }), { imported: 0, updated: 0, skipped: 0 });

    console.log(`CAS email cron complete: ${totals.imported} added, ${totals.updated} updated across ${userIds.length} users`);
    res.json({ users: userIds.length, ...totals, results });
  } catch (e) {
    res.status(500).json({ users: 0, error: e.message });
  }
});

// ── FD Expiry Alerts (7 / 30 / 60 day windows) ───────────────────────────────
// POST /api/cron/fd-alerts   (x-cron-secret header required)
// Env: CRON_SECRET, RESEND_API_KEY, APP_URL (e.g. https://app.wealthlenshub.com)

router.post("/fd-alerts", cronAuth, async (req, res) => {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.status(500).json({ error: "RESEND_API_KEY not configured" });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const WINDOWS = [7, 30, 60];

  const { data: fds, error } = await supabase
    .from("holdings")
    .select("id, name, user_id, principal, interest_rate, maturity_date")
    .eq("type", "FD")
    .not("maturity_date", "is", null);

  if (error) return res.status(500).json({ error: error.message });

  const results = [];

  for (const fd of fds || []) {
    const matDate = new Date(fd.maturity_date); matDate.setHours(0, 0, 0, 0);
    const dLeft = Math.round((matDate - today) / 864e5);
    if (!WINDOWS.includes(dLeft)) continue;

    // Resolve email via profiles table
    const { data: profile } = await supabase.from("profiles").select("email").eq("id", fd.user_id).single();
    const toEmail = profile?.email;
    if (!toEmail) { results.push({ fd: fd.id, dLeft, status: "no_email" }); continue; }

    const matFormatted = matDate.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
    const principalFmt = fd.principal ? `₹${Number(fd.principal).toLocaleString("en-IN")}` : "N/A";
    const urgencyColor = dLeft <= 7 ? "#e07c5a" : dLeft <= 30 ? "#f0a050" : "#4caf9a";
    const appUrl = process.env.APP_URL || "https://app.wealthlenshub.com";

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#134E4A">
        <div style="background:#0D9488;padding:1.5rem;border-radius:12px 12px 0 0;text-align:center">
          <div style="font-size:2rem">🏦</div>
          <div style="color:#fff;font-size:1.1rem;font-weight:600;margin-top:.5rem">FD Maturity Reminder</div>
        </div>
        <div style="background:#F4F7F5;padding:1.5rem;border-radius:0 0 12px 12px;border:1px solid #D1E8E0">
          <p>Your Fixed Deposit <strong>${fd.name}</strong> matures in
            <span style="color:${urgencyColor};font-weight:700"> ${dLeft} day${dLeft!==1?"s":""}</span>.
          </p>
          <table style="width:100%;border-collapse:collapse;margin:1rem 0">
            <tr style="border-bottom:1px solid #D1E8E0">
              <td style="padding:.5rem;color:#5E7A72;font-size:.85rem">Maturity Date</td>
              <td style="padding:.5rem;font-weight:600;color:${urgencyColor}">${matFormatted}</td>
            </tr>
            <tr style="border-bottom:1px solid #D1E8E0">
              <td style="padding:.5rem;color:#5E7A72;font-size:.85rem">Principal</td>
              <td style="padding:.5rem;font-weight:600">${principalFmt}</td>
            </tr>
            ${fd.interest_rate?`<tr><td style="padding:.5rem;color:#5E7A72;font-size:.85rem">Rate</td><td style="padding:.5rem;font-weight:600">${fd.interest_rate}% p.a.</td></tr>`:""}
          </table>
          <p style="font-size:.85rem;color:#5E7A72">Plan your reinvestment before maturity to avoid idle funds.
            View your portfolio at <a href="${appUrl}" style="color:#0D9488">${appUrl}</a>.</p>
        </div>
      </div>`;

    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: "WealthLens Hub <alerts@wealthlenshub.com>",
          to: [toEmail],
          subject: `⏰ FD Alert: "${fd.name}" matures in ${dLeft} day${dLeft!==1?"s":""}`,
          html,
        }),
      });
      const rj = await r.json();
      if (r.ok) await insertNotification(fd.user_id, "fd_alert", `FD Alert: "${fd.name}" matures in ${dLeft} day${dLeft!==1?"s":""}`, `Your Fixed Deposit "${fd.name}" matures on ${matFormatted}.`, "/holdings");
      results.push({ fd: fd.id, name: fd.name, dLeft, status: r.ok ? "sent" : "failed", resendId: rj.id });
    } catch (e) {
      results.push({ fd: fd.id, name: fd.name, dLeft, status: "error", error: e.message });
    }
  }

  const sent = results.filter(r => r.status === "sent").length;
  console.log(`FD alerts: scanned ${(fds||[]).length} FDs, sent ${sent} emails`);
  res.json({ scanned: (fds||[]).length, sent, results });
});

// ── Stale Holdings Nudge ────────────────────────────────────────────────────
// POST /api/cron/nudge-stale  (x-cron-secret header required)
//
// Fires once per threshold-crossing — only emails when a holding crosses its
// stale threshold within the last 7 days. Holdings stale for longer are skipped
// (already nudged). Batches all crossings per user into ONE email.
//
// Safe to call daily (piggybacked on price refresh cron) — the crossing window
// ensures emails go out at natural intervals (90d / 180d / 365d), not daily.
// Env: CRON_SECRET, RESEND_API_KEY, APP_URL

router.post("/nudge-stale", cronAuth, async (req, res) => {
  if (!process.env.RESEND_API_KEY) {
    return res.status(503).json({ error: "RESEND_API_KEY not configured" });
  }

  // 1. Fetch all manual holdings across all users (updated_at is key)
  const { data: holdings, error } = await supabase
    .from("holdings")
    .select("id, user_id, name, type, updated_at, created_at")
    .in("type", ["FD", "PPF", "EPF", "REAL_ESTATE", "CASH", "INSURANCE", "OTHER"]);

  if (error) return res.status(500).json({ error: error.message });

  // 2. Group holdings by user
  const byUser = {};
  for (const h of holdings || []) {
    (byUser[h.user_id] ||= []).push(h);
  }

  const now = new Date();
  const results = [];

  // 3. For each user, find stale holdings and send ONE batched email
  for (const [userId, userHoldings] of Object.entries(byUser)) {
    const stale = getCrossingHoldings(userHoldings, now);
    if (stale.length === 0) {
      results.push({ userId, status: "no_stale" });
      continue;
    }

    // Resolve user email
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .single();

    const toEmail = profile?.email;
    if (!toEmail) {
      results.push({ userId, staleCount: stale.length, status: "no_email" });
      continue;
    }

    try {
      const r = await sendStaleNudge(toEmail, stale);
      results.push({ userId, email: toEmail, staleCount: stale.length, status: "sent", resendId: r.id });
    } catch (e) {
      results.push({ userId, email: toEmail, staleCount: stale.length, status: "error", error: e.message });
    }
  }

  const sent = results.filter(r => r.status === "sent").length;
  const totalStale = results.reduce((s, r) => s + (r.staleCount || 0), 0);
  console.log(`Stale nudge cron: ${Object.keys(byUser).length} users scanned, ${sent} emails sent, ${totalStale} stale holdings total`);
  res.json({ users: Object.keys(byUser).length, emailsSent: sent, totalStaleHoldings: totalStale, results });
});

// ── Daily Alert Check ────────────────────────────────────────────────────────
// POST /api/cron/alert-check  (x-cron-secret header required)
//
// Evaluates all active portfolio alert rules for every user and sends a
// digest email if any rules are triggered. Mirrors the frontend useMemo logic
// in App.jsx for RETURN_TARGET, USD_INR_RATE, ALLOCATION_DRIFT, CONCENTRATION.
//
// Env: CRON_SECRET, RESEND_API_KEY, APP_URL

router.post("/alert-check", cronAuth, async (req, res) => {
  if (!process.env.RESEND_API_KEY) {
    return res.status(503).json({ error: "RESEND_API_KEY not configured" });
  }

  // 1. Fetch all portfolios that have at least one active alert rule
  const { data: portfolios, error: pErr } = await supabase
    .from("portfolio")
    .select("user_id, alerts, goals");
  if (pErr) return res.status(500).json({ error: pErr.message });

  const results = [];

  for (const port of portfolios || []) {
    const alertRules = (port.alerts || []).filter(a => a.active);
    if (!alertRules.length) continue;

    // 2. Fetch user's holdings
    const { data: holdings } = await supabase
      .from("holdings")
      .select("id, type, current_value, avg_cost, net_units, units, purchase_value, principal, usd_inr_rate")
      .eq("user_id", port.user_id);

    if (!holdings?.length) continue;

    // 3. Compute portfolio metrics (mirrors App.jsx computations)
    const allCur = holdings.reduce((s, h) => s + (Number(h.current_value) || 0), 0);
    const allInv = holdings.reduce((s, h) => {
      const inv = h.avg_cost != null && h.net_units != null
        ? Number(h.net_units) * Number(h.avg_cost)
        : Number(h.purchase_value || h.principal || 0);
      return s + inv;
    }, 0);
    const totPct = allInv > 0 ? ((allCur - allInv) / allInv) * 100 : 0;
    const usdInrRate = holdings.find(h => (Number(h.usd_inr_rate) || 0) > 0)?.usd_inr_rate || 0;

    // 4. Evaluate each alert rule
    const triggered = [];
    for (const a of alertRules) {
      const threshold = Number(a.threshold);
      if (a.type === "RETURN_TARGET") {
        if (totPct < threshold) triggered.push({ ...a, currentValue: totPct.toFixed(2) });
      } else if (a.type === "USD_INR_RATE") {
        if (usdInrRate > 0 && Number(usdInrRate) > threshold) {
          triggered.push({ ...a, currentValue: Number(usdInrRate).toFixed(2) });
        }
      } else if (a.type === "ALLOCATION_DRIFT" || a.type === "CONCENTRATION") {
        const typeVal = holdings
          .filter(h => h.type === a.assetType)
          .reduce((s, h) => s + (Number(h.current_value) || 0), 0);
        const pct = allCur > 0 ? (typeVal / allCur) * 100 : 0;
        if (a.type === "ALLOCATION_DRIFT" && pct > threshold) {
          triggered.push({ ...a, currentValue: pct.toFixed(2) });
        }
        if (a.type === "CONCENTRATION" && pct < threshold) {
          triggered.push({ ...a, currentValue: pct.toFixed(2) });
        }
      } else if (a.type === "HOLDING_PRICE" || a.type === "HOLDING_RETURN") {
        const h = holdings.find(hh => hh.id === a.holdingId);
        if (!h) continue;
        if (a.type === "HOLDING_PRICE") {
          const price = Number(h.current_price || h.current_nav || 0);
          if (a.direction === "above" && price > threshold) triggered.push({ ...a, currentValue: price.toFixed(2) });
          if (a.direction === "below" && price > 0 && price < threshold) triggered.push({ ...a, currentValue: price.toFixed(2) });
        } else {
          const cur = Number(h.current_value || 0);
          const inv = h.avg_cost != null && h.net_units != null
            ? Number(h.net_units) * Number(h.avg_cost)
            : Number(h.purchase_value || h.principal || 0);
          if (inv <= 0) continue;
          const ret = ((cur - inv) / inv) * 100;
          if (a.direction === "above" && ret > threshold) triggered.push({ ...a, currentValue: ret.toFixed(2) });
          if (a.direction === "below" && ret < threshold) triggered.push({ ...a, currentValue: ret.toFixed(2) });
        }
      }
    }

    if (!triggered.length) {
      results.push({ userId: port.user_id, triggered: 0, status: "no_alerts" });
      continue;
    }

    // 5. Resolve user email
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", port.user_id)
      .single();

    const toEmail = profile?.email;
    if (!toEmail) {
      results.push({ userId: port.user_id, triggered: triggered.length, status: "no_email" });
      continue;
    }

    // 6. Build a brief portfolio summary
    const portfolioSummary = [
      `Current value: ₹${allCur.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      `Invested:      ₹${allInv.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      `Total return:  ${totPct.toFixed(2)}%`,
      usdInrRate ? `USD/INR rate:  ₹${Number(usdInrRate).toFixed(2)}` : null,
    ].filter(Boolean).join("\n");

    try {
      await sendAlertDigest(toEmail, triggered, portfolioSummary);
      if (pushEnabled()) {
        const pushPayload = { title: "WealthLens Alert", body: `${triggered.length} alert${triggered.length>1?"s":""} triggered`, url: "/alerts" };
        await sendPushToUser(port.user_id, pushPayload).catch(()=>{});
      }
      await insertNotification(port.user_id, "alert_triggered", `${triggered.length} portfolio alert${triggered.length>1?"s":""} triggered`, triggered.map(a => a.type).join(", "), "/alerts");
      results.push({ userId: port.user_id, email: toEmail, triggered: triggered.length, status: "sent" });
    } catch (e) {
      results.push({ userId: port.user_id, email: toEmail, triggered: triggered.length, status: "error", error: e.message });
    }
  }

  const sent       = results.filter(r => r.status === "sent").length;
  const totalTrigs = results.reduce((s, r) => s + (r.triggered || 0), 0);
  console.log(`Alert check cron: ${(portfolios||[]).length} users, ${totalTrigs} alerts triggered, ${sent} digests sent`);
  res.json({ users: (portfolios||[]).length, emailsSent: sent, totalTriggered: totalTrigs, results });
});


// ── Insurance Premium Renewal Reminders (7 / 30 day windows) ─────────────────
// POST /api/cron/insurance-reminders  (x-cron-secret header required)
// Env: CRON_SECRET, RESEND_API_KEY, APP_URL

router.post("/insurance-reminders", cronAuth, async (req, res) => {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.status(500).json({ error: "RESEND_API_KEY not configured" });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const WINDOWS = [7, 30];

  // Fetch all INSURANCE holdings with premium fields
  const { data: policies, error } = await supabase
    .from("holdings")
    .select("id, name, user_id, premium, premium_frequency, start_date, maturity_date, sum_assured")
    .eq("type", "INSURANCE")
    .not("premium", "is", null)
    .not("start_date", "is", null);

  if (error) return res.status(500).json({ error: error.message });

  // Compute next due date from start_date + frequency
  function nextDueDate(startDateStr, frequency) {
    const start = new Date(startDateStr); start.setHours(0, 0, 0, 0);
    const freqMonths = { ANNUAL: 12, HALF_YEARLY: 6, QUARTERLY: 3, MONTHLY: 1 }[frequency] || 12;
    let due = new Date(start);
    const today2 = new Date(); today2.setHours(0, 0, 0, 0);
    while (due <= today2) {
      due = new Date(due);
      due.setMonth(due.getMonth() + freqMonths);
    }
    return due;
  }

  const results = [];

  for (const policy of policies || []) {
    if (!policy.premium_frequency) continue;

    // Skip if policy has already matured
    if (policy.maturity_date) {
      const mat = new Date(policy.maturity_date); mat.setHours(0, 0, 0, 0);
      if (mat < today) { results.push({ policy: policy.id, status: "matured_skip" }); continue; }
    }

    const nextDue = nextDueDate(policy.start_date, policy.premium_frequency);
    const daysUntil = Math.round((nextDue - today) / 864e5);
    if (!WINDOWS.includes(daysUntil)) continue;

    const { data: profile } = await supabase.from("profiles").select("email").eq("id", policy.user_id).single();
    const toEmail = profile?.email;
    if (!toEmail) { results.push({ policy: policy.id, status: "no_email" }); continue; }

    const dueFmt = nextDue.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
    const premiumFmt = policy.premium ? `₹${Number(policy.premium).toLocaleString("en-IN")}` : "N/A";
    const sumFmt = policy.sum_assured ? `₹${Number(policy.sum_assured).toLocaleString("en-IN")}` : "N/A";
    const urgencyColor = daysUntil <= 7 ? "#e07c5a" : "#f0a050";
    const freqLabel = { ANNUAL: "Annual", HALF_YEARLY: "Half-Yearly", QUARTERLY: "Quarterly", MONTHLY: "Monthly" }[policy.premium_frequency] || policy.premium_frequency;
    const appUrl = process.env.APP_URL || "https://app.wealthlenshub.com";

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#134E4A">
        <div style="background:#0D9488;padding:1.5rem;border-radius:12px 12px 0 0;text-align:center">
          <div style="font-size:2rem">🛡️</div>
          <div style="color:#fff;font-size:1.1rem;font-weight:600;margin-top:.5rem">Insurance Premium Due</div>
        </div>
        <div style="background:#F4F7F5;padding:1.5rem;border-radius:0 0 12px 12px;border:1px solid #D1E8E0">
          <p>Your insurance premium for <strong>${policy.name}</strong> is due in
            <span style="color:${urgencyColor};font-weight:700"> ${daysUntil} day${daysUntil !== 1 ? "s" : ""}</span>.
          </p>
          <table style="width:100%;border-collapse:collapse;margin:1rem 0">
            <tr style="border-bottom:1px solid #D1E8E0">
              <td style="padding:.5rem;color:#5E7A72;font-size:.85rem">Premium Due</td>
              <td style="padding:.5rem;font-weight:600;color:${urgencyColor}">${dueFmt}</td>
            </tr>
            <tr style="border-bottom:1px solid #D1E8E0">
              <td style="padding:.5rem;color:#5E7A72;font-size:.85rem">Premium Amount</td>
              <td style="padding:.5rem;font-weight:600">${premiumFmt}</td>
            </tr>
            <tr style="border-bottom:1px solid #D1E8E0">
              <td style="padding:.5rem;color:#5E7A72;font-size:.85rem">Frequency</td>
              <td style="padding:.5rem;font-weight:600">${freqLabel}</td>
            </tr>
            <tr>
              <td style="padding:.5rem;color:#5E7A72;font-size:.85rem">Sum Assured</td>
              <td style="padding:.5rem;font-weight:600">${sumFmt}</td>
            </tr>
          </table>
          <p style="font-size:.85rem;color:#5E7A72">Pay your premium on time to keep your coverage active.
            View your portfolio at <a href="${appUrl}" style="color:#0D9488">${appUrl}</a>.</p>
        </div>
      </div>`;

    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: "WealthLens Hub <alerts@wealthlenshub.com>",
          to: [toEmail],
          subject: `🛡️ Insurance Reminder: "${policy.name}" premium due in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`,
          html,
        }),
      });
      const rj = await r.json();
      if (r.ok) await insertNotification(policy.user_id, "insurance_reminder", `Insurance premium due: "${policy.name}"`, `Premium of ${premiumFmt} due in ${daysUntil} day${daysUntil!==1?"s":""} on ${dueFmt}.`, "/holdings");
      results.push({ policy: policy.id, name: policy.name, daysUntil, status: r.ok ? "sent" : "failed", resendId: rj.id });
    } catch (e) {
      results.push({ policy: policy.id, name: policy.name, daysUntil, status: "error", error: e.message });
    }
  }

  const sent = results.filter(r => r.status === "sent").length;
  console.log(`Insurance reminders: scanned ${(policies||[]).length} policies, sent ${sent} emails`);
  res.json({ scanned: (policies||[]).length, sent, results });
});

// ── Goal Progress Milestone Notifications (25 / 50 / 75 / 100 %) ─────────────
// POST /api/cron/goal-milestones  (x-cron-secret header required)
// Persists notified_milestone back into the goal JSONB so each milestone fires
// only once. Sends email + push for every new crossing.
// Env: CRON_SECRET, RESEND_API_KEY, APP_URL

router.post("/goal-milestones", cronAuth, async (req, res) => {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.status(500).json({ error: "RESEND_API_KEY not configured" });

  const MILESTONES = [25, 50, 75, 100];
  const appUrl = process.env.APP_URL || "https://app.wealthlenshub.com";

  // Fetch all portfolios with goals
  const { data: portfolios, error: pErr } = await supabase
    .from("portfolio")
    .select("user_id, goals");
  if (pErr) return res.status(500).json({ error: pErr.message });

  const results = [];

  for (const port of portfolios || []) {
    const goals = (port.goals || []).filter(g => g.targetAmount > 0);
    if (!goals.length) { results.push({ userId: port.user_id, status: "no_goals" }); continue; }

    // Fetch total current value for this user
    const { data: holdings } = await supabase
      .from("holdings")
      .select("current_value, type")
      .eq("user_id", port.user_id);
    if (!holdings?.length) continue;

    const totalValue = holdings.reduce((s, h) => s + (Number(h.current_value) || 0), 0);

    let goalsUpdated = false;
    const newGoals = [...goals];
    const notifications = [];

    for (let i = 0; i < newGoals.length; i++) {
      const goal = { ...newGoals[i] };
      const pct = Math.min((totalValue / goal.targetAmount) * 100, 100);
      const prevMilestone = goal.notified_milestone || 0;

      // Find the highest new milestone crossed
      const newMilestone = MILESTONES.filter(m => m > prevMilestone && pct >= m).pop();
      if (!newMilestone) continue;

      notifications.push({ goal, milestone: newMilestone, pct: pct.toFixed(1) });
      goal.notified_milestone = newMilestone;
      newGoals[i] = goal;
      goalsUpdated = true;
    }

    if (!notifications.length) { results.push({ userId: port.user_id, status: "no_new_milestones" }); continue; }

    // Persist updated notified_milestone values
    if (goalsUpdated) {
      await supabase.from("portfolio").update({ goals: newGoals }).eq("user_id", port.user_id).catch(e => console.error("goal update failed", e));
    }

    // Resolve email
    const { data: profile } = await supabase.from("profiles").select("email").eq("id", port.user_id).single();
    const toEmail = profile?.email;
    if (!toEmail) { results.push({ userId: port.user_id, status: "no_email" }); continue; }

    // Build email for all new milestone notifications
    const milestoneRows = notifications.map(n => {
      const emoji = n.milestone >= 100 ? "🏆" : n.milestone >= 75 ? "🎯" : n.milestone >= 50 ? "⭐" : "🌱";
      const color = n.milestone >= 100 ? "#059669" : n.milestone >= 75 ? "#0D9488" : n.milestone >= 50 ? "#5b9bd5" : "#A084CA";
      return `<div style="background:#fff;border:1px solid #D1E8E0;border-radius:8px;padding:1rem;margin:.5rem 0">
        <div style="display:flex;align-items:center;gap:.5rem">
          <span style="font-size:1.4rem">${emoji}</span>
          <div>
            <div style="font-weight:600;color:#134E4A">${n.goal.label || "Goal"}</div>
            <div style="color:${color};font-weight:700;font-size:1.1rem">${n.milestone}% Milestone Reached</div>
            <div style="color:#5E7A72;font-size:.85rem">Portfolio is at ${n.pct}% of target ₹${Number(n.goal.targetAmount).toLocaleString("en-IN")}</div>
          </div>
        </div>
      </div>`;
    }).join("");

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#134E4A">
        <div style="background:#0D9488;padding:1.5rem;border-radius:12px 12px 0 0;text-align:center">
          <div style="font-size:2rem">🎯</div>
          <div style="color:#fff;font-size:1.1rem;font-weight:600;margin-top:.5rem">Goal Milestone${notifications.length > 1 ? "s" : ""} Reached!</div>
        </div>
        <div style="background:#F4F7F5;padding:1.5rem;border-radius:0 0 12px 12px;border:1px solid #D1E8E0">
          <p>You've crossed a new milestone on your financial goal${notifications.length > 1 ? "s" : ""}. Keep going!</p>
          ${milestoneRows}
          <p style="margin-top:1rem;font-size:.85rem;color:#5E7A72">
            View your goals at <a href="${appUrl}" style="color:#0D9488">${appUrl}</a>
          </p>
        </div>
      </div>`;

    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: "WealthLens Hub <alerts@wealthlenshub.com>",
          to: [toEmail],
          subject: `🎯 Goal milestone${notifications.length > 1 ? "s" : ""} reached — ${notifications.map(n => n.milestone + "%").join(", ")}`,
          html,
        }),
      });
      const rj = await r.json();

      // Also push notification
      if (pushEnabled()) {
        const pushMsg = notifications.map(n => `${n.milestone}% — ${n.goal.label || "Goal"}`).join(", ");
        await sendPushToUser(port.user_id, {
          title: "Goal Milestone Reached! 🎯",
          body: pushMsg,
          url: "/goals",
        }).catch(() => {});
      }

      if (r.ok) { for (const n of notifications) { await insertNotification(port.user_id, "goal_milestone", `Goal milestone reached: ${n.milestone}%`, `"${n.goal.label || "Goal"}" is at ${n.pct}% of target.`, "/goals"); } }
      results.push({ userId: port.user_id, milestones: notifications.map(n => n.milestone), status: r.ok ? "sent" : "failed", resendId: rj.id });
    } catch (e) {
      results.push({ userId: port.user_id, status: "error", error: e.message });
    }
  }

  const sent = results.filter(r => r.status === "sent").length;
  console.log(`Goal milestones: ${(portfolios||[]).length} portfolios scanned, ${sent} emails sent`);
  res.json({ portfolios: (portfolios||[]).length, sent, results });
});

export default router;
