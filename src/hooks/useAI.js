/**
 * useAI.js — AI Advisor hook with tool use + streaming agentic loop
 *
 * Handles custom SSE protocol from /api/ai/chat/stream:
 *   text_delta       → append text to current message
 *   tool_call_start  → add tool-call indicator to message
 *   tool_result_end  → mark tool-call indicator as done
 *   done             → mark streaming complete
 *   error            → replace placeholder with error message
 */

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase.js';

const TOOL_LABELS = {
  get_portfolio_summary: "📊 Checking portfolio",
  get_holdings:          "📂 Fetching holdings",
  get_transactions:      "📋 Loading transactions",
  get_goal_progress:     "🎯 Reviewing goals",
  get_tax_summary:       "🧾 Computing tax",
};

const MAX_PERSISTED = 60; // keep last 60 messages in localStorage

function lsKey(uid) { return `wl_ai_conv_${uid}`; }

function loadPersistedMessages(uid) {
  try {
    const raw = localStorage.getItem(lsKey(uid));
    if (!raw) return [];
    const msgs = JSON.parse(raw);
    // Revive ts as Date objects; strip streaming flag (never persist mid-stream state)
    return msgs.map(m => ({ ...m, ts: new Date(m.ts), streaming: false }));
  } catch { return []; }
}

function persistMessages(uid, msgs) {
  try {
    // Only persist completed messages (no streaming ones)
    const toSave = msgs
      .filter(m => !m.streaming)
      .slice(-MAX_PERSISTED)
      .map(m => ({ role: m.role, content: m.content, ts: m.ts, toolCalls: m.toolCalls }));
    localStorage.setItem(lsKey(uid), JSON.stringify(toSave));
  } catch { /* localStorage unavailable — ignore */ }
}

export function useAI() {
  const [aiMessages, setAiMessages] = useState([]);
  const [aiInput,    setAiInput]    = useState("");
  const [aiLoading,  setAiLoading]  = useState(false);
  const userIdRef  = useRef(null);

  // On mount: get userId and restore persisted conversation
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        userIdRef.current = uid;
        const saved = loadPersistedMessages(uid);
        if (saved.length > 0) setAiMessages(saved);
      } catch { /* session unavailable */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * @param {string}  portfolioContext  - Text summary built in App.jsx
   * @param {object}  aiBottomRef       - Ref to the chat scroll target
   * @param {string?} overrideInput     - Used by suggestion buttons
   */
  async function askAI(portfolioContext, aiBottomRef, overrideInput) {
    const q = (overrideInput ?? aiInput).trim();
    if (!q || aiLoading) return;
    setAiInput("");
    setAiLoading(true);

    const userMsg = { role: "user", content: q, ts: new Date() };
    // Build message history (role + content only — no UI state)
    const history = [...aiMessages, userMsg].map(m => ({ role: m.role, content: m.content }));

    // Add user msg + empty streaming placeholder
    const placeholder = { role: "assistant", content: "", ts: new Date(), streaming: true, toolCalls: [] };
    setAiMessages(p => [...p, userMsg, placeholder]);
    const scroll = () => aiBottomRef?.current?.scrollIntoView({ behavior: "smooth" });
    setTimeout(scroll, 50);

    // Helper: update the last message
    function updateLast(fn) {
      setAiMessages(p => {
        const msgs = [...p];
        msgs[msgs.length - 1] = fn(msgs[msgs.length - 1]);
        return msgs;
      });
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";

      const response = await fetch("/api/ai/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          system: `You are a private wealth advisor assistant for WealthLens Hub. You have real-time tool access to the user's portfolio data — use the tools to retrieve accurate numbers rather than relying on the context summary below (which may be stale). Always use actual portfolio data when answering specific questions.

Be concise and conversational. Use ₹ for Indian values, $ for USD. Use Indian number formatting (Cr, L, K). Reference specific holdings, percentages, and amounts from the tools.

Portfolio context (may be used for general questions):
${portfolioContext}`,
          messages: history,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || response.statusText);
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let fullText = "";

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
            case "text_delta":
              fullText += ev.text;
              updateLast(m => ({ ...m, content: fullText }));
              scroll();
              break;

            case "tool_call_start":
              updateLast(m => ({
                ...m,
                toolCalls: [...(m.toolCalls || []), {
                  id:     ev.id,
                  name:   ev.name,
                  label:  TOOL_LABELS[ev.name] || ev.name,
                  status: "running",
                }],
              }));
              scroll();
              break;

            case "tool_result_end":
              updateLast(m => ({
                ...m,
                toolCalls: (m.toolCalls || []).map(tc =>
                  tc.id === ev.id ? { ...tc, status: "done" } : tc
                ),
              }));
              break;

            case "done":
              updateLast(m => ({ ...m, streaming: false }));
              break;

            case "error":
              throw new Error(ev.error || "Stream error");
          }
        }
      }

      // Ensure streaming flag cleared if `done` event wasn't received
      updateLast(m => ({ ...m, streaming: false }));

    } catch (e) {
      updateLast(m => ({
        ...m,
        role:      "assistant",
        content:   m.content || ("⚠ " + e.message),
        streaming: false,
        toolCalls: (m.toolCalls || []).map(tc => tc.status === "running" ? { ...tc, status: "error" } : tc),
      }));
    }

    setAiLoading(false);
    setTimeout(scroll, 100);

    // Persist the completed conversation (after state settles)
    if (userIdRef.current) {
      setAiMessages(current => {
        persistMessages(userIdRef.current, current);
        return current; // no state change — side-effect only
      });
    }
  }

  /** Clear chat + remove localStorage snapshot */
  function clearConversation() {
    setAiMessages([]);
    if (userIdRef.current) {
      try { localStorage.removeItem(lsKey(userIdRef.current)); } catch {}
    }
  }

  return { aiMessages, setAiMessages, aiInput, setAiInput, aiLoading, askAI, clearConversation };
}
