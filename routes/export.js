/**
 * routes/export.js — CSV and Excel export for holdings and transactions.
 *
 * GET /api/export/holdings      → wealthlens-holdings-YYYY-MM-DD.csv
 * GET /api/export/transactions  → wealthlens-transactions-YYYY-MM-DD.csv
 * GET /api/export/xlsx          → wealthlens-portfolio-YYYY-MM-DD.xlsx  (multi-sheet)
 * GET /api/export/report        → wealthlens-report-YYYY-MM-DD.html     (print-optimized)
 */
import { Router } from "express";
import ExcelJS    from "exceljs";
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

// ── Portfolio PDF Report (print-optimized HTML) ───────────────────────────────
router.get("/report", auth, async (req, res) => {
  try {
    const userId   = req.user.id;
    const dateStr  = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
    const isoDate  = today();

    const [holdings, { data: profile }] = await Promise.all([
      list(userId),
      supabase.from("profiles").select("email").eq("id", userId).single(),
    ]);

    const totalInv = holdings.reduce((s, h) => {
      const inv = h.avg_cost != null && h.net_units != null
        ? Number(h.net_units) * Number(h.avg_cost)
        : Number(h.purchase_value || h.principal || 0);
      return s + inv;
    }, 0);
    const totalCur = holdings.reduce((s, h) => s + Number(h.current_value || 0), 0);
    const totalGain = totalCur - totalInv;
    const totalPct  = totalInv > 0 ? ((totalGain / totalInv) * 100) : 0;
    const gainColor = totalGain >= 0 ? "#15803d" : "#dc2626";

    // Group by type
    const byType = {};
    for (const h of holdings) {
      if (!byType[h.type]) byType[h.type] = { cur: 0, inv: 0, count: 0 };
      byType[h.type].cur   += Number(h.current_value || 0);
      byType[h.type].inv   += (h.avg_cost != null && h.net_units != null)
        ? Number(h.net_units) * Number(h.avg_cost)
        : Number(h.purchase_value || h.principal || 0);
      byType[h.type].count++;
    }

    const fmtInr = v => `₹${Math.round(v).toLocaleString("en-IN")}`;
    const fmtPct = v => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

    // Top 10 holdings by current value
    const top10 = [...holdings]
      .filter(h => h.current_value > 0)
      .sort((a, b) => Number(b.current_value) - Number(a.current_value))
      .slice(0, 10);

    const allocationRows = Object.entries(byType)
      .sort((a, b) => b[1].cur - a[1].cur)
      .map(([type, v]) => {
        const pct   = totalCur > 0 ? (v.cur / totalCur) * 100 : 0;
        const gPct  = v.inv > 0 ? ((v.cur - v.inv) / v.inv) * 100 : 0;
        const gc    = gPct >= 0 ? "#15803d" : "#dc2626";
        return `<tr>
          <td>${type}</td>
          <td>${v.count}</td>
          <td style="text-align:right">${fmtInr(v.cur)}</td>
          <td style="text-align:right">${pct.toFixed(1)}%</td>
          <td style="text-align:right;color:${gc}">${fmtPct(gPct)}</td>
        </tr>`;
      }).join("");

    const holdingRows = top10.map(h => {
      const inv   = h.avg_cost != null && h.net_units != null
        ? Number(h.net_units) * Number(h.avg_cost)
        : Number(h.purchase_value || h.principal || 0);
      const cur   = Number(h.current_value || 0);
      const gain  = cur - inv;
      const gPct  = inv > 0 ? ((gain / inv) * 100) : 0;
      const gc    = gPct >= 0 ? "#15803d" : "#dc2626";
      const portPct = totalCur > 0 ? ((cur / totalCur) * 100) : 0;
      return `<tr>
        <td>${cell(h.name)}</td>
        <td>${h.type}</td>
        <td style="text-align:right">${fmtInr(cur)}</td>
        <td style="text-align:right">${portPct.toFixed(1)}%</td>
        <td style="text-align:right;color:${gc}">${fmtPct(gPct)}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>WealthLens Hub — Portfolio Report ${isoDate}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 13px; color: #1a1a2e; background: #fff; }
    @page { size: A4; margin: 18mm 16mm; }
    @media print {
      .no-print { display: none !important; }
      body { font-size: 11px; }
      table { page-break-inside: avoid; }
    }

    /* Print button (screen only) */
    .no-print {
      position: fixed; top: 16px; right: 16px; z-index: 999;
      background: #1e3a5f; color: #fff; border: none; padding: 10px 20px;
      border-radius: 6px; font-size: 13px; cursor: pointer; font-weight: 600;
    }
    .no-print:hover { background: #163060; }

    header { border-bottom: 3px solid #1e3a5f; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
    .brand { font-size: 20px; font-weight: 700; color: #1e3a5f; letter-spacing: -.5px; }
    .brand span { color: #c9a84c; }
    .report-meta { font-size: 11px; color: #666; text-align: right; line-height: 1.6; }

    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .metric-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; }
    .metric-card .label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #888; margin-bottom: 4px; }
    .metric-card .value { font-size: 18px; font-weight: 700; color: #1a1a2e; }
    .metric-card .sub   { font-size: 11px; color: #888; margin-top: 2px; }

    section { margin-bottom: 24px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #1e3a5f; margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }

    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #888; padding: 7px 10px; border-bottom: 2px solid #e5e7eb; font-weight: 600; }
    td { padding: 7px 10px; border-bottom: 1px solid #f0f0f0; font-size: 12px; }
    tr:last-child td { border-bottom: none; }
    tr:nth-child(even) { background: #f9fafb; }
    th:last-child, td:last-child { text-align: right; }

    footer { margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 10px; font-size: 10px; color: #aaa; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <button class="no-print" onclick="window.print()">🖨 Print / Save PDF</button>

  <header>
    <div>
      <div class="brand">✦ Wealth<span>Lens</span> Hub</div>
      <div style="font-size:12px;color:#888;margin-top:3px">Portfolio Report</div>
    </div>
    <div class="report-meta">
      Generated: ${dateStr}<br>
      ${profile?.email ? `Account: ${profile.email}<br>` : ""}
      Holdings: ${holdings.length}
    </div>
  </header>

  <div class="summary-grid">
    <div class="metric-card">
      <div class="label">Current Value</div>
      <div class="value">${fmtInr(totalCur)}</div>
      <div class="sub">${holdings.length} holdings</div>
    </div>
    <div class="metric-card">
      <div class="label">Invested</div>
      <div class="value">${fmtInr(totalInv)}</div>
      <div class="sub">cost basis</div>
    </div>
    <div class="metric-card">
      <div class="label">Total Gain</div>
      <div class="value" style="color:${gainColor}">${fmtInr(Math.abs(totalGain))}</div>
      <div class="sub" style="color:${gainColor}">${totalGain >= 0 ? "profit" : "loss"}</div>
    </div>
    <div class="metric-card">
      <div class="label">Return</div>
      <div class="value" style="color:${gainColor}">${fmtPct(totalPct)}</div>
      <div class="sub">simple return</div>
    </div>
  </div>

  <section>
    <h2>Asset Allocation</h2>
    <table>
      <thead><tr>
        <th>Asset Type</th><th>Holdings</th><th style="text-align:right">Value (INR)</th>
        <th style="text-align:right">Portfolio %</th><th style="text-align:right">Return</th>
      </tr></thead>
      <tbody>${allocationRows}</tbody>
    </table>
  </section>

  <section>
    <h2>Top Holdings (by value)</h2>
    <table>
      <thead><tr>
        <th>Name</th><th>Type</th><th style="text-align:right">Value (INR)</th>
        <th style="text-align:right">Portfolio %</th><th style="text-align:right">Return</th>
      </tr></thead>
      <tbody>${holdingRows}</tbody>
    </table>
  </section>

  <footer>
    <span>WealthLens Hub — Confidential Portfolio Report</span>
    <span>${dateStr}</span>
  </footer>
</body>
</html>`;

    const filename = `wealthlens-report-${isoDate}.html`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.send(html);
  } catch (e) { sendError(res, e); }
});

// ── Excel (multi-sheet) ───────────────────────────────────────────────────────
router.get("/xlsx", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch data in parallel
    const [holdings, { data: txns }, { data: fds }] = await Promise.all([
      list(userId),
      supabase
        .from("transactions")
        .select("*, holdings(name, type, ticker, scheme_code, member_id)")
        .eq("user_id", userId)
        .order("txn_date", { ascending: false }),
      supabase
        .from("holdings")
        .select("*")
        .eq("user_id", userId)
        .eq("type", "FD")
        .order("maturity_date", { ascending: true }),
    ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = "WealthLens Hub";
    wb.created = new Date();

    // ── Header style helper ────────────────────────────────────────────────────
    const headerStyle = {
      font:      { bold: true, color: { argb: "FFFFFFFF" } },
      fill:      { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } },
      alignment: { vertical: "middle", horizontal: "center" },
      border: {
        bottom: { style: "thin", color: { argb: "FFAAAAAA" } },
      },
    };
    const moneyFmt = '#,##0.00';
    const pctFmt   = '0.00"%"';

    function addHeaders(sheet, cols) {
      sheet.columns = cols;
      const hrow = sheet.getRow(1);
      hrow.eachCell(cell => Object.assign(cell, headerStyle));
      hrow.height = 22;
      sheet.views = [{ state: "frozen", ySplit: 1 }];
    }

    // ── Sheet 1: Holdings ──────────────────────────────────────────────────────
    const wsH = wb.addWorksheet("Holdings");
    addHeaders(wsH, [
      { header: "Name",             key: "name",       width: 30 },
      { header: "Type",             key: "type",       width: 12 },
      { header: "Ticker",           key: "ticker",     width: 14 },
      { header: "Member",           key: "member",     width: 14 },
      { header: "Units",            key: "units",      width: 14, style: { numFmt: '#,##0.0000' } },
      { header: "Avg Cost (INR)",   key: "avgCost",    width: 16, style: { numFmt: moneyFmt } },
      { header: "Invested (INR)",   key: "invested",   width: 16, style: { numFmt: moneyFmt } },
      { header: "Current Val (INR)",key: "curVal",     width: 18, style: { numFmt: moneyFmt } },
      { header: "Gain (INR)",       key: "gain",       width: 16, style: { numFmt: moneyFmt } },
      { header: "Gain %",           key: "gainPct",    width: 10, style: { numFmt: pctFmt } },
      { header: "XIRR %",          key: "xirr",       width: 10, style: { numFmt: pctFmt } },
    ]);
    for (const h of holdings) {
      const inv  = h.avg_cost != null && h.net_units != null
        ? h.net_units * h.avg_cost
        : (h.purchase_value || h.principal || 0);
      const cur  = h.current_value || 0;
      const gain = cur - inv;
      const r = wsH.addRow({
        name:    h.name,
        type:    h.type,
        ticker:  h.ticker || "",
        member:  h.member_id || "",
        units:   h.net_units != null ? h.net_units : (h.units || ""),
        avgCost: h.avg_cost || "",
        invested: inv,
        curVal:  cur,
        gain,
        gainPct: inv > 0 ? (gain / inv) * 100 : "",
        xirr:    h.xirr != null ? Number(h.xirr) : "",
      });
      // Color gain/loss cell
      const gainCell = r.getCell("gain");
      gainCell.font = { color: { argb: gain >= 0 ? "FF1E7E34" : "FFC82333" } };
    }
    wsH.autoFilter = { from: "A1", to: `K1` };

    // ── Sheet 2: Transactions ─────────────────────────────────────────────────
    const wsT = wb.addWorksheet("Transactions");
    addHeaders(wsT, [
      { header: "Date",         key: "date",    width: 14 },
      { header: "Holding",      key: "holding", width: 28 },
      { header: "Type",         key: "type",    width: 12 },
      { header: "Txn Type",     key: "txnType", width: 12 },
      { header: "Ticker",       key: "ticker",  width: 14 },
      { header: "Member",       key: "member",  width: 14 },
      { header: "Units",        key: "units",   width: 14, style: { numFmt: '#,##0.0000' } },
      { header: "Price (INR)",  key: "price",   width: 14, style: { numFmt: moneyFmt } },
      { header: "Total (INR)",  key: "total",   width: 16, style: { numFmt: moneyFmt } },
      { header: "Notes",        key: "notes",   width: 24 },
    ]);
    for (const t of (txns || [])) {
      const h      = t.holdings || {};
      const units  = Number(t.units  || 0);
      const price  = Number(t.price  || 0);
      const amount = Number(t.amount || 0);
      const isDiv  = t.txn_type === "DIVIDEND";
      wsT.addRow({
        date:    t.txn_date,
        holding: h.name    || "",
        type:    h.type    || "",
        txnType: t.txn_type,
        ticker:  h.ticker  || h.scheme_code || "",
        member:  h.member_id || "",
        units:   isDiv ? "" : units,
        price:   isDiv ? "" : price,
        total:   isDiv ? amount : units * price,
        notes:   t.notes   || "",
      });
    }
    wsT.autoFilter = { from: "A1", to: "J1" };

    // ── Sheet 3: FDs ──────────────────────────────────────────────────────────
    const wsF = wb.addWorksheet("Fixed Deposits");
    addHeaders(wsF, [
      { header: "Name",         key: "name",     width: 28 },
      { header: "Member",       key: "member",   width: 14 },
      { header: "Principal",    key: "principal",width: 16, style: { numFmt: moneyFmt } },
      { header: "Currency",     key: "currency", width: 10 },
      { header: "Interest Rate",key: "rate",     width: 14, style: { numFmt: pctFmt } },
      { header: "Start Date",   key: "start",    width: 14 },
      { header: "Maturity Date",key: "maturity", width: 14 },
      { header: "Current Val",  key: "curVal",   width: 16, style: { numFmt: moneyFmt } },
    ]);
    for (const fd of (fds || [])) {
      wsF.addRow({
        name:      fd.name,
        member:    fd.member_id || "",
        principal: fd.principal || 0,
        currency:  fd.currency  || "INR",
        rate:      fd.interest_rate || "",
        start:     fd.start_date    || "",
        maturity:  fd.maturity_date || "",
        curVal:    fd.current_value || fd.principal || 0,
      });
    }

    // ── Sheet 4: Summary ──────────────────────────────────────────────────────
    const wsS = wb.addWorksheet("Summary");
    wsS.getColumn("A").width = 28;
    wsS.getColumn("B").width = 20;

    const totalInvested = holdings.reduce((s, h) => {
      const inv = h.avg_cost != null && h.net_units != null
        ? h.net_units * h.avg_cost
        : (h.purchase_value || h.principal || 0);
      return s + inv;
    }, 0);
    const totalCurrent = holdings.reduce((s, h) => s + (h.current_value || 0), 0);
    const totalGain    = totalCurrent - totalInvested;

    const summaryRows = [
      ["Portfolio Summary",    ""],
      ["Generated",            new Date().toLocaleDateString("en-IN")],
      [""],
      ["Total Holdings",       holdings.length],
      ["Total Transactions",   (txns || []).length],
      [""],
      ["Total Invested (INR)", totalInvested],
      ["Current Value (INR)",  totalCurrent],
      ["Total Gain (INR)",     totalGain],
      ["Return %",             totalInvested > 0 ? ((totalGain / totalInvested) * 100).toFixed(2) + "%" : ""],
    ];

    for (const [label, value] of summaryRows) {
      const r = wsS.addRow([label, value]);
      if (label === "Portfolio Summary") {
        r.getCell(1).font = { bold: true, size: 14 };
        r.height = 24;
      } else if (["Total Invested (INR)", "Current Value (INR)", "Total Gain (INR)"].includes(label)) {
        r.getCell(2).numFmt = moneyFmt;
        if (label === "Total Gain (INR)") {
          r.getCell(2).font = { color: { argb: totalGain >= 0 ? "FF1E7E34" : "FFC82333" } };
        }
      }
    }

    // ── Send ──────────────────────────────────────────────────────────────────
    const filename = `wealthlens-portfolio-${today()}.xlsx`;
    res.setHeader("Content-Type",        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { sendError(res, e); }
});

export default router;
