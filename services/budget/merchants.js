import { decrypt } from "../../lib/crypto.js";
import { loadAllocations } from "./splits.js";

/** Normalize a transaction description to extract the core merchant name.
 *  Handles common Indian + US bank description patterns:
 *  - UPI: "UPI/CR/123456789012/SWIGGY FOOD" → "SWIGGY FOOD"
 *  - NEFT/RTGS/IMPS: "NEFT/HDFC123/AMAZON PAY" → "AMAZON PAY"
 *  - POS: "POS/TXN/BIGBASKET" → "BIGBASKET"
 *  - Generic: strips trailing dates, ref numbers, slashes */
const RAIL = "UPI|NEFT|RTGS|IMPS|POS|ACH|ECS|EMI|ENQ|CLG|TFR|NACH|ATM|INB|MOB|CHQ|DD|DEBIT CARD|CREDIT CARD|PURCHASE|ECOM|BIL|BILLPAY";

const NOISE_SEG = /^(CR|DR|C|D|P2A|P2M|P2P|TXN|REF|NA|NULL|PAYMENT|PAYMENT FROM PHONE|UPI|PAY|OK|REFUND|TRANSFER)$/;

const VPA_HANDLES = /^(OK)?(AXIS|HDFCBANK|SBI|ICICI|YBL|IBL|AXL|PAYTM|APL|UPI|FBL|OKAXIS|OKHDFCBANK|OKSBI|OKICICI)$/;

export function normalizeMerchant(desc) {
  if (!desc) return "Unknown";
  let s = String(desc).toUpperCase().trim();
  const rail = new RegExp(`^(${RAIL})\\b[\\s/\\-:]*`);
  // Peel leading rail markers (e.g. "UPI/", "POS ", "NEFT-")
  let hadRail = false;
  while (rail.test(s)) { s = s.replace(rail, ""); hadRail = true; }
  // Pick the delimiter: slash-delimited refs, else dash-delimited after a rail marker
  const delim = s.includes("/") ? "/" : (hadRail && (s.match(/-/g) || []).length >= 2 ? "-" : null);
  let segs = delim ? s.split(delim) : [s];
  const isRef = (x) => /\d/.test(x) && /^[A-Z0-9*X]{6,}$/.test(x.replace(/\s/g, "")) && !/\s/.test(x); // ref/ID tokens: alnum, has a digit
  segs = segs.map(x => x.trim()).filter(x => x && !NOISE_SEG.test(x) && !isRef(x) && !VPA_HANDLES.test(x));
  // Prefer the first segment that has a real word (3+ letters)
  let m = segs.find(x => /[A-Z]{3,}/.test(x)) || segs[0] || "";
  m = m.replace(/@\S+/g, "")                                  // VPA handle
       .replace(/\b\d{4}X{2,}\d{2,4}\b|\b\d*X{3,}\d*\b/g, "")  // masked card numbers
       .replace(/\s*\d{2}[-/]\d{2}(?:[-/]\d{2,4})?\s*$/, "")   // trailing dd-mm / dd-mm-yy
       .replace(/\s+\d{6,}\s*$/, "")                           // trailing long ref numbers
       .replace(/^[\s/\-:]+|[\s/\-:]+$/g, "")
       .replace(/\s{2,}/g, " ")
       .trim();
  if (!m) return "Unknown";
  return m.split(" ").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

/** Top merchants by spend. Groups by normalized description and sums amounts.
 *  Only considers DEBIT transactions. Returns top 20 by amount. */
export async function merchantRollup(userId, memberId, month, { from: rangeFrom, to: rangeTo } = {}) {
  let qFrom, qTo;
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    qFrom = `${month}-01`;
    qTo   = `${month}-${String(lastDay).padStart(2, "0")}`;
  } else if (rangeFrom) {
    qFrom = rangeFrom; qTo = rangeTo || new Date().toISOString().slice(0, 10);
  } else {
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    qFrom = `${y}-${m}-01`; qTo = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
  }

  // Split-aware: a shared purchase counts only the requested member's share
  const data = await loadAllocations(userId, memberId || null, {
    from: qFrom, to: qTo, txnType: "DEBIT", extraCols: "description, search_text",
  });

  const grouped = {};
  for (const t of data || []) {
    const rawDesc = decrypt(t.description) || t.search_text || "";
    const merchant = normalizeMerchant(rawDesc);
    if (!grouped[merchant]) grouped[merchant] = { merchant, total: 0, count: 0, category: t.category };
    grouped[merchant].total += t.amount;
    grouped[merchant].count += 1;
  }
  return Object.values(grouped)
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
}

/** Detect recurring transactions — transactions with the same normalized merchant
 *  appearing in 2+ distinct calendar months at a broadly similar amount (within ±30%).
 *  Returns a list of suspected recurring entries sorted by typical monthly cost desc. */
export async function detectRecurring(userId, memberId) {
  const cutoff = new Date(Date.now() - 365 * 24 * 3600_000).toISOString().slice(0, 10);
  const data = await loadAllocations(userId, memberId || null, {
    from: cutoff, txnType: "DEBIT", extraCols: "description, search_text",
  });

  // Group by merchant → month → list of amounts
  const byMerchant = {};
  for (const t of data || []) {
    const rawDesc = decrypt(t.description) || t.search_text || "";
    const merchant = normalizeMerchant(rawDesc);
    const mo = t.txn_date.slice(0, 7);
    if (!byMerchant[merchant]) byMerchant[merchant] = {};
    if (!byMerchant[merchant][mo]) byMerchant[merchant][mo] = [];
    byMerchant[merchant][mo].push({ amount: t.amount, category: t.category });
  }

  const results = [];
  for (const [merchant, months] of Object.entries(byMerchant)) {
    const moKeys = Object.keys(months).sort();
    if (moKeys.length < 2) continue; // must appear in at least 2 months

    // Representative amount per month = sum (usually just 1 transaction)
    const monthAmounts = moKeys.map(mo => months[mo].reduce((s, t) => s + t.amount, 0));
    const avg = monthAmounts.reduce((s, v) => s + v, 0) / monthAmounts.length;
    const allInRange = monthAmounts.every(a => Math.abs(a - avg) / avg <= 0.30); // within ±30%
    if (!allInRange) continue;

    const latestCategory = months[moKeys[moKeys.length - 1]][0].category;
    results.push({
      merchant,
      typicalAmount: Math.round(avg),
      monthCount: moKeys.length,
      months: moKeys,
      category: latestCategory,
      isSubscription: avg < 5000, // heuristic: <₹5000 = likely subscription
    });
  }
  return results.sort((a, b) => b.typicalAmount - a.typicalAmount).slice(0, 30);
}
