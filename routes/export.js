/**
 * routes/export.js — CSV export for holdings and transactions.
 * No external package needed — pure string CSV generation.
 *
 * GET /api/export/holdings     → wealthlens-holdings-YYYY-MM-DD.csv
 * GET /api/export/transactions → wealthlens-transactions-YYYY-MM-DD.csv
 */
import { Router } from "express";
import { auth, sendError } from "../lib/auth.js";
import { list } from "../services/holdings.service.js";
import { supabase } from "../lib/db.js";

const router = Router();

/** Escape a single CSV cell value. */
function cell(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
function row(cells) { return cells.map(cell).join(","); }
function today()    { return new Date().toISOString().slice(0, 10); }
function n2(v)      { return v != null ? Number(v).toFixed(2) : ""; }

/** Serve a CSV string as a file download. */
function sendCsv(res, csv, filename) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // UTF-8 BOM — makes Excel auto-detect encoding correctly
  res.send("﻿" + csv);
}

// ── Holdings ──────────────────────────────────────────────────────────────────
router.get("/holdings", auth, async (req, res) => {
  try {
    const holdings = await list(req.user.id);

    const headers = [
      "Name","Type","Member ID","Ticker","Scheme Code",
      "Net Units","Avg Cost (INR)","Invested (INR)","Current Value (INR)",
      "Gain (INR)","Gain %","XIRR %",
      "Interest Rate %","Principal","Sum Assured","Premium","Premium Frequency",
      "Currency","Policy Type",
      "Start Date","Maturity Date","Source",
    ];

    const rows = [row(headers)];

    for (const h of holdings) {
      // Best-effort invested & current value in INR
      const inv = h.avg_cost != null && h.net_units != null
        ? h.net_units * h.avg_cost
        : (h.purchase_value || h.principal || 0);
      const cur  = h.current_value || 0;
      const gain = cur - inv;
      const pct  = inv > 0 ? ((gain / inv) * 100).toFixed(2) : "";

      rows.push(row([
        h.name,
        h.type,
        h.member_id || "",
        h.ticker || "",
        h.scheme_code || "",
        h.net_units != null ? h.net_units : (h.units || ""),
        h.avg_cost != null ? n2(h.avg_cost) : "",
        n2(inv),
        n2(cur),
        n2(gain),
        pct,
        h.xirr != null ? Number(h.xirr).toFixed(2) : "",
        h.interest_rate || "",
        h.principal || "",
        h.sum_assured || "",
        h.premium || "",
        h.premium_frequency || "",
        h.currency || "INR",
        h.policy_type || "",
        h.start_date || "",
        h.maturity_date || "",
        h.source || "manual",
      ]));
    }

    sendCsv(res, rows.join("\r\n"), `wealthlens-holdings-${today()}.csv`);
  } catch (e) { sendError(res, e); }
});

// ── Transactions ──────────────────────────────────────────────────────────────
router.get("/transactions", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("transactions")
      .select("*, holdings(name, type, ticker, scheme_code, member_id)")
      .eq("user_id", req.user.id)
      .order("txn_date", { ascending: false });
    if (error) throw new Error(error.message);

    const headers = [
      "Date","Holding Name","Holding Type","Member ID",
      "Ticker / Scheme","Txn Type",
      "Units","Price (INR)","Price USD","Amount (INR)","Total (INR)","Notes",
    ];
    const rows = [row(headers)];

    for (const t of (data || [])) {
      const h       = t.holdings || {};
      const units   = Number(t.units  || 0);
      const price   = Number(t.price  || 0);
      const amount  = Number(t.amount || 0); // DIVIDEND cash field
      const isDivid = t.txn_type === "DIVIDEND";
      const total   = isDivid ? amount : units * price;

      rows.push(row([
        t.txn_date,
        h.name || "",
        h.type || "",
        h.member_id || "",
        h.ticker || h.scheme_code || "",
        t.txn_type,
        isDivid ? (units || "") : n2(units),
        isDivid ? "" : n2(price),
        t.price_usd != null ? n2(t.price_usd) : "",
        isDivid ? n2(amount) : "",
        n2(total),
        t.notes || "",
      ]));
    }

    sendCsv(res, rows.join("\r\n"), `wealthlens-transactions-${today()}.csv`);
  } catch (e) { sendError(res, e); }
});

export default router;
