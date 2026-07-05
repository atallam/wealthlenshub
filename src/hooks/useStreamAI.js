/**
 * useStreamAI.js — Shared SSE streaming hook for all tab-level AI features.
 *
 * Usage:
 *   const { text, loading, stream, abort } = useStreamAI();
 *   await stream(prompt, systemPrompt, { model, maxTokens });
 *
 * The hook manages:
 *   - Auth token retrieval
 *   - SSE parsing (text_delta, done, error events)
 *   - AbortController lifecycle
 *   - text / loading state
 *
 * For the full agentic loop (tool use), see useAI.js.
 * For goal-specific AI features, see useGoalAI.js (uses readSSEStream below).
 */

import { useState, useRef, useCallback } from 'react';
import { supabase } from '../supabase.js';

// ── Low-level SSE reader (also exported for useGoalAI.js compat) ─────────────

/**
 * Read an SSE response body, calling onChunk for each text_delta event.
 * Resolves when the server sends { type: "done" } or the stream ends.
 * @param {Response}  res
 * @param {Function}  onChunk  called with each text string fragment
 * @param {AbortSignal} [signal]
 */
export async function readSSEStream(res, onChunk, signal) {
  const reader = res.body?.getReader();
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
            if (ev.type === 'error') throw new Error(ev.error || 'Stream error');
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

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useStreamAI — stateful wrapper around the SSE streaming endpoint.
 *
 * @returns {{
 *   text: string,
 *   loading: boolean,
 *   stream: (prompt: string, system: string, opts?: {model?: string, maxTokens?: number}) => Promise<void>,
 *   abort: () => void,
 *   reset: () => void,
 * }}
 */
export function useStreamAI() {
  const [text,    setText]    = useState('');
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abort();
    setText('');
    setLoading(false);
  }, [abort]);

  /**
   * @param {string} prompt
   * @param {string} system
   * @param {{ model?: string, maxTokens?: number }} [opts]
   */
  const stream = useCallback(async (prompt, system, opts = {}) => {
    abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setText('');
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch('/api/ai/chat/stream', {
        method:  'POST',
        signal:  ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model:      opts.model      ?? 'claude-sonnet-4-6',
          max_tokens: opts.maxTokens  ?? 1200,
          system,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `AI request failed (${res.status})`);
      }

      await readSSEStream(
        res,
        (chunk) => setText(prev => prev + chunk),
        ctrl.signal,
      );
    } catch (e) {
      if (e.name === 'AbortError') return;
      setText(`⚠ ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [abort]);

  return { text, loading, stream, abort, reset };
}
