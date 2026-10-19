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
  "IN_STOCK", "IN_ETF", "MF", "FD", "PPF", "EPF",
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
export function validateRows(schema, rows) {
  const valid = [], invalid = [];
  for (let i = 0; i < rows.length; i++) {
    const result = schema.safeParse(rows[i]);
    if (result.success) {
      valid.push({ index: i, data: result.data });
    } else {
      invalid.push({ index: i, raw: rows[i], errors: result.error.errors.map(e => e.message) });
    }
  }
  return { valid, invalid };
}
