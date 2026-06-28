import { Router } from "express";
import { supabase } from "../lib/db.js";
import { auth } from "../lib/auth.js";

const router = Router();

router.get("/:holdingId", auth, async (req, res) => {
  const { data, error } = await supabase.from("transactions")
    .select("*").eq("holding_id", req.params.holdingId).eq("user_id", req.user.id).order("txn_date", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post("/import", auth, async (req, res) => {
  const { transactions } = req.body;
  if (!transactions?.length) return res.status(400).json({ error: "No transactions to import" });

  const { data: userHoldings } = await supabase.from("holdings").select("id, name, ticker, scheme_code, type").eq("user_id", req.user.id);
  const holdingMap = {};
  for (const h of (userHoldings || [])) {
    if (h.ticker) holdingMap[h.ticker.toLowerCase()] = h.id;
    if (h.scheme_code) holdingMap[h.scheme_code.toLowerCase()] = h.id;
    holdingMap[h.name.toLowerCase()] = h.id;
  }

  const imported = [], unmatched = [], errors = [];
  for (const t of transactions) {
    const sym = (t._symbol || "").toLowerCase();
    const holdingId = holdingMap[sym] || holdingMap[sym.replace(/\s+/g, "")] || Object.entries(holdingMap).find(([k]) => k.includes(sym))?.[1];
    if (!holdingId) { unmatched.push(t._symbol); continue; }
    const { error } = await supabase.from("transactions").insert({
      id: "t_" + Date.now() + Math.random().toString(36).slice(2, 6),
      holding_id: holdingId, user_id: req.user.id,
      txn_type: t.txn_type || "BUY", units: Number(t.units) || 0, price: Number(t.price) || 0,
      txn_date: t.txn_date || new Date().toISOString().slice(0, 10), notes: t.notes || "Bulk import",
    });
    if (error) errors.push(`${t._symbol}: ${error.message}`);
    else imported.push(t._symbol);
  }
  res.json({ ok: true, imported_count: imported.length, unmatched_count: unmatched.length, error_count: errors.length, unmatched: [...new Set(unmatched)], errors });
});

router.post("/", auth, async (req, res) => {
  const { error } = await supabase.from("transactions").insert({ ...req.body, user_id: req.user.id });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.delete("/:id", auth, async (req, res) => {
  const { error } = await supabase.from("transactions").delete().eq("id", req.params.id).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
