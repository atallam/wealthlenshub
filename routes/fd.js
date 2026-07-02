// routes/fd.js — FD certificate OCR scan endpoint
import { Router } from "express";
import multer from "multer";
import { auth, sendError, strictLimiter } from "../lib/auth.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const FD_PROMPT = `You are a precise financial document parser. Extract Fixed Deposit (FD) or Certificate of Deposit (CD) details from this document.

Return ONLY a valid JSON object with these exact fields (null for any field not visible):
{
  "bank_name": "name of the bank or financial institution",
  "account_holder": "name of the FD/CD holder",
  "fd_number": "FD/receipt/certificate number if shown",
  "principal": 500000,
  "currency": "INR",
  "interest_rate": 7.25,
  "tenure_months": 24,
  "start_date": "2024-01-15",
  "maturity_date": "2026-01-15",
  "maturity_amount": 578123,
  "interest_type": "compound",
  "compounding": "quarterly"
}

Rules:
- Dates → YYYY-MM-DD. Convert "15 Jan 2024" → "2024-01-15".
- interest_rate → number, e.g. 7.25 (not "7.25%").
- principal and maturity_amount → numbers, no commas or symbols.
- tenure in years → multiply by 12 for tenure_months.
- Return ONLY the JSON object. No markdown fences, no explanation.`;

router.post("/scan", auth, strictLimiter, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const key = process.env.ANTHROPIC_KEY;
  if (!key) return res.status(500).json({ error: "ANTHROPIC_KEY not configured" });

  try {
    const b64 = req.file.buffer.toString("base64");
    const mime = req.file.mimetype;
    const isPdf = mime === "application/pdf";

    // Build Claude content block — image or PDF
    const docBlock = isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image",    source: { type: "base64", media_type: mime, data: b64 } };

    const body = {
      // Configurable; defaults to a current Sonnet. Override with FD_MODEL if needed.
      model: process.env.FD_MODEL || "claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: [docBlock, { type: "text", text: FD_PROMPT }] }],
    };

    const headers = {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    };
    if (isPdf) headers["anthropic-beta"] = "pdfs-2024-09-25";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Claude FD OCR error:", response.status, data);
      return res.status(response.status).json({ error: data?.error?.message || "Claude API error" });
    }

    const raw = (data.content?.[0]?.text || "").trim();
    let fd;
    try {
      // Strip accidental markdown fences if Claude adds them
      const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
      fd = JSON.parse(cleaned);
    } catch {
      console.error("FD OCR parse error — raw:", raw);
      return res.status(422).json({ error: "Could not parse FD details from document", raw });
    }

    res.json({ ok: true, fd });
  } catch (e) {
    console.error("FD scan error:", e.message);
    sendError(res, e);
  }
});

export default router;
