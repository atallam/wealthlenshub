/**
 * lib/concall/extractor.js — PDF → text extraction and transcript preparation.
 *
 * Uses pdf-parse (already installed) to extract text from PDF buffers.
 * Applies smart truncation: preserves the Q&A section (which carries the most
 * signal) when the transcript exceeds the 48k character cap.
 *
 * Ported and simplified from Drishti 2.0's _truncate_transcript() logic.
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const MAX_CHARS         = 48_000;   // approx 12k tokens — safe for Claude's context
const QA_RESERVE        = 16_000;   // chars reserved for Q&A section at the end
const QA_MARKERS        = ["question", "q&a", "question-and-answer", "q:", "analyst:"];

/**
 * Extract text from a PDF buffer.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
export async function extractPdf(buffer) {
  const data = await pdfParse(buffer);
  return data.text || "";
}

/**
 * Prepare raw transcript text for Claude:
 *  - Normalises whitespace
 *  - Truncates to MAX_CHARS while preserving the Q&A section
 *
 * @param {string} raw  Raw transcript text (from PDF extraction or paste)
 * @returns {string}    Cleaned, truncated text ready for the prompt
 */
export function prepareTranscript(raw) {
  // Normalise whitespace: collapse multiple blank lines, trim lines
  let text = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  if (text.length <= MAX_CHARS) return text;

  // Find Q&A section start (case-insensitive)
  const lower = text.toLowerCase();
  let qaStart = -1;
  for (const marker of QA_MARKERS) {
    const idx = lower.lastIndexOf(marker);   // last occurrence = actual Q&A
    if (idx > text.length * 0.4) {           // must be in the latter 60% of transcript
      qaStart = Math.max(qaStart, idx);
    }
  }

  if (qaStart > 0) {
    // Keep first (MAX_CHARS - QA_RESERVE) chars from opening + QA_RESERVE chars of Q&A
    const openingEnd = MAX_CHARS - QA_RESERVE;
    const opening = text.slice(0, openingEnd);
    const qa      = text.slice(qaStart, qaStart + QA_RESERVE);
    const ellipsis = "\n\n[... transcript truncated — middle section omitted ...]\n\n";
    return opening + ellipsis + qa;
  }

  // No clear Q&A section found — simple truncation
  return text.slice(0, MAX_CHARS) + "\n\n[... transcript truncated ...]";
}
