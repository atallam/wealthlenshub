/**
 * routes/ai.js — AI Advisor with tool use + streaming agentic loop
 *
 * SSE event protocol (sent to client):
 *   { type:"text_delta",       text:"..." }
 *   { type:"tool_call_start",  name:"get_holdings", id:"toolu_xxx" }
 *   { type:"tool_result_start",name:"get_holdings", id:"toolu_xxx" }
 *   { type:"tool_result_end",  name:"get_holdings", id:"toolu_xxx" }
 *   { type:"done" }
 *   { type:"error",            error:"..." }
 */

import { Router }    from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { auth, sendError } from "../lib/auth.js";
import { supabase }  from "../lib/db.js";
import { currentFY, fyRange, computeGains, summarizeRealized } from "../lib/tax.js";
import { decrypt } from "../lib/crypto.js";

const router = Router();

const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI requests — please wait a minute before trying again." },
});

const ALLOWED_MODELS = new Set([
  "claude-haiku-4-5-20251001", "claude-haiku-4-5",
  "claude-sonnet-4-5", "claude-sonnet-4-5-20241022", "claude-sonnet-4-6",
]);

function validateAiRequest(req, res) {
  const key = process.env.ANTHROPIC_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_KEY not set on server" }); return null; }
  const m = req.body?.model;
  if (m && !ALLOWED_MODELS.has(m)) {
    res.status(400).json({ error: `Model '${m}' is not permitted.` });
    return null;
  }
  return { key, model: m || "claude-sonnet-4-6", max_tokens: Math.min(req.body?.max_tokens || 2048, 4096) };
}

// ── Tool definitions ───────────────────────────────────────────────────────

const ADVISOR_TOOLS = [
  {
    name: "get_portfolio_summary",
    description: "Get high-level portfolio summary: total current value, total invested, overall gain/loss, and breakdown by asset type. Use when the user asks about their overall portfolio, net worth, or total returns.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_holdings",
    description: "Get detailed list of holdings with values and gains. Can filter by asset type and/or family member. Use when the user asks about specific asset types (MF, stocks, FD, etc.) or a particular family member's investments.",
    input_schema: {
      type: "object",
      properties: {
        asset_type: { type: "string", description: "One of: IN_STOCK, IN_ETF, MF, US_STOCK, US_ETF, US_BOND, FD, PPF, EPF, CRYPTO, REAL_ESTATE, CASH, OTHER" },
        member_id:  { type: "string", description: "Family member ID to filter by" },
      },
    },
  },
  {
    name: "get_transactions",
    description: "Get transaction history (buys/sells) for a specific holding. Use when the user asks about buy/sell history, average cost, or SIP details for a specific investment.",
    input_schema: {
      type: "object",
      required: ["holding_id"],
      properties: {
        holding_id: { type: "string", description: "Holding ID (from get_holdings response)" },
      },
    },
  },
  {
    name: "get_goal_progress",
    description: "Get all financial goals with their targets, timelines, and current progress. Use when the user asks about their goals, retirement planning, or how much they need to save.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_tax_summary",
    description: "Get LTCG/STCG capital gains tax summary for Indian equity holdings (IN_STOCK, IN_ETF, MF). Shows realized gains, estimated tax, and harvesting opportunities. Use when the user asks about taxes, capital gains, or ITR filing.",
    input_schema: {
      type: "object",
      properties: {
        fy: { type: "string", description: "Indian FY like '2025-26'. Defaults to current FY." },
      },
    },
  },
  {
    name: "get_budget_summary",
    description: "Get spending summary by category for recent months. Use when the user asks about expenses, spending habits, where their money is going, or budget vs investment balance.",
    input_schema: {
      type: "object",
      properties: {
        months: { type: "number", description: "How many recent months to summarise (default 3, max 12)" },
      },
    },
  },
  {
    name: "get_watchlist",
    description: "Get the user's watchlist — tickers they are tracking with target prices and current prices. Use when the user asks about stocks they are watching, target prices, or what to buy next.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_snapshot_history",
    description: "Get net worth snapshot history showing how portfolio value has changed month by month. Use when the user asks about portfolio growth, wealth progression, or how much they have grown over time.",
    input_schema: {
      type: "object",
      properties: {
        months: { type: "number", description: "How many recent months to return (default 12, max 24)" },
      },
    },
  },
  {
    name: "get_fd_maturities",
    description: "Get upcoming FD (Fixed Deposit) maturities with amounts and dates. Use when the user asks about cash flow, reinvestment planning, or which FDs are maturing soon.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Look-ahead window in days (default 180)" },
      },
    },
  },
];

// ── Tax helpers ──────────────────────────────────────────────────────────────
// FIFO/FY math lives in lib/tax.js (shared with routes/tax.js so they can't drift).

