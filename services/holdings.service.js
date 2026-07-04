/**
 * services/holdings.service.js — all DB access for holdings + their CSV/CAS import.
 * Behavior is a verbatim move from the old routes/holdings.js; the route is now
 * a thin controller.
 */
import { randomUUID } from "crypto";
import { supabase } from "../lib/db.js";
import { sanitizeDates, enrichHoldings } from "../lib/holdings-utils.js";
import { yahooPrice, stockPrice } from "../lib/prices.js";
import { holdingSchema, validateRows } from "../lib/validate.js";
import { takeSnapshot } from "../lib/snapshot.js";

const hId = () => "h_" + randomUUID().replace(/-/g, "").slice(0, 16);
const tId = () => "t_" + randomUUID().replace(/-/g, "").slice(0, 16);

// SIP signal fields so CalendarTab can detect active SIPs without client-side iteration.
function computeSipFields(transactions = []) {
  const transaction_count = transactions.length;
  const buyTxns = transactions
    .filter((t) => t.txn_type === "BUY" && t.txn_date)
    .sort((a, b) => b.txn_date.localeCompare(a.txn_date));
  if (buyTxns.length < 3) return { transaction_count, sip_day: null, sip_active: false, sip_avg_amount: null };
  const now = new Date();
  const nowMo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMo = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  const lastMo = buyTxns[0].txn_date.slice(0, 7);
  if (!(lastMo === nowMo || lastMo === prevMo)) return { transaction_count, sip_day: null, sip_active: false, sip_avg_amount: null };
  const cutoff = new Date(now.getFullYear(), now.getMonth() - 6, 1).toISOString().slice(0, 7);
  const activeMos = new Set(buyTxns.filter((t) => t.txn_date.slice(0, 7) >= cutoff).map((t) => t.txn_date.slice(0, 7)));
  if (activeMos.size < 3) return { transaction_count, sip_day: null, sip_active: false, sip_avg_amount: null };
  const freq = {};
  buyTxns.slice(0, 6).forEach((t) => { const d = +t.txn_date.slice(8, 10); freq[d] = (freq[d] || 0) + 1; });
  const sip_day = +Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
  const sip_avg_amount = buyTxns.slice(0, 3).reduce((s, t) => s + (+t.units) * (+t.price), 0) / 3;
  return { transaction_count, sip_day, sip_active: true, sip_avg_amount };
}

