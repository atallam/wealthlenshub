/**
 * lib/casDiff.js — pure helpers for the CAS import pipeline.
 *
 *   parse (Python) → normalize → group by member → diff vs DB → preview → apply (RPC)
 *
 * Nothing in here touches the database, so every function is unit-testable.
 *
 * Natural key of a CAS holding:  member_id + depository + account_id + isin
 *   depository  NSDL | CDSL | CAMS | KFINTECH
 *   account_id  "dpid/clientid" (demat) | folio number (RTA) | "MF-FOLIOS"
 */

const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? 0 : Number(v));
const eq  = (a, b, tol = 1e-6) => Math.abs(num(a) - num(b)) <= tol;

/** Normalise a parsed holding: guarantee isin / account_id, strip UI-only fields. */
export function normalizeCasHolding(h) {
  const isin = String(h.isin || h.ticker || h.scheme_code || "").trim().toUpperCase();
  return {
    isin,
    account_id:     String(h.account_id || h._folio || "").trim() || "UNKNOWN",
    name:           h.name || isin,
    type:           h.type || "IN_STOCK",
    ticker:         h.ticker || isin,
    scheme_code:    h.scheme_code || "",
    units:          num(h.units),
    purchase_nav:   h.purchase_nav   ?? null,
    current_nav:    h.current_nav    ?? null,
    purchase_price: h.purchase_price ?? null,
    current_price:  h.current_price  ?? null,
    purchase_value: num(h.purchase_value),
    current_value:  num(h.current_value),
    brokerage_name: h.brokerage_name || null,
    currency:       h.currency || "INR",
    start_date:     h.start_date || null,
    asset_class:    h.asset_class || null,
    // Ledger rows from a detailed CAMS/KFin CAS (empty for summary / depository CAS)
    transactions:   Array.isArray(h.transactions) ? h.transactions.filter((t) => t && t.external_key && t.txn_date) : [],
    // pass-through hints used for member resolution / dup decisions
    _holder_name:   h._holder_name || h._account_name || null,
    _pan:           h._pan || null,
    _dupAction:     h._dupAction || null,
  };
}

/**
 * Resolve each holding to a member and group them.
 *
 * Resolution order per row: account_map[holder_name] → member_id (single-holder
 * default) → row.member_id. Rows that resolve to nothing are returned in
 * `unmatched` and never written (silently assigning to the wrong member was the
 * original bug this pipeline replaces).
 */
export function groupByMember(holdings, { account_map = null, member_id = null } = {}) {
  const groups = new Map();
  const unmatched = [];
  for (const raw of holdings) {
    const h = normalizeCasHolding(raw);
    if (!h.isin) { unmatched.push({ ...h, _reason: "no_isin" }); continue; }
    const mid = (account_map && h._holder_name && account_map[h._holder_name]) || member_id || raw.member_id || null;
    if (!mid) { unmatched.push({ ...h, _reason: "no_member" }); continue; }
    if (!groups.has(mid)) groups.set(mid, { member_id: mid, account_ids: new Set(), rows: [] });
    const g = groups.get(mid);
    g.account_ids.add(h.account_id);
    g.rows.push(h);
  }
  return {
    groups: [...groups.values()].map((g) => ({ ...g, account_ids: [...g.account_ids] })),
    unmatched,
  };
}

/**
 * Diff incoming groups against existing CAS rows for the same user.
 *
 * @param groups    output of groupByMember
 * @param existing  holdings rows: { id, member_id, depository, account_id, isin, units,
 *                  current_value, holding_status, source_date, name }
 * @param depository the statement's depository
 * @param statementDate ISO date of the statement (for "older statement" detection)
 */
