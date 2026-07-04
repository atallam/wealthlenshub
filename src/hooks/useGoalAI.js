/**
 * useGoalAI.js — All AI-powered goal features.
 *
 * Features:
 *   1. parseGoalText()           — Natural language → structured goal form
 *   2. loadNudges()              — Smart gap alerts + proactive nudges
 *   3. detectConflicts()         — Pure-math SIP conflict detector
 *   4. resolveConflictsWithAI()  — Streaming conflict resolution plan
 *   5. getTaxPath()              — Static tax-optimized path (re-exported)
 *   6. getAITaxPath()            — Streaming personalised tax advice
 *
 * All streaming uses /api/ai/chat/stream (SSE, type:"text_delta" events).
 * All JSON extraction uses /api/ai/chat (non-streaming).
 */

import { useState, useCallback } from 'react';
import { supabase } from '../supabase.js';
import { goalCagr, sipRequired, getTaxPath } from '../features/goals/goalMath.js';

export { getTaxPath }; // re-export so callers only need one import

// ── Shared helpers ────────────────────────────────────────────────────────────

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || '';
}

async function aiChat(messages, system, model = 'claude-haiku-4-5-20251001') {
  const token = await getToken();
  const res = await fetch('/api/ai/chat', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ model, max_tokens: 1024, system, messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
}

/** Read an SSE stream from /api/ai/chat/stream, calling onChunk for each text delta. */
export async function readSSEStream(res, onChunk, signal) {
  const reader  = res.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t || t === 'data: [DONE]') continue;
        if (t.startsWith('data: ')) {
          try {
            const ev = JSON.parse(t.slice(6));
            if (ev.type === 'text_delta' && ev.text) onChunk(ev.text);
            if (ev.type === 'done') return;
            if (ev.type === 'error') throw new Error(ev.error);
          } catch (e) {
            if (e.message && !e.message.includes('JSON')) throw e;
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

async function aiStream(prompt, system, onChunk, signal, model = 'claude-sonnet-4-6') {
  const token = await getToken();
  const res = await fetch('/api/ai/chat/stream', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ model, max_tokens: 1200, system, messages: [{ role: 'user', content: prompt }] }),
    signal,
  });
  if (!res.ok) throw new Error(`AI request failed (${res.status})`);
  await readSSEStream(res, onChunk, signal);
}

// ── fmtCr helper (INR formatting, no FX needed here) ─────────────────────────

