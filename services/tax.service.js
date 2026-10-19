/**
 * services/tax.service.js — LTCG / STCG tax computation (India, post Budget-2024).
 * Moved out of routes/tax.js (P3-2) — same queries, same FIFO math (lib/tax.js
 * is unchanged and still shared with routes/ai.js's get_tax_summary tool).
 */
import { supabase } from "../lib/db.js";
import { fetchAll } from "../lib/utils.js";
import { fyRange, computeGains, summarizeRealized } from "../lib/tax.js";

/**
 * Realized + unrealized LTCG/STCG for one user's equity holdings (IN_STOCK, IN_ETF, MF).
 * @param {string} userId
 * @param {{fy:string, member?:string}} opts  fy is required (caller resolves the default)
 */
export async function getGains(userId, { fy, member = "all" }) {
  const { start: fyStart, end: fyEnd } = fyRange(fy);

  // 1. Fetch taxable holdings
  let hq = supabase
    .from("holdings")
    .select("*")   // not a column list: `symbol` doesn't exist on holdings (it's `ticker`) and an unknown column fails the whole query
    .eq("user_id", userId)
    .in("type", ["IN_STOCK", "IN_ETF", "MF"]);

  if (member !== "all") hq = hq.eq("member_id", member);

  const { data: holdings, error: hErr } = await hq;
  if (hErr) throw new Error(hErr.message);

  if (!holdings || holdings.length === 0) {
    return {
      fy,
      realized:   { stcg: 0, ltcg: 0, ltcg_exemption: 125000, ltcg_taxable: 0, stcg_tax: 0, ltcg_tax: 0, total_tax: 0, details: [] },
      unrealized: { stcg: 0, ltcg: 0, details: [] },
    };
  }

  // 2. Fetch all transactions for those holdings
  const holdingIds = holdings.map(h => h.id);
  // Paged: FIFO needs the COMPLETE ledger — a silent 1000-row cut would mis-state every gain.
  const transactions = await fetchAll(() => supabase
    .from("transactions")
    .select("id, holding_id, txn_type, units, price, txn_date, source_type")
    .eq("user_id", userId)
    .in("holding_id", holdingIds)
    .order("txn_date", { ascending: true }));

  // 3. Group transactions by holding
  const txnMap = {};
  for (const t of (transactions || [])) {
    (txnMap[t.holding_id] ||= []).push(t);
  }

  // 4. FIFO per holding
  const realizedAll  = [];
  const unrealizedAll = [];

  for (const h of holdings) {
    if (h.maturity_status === "closed") continue;
    const txns = txnMap[h.id] || [];
    if (txns.length === 0) continue;

    const currentPrice = +(h.current_price || h.current_nav || 0);
    const { realized, unrealized } = computeGains(txns, fyStart, fyEnd, h.holding_status === "exited" ? 0 : currentPrice, { assetClass: h.asset_class });

    const meta = { holding_id: h.id, name: h.name, symbol: h.ticker || h.symbol, type: h.type, member_id: h.member_id, asset_class: h.asset_class || "EQUITY" };
    for (const r of realized)   realizedAll.push({ ...meta, ...r });
    for (const u of unrealized) unrealizedAll.push({ ...meta, ...u });
  }

  // 5. Aggregate (shared math in lib/tax.js)
  const summary = summarizeRealized(realizedAll);
  const stcgUR = unrealizedAll.filter(d => !d.is_ltcg).reduce((s, d) => s + d.gain, 0);
  const ltcgUR = unrealizedAll.filter(d =>  d.is_ltcg).reduce((s, d) => s + d.gain, 0);
  const slabUR = unrealizedAll.filter(d => d.rate_basis === "slab").reduce((s, d) => s + d.gain, 0);

  return {
    fy,
    realized: { ...summary, details: realizedAll },
    unrealized: { stcg: stcgUR, ltcg: ltcgUR, slab: slabUR, details: unrealizedAll },
  };
}
