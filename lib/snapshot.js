// Shared snapshot logic — used by routes/snapshots.js (per-user HTTP) and
// routes/cron.js (all-users background refresh) so the computation is consistent.
import { supabase } from "./db.js";
import { fetchUsdInr, FX_FALLBACK } from "./prices.js";
import { USD_TYPES } from "./constants.js";

/**
 * Take a net-worth snapshot for a single user.
 *
 * @param {string} userId
 * @param {object} opts
 * @param {string} [opts.source="manual"]          - source label stored on the row
 * @param {string} [opts.cas_statement_date=null]  - if set, pins the snapshot to that month
 * @returns {Promise<{snapshot: object|null, message?: string}>}
 */
export async function takeSnapshot(userId, { source = "manual", cas_statement_date = null } = {}) {
  // Determine snapshot month
  let snapshotMonth;
  if (cas_statement_date) {
    snapshotMonth = cas_statement_date.slice(0, 7);
  } else {
    const now = new Date();
    snapshotMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  const { data: holdings } = await supabase
    .from("holdings")
    .select("id, member_id, type, units, purchase_price, current_price, purchase_value, current_value, currency")
    .eq("user_id", userId);

  if (!holdings?.length) return { snapshot: null, message: "No holdings to snapshot" };

  const { rate: usdInr } = await fetchUsdInr().catch(() => ({ rate: FX_FALLBACK }));

  const isUSD  = (h) => USD_TYPES.has(h.type) || (h.currency || "").toUpperCase() === "USD";
  const toINR  = (h) => { const v = h.current_value  || (h.units * h.current_price)  || 0; return isUSD(h) ? v * usdInr : v; };
  const invINR = (h) => { const v = h.purchase_value || (h.units * h.purchase_price) || 0; return isUSD(h) ? v * usdInr : v; };

  let totalInvested = 0, totalCurrent = 0;
  const memberBreakdown = {}, typeBreakdown = {};

  for (const h of holdings) {
    const cur = toINR(h), inv = invINR(h);
    totalInvested += inv; totalCurrent += cur;
    const mid = h.member_id || "unassigned";
    if (!memberBreakdown[mid]) memberBreakdown[mid] = { invested: 0, current: 0 };
    memberBreakdown[mid].invested += inv; memberBreakdown[mid].current += cur;
    const t = h.type || "OTHER";
    if (!typeBreakdown[t]) typeBreakdown[t] = { invested: 0, current: 0 };
    typeBreakdown[t].invested += inv; typeBreakdown[t].current += cur;
  }

  const { data: snap, error } = await supabase
    .from("net_worth_snapshots")
    .upsert({
      user_id: userId, snapshot_month: snapshotMonth,
      total_invested: Math.round(totalInvested), total_current: Math.round(totalCurrent),
      currency: "INR", member_breakdown: memberBreakdown, type_breakdown: typeBreakdown,
      source, cas_statement_date: cas_statement_date || null,
    }, { onConflict: "user_id,snapshot_month,currency" })
    .select().single();

  if (error) throw error;
  return { snapshot: snap };
}