// ── Tool executors ─────────────────────────────────────────────────────────

async function execTool(name, input, userId) {
  try {
    switch (name) {

      case "get_portfolio_summary": {
        const { data: h } = await supabase
          .from("holdings")
          .select("type, current_value, invested_value, member_name")
          .eq("user_id", userId);
        if (!h?.length) return { message: "No holdings found." };

        const cur = h.reduce((s, x) => s + (+x.current_value || 0), 0);
        const inv = h.reduce((s, x) => s + (+x.invested_value || 0), 0);
        const byType = {}, byMember = {};
        for (const x of h) {
          byType[x.type]     = (byType[x.type] || 0) + (+x.current_value || 0);
          byMember[x.member_name || "Unknown"] = (byMember[x.member_name || "Unknown"] || 0) + (+x.current_value || 0);
        }
        return {
          total_current_value_inr: Math.round(cur),
          total_invested_inr:      Math.round(inv),
          total_gain_inr:          Math.round(cur - inv),
          gain_pct:                inv > 0 ? +((cur - inv) / inv * 100).toFixed(2) : 0,
          holding_count:           h.length,
          by_asset_type:           Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v)])),
          by_member:               Object.fromEntries(Object.entries(byMember).map(([k, v]) => [k, Math.round(v)])),
        };
      }

      case "get_holdings": {
        let q = supabase.from("holdings")
          .select("id, name, ticker, symbol, type, units, current_price, current_nav, current_value, invested_value, member_name")
          .eq("user_id", userId)
          .order("current_value", { ascending: false })
          .limit(500);   // no practical limit — surface all holdings to the AI
        if (input.asset_type) q = q.eq("type", input.asset_type);
        if (input.member_id)  q = q.eq("member_id", input.member_id);
        const { data: h } = await q;
        if (!h?.length) return { holdings: [], count: 0 };
        return {
          count: h.length,
          holdings: h.map(x => ({
            id:                  x.id,
            name:                x.name,
            ticker:              x.ticker || x.symbol,
            type:                x.type,
            units:               x.units,
            current_price_inr:   x.current_price || x.current_nav,
            current_value_inr:   Math.round(+x.current_value || 0),
            invested_value_inr:  Math.round(+x.invested_value || 0),
            gain_inr:            Math.round((+x.current_value || 0) - (+x.invested_value || 0)),
            gain_pct:            +x.invested_value > 0 ? +(((+x.current_value - +x.invested_value) / +x.invested_value) * 100).toFixed(1) : 0,
            member:              x.member_name,
          })),
        };
      }

      case "get_transactions": {
        // IDOR guard: scope to the caller's own transactions. Without this,
        // a user could ask the advisor for another user's holding_id and
        // exfiltrate their transactions through the model.
        const { data: t } = await supabase
          .from("transactions")
          .select("txn_type, units, price, txn_date, notes")
          .eq("holding_id", input.holding_id)
          .eq("user_id", userId)
          .order("txn_date", { ascending: false })
          .limit(25);
        return { transactions: t || [], count: t?.length || 0 };
      }

      case "get_goal_progress": {
        const { data: p } = await supabase
          .from("portfolio").select("goals").eq("user_id", userId).single();
        return { goals: p?.goals || [], count: p?.goals?.length || 0 };
      }

      case "get_tax_summary": {
        const fy = input.fy || currentFY();
        const { start, end } = fyRange(fy);
        const { data: holdings } = await supabase
          .from("holdings").select("id, name, type").eq("user_id", userId)
          .in("type", ["IN_STOCK", "IN_ETF", "MF"]);
        if (!holdings?.length) return { fy, stcg: 0, ltcg: 0, estimated_tax: 0 };
        const { data: txns } = await supabase
          .from("transactions").select("holding_id, txn_type, units, price, txn_date")
          .in("holding_id", holdings.map(h => h.id));
        const txnMap = {};
        for (const t of (txns || [])) (txnMap[t.holding_id] ||= []).push(t);
        // Shared FIFO math (lib/tax.js) — aggregate realized rows across holdings.
        const realizedAll = [];
        for (const h of holdings) {
          const { realized } = computeGains(txnMap[h.id] || [], start, end, 0);
          realizedAll.push(...realized);
        }
        const s = summarizeRealized(realizedAll);
        return {
          fy, stcg: Math.round(s.stcg), ltcg: Math.round(s.ltcg),
          ltcg_exemption: s.ltcg_exemption, ltcg_taxable: Math.round(s.ltcg_taxable),
          estimated_tax: Math.round(s.total_tax),
        };
      }

      case "get_budget_summary": {
        const lookbackMonths = Math.min(Math.max(input.months || 3, 1), 12);
        const since = new Date();
        since.setMonth(since.getMonth() - lookbackMonths);
        const sinceStr = since.toISOString().slice(0, 10);

        const { data: txns } = await supabase
          .from("budget_transactions")
          .select("category, amount, txn_type, txn_date, description")
          .eq("user_id", userId)
          .gte("txn_date", sinceStr)
          .order("txn_date", { ascending: false })
          .limit(2000);

        if (!txns?.length) return { message: "No budget transactions found for this period." };

        // Aggregate by category (debits = spending)
        const byCategory = {};
        let totalSpend = 0, totalIncome = 0;
        for (const t of txns) {
          const cat = t.category || "Uncategorised";
          const amt = Number(t.amount || 0);
          if (t.txn_type === "DEBIT") {
            byCategory[cat] = (byCategory[cat] || 0) + amt;
            totalSpend += amt;
          } else {
            totalIncome += amt;
          }
        }

        const categories = Object.entries(byCategory)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([cat, amt]) => ({
            category: cat,
            amount: Math.round(amt),
            pct_of_spend: totalSpend > 0 ? +((amt / totalSpend) * 100).toFixed(1) : 0,
          }));

        return {
          period_months: lookbackMonths,
          total_spend: Math.round(totalSpend),
          total_income: Math.round(totalIncome),
          net_cashflow: Math.round(totalIncome - totalSpend),
          transaction_count: txns.length,
          top_categories: categories,
        };
      }

      case "get_watchlist": {
        const { data: items } = await supabase
          .from("watchlist")
          .select("id, name, ticker, asset_type, target_price, notes, current_price, price_change_pct, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (!items?.length) return { watchlist: [], count: 0 };

        return {
          count: items.length,
          watchlist: items.map(w => ({
            name:             w.name,
            ticker:           w.ticker,
            asset_type:       w.asset_type,
            target_price:     w.target_price ? Number(w.target_price) : null,
            current_price:    w.current_price ? Number(w.current_price) : null,
            price_change_pct: w.price_change_pct ? Number(w.price_change_pct).toFixed(2) : null,
            hit_target:       w.target_price && w.current_price
              ? Number(w.current_price) >= Number(w.target_price) : null,
            notes: w.notes || null,
          })),
        };
      }

      case "get_snapshot_history": {
        const lookbackMonths = Math.min(Math.max(input.months || 12, 2), 24);
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - lookbackMonths);
        const cutoffMonth = cutoff.toISOString().slice(0, 7);

        const { data: snaps } = await supabase
          .from("net_worth_snapshots")
          .select("snapshot_month, total_invested, total_current, source")
          .eq("user_id", userId)
          .gte("snapshot_month", cutoffMonth)
          .order("snapshot_month", { ascending: true });

        if (!snaps?.length) return { message: "No snapshot history found. Take a snapshot first via the Portfolio refresh button." };

        const first = snaps[0];
        const last  = snaps[snaps.length - 1];
        const growthAmt = last.total_current - first.total_current;
        const growthPct = first.total_current > 0
          ? +((growthAmt / first.total_current) * 100).toFixed(1) : 0;

        return {
          months_covered: snaps.length,
          from_month:     first.snapshot_month,
          to_month:       last.snapshot_month,
          start_value:    Math.round(first.total_current),
          end_value:      Math.round(last.total_current),
          growth_inr:     Math.round(growthAmt),
          growth_pct:     growthPct,
          snapshots:      snaps.map(s => ({
            month:     s.snapshot_month,
            invested:  Math.round(s.total_invested),
            current:   Math.round(s.total_current),
            gain:      Math.round(s.total_current - s.total_invested),
            gain_pct:  s.total_invested > 0
              ? +((( s.total_current - s.total_invested) / s.total_invested) * 100).toFixed(1) : 0,
          })),
        };
      }

      case "get_fd_maturities": {
        const lookAheadDays = Math.min(Math.max(input.days || 180, 30), 730);
        const today    = new Date().toISOString().slice(0, 10);
        const maxDate  = new Date(Date.now() + lookAheadDays * 864e5).toISOString().slice(0, 10);

        const { data: fds } = await supabase
          .from("holdings")
          .select("name, member_name, principal, current_value, interest_rate, start_date, maturity_date, currency")
          .eq("user_id", userId)
          .eq("type", "FD")
          .gte("maturity_date", today)
          .lte("maturity_date", maxDate)
          .order("maturity_date", { ascending: true });

        if (!fds?.length) return { message: `No FDs maturing in the next ${lookAheadDays} days.` };

        const totalMaturingINR = fds.reduce((s, fd) => s + Number(fd.current_value || fd.principal || 0), 0);

        return {
          look_ahead_days: lookAheadDays,
          count:           fds.length,
          total_maturing_inr: Math.round(totalMaturingINR),
          fds: fds.map(fd => {
            const daysLeft = Math.round((new Date(fd.maturity_date) - new Date()) / 864e5);
            return {
              name:          fd.name,
              member:        fd.member_name || null,
              principal:     Math.round(Number(fd.principal || 0)),
              maturity_value: Math.round(Number(fd.current_value || fd.principal || 0)),
              interest_rate: fd.interest_rate ? Number(fd.interest_rate) : null,
              maturity_date: fd.maturity_date,
              days_left:     daysLeft,
              currency:      fd.currency || "INR",
            };
          }),
        };
      }

      default: return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    console.error(`Tool exec error [${name}]:`, e.message);
    return { error: e.message };
  }
}

