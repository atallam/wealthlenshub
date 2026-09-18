/**
 * lib/concall/calendar.js — Upcoming concall estimation.
 *
 * Indian listed companies report quarterly; the concall typically follows
 * within a few weeks of the board meeting that approves results. There is
 * no clean feed of scheduled concalls, so this combines two signals:
 *
 *   1. A deterministic ESTIMATE — the holding's last analysed quarter_date
 *      (from concall_analyses) plus a typical reporting lag. Always
 *      available once a holding has one analysed quarter, and always
 *      labelled as an estimate — never presented as a confirmed date.
 *
 *   2. A best-effort LIVE LOOKUP — searches BSE's corporate announcement
 *      feed (same API BSEFilingProvider in providers.js already uses) for
 *      a recent "Board Meeting" intimation and tries to parse a future
 *      date out of the filing subject. BSE's JSON has no structured
 *      meeting-date field, so this is inherently fuzzy — it degrades to
 *      null rather than guessing when nothing parses cleanly.
 */

import { createRequire } from "module";

const require = createRequire(import.meta.url);
let BSE_CODES = {};
try {
  BSE_CODES = require("../bse_codes.json");
} catch {
  console.warn("[concall/calendar] bse_codes.json not found — board-meeting lookup will use dynamic lookup only");
}

const FETCH_TIMEOUT_MS = 8_000;   // tighter than providers.js — this runs for many holdings per request
const REPORTING_LAG_DAYS = { start: 25, end: 50 }; // typical India gap: quarter-end -> results + concall

async function timedFetch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @typedef {Object} ConcallEstimate
 * @property {string} window_start  ISO date
 * @property {string} window_end    ISO date
 * @property {"upcoming"|"due_now"|"overdue"} status
 * @property {string} basis         human-readable provenance note
 */

/**
 * Deterministic estimate — no network call. Pure function of the last
 * analysed quarter's period-end date.
 * @param {string|null} lastQuarterDate  YYYY-MM-DD
 * @returns {ConcallEstimate|null}
 */
export function estimateNextConcall(lastQuarterDate) {
  if (!lastQuarterDate) return null;

  const base = new Date(lastQuarterDate);
  if (isNaN(base)) return null;

  // The NEXT results cover the quarter ending ~91 days after the one this
  // analysis covered, then the usual reporting lag before results + concall.
  const nextQuarterEnd = new Date(base.getTime() + 91 * 864e5);
  const windowStart = new Date(nextQuarterEnd.getTime() + REPORTING_LAG_DAYS.start * 864e5);
  const windowEnd   = new Date(nextQuarterEnd.getTime() + REPORTING_LAG_DAYS.end   * 864e5);

  const now = Date.now();
  const status = now < windowStart.getTime() ? "upcoming"
               : now <= windowEnd.getTime()  ? "due_now"
               : "overdue";

  return {
    window_start: windowStart.toISOString().split("T")[0],
    window_end:   windowEnd.toISOString().split("T")[0],
    status,
    basis: `estimated from last reported quarter (period ending ${lastQuarterDate})`,
  };
}

async function resolveBseCode(symbol) {
  if (BSE_CODES[symbol]) return BSE_CODES[symbol];
  try {
    const res = await timedFetch(
      `https://api.bseindia.com/BseIndiaAPI/api/ddlsector_companySearch/w?search=${encodeURIComponent(symbol)}&type=0&flag=0`,
      { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)", "Referer": "https://www.bseindia.com/" } }
    );
    if (!res.ok) return null;
    const results = await res.json();
    const match = Array.isArray(results)
      ? results.find(r => (r.nseid || r.NSEID || r.NSEId || "").toUpperCase() === symbol)
      : null;
    const code = match?.scrip_cd || match?.SCRIP_CD || match?.Scrip_Cd || match?.scripCd;
    return code ? String(code) : null;
  } catch {
    return null;
  }
}

// Loose date parser for BSE filing subjects — handles the handful of formats
// these announcements actually use. Ignores anything not clearly in the future
// (a filing that only mentions a past date isn't a useful calendar entry).
const DATE_PATTERNS = [
  // 24/10/2026, 24-10-2026
  { re: /\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/,
    fmt: m => `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}` },
  // 24th October, 2026 / 24 October 2026
  { re: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(\d{4})\b/i,
    fmt: m => {
      const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
      const mo = months.indexOf(m[2].toLowerCase()) + 1;
      return `${m[3]}-${String(mo).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
    } },
];

function parseFutureDate(text) {
  if (!text) return null;
  for (const { re, fmt } of DATE_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const iso = fmt(m);
    const d = new Date(iso);
    if (!isNaN(d) && d.getTime() > Date.now() - 3 * 864e5) return iso; // allow a small grace window
  }
  return null;
}

// Only two terms (not the full BSE_SEARCH_TERMS list in providers.js) — this
// runs once per holding per calendar request, so it needs to stay fast.
const BOARD_MEETING_TERMS = ["board meeting", "financial results"];

/**
 * Best-effort: find the most recent BSE "board meeting" style filing for a
 * ticker and try to pull a future date out of its subject line.
 * @param {string} ticker
 * @returns {Promise<{subject:string, filed_url:string|null, meeting_date:string|null}|null>}
 */
export async function findBoardMeetingFiling(ticker) {
  const symbol = ticker.toUpperCase().replace(/\.BO$/, "").replace(/\.NS$/, "");
  const bseCode = await resolveBseCode(symbol);
  if (!bseCode) return null;

  for (const term of BOARD_MEETING_TERMS) {
    const url =
      `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w` +
      `?strCat=-1&strPrevDate=&strScrip=${bseCode}&strSearch=${encodeURIComponent(term)}&strToDate=&strType=C&subcategory=-1`;
    try {
      const res = await timedFetch(url, {
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; WealthLensHub/1.0)", "Referer": "https://www.bseindia.com/" },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const items = data?.Table || [];
      if (!items.length) continue;

      const entry = items[0];
      const subject = entry.NEWSSUB || entry.HEADLINE || "";
      const filed_url = entry.ATTACHMENTNAME
        ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${entry.ATTACHMENTNAME}`
        : null;

      return { subject, filed_url, meeting_date: parseFutureDate(subject) };
    } catch (e) {
      console.warn(`[concall/calendar] Board meeting lookup failed for ${symbol} ("${term}"):`, e.message);
    }
  }
  return null;
}
