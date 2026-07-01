import { useState } from 'react';
import { supabase } from '../supabase.js';

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
    setAiLoading(true);

    const userMsg = { role: "user", content: q, ts: new Date() };
    const history = [...aiMessages, userMsg].map(m => ({ role: m.role, content: m.content }));

    // Append user message + empty streaming assistant placeholder
    setAiMessages(p => [...p, userMsg, { role: "assistant", content: "", ts: new Date(), streaming: true }]);
    if (aiBottomRef?.current) setTimeout(() => aiBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";

      const response = await fetch("/api/ai/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: `You are a private wealth advisor assistant for WealthLens Pro, a personal portfolio intelligence platform. You have access to the family's complete, real portfolio data below. Answer questions about their portfolio directly and specifically — use actual numbers, names, and holdings from the data. Be concise and conversational. Use ₹ for values, Indian number formatting (Cr, L). Do not give generic financial advice — always refer to their specific holdings and numbers.\n\n${portfolioContext}`,
          messages: history,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || response.statusText);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      const scroll = () => { if (aiBottomRef?.current) aiBottomRef.current.scrollIntoView({ behavior: "smooth" }); };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep trailing incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]" || !payload) continue;

          let event;
          try { event = JSON.parse(payload); } catch { continue; }

          // Anthropic streaming event types
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            fullText += event.delta.text;
            setAiMessages(p => {
              const msgs = [...p];
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: fullText };
              return msgs;
            });
            scroll();
          }

          if (event.type === "error") {
            throw new Error(event.error?.message || "Stream error");
          }
        }
      }

      // Mark streaming complete (removes blinking cursor)
      setAiMessages(p => {
        const msgs = [...p];
        const last = msgs[msgs.length - 1];
        if (last?.streaming) msgs[msgs.length - 1] = { ...last, streaming: false };
        return msgs;
      });

    } catch (e) {
      setAiMessages(p => {
        const msgs = [...p];
        const last = msgs[msgs.length - 1];
        if (last?.streaming) {
          // Replace empty placeholder with error
          msgs[msgs.length - 1] = { role: "assistant", content: "Something went wrong: " + e.message, ts: new Date() };
        } else {
          msgs.push({ role: "assistant", content: "Something went wrong: " + e.message, ts: new Date() });
        }
        return msgs;
      });
    }

    setAiLoading(false);
    if (aiBottomRef?.current) setTimeout(() => aiBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  return { aiMessages, setAiMessages, aiInput, setAiInput, aiLoading, askAI };
}
