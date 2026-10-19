/**
 * useStreamAI.js — Shared SSE reader for the tab-level AI features.
 * readSSEStream() is used by useGoalAI.js and useAI.js.
 * For the full agentic loop (tool use), see useAI.js.
 */

import { useState, useRef, useCallback } from 'react';
import { supabase } from '../supabase.js';

// ── Low-level SSE reader ──────────────────────────────────────────────────────

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
