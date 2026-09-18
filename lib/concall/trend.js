/**
 * lib/concall/trend.js — Quarter-over-quarter concall trend analysis.
 *
 * Takes the structured concall_analyses history for a holding (already
 * scored by analyzer.js, one row per quarter) and produces a narrative:
 * is the thesis strengthening, stable, weakening, or whipsawing quarter
 * to quarter?
 *
 * Deliberately does NOT re-fetch or re-read transcripts — it reasons over
 * the compact structured history (scores + summaries) already sitting in
 * concall_analyses, so this stays cheap (haiku, well under 1k input tokens)
 * even with a full year of quarters.
 */

import Anthropic from "@anthropic-ai/sdk";

const MODEL      = "claude-haiku-4-5-20251001";   // same choice as analyzer.js — fast + cheap
const MAX_TOKENS = 768;
const MIN_QUARTERS = 2;

const DIRECTIONS = ["IMPROVING", "STABLE", "DETERIORATING", "VOLATILE"];

/**
 * @typedef {Object} TrendResult
 * @property {string}      trend_direction    IMPROVING|STABLE|DETERIORATING|VOLATILE
 * @property {string}      narrative          2-4 sentence synthesis
 * @property {Object|null} inflection         { quarter, reason } | null
 * @property {number}      net_change         score(latest) - score(earliest)
 * @property {number}      signal_flips       count of signal changes across the window
 * @property {number}      quarters_analyzed
 */

/**
 * Pure numeric pass over history — no LLM call. History must be ascending
 * by quarter_date (oldest first).
 * @param {Array} history
 * @returns {{ deltas: Array, netChange: number, signalFlips: number }}
 */
export function computeDeltas(history) {
  const deltas = [];
  let signalFlips = 0;

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    if (curr.signal !== prev.signal) signalFlips++;
    deltas.push({
      from: prev.quarter,
      to:   curr.quarter,
      score_delta:  +((curr.score ?? 0) - (prev.score ?? 0)).toFixed(2),
      signal_from:  prev.signal,
      signal_to:    curr.signal,
    });
  }

  const netChange = history.length >= 2
    ? +((history[history.length - 1].score ?? 0) - (history[0].score ?? 0)).toFixed(2)
    : 0;

  return { deltas, netChange, signalFlips };
}

/**
 * @param {Array} history   Ascending-by-quarter_date rows
 * @param {{deltas:Array, netChange:number, signalFlips:number}} deltaInfo
 * @param {Object} holdingMeta { name, ticker }
 */
function buildPrompt(history, deltaInfo, { name, ticker }) {
  const timeline = history
    .map(h => `${h.quarter} (${h.quarter_date}): score ${h.score ?? "—"}/10, signal ${h.signal || "—"}. ${h.summary || ""}`)
    .join("\n");

  const system = `You are an equity analyst tracking how an earnings-call thesis evolves across consecutive quarters.
Always respond with valid JSON only — no markdown, no prose outside the JSON object.`;

  const user = `Here is the quarter-by-quarter concall analysis history for ${name}${ticker ? ` (${ticker})` : ""}, oldest first:

${timeline}

Net composite score change over this window: ${deltaInfo.netChange >= 0 ? "+" : ""}${deltaInfo.netChange}
Thesis signal changed ${deltaInfo.signalFlips} time(s) across these quarters.

Return a JSON object with EXACTLY this structure:
{
  "trend_direction": "<IMPROVING|STABLE|DETERIORATING|VOLATILE>",
  "narrative": "<2-4 sentences on how the story has evolved quarter to quarter, referencing specific quarters by name>",
  "inflection": { "quarter": "<quarter label, or null>", "reason": "<what changed there, or null>" }
}

Guidance:
- IMPROVING: scores trending up and/or signal moving toward CONFIRMS
- DETERIORATING: scores trending down and/or signal moving toward CHALLENGES/BREAKS
- STABLE: no material change in either scores or signal across the window
- VOLATILE: scores or signal swinging back and forth without a clear direction
- inflection: the single quarter where the story most clearly turned; set both fields to null if there isn't one`;

  return { system, user };
}

/**
 * @param {string} raw
 * @param {{deltas:Array, netChange:number, signalFlips:number}} deltaInfo
 * @returns {TrendResult}
 */
function parseResponse(raw, deltaInfo) {
  let json = raw.trim();
  const fenceMatch = json.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenceMatch) json = fenceMatch[1];

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Claude returned invalid JSON — could not parse trend analysis.");
  }

  const direction = DIRECTIONS.includes(parsed.trend_direction) ? parsed.trend_direction : "STABLE";
  const narrative = String(parsed.narrative || "");
  const inflection = parsed.inflection && parsed.inflection.quarter
    ? { quarter: String(parsed.inflection.quarter), reason: String(parsed.inflection.reason || "") }
    : null;

  return {
    trend_direction: direction,
    narrative,
    inflection,
    net_change:        deltaInfo.netChange,
    signal_flips:       deltaInfo.signalFlips,
    quarters_analyzed:  deltaInfo.deltas.length + 1,
  };
}

/**
 * Run the trend pipeline for a holding's concall history.
 * @param {Array}  history      Ascending-by-quarter_date rows (length >= MIN_QUARTERS)
 * @param {Object} holdingMeta  { name, ticker }
 * @returns {Promise<TrendResult>}
 */
export async function analyzeTrend(history, holdingMeta) {
  if (!Array.isArray(history) || history.length < MIN_QUARTERS) {
    throw new Error(`Need at least ${MIN_QUARTERS} analysed quarters to compute a trend (have ${history?.length ?? 0})`);
  }

  const key = process.env.ANTHROPIC_KEY;
  if (!key) throw new Error("ANTHROPIC_KEY not set on server");

  const deltaInfo = computeDeltas(history);
  const client = new Anthropic({ apiKey: key });
  const { system, user } = buildPrompt(history, deltaInfo, holdingMeta);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: user }],
  });

  const raw = response.content?.[0]?.type === "text" ? response.content[0].text : "";
  if (!raw) throw new Error("Empty response from Claude trend analysis");

  return parseResponse(raw, deltaInfo);
}