// ── SSE helper ─────────────────────────────────────────────────────────────
const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

// ── Agentic loop ───────────────────────────────────────────────────────────

async function runAgenticLoop(req, res, key, model, maxTokens, systemPrompt, initMessages) {
  let messages = [...initMessages];
  const MAX_TURNS = 6;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // ── Call Anthropic (streaming) ─────────────────────────────────
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, tools: ADVISOR_TOOLS, messages, stream: true }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      sse(res, { type: "error", error: err?.error?.message || "Anthropic API error" });
      return;
    }

    // ── Parse the stream ───────────────────────────────────────────
    const reader  = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    // Accumulate the assistant's full content array for message history
    const contentBlocks = [];
    let textBlockIdx = null;
    let toolBlock    = null;
    let toolInput    = "";
    let stopReason   = "end_turn";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        let ev; try { ev = JSON.parse(payload); } catch { continue; }

        switch (ev.type) {
          case "content_block_start":
            if (ev.content_block?.type === "text") {
              textBlockIdx = contentBlocks.length;
              contentBlocks.push({ type: "text", text: "" });
            } else if (ev.content_block?.type === "tool_use") {
              toolBlock = { id: ev.content_block.id, name: ev.content_block.name };
              toolInput = "";
              contentBlocks.push({ type: "tool_use", id: toolBlock.id, name: toolBlock.name, input: {} });
              sse(res, { type: "tool_call_start", name: toolBlock.name, id: toolBlock.id });
            }
            break;

          case "content_block_delta":
            if (ev.delta?.type === "text_delta") {
              const t = ev.delta.text;
              if (textBlockIdx !== null) contentBlocks[textBlockIdx].text += t;
              sse(res, { type: "text_delta", text: t });
            } else if (ev.delta?.type === "input_json_delta") {
              toolInput += ev.delta.partial_json;
            }
            break;

          case "content_block_stop":
            if (toolBlock) {
              let parsed = {};
              try { parsed = JSON.parse(toolInput || "{}"); } catch {}
              const idx = contentBlocks.findIndex(b => b.type === "tool_use" && b.id === toolBlock.id);
              if (idx >= 0) contentBlocks[idx].input = parsed;
              toolBlock  = null;
              toolInput  = "";
            }
            break;

          case "message_delta":
            if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
            break;

          case "error":
            sse(res, { type: "error", error: ev.error?.message || "Stream error" });
            return;
        }
      }
    }

    // ── No tool calls → done ───────────────────────────────────────
    const toolUseBlocks = contentBlocks.filter(b => b.type === "tool_use");
    if (stopReason !== "tool_use" || toolUseBlocks.length === 0) break;

    // ── Execute tools ──────────────────────────────────────────────
    const toolResults = [];
    for (const tb of toolUseBlocks) {
      sse(res, { type: "tool_result_start", name: tb.name, id: tb.id });
      const result = await execTool(tb.name, tb.input, req.user.id);
      sse(res, { type: "tool_result_end",   name: tb.name, id: tb.id });
      toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: JSON.stringify(result) });
    }

    // Append turn to message history
    messages = [
      ...messages,
      { role: "assistant", content: contentBlocks },
      { role: "user",      content: toolResults  },
    ];
  }

  sse(res, { type: "done" });
  res.end();
}

// ── Routes ─────────────────────────────────────────────────────────────────

// Non-streaming (kept for compatibility)
router.post("/chat", auth, aiLimiter, async (req, res) => {
  const v = validateAiRequest(req, res);
  if (!v) return;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": v.key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ ...req.body, max_tokens: v.max_tokens }),
    });
    const d = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: d?.error?.message || "Anthropic API error" });
    res.json(d);
  } catch (e) { sendError(res, e); }
});

// Streaming + agentic loop
router.post("/chat/stream", auth, aiLimiter, async (req, res) => {
  const v = validateAiRequest(req, res);
  if (!v) return;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    await runAgenticLoop(
      req, res,
      v.key, v.model, v.max_tokens,
      req.body.system || "You are a personal wealth advisor. Help the user understand their portfolio.",
      req.body.messages || [],
    );
  } catch (e) {
    console.error("AI stream error:", e.message);
    sse(res, { type: "error", error: e.message });
    res.end();
  }
});

export default router;
