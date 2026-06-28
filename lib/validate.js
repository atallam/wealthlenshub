/**
 * validate.js — Zod schemas and Express middleware for input validation.
 *
 * Usage (in a route file):
 *   import { validate, holdingSchema, transactionSchema } from "../lib/validate.js";
 *   router.post("/", auth, validate(holdingSchema), async (req, res) => { ... });
 *
 * The middleware attaches the parsed (coerced + stripped) data to req.validated.
 */

import { z } from "zod";

// ── Asset type enum ────────────────────────────────────────────────────────────
export const ASSET_TYPES = [
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

// ── Transaction schema ─────────────────────────────────────────────────────────
export const transactionSchema = z.object({
  holding_id:     z.string().min(1),
  type:           z.enum(["BUY", "SELL", "DIVIDEND", "SPLIT", "BONUS", "SIP"]),
  units:          z.coerce.number().finite(),
  price:          z.coerce.number().nonneg().finite(),
  date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  notes:          z.string().max(500).optional().nullable(),
});

// ── Budget transaction schema ──────────────────────────────────────────────────
export const budgetTxnSchema = z.object({
  txn_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "txn_date must be YYYY-MM-DD"),
  description: z.string().min(1).max(500).trim(),
  amount:      z.coerce.number().nonneg().finite(),
  txn_type:    z.enum(["DEBIT", "CREDIT"]),
  category:    z.string().max(100).optional().nullable(),
  currency:    z.string().length(3).toUpperCase().default("INR"),
});

// ── File upload metadata schema ────────────────────────────────────────────────
export const artifactMetaSchema = z.object({
  holdingId:   z.string().min(1),
  description: z.string().max(500).optional().default(""),
});

// ── Validation middleware factory ──────────────────────────────────────────────
/**
 * Returns Express middleware that validates req.body against the given Zod schema.
 * On success, attaches the cleaned data to req.validated.
 * On failure, returns 422 with structured error details.
 *
 * @param {z.ZodSchema} schema
 * @param {"body"|"query"|"params"} source
 */
export function validate(schema, source = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        field: e.path.join("."),
        message: e.message,
      }));
      return res.status(422).json({ error: "Validation failed", errors });
    }
    req.validated = result.data;
    next();
  };
}

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
