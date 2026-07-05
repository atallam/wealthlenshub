/**
 * lib/concall/analyzer.js — Claude-powered earnings call analysis.
 *
 * Builds a structured prompt from transcript + holding metadata,
 * calls the Anthropic API, and parses the JSON response into a
 * normalized ConcallResult object.
 *
 * Signal vocabulary (borrowed from Drishti 2.0's thesis engine):
 *   CONFIRMS   — call reinforces the original investment thesis
 *   NEUTRAL    — no material change to thesis
 *   CHALLENGES — call raises concerns worth monitoring
 *   BREAKS     — fundamental thesis breach; reassess position
 *
 * Scoring weights (must sum to 1.0):
 *   guidance  35 %  — forward visibility and confidence
 *   tone      25 %  — management candour vs defensiveness
 *   clarity   25 %  — Q&A quality and transparency
 *   surprise  15 %  — positive / negative vs expectations
 */

import Anthropic from "@anthropic-ai/sdk";

const SIGNALS  = ["CONFIRMS", "NEUTRAL", "CHALLENGES", "BREAKS"];
const WEIGHTS  = { guidance: 0.35, tone: 0.25, clarity: 0.25, surprise: 0.15 };
const MODEL    = "claude-haiku-4-5-20251001";   // fast + cheap; enough for structured JSON
const MAX_TOKENS = 2048;

/**
 * @typedef {Object} ConcallResult
 * @property {number}   score            Composite 0–10
 * @property {string}   signal           CONFIRMS|NEUTRAL|CHALLENGES|BREAKS
 * @property {number}   score_guidance
 * @property {number}   score_tone
 * @property {number}   score_clarity
 * @property {number}   score_surprise
 * @property {Array}    bull_points      [{point, evidence}]
 * @property {Array}    bear_points      [{point, evidence}]
 * @property {Object}   guidance         {revenue, margins, capex, commentary}
 * @property {string[]} key_risks
 * @property {string}   summary
 */

/**
 * Build the system + user prompt for the analysis.
 * @param {string} transcript     Prepared (truncated) transcript text
 * @param {Object} holdingMeta    { name, ticker, type, quarter }
 * @returns {{ system: string, user: string }}
 */
function buildPrompt(transcript, { name, ticker, type, quarter }) {
  const isUS = ["US_STOCK", "US_ETF"].includes(type);
  const currency = isUS ? "USD" : "INR";

  const system = `You are an expert equity analyst specialising in earnings call analysis for ${isUS ? "US" : "Indian"} markets.
You extract structured, evidence-backed insights from earnings call transcripts.
Always respond with valid JSON only — no markdown, no prose outside the JSON object.`;

  const user = `Analyse this ${quarter} earnings call transcript for ${name}${ticker ? ` (${ticker})` : ""}.

TRANSCRIPT:
${transcript}

Return a JSON object with EXACTLY this structure (all fields required):
{
  "score_guidance": <float 0-10>,
  "score_tone": <float 0-10>,
  "score_clarity": <float 0-10>,
  "score_surprise": <float 0-10>,
  "signal": "<CONFIRMS|NEUTRAL|CHALLENGES|BREAKS>",
  "bull_points": [
    {"point": "<concise heading>", "evidence": "<specific quote or data from the call>"},
    ...
  ],
  "bear_points": [
    {"point": "<concise heading>", "evidence": "<specific quote or data from the call>"},
    ...
  ],
  "guidance": {
    "revenue": "<management's revenue outlook, or null>",
    "margins": "<margin guidance, or null>",
    "capex": "<capex plans, or null>",
    "commentary": "<key forward-looking statement in management's words>"
  },
  "key_risks": ["<risk 1>", "<risk 2>", ...],
  "summary": "<2-3 sentence synthesis of the most important takeaways from this call>"
}

Scoring rubric:
- score_guidance: 8-10 = specific quantitative guidance; 5-7 = directional; 3-4 = vague; 0-2 = no guidance or misleading
- score_tone: 8-10 = candid, confident, transparent; 5-7 = neutral; 3-4 = defensive; 0-2 = evasive or alarm signals
- score_clarity: 8-10 = direct answers in Q&A, clear data; 5-7 = mostly clear; 3-4 = deflects questions; 0-2 = very unclear
- score_surprise: 7-10 = materially positive surprise; 5-6 = in-line; 3-4 = mild miss; 0-2 = major negative surprise
- signal: CONFIRMS = call reinforces investment case; NEUTRAL = no material change; CHALLENGES = raises concerns; BREAKS = fundamental thesis breach

Include 2-4 bull_points and 2-4 bear_points. Use ${currency} for all financial figures. Be specific and evidence-backed.`;

  return { system, user };
}

/**
 * Parse and validate the Claude response JSON.
 * @param {string} raw  Raw text response from Claude
 * @returns {ConcallResult}
 */
function parseResponse(raw) {
  // Strip markdown code fences if Claude adds them despite instructions
  let json = raw.trim();
  const fenceMatch = json.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenceMatch) json = fenceMatch[1];

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Claude returned invalid JSON — could not parse concall analysis.");
  }

  // Validate and clamp sub-scores
  const clamp = n => Math.min(10, Math.max(0, Number(n) || 0));
  const sg = clamp(parsed.score_guidance);
  const st = clamp(parsed.score_tone);
  const sc = clamp(parsed.score_clarity);
  const ss = clamp(parsed.score_surprise);

  // Composite weighted score
  const score = +(
    sg * WEIGHTS.guidance +
    st * WEIGHTS.tone +
    sc * WEIGHTS.clarity +
    ss * WEIGHTS.surprise
  ).toFixed(2);

  // Validate signal
  const signal = SIGNALS.includes(parsed.signal) ? parsed.signal : "NEUTRAL";

  // Sanitise arrays
  const bullPoints = (Array.isArray(parsed.bull_points) ? parsed.bull_points : [])
    .slice(0, 6)
    .map(p => ({ point: String(p.point || ""), evidence: String(p.evidence || "") }));

  const bearPoints = (Array.isArray(parsed.bear_points) ? parsed.bear_points : [])
    .slice(0, 6)
    .map(p => ({ point: String(p.point || ""), evidence: String(p.evidence || "") }));

  const guidance = {
    revenue:     parsed.guidance?.revenue     || null,
    margins:     parsed.guidance?.margins     || null,
    capex:       parsed.guidance?.capex       || null,
    commentary:  parsed.guidance?.commentary  || null,
  };

  const keyRisks = (Array.isArray(parsed.key_risks) ? parsed.key_risks : [])
    .slice(0, 6)
    .map(String);

  const summary = String(parsed.summary || "");

  return { score, signal, score_guidance: sg, score_tone: st, score_clarity: sc, score_surprise: ss,
           bull_points: bullPoints, bear_points: bearPoints, guidance, key_risks: keyRisks, summary };
}

/**
 * Run the full analysis pipeline.
 * @param {string} transcript     Prepared transcript text
 * @param {Object} holdingMeta    { name, ticker, type, quarter }
 * @returns {Promise<ConcallResult>}
 */
export async function analyzeTranscript(transcript, holdingMeta) {
  const key = process.env.ANTHROPIC_KEY;
  if (!key) throw new Error("ANTHROPIC_KEY not set on server");

  const client = new Anthropic({ apiKey: key });
  const { system, user } = buildPrompt(transcript, holdingMeta);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: user }],
  });

  const raw = response.content?.[0]?.type === "text" ? response.content[0].text : "";
  if (!raw) throw new Error("Empty response from Claude analysis");

  return parseResponse(raw);
}
