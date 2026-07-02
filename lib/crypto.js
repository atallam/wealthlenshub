import crypto from "crypto";

// Single encryption key used for all sensitive fields (PAN, DOB, Plaid tokens, budget transactions).
// Env var: BUDGET_ENCRYPT_KEY — 64-char hex string (32 bytes).
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const IS_PROD = process.env.NODE_ENV === "production";

if (!process.env.BUDGET_ENCRYPT_KEY) {
  // In production, an ephemeral key would silently make ALL encrypted data
  // (PAN, DOB, broker tokens, budget descriptions) permanently undecryptable
  // after any restart/redeploy. Fail fast instead of losing data quietly.
  if (IS_PROD) {
    throw new Error(
      "BUDGET_ENCRYPT_KEY is not set. Refusing to start in production with an " +
      "ephemeral key — all encrypted data would be lost on restart. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  console.warn("⚠️  BUDGET_ENCRYPT_KEY not set — using ephemeral dev key. Encrypted data will be unreadable after restart. Set a 64-char hex key for any persistent use.");
}

// Validate key length when provided (must be 32 bytes / 64 hex chars for AES-256).
if (process.env.BUDGET_ENCRYPT_KEY && Buffer.from(process.env.BUDGET_ENCRYPT_KEY, "hex").length !== 32) {
  throw new Error("BUDGET_ENCRYPT_KEY must be a 64-character hex string (32 bytes).");
}

export const BUDGET_KEY = process.env.BUDGET_ENCRYPT_KEY
  ? Buffer.from(process.env.BUDGET_ENCRYPT_KEY, "hex")
  : crypto.randomBytes(32);

export function encrypt(text) {
  if (!text) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", BUDGET_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}

export function decrypt(data) {
  if (!data || !data.includes(":")) return data || "";
  try {
    const [ivHex, tagHex, encHex] = data.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", BUDGET_KEY, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
  } catch { return "[encrypted]"; }
}

/**
 * Compute a SHA-256 hash of a Buffer.
 * Used for file integrity verification on artifact uploads.
 * @param {Buffer} buffer
 * @returns {string} hex digest
 */
export function hashFile(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Verify that a file buffer matches a previously stored hash.
 * @param {Buffer} buffer
 * @param {string} expectedHex
 * @returns {boolean}
 */
export function verifyFileHash(buffer, expectedHex) {
  return hashFile(buffer) === expectedHex;
}
