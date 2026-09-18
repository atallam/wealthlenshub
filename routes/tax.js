/**
 * routes/tax.js — LTCG / STCG tax computation (India, post Budget-2024)
 *
 * Rules applied:
 *  • Equity assets (IN_STOCK, IN_ETF, MF)
 *  • STCG  : holding < 12 months → 20 %  (new rate from Jul 2024)
 *  • LTCG  : holding ≥ 12 months → 12.5 % on gains > ₹ 1,25,000 exemption per FY
 *  • FIFO lot matching for SELLs
 *
 * Endpoint:  GET /api/tax/gains?fy=2025-26
 */

import { Router } from "express";
import { auth } from "../lib/auth.js";
import { currentFY } from "../lib/tax.js";
import { getGains } from "../services/tax.service.js";

const router = Router();

/**
 * GET /api/tax/gains?fy=2025-26
 *
 * Query params:
 *   fy       — Indian FY string, default current FY
 *   member   — member_id filter ("all" or specific id)
 */
router.get("/gains", auth, async (req, res) => {
  const fy     = req.query.fy     || currentFY();
  const member = req.query.member || "all";
  try {
    res.json(await getGains(req.user.id, { fy, member }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
