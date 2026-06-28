import crypto from "crypto";

export const BUDGET_KEY = process.env.BUDGET_ENCRYPT_KEY
  ? Buffer.from(process.env.BUDGET_ENCRYPT_KEY, "hex")
  : crypto.randomBytes(32);

if (!process.env.BUDGET_ENCRYPT_KEY) {
  console.warn("⚠️  BUDGET_ENCRYPT_KEY not set — using ephemeral key. Transactions will lose decryption on restart. Set a 64-char hex key in Render env.");
}

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
