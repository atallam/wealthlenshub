import { useState } from 'react';
import { supabase } from '../supabase.js';

async function api(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const isForm = opts.body instanceof FormData;
  const headers = { Authorization: `Bearer ${token}`, ...(isForm ? {} : { "Content-Type": "application/json" }), ...(opts.headers || {}) };
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  return res.json();
}

// Lines 1148–1150 (state) + lines 1937–2031 (buildPortfolioContext + askAI)
// NOTE: buildPortfolioContext uses memoized caches (valINRCache, invINRCache, xirrCache, trigAlerts)
// and formatting helpers (fmtCr, AT) from App.jsx. These must be passed in as portfolioContext param.
export function useAI() {
  // ── AI state ── Lines 1148–1150
  const [aiMessages, setAiMessages] = useState([]); // {role, content, ts}
  const [aiInput,    setAiInput]    = useState("");
  const [aiLoading,  setAiLoading]  = useState(false);

  // ── Ask AI ── Lines 2000–2031
  // portfolioContext: string returned by buildPortfolioContext() in App.jsx
  async function askAI(portfolioContext, aiBottomRef) {
    const q = aiInput.trim();
    if (!q || aiLoading) return;
    setAiInput("");
    const userMsg = { role: "user", content: q, ts: new Date() };
    setAiMessages(p => [...p, userMsg]);
    setAiLoading(true);
    if (aiBottomRef?.current) setTimeout(() => aiBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    const history = [...aiMessages, userMsg].map(m => ({ role: m.role, content: m.content }));

    try {
      const data = await api("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are a private wealth advisor assistant for WealthLens Pro, a personal portfolio intelligence platform. You have access to the family's complete, real portfolio data below. Answer questions about their portfolio directly and specifically — use actual numbers, names, and holdings from the data. Be concise and conversational. Use ₹ for values, Indian number formatting (Cr, L). Do not give generic financial advice — always refer to their specific holdings and numbers.\n\n${portfolioContext}`,
          messages: history,
        }),
      });
      const reply = data.content?.find(c => c.type === "text")?.text || "Sorry, I couldn't process that.";
      setAiMessages(p => [...p, { role: "assistant", content: reply, ts: new Date() }]);
    } catch (e) {
      setAiMessages(p => [...p, { role: "assistant", content: "Something went wrong: " + e.message, ts: new Date() }]);
    }
    setAiLoading(false);
    if (aiBottomRef?.current) setTimeout(() => aiBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  return {
    aiMessages,
    aiInput,
    setAiInput,
    aiLoading,
    askAI,
  };
}

// ── buildPortfolioContext ── Lines 1937–1998
// This function lives in App.jsx and relies on: holdings, members, goals, alerts,
// valINRCache, invINRCache, xirrCache, trigAlerts, allCur, allInv (all memoized in App).
// It is NOT extracted into useAI because it depends on too many memoized values from App.jsx.
// Instead, call it in App.jsx and pass the result string to askAI(portfolioContext).
// Signature in App.jsx:
//   function buildPortfolioContext() { ... }  → returns string