/** List holdings with artifacts + transactions, enriched with SIP/net-unit fields. */
export async function list(userId) {
  let { data, error } = await supabase
    .from("holdings")
    .select("*, artifacts(id,file_name,file_type,file_size,description,uploaded_at), transactions(id,txn_type,units,price,txn_date,notes,created_at)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) ({ data, error } = await supabase.from("holdings").select("*, artifacts(id,file_name,file_type,file_size,description,uploaded_at)").eq("user_id", userId).order("created_at", { ascending: true }));
  if (error) throw new Error(error.message);
  return enrichHoldings(data).map((h) =>
    h.type === "MF"
      ? { ...h, ...computeSipFields(h.transactions || []) }
      : { ...h, transaction_count: (h.transactions || []).length }
  );
}

/** Transactions for one holding (lazy load), scoped to the caller. */
export async function listTransactions(userId, holdingId) {
  const { data, error } = await supabase
    .from("transactions")
    .select("id,txn_type,units,price,price_usd,txn_date,notes,created_at")
    .eq("holding_id", holdingId)
    .eq("user_id", userId)
    .order("txn_date", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

/** CSV/CAS import (flush-and-fill for CAS, update-vs-insert for manual). */
export async function importHoldings(userId, body) {
  const { holdings, member_id, account_map, cas_statement_date, cas_period_start, cas_period_end } = body;

  const { invalid } = validateRows(holdingSchema.partial(), holdings);
  if (invalid.length > 0) console.warn(`[import] ${invalid.length} invalid row(s) flagged (kept — lenient import).`);

  let effectiveMemberId = member_id || null;
  // Only fall back to first portfolio member for non-CAS imports (CSV etc.).
  // For CAS imports the member must be explicit — the pMembers[0] fallback was
  // silently assigning imports to the wrong member (e.g. Avinash instead of TV RAO).
  if (!effectiveMemberId && !account_map) {
    const { data: portfolio } = await supabase.from("portfolio").select("members").eq("user_id", userId).single();
    const pMembers = portfolio?.members || [];
    if (pMembers.length > 0) effectiveMemberId = pMembers[0].id;
  }

  const isCASImport = !!cas_statement_date;
  if (isCASImport) {
    const affectedMemberIds = new Set();
    if (account_map) for (const mid of Object.values(account_map)) if (mid) affectedMemberIds.add(mid);
    if (effectiveMemberId) affectedMemberIds.add(effectiveMemberId);
    if (affectedMemberIds.size > 0) {
      await supabase.from("holdings").delete().eq("user_id", userId).eq("source", "cas").in("member_id", [...affectedMemberIds]);
    }
    await supabase.from("holdings").delete().eq("user_id", userId).eq("source", "cas").is("member_id", null);
  }

  const existingMap = {};
  if (!isCASImport) {
    const { data: existing } = await supabase.from("holdings").select("id, name, ticker, scheme_code, type").eq("user_id", userId);
    for (const h of (existing || [])) {
      const key = `${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`;
      existingMap[key] = h.id;
    }
  }

  await supabase.from("holdings").delete().eq("user_id", userId).like("notes", "%__demo__%");

  const inserted = [], updated = [], skipped = [], errors = [];
  const toInsert = [], toInsertTxns = [], toUpdate = [];

  for (const h of holdings) {
    const key = `${(h.ticker || h.scheme_code || h.name).toLowerCase()}|${h.type}`;
    const existingId = !isCASImport ? existingMap[key] : null;
    if (existingId && h._dupAction === "skip") { skipped.push(h.name); continue; }
    const isMF = (h.type || "IN_STOCK") === "MF";
    // account_map keys are holder names (e.g. "TV RAO").
    // _holder_name is set by the CAS parser; _account_name is a legacy alias.
    const holderKey = h._holder_name || h._account_name;
    const resolvedMember = (account_map && holderKey && account_map[holderKey]) || effectiveMemberId || h.member_id || null;
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
      const id = hId();
      toInsert.push({ ...payload, id, user_id: userId });
      inserted.push(h.name);
      const price = h.purchase_price || h.purchase_nav || 0;
      if (h.units && price) {
        toInsertTxns.push({ id: tId(), holding_id: id, user_id: userId, txn_type: "BUY", units: h.units, price, txn_date: h.start_date || new Date().toISOString().slice(0, 10), notes: "Imported from CSV" });
      }
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("holdings").insert(toInsert);
    if (error) { errors.push(`Batch insert error: ${error.message}`); inserted.length = 0; }
  }
  if (toInsertTxns.length > 0) await supabase.from("transactions").insert(toInsertTxns);
  for (const { id, payload, name } of toUpdate) {
    const { error } = await supabase.from("holdings").update(payload).eq("id", id);
    if (error) errors.push(`${name}: ${error.message}`); else updated.push(name);
  }

  return {
    ok: true,
    inserted_count: inserted.length, updated_count: updated.length,
    skipped_count: skipped.length, error_count: errors.length,
    inserted, updated, skipped, errors,
    validation: { invalid_count: invalid.length, invalid_sample: invalid.slice(0, 10).map((r) => ({ row: r.index, errors: r.errors })) },
    needs_price_refresh: inserted.length > 0 || updated.length > 0,
    _cas_statement_date: cas_statement_date || null,
  };
}

/** Fire-and-forget after import: snapshot + best-effort price backfill. */
export function runPostImport(userId, casStatementDate) {
  takeSnapshot(userId, { source: "cas_import", cas_statement_date: casStatementDate || null })
    .catch((e) => console.error("Auto-snapshot failed:", e.message));
  (async () => {
    try {
      const { data: fresh } = await supabase.from("holdings").select("id, type, ticker, scheme_code, units")
        .eq("user_id", userId).in("type", ["IN_STOCK", "IN_ETF"]).or("current_price.eq.0,current_price.is.null");
      if (!fresh?.length) return;
      for (const h of fresh) {
        if (!h.ticker || h.ticker.startsWith("INE")) continue;
        try {
          const q = await stockPrice(`${h.ticker.toUpperCase()}.NS`, "NSE");
          const price = q?.price ?? await yahooPrice(`${h.ticker.toUpperCase()}.BO`);
          if (price && price > 0) {
            await supabase.from("holdings").update({ current_price: price, current_value: (h.units || 0) * price, price_fetched_at: new Date().toISOString() }).eq("id", h.id);
          }
        } catch { /* skip */ }
        await new Promise((r) => setTimeout(r, 1200));
      }
    } catch (e) { console.log(`Post-import price fetch error: ${e.message}`); }
  })();
}

/** Create a manual holding (+ optional first transaction). */
export async function create(userId, body) {
  const { first_transaction, purchase_nav, current_nav, ...holdingData } = body;
  const isMF = holdingData.type === "MF";
  if (!holdingData.notes?.includes("__demo__"))
    await supabase.from("holdings").delete().eq("user_id", userId).like("notes", "%__demo__%");
  const insertData = { ...holdingData, user_id: userId, ...(isMF ? { purchase_nav: purchase_nav || 0, current_nav: current_nav || 0 } : {}) };
  const { error } = await supabase.from("holdings").insert(sanitizeDates(insertData));
  if (error) throw new Error(error.message);
  if (first_transaction && first_transaction.units && first_transaction.price) {
    await supabase.from("transactions").insert({ id: tId(), holding_id: holdingData.id, txn_type: first_transaction.txn_type || "BUY", units: Number(first_transaction.units), price: Number(first_transaction.price), txn_date: first_transaction.txn_date || holdingData.start_date || new Date().toISOString().slice(0, 10), notes: first_transaction.notes || "" });
  }
  return { ok: true };
}

/** Update one of the user's holdings. */
export async function update(userId, id, body) {
  const { artifacts, transactions, net_units, avg_cost, purchase_nav, current_nav, purchase_price, ...holdingData } = body;
  const isMF = holdingData.type === "MF";
  const updateData = { ...holdingData, ...(isMF ? { purchase_nav: purchase_nav || 0, current_nav: current_nav || 0 } : {}) };
  const { error } = await supabase.from("holdings").update(sanitizeDates(updateData)).eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Delete one of the user's holdings. */
export async function remove(userId, id) {
  const { error } = await supabase.from("holdings").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
