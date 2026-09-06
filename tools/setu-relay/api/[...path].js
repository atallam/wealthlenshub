// Vercel serverless entry (pinned to bom1 via vercel.json). URL shape: /api/auth, /api/fiu/v2/consents ...
import { relay } from "../relay.js";

export const config = { api: { bodyParser: false } };

function readBody(req) {
  return new Promise((resolve) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d || undefined)); });
}

export default async function handler(req, res) {
  const segments = [].concat(req.query.path || []);
  const query = (req.url.split("?")[1] || "");
  const headers = {}; for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  const out = await relay({ method: req.method, segments, query, headers, body: await readBody(req) });
  res.status(out.status).setHeader("content-type", out.contentType).send(out.body);
}
