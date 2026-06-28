import { Router } from "express";
import multer from "multer";
import { supabase } from "../lib/db.js";
import { auth } from "../lib/auth.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.get("/:holdingId", auth, async (req, res) => {
  const { data, error } = await supabase.from("artifacts").select("*").eq("holding_id", req.params.holdingId).order("uploaded_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post("/upload", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const { holdingId, description } = req.body;
  if (!holdingId) return res.status(400).json({ error: "holdingId required" });
  const id = "art_" + Date.now() + Math.random().toString(36).slice(2,6);
  const ext = req.file.originalname.split(".").pop();
  const storagePath = `holdings/${holdingId}/${id}.${ext}`;
  const { error: upErr } = await supabase.storage.from("artifacts").upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
  if (upErr) return res.status(500).json({ error: upErr.message });
  const { error: dbErr } = await supabase.from("artifacts").insert({ id, holding_id: holdingId, file_name: req.file.originalname, storage_path: storagePath, file_type: req.file.mimetype, file_size: req.file.size, description: description || "" });
  if (dbErr) return res.status(500).json({ error: dbErr.message });
  res.json({ ok: true, id, file_name: req.file.originalname });
});

router.get("/download/:id", auth, async (req, res) => {
  const { data, error } = await supabase.from("artifacts").select("storage_path, file_name").eq("id", req.params.id).single();
  if (error || !data) return res.status(404).json({ error: "Not found" });
  const { data: signed } = await supabase.storage.from("artifacts").createSignedUrl(data.storage_path, 300);
  res.json({ url: signed?.signedUrl, file_name: data.file_name });
});

router.delete("/:id", auth, async (req, res) => {
  const { data } = await supabase.from("artifacts").select("storage_path, holding_id").eq("id", req.params.id).single();
  if (!data) return res.status(404).json({ error: "Not found" });
  const { data: holding } = await supabase.from("holdings").select("id").eq("id", data.holding_id).eq("user_id", req.user.id).single();
  if (!holding) return res.status(403).json({ error: "Not authorized" });
  if (data.storage_path) await supabase.storage.from("artifacts").remove([data.storage_path]);
  await supabase.from("artifacts").delete().eq("id", req.params.id);
  res.json({ ok: true });
});

export default router;