function fmtCrINR(n) {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `₹${(a / 1e5).toFixed(1)}L`;
  return `₹${Math.round(a).toLocaleString('en-IN')}`;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useGoalAI({ goals, members, allCur }) {

  // ── 1. Natural Language Goal Parsing ────────────────────────────────────────
  const [nlLoading, setNlLoading] = useState(false);
  const [nlError,   setNlError]   = useState('');

  const parseGoalText = useCallback(async (text) => {
    if (!text?.trim()) return null;
    setNlLoading(true);
    setNlError('');
    try {
      const today  = new Date().toISOString().slice(0, 10);
      const system = `You are a financial goal parser for an Indian family wealth app. Extract goal details from natural language and return ONLY valid JSON — no explanation, no markdown fences.

Schema:
{
  "name": string,
  "category": "Retirement" | "Education" | "Real Estate" | "Emergency Fund" | "Wealth" | "Travel" | "Other",
  "targetAmount": number (INR — convert "crore/lakh" phrases),
  "targetDate": "YYYY-MM-DD",
  "monthlyContribution": number (INR, 0 if not stated),
  "notes": string (one sentence summary),
  "color": one of "#c9a84c" | "#a084ca" | "#5a9ce0" | "#4caf9a" | "#e07c5a" | "#7cb87c"
}

Rules:
- Today is ${today}. Compute targetDate from age/year clues ("retire at 60, I'm 35" → +25 years).
- "5 crore" = 5000000, "50 lakh" = 500000.
- Pick color that fits category: gold for Retirement, purple for Education, blue for Real Estate, green for Emergency, red for Other.
- Return ONLY the JSON object.`;

      const raw   = await aiChat([{ role: 'user', content: text }], system);
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not extract goal from text — try being more specific');
      return JSON.parse(match[0]);
    } catch (e) {
      setNlError(e.message);
      return null;
    } finally {
      setNlLoading(false);
    }
  }, []);

  // ── 2. Smart Goal Gap Nudges ─────────────────────────────────────────────────
  const [nudges,           setNudges]           = useState([]);
  const [nudgesLoading,    setNudgesLoading]    = useState(false);
  const [nudgesLoaded,     setNudgesLoaded]     = useState(false);
  const [nudgesDismissed,  setNudgesDismissed]  = useState(false);

  const loadNudges = useCallback(async () => {
    if (nudgesLoading || nudgesLoaded) return;
    setNudgesLoading(true);
    try {
      const categories    = [...new Set(goals.map(g => g.category))];
      const totalSIPSet   = goals.reduce((s, g) => s + (g.monthlyContribution || 0), 0);
      const goalLines     = goals.map(g =>
        `${g.name} (${g.category}, ₹${(g.targetAmount / 1e5).toFixed(1)}L by ${g.targetDate}${g.monthlyContribution ? `, SIP ₹${(+g.monthlyContribution).toLocaleString('en-IN')}/mo` : ', no SIP'})`
      ).join('; ') || 'None';

      const system = `You are a wealth advisor AI. Return ONLY a JSON array of 2–4 concise, actionable nudges. No markdown, no explanation.

Schema: [{"severity":"warning"|"info", "icon":"⚠"|"💡"|"📌", "text":"one specific actionable sentence with INR numbers", "action":"short CTA like 'Add Emergency Fund goal'"}]

Be specific: mention amounts, timelines, and tax benefits where relevant.`;

      const prompt = `Indian family portfolio: ${fmtCrINR(allCur)} total. ${members.length} member(s). Current goal categories: [${categories.join(', ') || 'none'}]. Total monthly SIP committed: ₹${totalSIPSet.toLocaleString('en-IN')}. Goals: ${goalLines}.

Identify the 2–4 most important gaps or risks (missing goal types, inadequate SIP, no emergency fund, retirement underfunded, etc.). Return nudges JSON array.`;

      const raw   = await aiChat([{ role: 'user', content: prompt }], system);
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) setNudges(JSON.parse(match[0]));
    } catch (e) {
      console.warn('[useGoalAI] nudges failed:', e.message);
    } finally {
      setNudgesLoading(false);
      setNudgesLoaded(true);
    }
  }, [goals, members, allCur, nudgesLoading, nudgesLoaded]);

  const dismissNudges = useCallback(() => setNudgesDismissed(true), []);
  const resetNudges   = useCallback(() => { setNudges([]); setNudgesLoaded(false); setNudgesDismissed(false); }, []);

  // ── 3. Goal Conflict Detector (pure math) ───────────────────────────────────
  const detectConflicts = useCallback(() => {
    if (goals.length < 2) return null;

    const goalSips = goals.map(g => {
      const msLeft  = Math.max(0, new Date(g.targetDate) - new Date());
      const yLeft   = msLeft / (864e5 * 365.25);
      const r       = goalCagr(g.linkedTypes);
      // Use current funded amount = 0 for "needed" (conservative) since we don't have valINRCache here
      // The caller should pass curFn if available; use simple linear estimate as proxy
      const monthly = g.monthlyContribution || 0;
      const needed  = yLeft > 0 ? sipRequired(g.targetAmount * 0.7, r, yLeft) : 0; // assume ~30% already funded
      return { name: g.name, color: g.color, priority: g.priority || 99, monthly, needed };
    });

    const totalNeeded   = goalSips.reduce((s, g) => s + g.needed, 0);
    const totalCurrent  = goalSips.reduce((s, g) => s + g.monthly, 0);
    const shortfall     = totalNeeded - totalCurrent;

    // Only surface if shortfall is meaningful (> ₹10K/mo gap)
    if (shortfall < 10000) return null;

    return {
      totalNeeded,
      totalCurrent,
      shortfall,
      goalSips: goalSips.sort((a, b) => a.priority - b.priority),
    };
  }, [goals]);

  // ── 4. Streaming Conflict Resolution ────────────────────────────────────────
  const resolveConflictsWithAI = useCallback(async (conflictData, onChunk, signal) => {
    const goalLines = conflictData.goalSips
      .map(g => `P${g.priority} ${g.name}: contributes ₹${g.monthly.toLocaleString('en-IN')}/mo, estimated need ₹${Math.round(g.needed).toLocaleString('en-IN')}/mo`)
      .join('\n');

    const prompt = `I have ${goals.length} financial goals with competing SIP demands. Portfolio: ${fmtCrINR(allCur)}.

Goals (by priority):
${goalLines}

Total SIP currently committed: ₹${Math.round(conflictData.totalCurrent).toLocaleString('en-IN')}/month
Total SIP estimated needed: ₹${Math.round(conflictData.totalNeeded).toLocaleString('en-IN')}/month
Monthly shortfall: ₹${Math.round(conflictData.shortfall).toLocaleString('en-IN')}

Provide:
1. Which goals to prioritise and fund fully first
2. Which goals to extend or reduce the target for
3. A concrete monthly SIP allocation table across all goals
4. What total monthly SIP commitment is realistic given portfolio size

Be specific with amounts in INR (Lakhs/Crores). Keep response under 300 words.`;

    await aiStream(
      prompt,
      'You are a concise Indian family wealth planner. Give a specific, numbered action plan. Use Indian number format (Lakhs/Crores).',
      onChunk,
      signal,
    );
  }, [goals, allCur]);

  // ── 5 + 6. Tax Path (getTaxPath is re-exported from goalMath) ───────────────

  const getAITaxPath = useCallback(async (goal, cur, yLeft, onChunk, signal) => {
    const rem     = Math.max(0, goal.targetAmount - cur);
    const monthly = goal.monthlyContribution || 0;

    const prompt = `Financial goal: "${goal.name}" (${goal.category})
Target: ${fmtCrINR(goal.targetAmount)} by ${goal.targetDate}
Currently funded: ${fmtCrINR(cur)} | Remaining: ${fmtCrINR(rem)}
Time left: ${yLeft.toFixed(1)} years | Monthly SIP: ₹${monthly.toLocaleString('en-IN')}
Linked asset types: ${(goal.linkedTypes || []).join(', ') || 'not specified'}

Give me a specific tax-optimised investment path using Indian tax laws. Cover:
1. Which instruments to use (ELSS, PPF, NPS, equity MF, FD etc.) and approximate split
2. Exact tax deductions available (80C, 80CCD, LTCG exemption, etc.)
3. Estimated annual tax saving in INR at 30% bracket
4. Any lock-in or liquidity constraints to be aware of

Keep under 250 words. Use Lakhs/Crores.`;

    await aiStream(
      prompt,
      'You are an Indian certified financial planner specialising in tax-efficient investing. Be specific with deductions and instruments. Use Lakhs/Crores.',
      onChunk,
      signal,
    );
  }, []);

  return {
    // 1. NL parsing
    parseGoalText, nlLoading, nlError,
    // 2. Nudges
    nudges, nudgesLoading, nudgesLoaded, nudgesDismissed,
    loadNudges, dismissNudges, resetNudges,
    // 3+4. Conflicts
    detectConflicts, resolveConflictsWithAI,
    // 5+6. Tax path
    getAITaxPath,
  };
}
