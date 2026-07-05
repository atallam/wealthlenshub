/**
 * lib/concall/validate.js — Transcript quality heuristics.
 *
 * Four checks ported from Drishti 2.0's concall engine:
 *   1. Minimum character count      (>= 2000)
 *   2. Concall keyword density      (>= 3 distinct keywords)
 *   3. Non-ASCII character ratio    (<= 15 %)
 *   4. Average word length          (3–15 characters)
 *
 * Returns { ok: bool, reason: string | null }
 */

const CONCALL_KEYWORDS = [
  "quarter", "revenue", "ebitda", "margin", "guidance", "outlook",
  "management", "analyst", "q&a", "question", "answer", "growth",
  "profit", "operating", "capex", "balance sheet", "cash flow",
  "year-over-year", "yoy", "q1", "q2", "q3", "q4", "fy",
];

const MIN_CHARS      = 2000;
const MIN_KEYWORDS   = 3;
const MAX_NON_ASCII  = 0.15;   // 15 %
const MIN_AVG_WORD   = 3;
const MAX_AVG_WORD   = 15;

/**
 * Validates raw transcript text.
 * @param {string} text
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function validateTranscript(text) {
  if (typeof text !== "string") {
    return { ok: false, reason: "Transcript must be a non-empty string" };
  }

  // 1. Min character count
  if (text.length < MIN_CHARS) {
    return {
      ok: false,
      reason: `Transcript too short (${text.length} chars, need ≥ ${MIN_CHARS}). Likely not a full earnings call.`,
    };
  }

  // 2. Keyword density
  const lower = text.toLowerCase();
  const hitKeywords = CONCALL_KEYWORDS.filter(k => lower.includes(k));
  if (hitKeywords.length < MIN_KEYWORDS) {
    return {
      ok: false,
      reason: `Transcript lacks concall content (only ${hitKeywords.length} keywords found, need ≥ ${MIN_KEYWORDS}).`,
    };
  }

  // 3. Non-ASCII ratio (e.g. garbled OCR / wrong PDF)
  const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length;
  const ratio = nonAscii / text.length;
  if (ratio > MAX_NON_ASCII) {
    return {
      ok: false,
      reason: `Too many non-ASCII characters (${(ratio * 100).toFixed(1)}% — possible OCR or encoding issue).`,
    };
  }

  // 4. Average word length
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { ok: false, reason: "No words found in transcript." };
  const avgLen = words.reduce((s, w) => s + w.length, 0) / words.length;
  if (avgLen < MIN_AVG_WORD || avgLen > MAX_AVG_WORD) {
    return {
      ok: false,
      reason: `Unusual average word length (${avgLen.toFixed(1)} chars — expected 3–15). Text may be corrupted.`,
    };
  }

  return { ok: true, reason: null };
}
