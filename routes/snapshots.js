import { Router } from "express";
import { supabase } from "../lib/db.js";
import { auth, sendError } from "../lib/auth.js";
import { takeSnapshot } from "../lib/snapshot.js";

const router = Router();

router.post("/", auth, async (req, res) => {
  try {
    const { source = "manual", cas_statement_date = null } = req.body;
    const result = await takeSnapshot(req.user.id, { source, cas_statement_date });
    if (!result.snapshot) return res.json(result);
    res.json({ snapshot: result.snapshot });
  } catch (e) { console.error("Snapshot error:", e); sendError(res, e); }
});

router.get("/", auth, async (req, res) => {
  try {
    const { months = 24 } = req.query;
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - parseInt(months));
    const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;
    const { data, error } = await supabase.from("net_worth_snapshots")
      .select("*").eq("user_id", req.user.id).gte("snapshot_month", cutoffMonth)
      .order("snapshot_month", { ascending: true });
    if (error) throw error;
    res.json({ snapshots: data || [] });
  } catch (e) { console.error("Snapshots fetch error:", e); sendError(res, e); }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    const { error } = await supabase.from("net_worth_snapshots").delete().eq("id", req.params.id).eq("user_id", req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

export default router;
