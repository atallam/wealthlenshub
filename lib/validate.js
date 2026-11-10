/**
 * validate.js — Zod schemas for input validation.
 *
 * Usage: validateRows(holdingSchema.partial(), rows) flags (without rejecting) rows
 * that don't match — see services/holdings.service.js.
 */

import { z } from "zod";

// ── Asset type enum ────────────────────────────────────────────────────────────
const ASSET_TYPES = [
  "US_STOCK", "US_ETF", "CRYPTO", "US_BOND", "CASH",
  "IN_STOCK", "IN_ETF", "IN_BOND", "MF", "FD", "PPF", "EPF",
  "REAL_ESTATE", "OTHER",
];

// ── Holding schema ─────────────────────────────────────────────────────────────
export const holdingSchema = z.object({
  name:           z.string().min(1).max(200).trim(),
  ticker:         z.string().max(50).trim().optional().nullable(),
  type:           z.enum(ASSET_TYPES),
  units:          z.coerce.number().nonnegative().finite(),
  purchase_price: z.coerce.number().nonnegative().finite(),
  current_price:  z.coerce.number().nonnegative().finite().optional().nullable(),
  currency:       z.string().length(3).toUpperCase().default("INR"),
  purchase_date:  z.string().datetime({ offset: true }).optional().nullable()
                  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable()),
  member_id:      z.string().uuid().optional().nullable(),
  notes:          z.string().max(1000).optional().nullable(),
});

// ── Array validation helper ────────────────────────────────────────────────────
/**
 * Validates an array of objects against a schema.
 * Returns { valid, invalid } partitions with row indices.
 *
 * @param {z.ZodSchema} schema
 * @param {unknown[]} rows
 */
// Hard cap on rows validated per call (zod advisory GHSA-mrhx-c7xc-m3w5: oversized collections can exhaust
// memory and no patched release exists yet). Rows past the cap are not validated, matching the lenient import.
export const MAX_VALIDATED_ROWS = 5000;

export function validateRows(schema, rows) {
  const valid = [], invalid = [];
  const n = Math.min(rows.length, MAX_VALIDATED_ROWS);
  for (let i = 0; i < n; i++) {
    const result = schema.safeParse(rows[i]);
    if (result.success) {
      valid.push({ index: i, data: result.data });
    } else {
      invalid.push({ index: i, raw: rows[i], errors: result.error.errors.map(e => e.message) });
    }
  }
  return { valid, invalid };
}

// ── Request-body schemas (budget + profile) ────────────────────────────────────
// Unknown keys are stripped (zod default), so a client can never smuggle user_id / id /
// created_at into an insert or update. BODY_SCHEMA_MODE=log (default) only logs bodies that
// fail validation and lets them through, so the UI cannot break; set it to "enforce" to 400.
const num = z.coerce.number().finite().nonnegative();
const short = (n) => z.string().max(n);
const settingsSchema = z.record(z.any()).refine((o) => JSON.stringify(o).length <= 10_000, "settings too large");

export const profileUpdateSchema = z.object({
  display_name: short(100).nullish(),
  currency:     short(8).nullish(),
  pan:          short(20).nullish(),
  dob:          short(20).nullish(),
  settings:     settingsSchema.nullish(),
});
export const assetTypeSchema = z.object({
  label:        short(60).min(1),
  icon:         short(16).nullish(),
  color:        short(32).nullish(),
  price_source: z.enum(["MANUAL", "YAHOO", "MFAPI"]).nullish(),
  currency:     short(8).nullish(),
  is_default:   z.boolean().nullish(),
});
export const assetTypeUpdateSchema = assetTypeSchema.partial();

export const categorySchema = z.object({
  name:          short(60).min(1),
  keywords:      z.union([short(2000), z.array(z.string().max(100)).max(200)]).nullish(),
  icon:          short(16).nullish(),
  color:         short(32).nullish(),
  monthly_limit: num.nullish(),
  is_essential:  z.boolean().nullish(),
});
export const categoryUpdateSchema = categorySchema.partial();
export const goalSchema = z.object({
  name:     short(100).min(1),
  target:   num,
  saved:    num.nullish(),
  due_date: short(32).nullish(),
  note:     short(500).nullish(),
  color:    short(32).nullish(),
  icon:     short(16).nullish(),
});
export const goalUpdateSchema = goalSchema.partial();
export const categoryLimitSchema = z.object({
  category_id:   short(100).min(1),
  member_id:     short(100).min(1),
  monthly_limit: num.nullish(),
});
export const txnCategorySchema = z.object({ category: short(60).min(1) });
export const recategoriseSchema = z.object({
  ids:      z.array(short(100)).min(1).max(500),
  category: short(60).min(1),
});

/** Express middleware: validate + strip req.body. See the note above for log vs enforce. */
export function bodyGuard(schema, label = "body") {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (parsed.success) { req.body = parsed.data; return next(); }
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    if (process.env.BODY_SCHEMA_MODE === "enforce") {
      return res.status(400).json({ error: `Invalid ${label}: ${msg}` });
    }
    console.warn(`[validate] ${label} failed schema (log mode, allowed through): ${msg}`);
    next();
  };
}