export function diffCas(groups, existing, { depository, statementDate = null } = {}) {
  const key = (m, d, a, i) => `${m || ""}|${d}|${a}|${i}`;
  const byKey = new Map();
  const activeByMemberIsin = new Map(); // member|isin → rows (cross-depository overlap)
  const legacyByMember = new Map();

  for (const e of existing || []) {
    if (e.source !== "cas" && e.source !== undefined) continue;
    byKey.set(key(e.member_id, e.depository, e.account_id, e.isin), e);
    if (e.holding_status !== "exited") {
      const k = `${e.member_id || ""}|${e.isin}`;
      if (!activeByMemberIsin.has(k)) activeByMemberIsin.set(k, []);
      activeByMemberIsin.get(k).push(e);
      if (e.depository === "LEGACY") {
        legacyByMember.set(e.member_id, (legacyByMember.get(e.member_id) || 0) + 1);
      }
    }
  }

  const rows = [];
  const exited = [];
  const overlaps = [];
  const summary = { new: 0, changed: 0, unchanged: 0, exited: 0, older: 0, overlap: 0, transactions: 0, approx_cost: 0 };

  for (const g of groups) {
    const incomingIsins = new Set(g.rows.map((r) => r.isin));

    for (const r of g.rows) {
      const ex = byKey.get(key(g.member_id, depository, r.account_id, r.isin));
      let status;
      let delta = null;
      if (!ex || ex.holding_status === "exited") {
        status = ex ? "reentered" : "new";
        summary.new++;
      } else if (statementDate && ex.source_date && statementDate < ex.source_date) {
        status = "older";
        summary.older++;
      } else if (eq(ex.units, r.units) && eq(ex.current_value, r.current_value, 0.5)) {
        status = "unchanged";
        summary.unchanged++;
      } else {
        status = "changed";
        delta = { units: r.units - num(ex.units), value: r.current_value - num(ex.current_value) };
        summary.changed++;
      }

      // Same member + ISIN already active from a different statement family.
      // Legit for stocks (two demat accounts) but a double count for MFs when
      // an RTA CAS and a depository CAS both list the folio.
      const others = (activeByMemberIsin.get(`${g.member_id}|${r.isin}`) || [])
        .filter((o) => o.depository !== depository && o.depository !== "LEGACY");
      let overlap = null;
      if (others.length) {
        overlap = others.map((o) => ({ id: o.id, depository: o.depository, account_id: o.account_id, units: num(o.units) }));
        summary.overlap++;
        overlaps.push({ member_id: g.member_id, isin: r.isin, name: r.name, type: r.type, with: overlap });
      }

      const txnCount = r.transactions.length;
      const approx = r.transactions.some((t) => t.source_type === "OPENING");
      summary.transactions += txnCount;
      if (approx) summary.approx_cost++;

      rows.push({
        member_id: g.member_id, isin: r.isin, account_id: r.account_id, name: r.name, type: r.type,
        units: r.units, current_value: r.current_value,
        status, delta, overlap, existing_id: ex?.id || null,
        transactions: txnCount, approx_cost: approx,
      });
    }

    // Anything active in these accounts that the statement no longer lists.
    for (const e of existing || []) {
      if (e.holding_status === "exited") continue;
      if ((e.member_id || null) !== (g.member_id || null)) continue;
      if (e.depository !== depository) continue;
      if (!g.account_ids.includes(e.account_id)) continue;
      if (incomingIsins.has(e.isin)) continue;
      if (statementDate && e.source_date && statementDate < e.source_date) continue;
      exited.push({ id: e.id, member_id: e.member_id, isin: e.isin, account_id: e.account_id, name: e.name, units: num(e.units), current_value: num(e.current_value) });
      summary.exited++;
    }
  }

  const legacy = [...legacyByMember.entries()]
    .filter(([m]) => groups.some((g) => (g.member_id || null) === (m || null)))
    .map(([member_id, count]) => ({ member_id, count }));

  return { summary, rows, exited, overlaps, legacy };
}

/**
 * Build the jsonb payload for apply_cas_snapshot(), honouring per-row dup
 * decisions: a row whose `_dupAction` is "skip" (user chose to keep the other
 * source) is dropped from the write set AND from exit detection.
 */
export function buildApplyGroups(groups, dupActions = {}) {
  return groups.map((g) => ({
    member_id: g.member_id,
    account_ids: g.account_ids,
    rows: g.rows
      .filter((r) => (dupActions[`${g.member_id}|${r.isin}`] || r._dupAction) !== "skip")
      .map(({ _holder_name, _pan, _dupAction, ...r }) => r),
  }));
}
