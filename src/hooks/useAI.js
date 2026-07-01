import { useState } from 'react';
import { api } from '../lib/api.js';

export function useAI() {
  const [aiMessages, setAiMessages] = useState([]);
  const [aiInput,    setAiInput]    = useState("");
  const [aiLoading,  setAiLoading]  = useState(false);

  // portfolioContext: string from buildPortfolioContext() in App.jsx
  // overrideInput: optional — used by suggested-question buttons to submit directly
  async function askAI(portfolioContext, aiBottomRef, overrideInput) {
    const q = (overrideInput ?? aiInput).trim();
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
          model: "claude-sonnet-4-6",
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

  return { aiMessages, setAiMessages, aiInput, setAiInput, aiLoading, askAI };
}
