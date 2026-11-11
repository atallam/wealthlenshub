import { supabase } from "../../lib/db.js";
import { yahooFetch } from "../../lib/prices.js";

// ── Goals (Budget 2) ──────────────────────────────────────────────

export async function listGoals(userId) {
  const { data } = await supabase.from("budget_goals").select("*").eq("user_id", userId).order("created_at", { ascending: true });
  return data || [];
}

export async function createGoal(userId, { name, target, saved, due_date, note, color, icon }) {
  const id = `goal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { data, error } = await supabase.from("budget_goals").insert({
    id, user_id: userId, name: String(name).slice(0, 100),
    target: Number(target) || 0, saved: Number(saved) || 0,
    due_date: due_date || null, note: String(note || "").slice(0, 500),
    color: color || "#c9a84c", icon: icon || "🎯",
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateGoal(userId, id, patch) {
  const allowed = ["name", "target", "saved", "due_date", "note", "color", "icon"];
  const safe = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
  if (safe.name)   safe.name   = String(safe.name).slice(0, 100);
  if (safe.target) safe.target = Number(safe.target) || 0;
  if (safe.saved)  safe.saved  = Number(safe.saved)  || 0;
  safe.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from("budget_goals").update(safe).eq("id", id).eq("user_id", userId).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteGoal(userId, id) {
  const { error } = await supabase.from("budget_goals").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function benchmark(period = "1Y") {
  const range = ({ "1Y": "1y", "3Y": "3y", "5Y": "5y", ALL: "10y" })[period] || "1y";
  const fetchSeries = async (symbol) => {
    const data = await yahooFetch(`/v8/finance/chart/${symbol}?interval=1mo&range=${range}`);
    const result = data?.chart?.result?.[0];
    if (!result) return [];
    const ts = result.timestamp || [];
    const closes = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
    return ts.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 7), value: closes[i] })).filter((p) => p.value != null);
  };
  const [nifty, sp500] = await Promise.all([fetchSeries("^NSEI"), fetchSeries("^GSPC")]);
  const normalize = (s) => { if (!s.length) return []; const base = s[0].value; return s.map((p) => ({ date: p.date, value: p.value, pct: +(((p.value - base) / base) * 100).toFixed(2) })); };
  return { nifty50: normalize(nifty), sp500: normalize(sp500), period, fetchedAt: new Date().toISOString() };
}
