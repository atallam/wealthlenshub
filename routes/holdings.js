import { Router } from "express";
import { randomUUID } from "crypto";
import { supabase } from "../lib/db.js";
import { auth, sendError } from "../lib/auth.js";
import { sanitizeDates, enrichHoldings } from "./portfolio.js";
import { yahooPrice, stockPrice } from "../lib/prices.js";
import { validate, holdingSchema, validateRows } from "../lib/validate.js";
import { auditImport } from "../lib/importLogger.js";
import { takeSnapshot } from "../lib/snapshot.js";

const router = Router();

// ── Compute SIP signal fields from transaction list ───────────────
// Returns { sip_day, sip_active, sip_avg_amount, transaction_count }
// so CalendarTab can detect active SIPs without iterating raw transactions client-side.
function computeSipFields(transactions = []) {
  const transaction_count = transactions.length;
  const buyTxns = transactions
    .filter(t => t.txn_type === "BUY" && t.txn_date)
    .sort((a, b) => b.txn_date.localeCompare(a.txn_date));

  if (buyTxns.length < 3) return { transaction_count, sip_day: null, sip_active: false, sip_avg_amount: null };

  const now = new Date();
  const nowMo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMo = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  const lastMo = buyTxns[0].txn_date.slice(0, 7);
  const isRecent = lastMo === nowMo || lastMo === prevMo;

  if (!isRecent) return { transaction_count, sip_day: null, sip_active: false, sip_avg_amount: null };

  const cutoff = new Date(now.getFullYear(), now.getMonth() - 6, 1).toISOString().slice(0, 7);
  const activeMos = new Set(buyTxns.filter(t => t.txn_date.slice(0, 7) >= cutoff).map(t => t.txn_date.slice(0, 7)));
  if (activeMos.size < 3) return { transaction_count, sip_day: null, sip_active: false, sip_avg_amount: null };

  // Most common day-of-month from recent buys
  const freq = {};
  buyTxns.slice(0, 6).forEach(t => { const d = +t.txn_date.slice(8, 10); freq[d] = (freq[d] || 0) + 1; });
  const sip_day = +Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];

  // Average amount (units × price) for last 3 buys
  const sip_avg_amount = buyTxns.slice(0, 3).reduce((s, t) => s + (+t.units) * (+t.price), 0) / 3;

  return { transaction_count, sip_day, sip_active: true, sip_avg_amount };
}

router.get("/", auth, async (req, res) => {
  let { data, error } = await supabase
    .from("holdings")
    .select("*, artifacts(id,file_name,file_type,file_size,description,uploaded_at), transactions(id,txn_type,units,price,txn_date,notes,created_at)")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: true });
  if (error) ({ data, error } = await supabase.from("holdings").select("*, artifacts(id,file_name,file_type,file_size,description,uploaded_at)").eq("user_id", req.user.id).order("created_at", { ascending: true }));
  if (error) return res.status(500).json({ error: error.message });

  // Inject SIP signal fields — lets CalendarTab detect SIPs without iterating transactions client-side
  const enriched = enrichHoldings(data).map(h => {
    if (h.type === "MF") {
      return { ...h, ...computeSipFields(h.transactions || []) };
    }
    return { ...h, transaction_count: (h.transactions || []).length };
  });
  res.json(enriched);
});

