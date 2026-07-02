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
import rateLimit     from "express-rate-limit";
import { auth, sendError } from "../lib/auth.js";
import { supabase }  from "../lib/db.js";
import { currentFY, fyRange, computeGains, summarizeRealized } from "../lib/tax.js";

const router = Router();

const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  keyGenerator: (req) => req.user?.id || req.ip,
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
          .select("id, name, symbol, type, units, current_price, current_nav, current_value, invested_value, member_name")
          .eq("user_id", userId)
          .order("current_value", { ascending: false })
          .limit(40);
        if (input.asset_type) q = q.eq("type", input.asset_type);
        if (input.member_id)  q = q.eq("member_id", input.member_id);
        const { data: h } = await q;
        if (!h?.length) return { holdings: [], count: 0 };
        return {
          count: h.length,
          holdings: h.map(x => ({
            id:                  x.id,
            name:                x.name,
            symbol:              x.symbol,
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
