/**
 * services/alert-mailer.js — Send WealthLens Hub alert digest emails via Resend.
 *
 * Requirements:
 *   RESEND_API_KEY  — from https://resend.com (free tier: 100 emails/day)
 *   RESEND_FROM     — verified sender, e.g. "WealthLens Hub <noreply@yourdomain.com>"
 *                     (defaults to onboarding@resend.dev for testing — Resend's sandbox)
 *
 * No extra npm package needed — uses Node 18+ built-in fetch.
 */

const RESEND_URL = "https://api.resend.com/emails";

function htmlEmail(toEmail, trigAlerts, portfolioSummary) {
  const alertRows = trigAlerts.map(a => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #242424;font-size:.88rem;">
        <span style="font-weight:600;color:#e07c5a;">⚠ ${escH(a.label || a.type)}</span>
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #242424;font-size:.78rem;color:#888;white-space:nowrap;">
        ${escH(a.type)}
      </td>
    </tr>`).join("");

  const summaryBlock = portfolioSummary
    ? `<div style="background:#181818;border:1px solid #2a2a2a;border-radius:8px;padding:16px 18px;margin-bottom:20px;">
         <div style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#666;margin-bottom:8px;">Portfolio Snapshot</div>
         <pre style="margin:0;font-size:.82rem;color:#ccc;white-space:pre-wrap;font-family:inherit;">${escH(portfolioSummary)}</pre>
       </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WealthLens Hub — Alert Digest</title></head>
<body style="margin:0;padding:0;background:#111;font-family:'DM Sans',Arial,Helvetica,sans-serif;">
  <div style="max-width:580px;margin:40px auto;background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid #2a2a2a;">

    <!-- Header -->
    <div style="background:#1e1e1e;padding:24px 28px;border-bottom:1px solid #2a2a2a;">
      <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:1.4rem;color:#c9a84c;font-weight:700;">✦ WealthLens Hub</div>
      <div style="font-size:.78rem;color:#555;margin-top:4px;">Alert Digest · ${new Date().toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"})}</div>
    </div>

    <!-- Body -->
    <div style="padding:24px 28px;">
      <p style="margin:0 0 16px;font-size:.9rem;color:#bbb;">
        ${trigAlerts.length} alert${trigAlerts.length > 1 ? "s are" : " is"} currently triggered on your portfolio.
      </p>

      ${summaryBlock}

      <!-- Alert table -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;border:1px solid #2a2a2a;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#161616;">
            <th style="padding:10px 14px;text-align:left;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#555;border-bottom:1px solid #2a2a2a;">Alert</th>
            <th style="padding:10px 14px;text-align:left;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#555;border-bottom:1px solid #2a2a2a;">Type</th>
          </tr>
        </thead>
        <tbody>${alertRows}</tbody>
      </table>

      <p style="font-size:.78rem;color:#555;margin:0;">
        Log in to WealthLens Hub to review and take action on your portfolio.
      </p>
    </div>

    <!-- Footer -->
    <div style="padding:14px 28px;border-top:1px solid #2a2a2a;font-size:.68rem;color:#444;text-align:center;">
      WealthLens Hub &middot; Sent to ${escH(toEmail)} &middot; To stop receiving digests, turn off alerts in the Strategy tab.
    </div>
  </div>
</body>
</html>`;
}

function escH(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Send the alert digest email.
 * @param {string}   toEmail         - Recipient email (from Supabase auth)
 * @param {object[]} trigAlerts       - Triggered alert objects {id, type, label, ...}
 * @param {string}   portfolioSummary - Optional one-paragraph portfolio summary text
 * @returns {Promise<{id: string}>}   - Resend email ID
 */
export async function sendAlertDigest(toEmail, trigAlerts, portfolioSummary = "") {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw Object.assign(new Error("RESEND_API_KEY not set — add it to .env"), { status: 503 });

  const from    = process.env.RESEND_FROM || "onboarding@resend.dev";
  const subject = `WealthLens Hub — ${trigAlerts.length} Alert${trigAlerts.length > 1 ? "s" : ""} Triggered`;

  const response = await fetch(RESEND_URL, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body:    JSON.stringify({
      from, to: [toEmail], subject,
      html: htmlEmail(toEmail, trigAlerts, portfolioSummary),
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || `Resend returned ${response.status}`);
  }
  return response.json(); // { id: "re_..." }
}