// ── Per-holding transaction fetch (lazy load) ─────────────────────
// Used by TransactionPanel to fetch fresh transactions on open
// instead of relying on possibly-stale inline data.
router.get("/:id/transactions", auth, async (req, res) => {
  const { data, error } = await supabase
    .from("transactions")
    .select("id,txn_type,units,price,price_usd,txn_date,notes,created_at")
    .eq("holding_id", req.params.id)
    .eq("user_id", req.user.id)        // IDOR guard: scope to caller (transactions has user_id)
    .order("txn_date", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post("/import", auth, auditImport("HOLDINGS_IMPORT"), async (req, res) => {
  const { holdings, member_id, account_map, cas_statement_date, cas_period_start, cas_period_end } = req.body;
  if (!holdings?.length) return res.status(400).json({ error: "No holdings to import" });

  // Validate each row before touching the database.
  const { valid, invalid } = validateRows(holdingSchema.partial(), holdings);
  if (invalid.length > 0) {
    console.warn(`[import] ${invalid.length} invalid row(s) rejected:`, invalid.slice(0, 5));
    // Warn but don't block — import may include partial/enriched data from parsers.
    // Full rejection would break CAS imports. Log for audit purposes only.
  }

  let effectiveMemberId = member_id || null;
  if (!effectiveMemberId) {
    const { data: portfolio } = await supabase.from("portfolio").select("members").eq("user_id", req.user.id).single();
    const pMembers = portfolio?.members || [];
    if (pMembers.length > 0) effectiveMemberId = pMembers[0].id;
  }

  // CAS imports are flush-and-fill: delete only the CAS holdings belonging to
  // the member(s) in this statement — never touch manual or other-source holdings.
  const isCASImport = !!cas_statement_date;
  if (isCASImport) {
    // Collect member IDs present in this CAS (via account_map + single member fallback).
    const affectedMemberIds = new Set();
    if (account_map) {
      for (const mid of Object.values(account_map)) { if (mid) affectedMemberIds.add(mid); }
    }
    if (effectiveMemberId) affectedMemberIds.add(effectiveMemberId);

    // Delete CAS holdings for affected members.
    // We run TWO deletes: one for matched member_ids, one for member_id IS NULL.
    // The IS NULL case catches legacy imports from before member tracking was added —
    // those holdings have source='cas' but no member_id and would survive an IN filter,
    // leaving stale wrong-NAV records that re-import can't overwrite.
    if (affectedMemberIds.size > 0) {
      await supabase.from("holdings").delete().eq("user_id", req.user.id).eq("source", "cas").in("member_id", [...affectedMemberIds]);
    }
    // Always clear null-member CAS holdings (legacy or unmatched).
    await supabase.from("holdings").delete().eq("user_id", req.user.id).eq("source", "cas").is("member_id", null);
  }

  // For non-CAS imports, build an existingMap to support update-vs-insert.
  const existingMap = {};
  if (!isCASImport) {
    const { data: existing } = await supabase.from("holdings").select("id, name, ticker, scheme_code, type").eq("user_id", req.user.id);
    for (const h of (existing || [])) {
      const key = `${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`;
      existingMap[key] = h.id;
    }
  }

  await supabase.from("holdings").delete().eq("user_id", req.user.id).like("notes", "%__demo__%");

  const inserted = [], updated = [], skipped = [], errors = [];
  const toInsert = [], toInsertTxns = [];
  const toUpdate = []; // { id, payload }

  for (const h of holdings) {
    const key = `${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`;
    const existingId = !isCASImport ? existingMap[key] : null;
    if (existingId && h._dupAction === "skip") { skipped.push(h.name); continue; }

    const isMF = (h.type || "IN_STOCK") === "MF";
    const resolvedMember = (account_map && h._account_name && account_map[h._account_name]) || effectiveMemberId || h.member_id || null;
    const payload = sanitizeDates({
      member_id: resolvedMember, type: h.type || "IN_STOCK", name: h.name,
      ticker: h.ticker || "", scheme_code: h.scheme_code || "",
      units: h.units || 0, purchase_price: h.purchase_price || 0, current_price: h.current_price || 0,
      ...(isMF ? { purchase_nav: h.purchase_nav || 0, current_nav: h.current_nav || 0 } : {}),
      purchase_value: h.purchase_value || 0, current_value: h.current_value || 0,
      principal: h.principal || 0, interest_rate: h.interest_rate || 0,
      start_date: h.start_date || null, maturity_date: h.maturity_date || null,
      usd_inr_rate: h.usd_inr_rate || null,
      ...(h.source ? { source: h.source } : {}),
      ...(h.brokerage_name ? { brokerage_name: h.brokerage_name } : {}),
      ...(h.currency ? { currency: h.currency } : {}),
      ...(cas_statement_date ? { source_date: cas_statement_date } : {}),
      ...(cas_period_start ? { cas_period_start } : {}),
      ...(cas_period_end ? { cas_period_end } : {}),
    });

    if (existingId) {
      toUpdate.push({ id: existingId, payload, name: h.name });
    } else {
      const id = "h_" + randomUUID().replace(/-/g, "").slice(0, 16);
      toInsert.push({ ...payload, id, user_id: req.user.id });
      inserted.push(h.name);
      const price = h.purchase_price || h.purchase_nav || 0;
      if (h.units && price) {
        toInsertTxns.push({ id: "t_" + randomUUID().replace(/-/g, "").slice(0, 16), holding_id: id, user_id: req.user.id, txn_type: "BUY", units: h.units, price, txn_date: h.start_date || new Date().toISOString().slice(0, 10), notes: "Imported from CSV" });
      }
    }
  }

  // Batch insert all new holdings in one DB call
  if (toInsert.length > 0) {
    const { error } = await supabase.from("holdings").insert(toInsert);
    if (error) { errors.push(`Batch insert error: ${error.message}`); inserted.length = 0; }
  }
  // Batch insert initial transactions in one DB call
  if (toInsertTxns.length > 0) {
    await supabase.from("transactions").insert(toInsertTxns);
  }
  // Updates must still be individual (each has a different payload + different id)
  for (const { id, payload, name } of toUpdate) {
    const { error } = await supabase.from("holdings").update(payload).eq("id", id);
    if (error) { errors.push(`${name}: ${error.message}`); } else { updated.push(name); }
  }

  res.json({
    ok: true,
    inserted_count: inserted.length, updated_count: updated.length,
    skipped_count: skipped.length, error_count: errors.length,
    inserted, updated, skipped, errors,
    // Import is intentionally LENIENT (rows failing schema validation are still
    // imported, because parser output is often partial/enriched). We now surface
    // what failed validation so the client can flag data-quality issues instead
    // of the failures being silently log-only. See AUDIT_REPORT.md P2-5.
    validation: {
      invalid_count: invalid.length,
      invalid_sample: invalid.slice(0, 10).map(r => ({ row: r.index, errors: r.errors })),
    },
    needs_price_refresh: inserted.length > 0 || updated.length > 0,
  });

  // Auto-snapshot (direct call — no self-HTTP round-trip)
  takeSnapshot(req.user.id, { source: "cas_import", cas_statement_date: cas_statement_date || null })
    .catch(e => console.error("Auto-snapshot failed:", e.message));

  // Background price fetch
  (async () => {
    try {
      const { data: freshHoldings } = await supabase.from("holdings").select("id, type, ticker, scheme_code, units").eq("user_id", req.user.id).in("type", ["IN_STOCK", "IN_ETF"]).or("current_price.eq.0,current_price.is.null");
      if (!freshHoldings?.length) return;
      for (const h of freshHoldings) {
        if (!h.ticker || h.ticker.startsWith("INE")) continue;
        try {
          const q = await stockPrice(`${h.ticker.toUpperCase()}.NS`, "NSE");
          const price = q?.price ?? await yahooPrice(`${h.ticker.toUpperCase()}.BO`);
          if (price && price > 0) {
            const cv = (h.units || 0) * price;
            await supabase.from("holdings").update({ current_price: price, current_value: cv, price_fetched_at: new Date().toISOString() }).eq("id", h.id);
          }
        } catch {}
        await new Promise(r => setTimeout(r, 1200));
      }
    } catch (e) { console.log(`Post-import price fetch error: ${e.message}`); }
  })();
});

router.post("/", auth, async (req, res) => {
  const { first_transaction, purchase_nav, current_nav, ...holdingData } = req.body;
  const isMF = holdingData.type === "MF";
  if (!holdingData.notes?.includes("__demo__"))
    await supabase.from("holdings").delete().eq("user_id", req.user.id).like("notes", "%__demo__%");
  const insertData = { ...holdingData, user_id: req.user.id, ...(isMF ? { purchase_nav: purchase_nav || 0, current_nav: current_nav || 0 } : {}) };
  const { error } = await supabase.from("holdings").insert(sanitizeDates(insertData));
  if (error) return res.status(500).json({ error: error.message });
  if (first_transaction && first_transaction.units && first_transaction.price) {
    await supabase.from("transactions").insert({ id: "t_" + randomUUID().replace(/-/g, "").slice(0, 16), holding_id: holdingData.id, txn_type: first_transaction.txn_type || "BUY", units: Number(first_transaction.units), price: Number(first_transaction.price), txn_date: first_transaction.txn_date || holdingData.start_date || new Date().toISOString().slice(0,10), notes: first_transaction.notes || "" });
  }
  res.json({ ok: true });
});

router.put("/:id", auth, async (req, res) => {
  const { artifacts, transactions, net_units, avg_cost, purchase_nav, current_nav, purchase_price, ...holdingData } = req.body;
  const isMF = holdingData.type === "MF";
  const updateData = { ...holdingData, ...(isMF ? { purchase_nav: purchase_nav || 0, current_nav: current_nav || 0 } : {}) };
  const { error } = await supabase.from("holdings").update(sanitizeDates(updateData)).eq("id", req.params.id).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.delete("/:id", auth, async (req, res) => {
  const { error } = await supabase.from("holdings").delete().eq("id", req.params.id).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
