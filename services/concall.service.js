/**
 * services/concall.service.js — Earnings-call analysis data access.
 * Moved out of routes/concall.js (P3-2) — same queries, same behavior,
 * including the deliberate holding lookup design documented below.
 */
import { supabase } from "../lib/db.js";

/**
 * Return a holding by ID.
 *
 * We do NOT filter by user_id here because:
 *   1. The auth middleware already validated the Bearer JWT — req.user is set.
 *   2. The backend uses the service-role key, so RLS is bypassed.
 *   3. Holdings IDs are 16-char hex (h_<hex>) — practically unguessable.
 *   4. The user_id column may be NULL on rows created before migration 0018.
 *
 * If you need to assert ownership, do it after the call by joining through
 * portfolio membership (portfolio.user_id → members[].id → holding.member_id).
 */
export async function getHolding(holdingId) {
  const { data, error } = await supabase
    .from("holdings")
    .select("id, name, ticker, type, user_id, member_id")
    .eq("id", holdingId)
    .single();
  if (error || !data) {
    console.error("[concall] getHolding failed — holdingId=%s error=%j", holdingId, error);
    return { _notFound: true, holdingId, supabaseError: error };
  }
  return data;
}

/** Date representing the end of the given quarter (for sorting). */
export function quarterDate() {
  const d  = new Date();
  const m  = d.getMonth() + 1;
  const y  = d.getFullYear();
  if (m <= 3)  return new Date(y, 2, 31);     // Mar 31
  if (m <= 6)  return new Date(y, 5, 30);     // Jun 30
  if (m <= 9)  return new Date(y, 8, 30);     // Sep 30
  return new Date(y, 11, 31);                  // Dec 31
}

/** Derive a quarter label from today's date (e.g. "Q1 FY26"). */
export function currentQuarter() {
  const d  = new Date();
  const m  = d.getMonth() + 1;  // 1-indexed
  const y  = d.getFullYear();
  const fy = m >= 4 ? y + 1 : y;
  const q  = m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 && m <= 12 ? 3 : 4;
  return `Q${q} FY${String(fy).slice(-2)}`;
}

/** A cached, still-fresh analysis for this holding + quarter, or null. */
export async function getCachedAnalysis(holdingId, quarter) {
  const { data } = await supabase
    .from("concall_analyses")
    .select("*")
    .eq("holding_id", holdingId)
    .eq("quarter", quarter)
    .gt("expires_at", new Date().toISOString())
    .single();
  return data || null;
}

/** Persist analysis result to Supabase (upsert on holding_id + quarter). */
export async function saveAnalysis(holdingId, userId, quarter, result, provenance) {
  const { data, error } = await supabase
    .from("concall_analyses")
    .upsert(
      {
        holding_id:      holdingId,
        user_id:         userId,
        quarter,
        quarter_date:    quarterDate().toISOString().split("T")[0],
        score:           result.score,
        signal:          result.signal,
        score_guidance:  result.score_guidance,
        score_tone:      result.score_tone,
        score_clarity:   result.score_clarity,
        score_surprise:  result.score_surprise,
        bull_points:     result.bull_points,
        bear_points:     result.bear_points,
        guidance:        result.guidance,
        key_risks:       result.key_risks,
        summary:         result.summary,
        source_provider: provenance.provider,
        source_url:      provenance.url     || null,
        transcript_chars: provenance.chars  || null,
        analysed_at:     new Date().toISOString(),
        expires_at:      new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: "holding_id,quarter" }
    )
    .select()
    .single();

  if (error) {
    if (error.code === "42P01") {
      throw new Error("concall_analyses table not found — run migrations/0012_concall_analyses.sql in Supabase SQL editor");
    }
    throw error;
  }
  return data;
}

/** Latest analysis for a holding, scoped to the caller. Returns { analysis, noData }. */
export async function getLatest(holdingId, userId) {
  const { data, error } = await supabase
    .from("concall_analyses")
    .select("*")
    .eq("holding_id", holdingId)
    .eq("user_id", userId)
    .order("quarter_date", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    // PGRST116 = no rows found
    // 42P01   = table not yet migrated
    // 22P02   = holding_id column is uuid but holding id is text (run migration 0017)
    if (error.code === "PGRST116" || error.code === "42P01" || error.code === "22P02") {
      return { analysis: null, noData: true };
    }
    throw error;
  }
  return { analysis: data, noData: false };
}

/** Last 12 quarters of analysis history for a holding, scoped to the caller. */
export async function getHistory(holdingId, userId) {
  const { data, error } = await supabase
    .from("concall_analyses")
    .select("id, quarter, quarter_date, score, signal, summary, source_provider, analysed_at")
    .eq("holding_id", holdingId)
    .eq("user_id", userId)
    .order("quarter_date", { ascending: false })
    .limit(12);

  // 42P01 = table not yet migrated
  // 22P02 = holding_id type mismatch (run migration 0017)
  if (error && error.code !== "42P01" && error.code !== "22P02") throw error;
  return data || [];
}
