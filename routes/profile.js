import { Router } from "express";
import { supabase } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";

const router = Router();

router.get("/", auth, async (req, res) => {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", req.user.id).single();
  if (error && error.code !== "PGRST116") return res.status(500).json({ error: error.message });
  if (!data) {
    const { data: newProfile } = await supabase.from("profiles").insert({ id: req.user.id, display_name: req.user.user_metadata?.full_name || req.user.email?.split("@")[0] || "User", currency: "INR" }).select().single();
    return res.json(newProfile || { id: req.user.id, currency: "INR" });
  }
  res.json(data);
});

router.put("/", auth, async (req, res) => {
  const { display_name, currency, pan, dob, settings } = req.body;
  const update = { id: req.user.id, updated_at: new Date().toISOString() };
  if (display_name !== undefined) update.display_name = display_name;
  if (currency !== undefined) update.currency = currency;
  if (pan !== undefined) update.encrypted_pan = pan ? encrypt(pan.toUpperCase().trim()) : null;
  if (dob !== undefined) update.encrypted_dob = dob ? encrypt(dob.trim()) : null;
  // settings is a JSONB column for user preferences (ppf_rate, epf_rate, etc.)
  if (settings !== undefined) update.settings = settings;
  const { error } = await supabase.from("profiles").upsert(update);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.get("/cas-credentials", auth, async (req, res) => {
  const { data, error } = await supabase.from("profiles").select("encrypted_pan, encrypted_dob").eq("id", req.user.id).single();
  if (error) return res.json({ pan: null, dob: null, has_credentials: false });
  const pan = data?.encrypted_pan ? decrypt(data.encrypted_pan) : null;
  const dob = data?.encrypted_dob ? decrypt(data.encrypted_dob) : null;
  if (!pan || pan === "[encrypted]") return res.json({ pan: null, dob: null, has_credentials: false });
  const maskedPan = pan.length >= 10 ? pan.slice(0, 4) + "****" + pan.slice(-1) : "****";
  // P1-2: never return the plaintext PAN/DOB to the client. CAS PDF unlock now
  // happens server-side (routes/import.js → resolveCasPassword). This endpoint
  // only reports whether credentials exist, plus a masked PAN for display.
  res.json({ pan_masked: maskedPan, has_credentials: true });
});

// Asset types
router.get("/asset-types", auth, async (req, res) => {
  const { data, error } = await supabase.from("asset_types").select("*").eq("user_id", req.user.id).order("label");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post("/asset-types", auth, async (req, res) => {
  const id = "at_" + Date.now().toString(36) + "_" + req.user.id.slice(0,8);
  const { error } = await supabase.from("asset_types").insert({ id, user_id: req.user.id, ...req.body });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, id });
});

router.put("/asset-types/:id", auth, async (req, res) => {
  const { error } = await supabase.from("asset_types").update(req.body).eq("id", req.params.id).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.delete("/asset-types/:id", auth, async (req, res) => {
  await supabase.from("asset_types").delete().eq("id", req.params.id).eq("user_id", req.user.id);
  res.json({ ok: true });
});

export default router;
