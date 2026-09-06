// Setu India relay — a thin pass-through that runs on an Indian IP (Vercel bom1 or any
// Mumbai VPS) because Setu's hosts return 403 to non-India IPs.
//
// Routes (relative to the deployment):
//   POST /api/auth        → SETU_UPSTREAM_AUTH (default orgservice-prod login)
//   ANY  /api/fiu/<path>  → SETU_UPSTREAM_FIU/<path> (default fiu-sandbox)
// Every request must carry header `x-relay-key: <RELAY_KEY>`.
// No credentials live here — clientID/secret/product-instance-id are forwarded from the app.

const UPSTREAM_AUTH = process.env.SETU_UPSTREAM_AUTH || "https://orgservice-prod.setu.co/v1/users/login";
const UPSTREAM_FIU  = (process.env.SETU_UPSTREAM_FIU || "https://fiu-sandbox.setu.co").replace(/\/+$/, "");
const RELAY_KEY     = process.env.RELAY_KEY;
const FORWARD_HEADERS = ["content-type", "authorization", "client", "x-product-instance-id"];

function resolveUpstream(segments) {
  if (segments[0] === "auth" && segments.length === 1) return UPSTREAM_AUTH;
  if (segments[0] === "fiu" && segments.length > 1) return `${UPSTREAM_FIU}/${segments.slice(1).map(encodeURIComponent).join("/")}`;
  return null;
}

/**
 * @param {{method:string, segments:string[], query:string, headers:Record<string,string>, body:string|undefined}} req
 * @returns {Promise<{status:number, contentType:string, body:string}>}
 */
export async function relay(req) {
  if (!RELAY_KEY) return { status: 503, contentType: "application/json", body: JSON.stringify({ errorMsg: "RELAY_KEY not configured on relay" }) };
  if (req.headers["x-relay-key"] !== RELAY_KEY) return { status: 401, contentType: "application/json", body: JSON.stringify({ errorMsg: "Unauthorized relay request" }) };
  const target = resolveUpstream(req.segments);
  if (!target) return { status: 404, contentType: "application/json", body: JSON.stringify({ errorMsg: "Unknown relay route. Use /api/auth or /api/fiu/<path>" }) };

  const headers = {};
  for (const h of FORWARD_HEADERS) if (req.headers[h]) headers[h] = req.headers[h];
  const hasBody = req.body && !["GET", "HEAD"].includes(req.method);
  const upstream = await fetch(target + (req.query ? `?${req.query}` : ""), { method: req.method, headers, body: hasBody ? req.body : undefined });
  const text = await upstream.text();
  return { status: upstream.status, contentType: upstream.headers.get("content-type") || "application/json", body: text };
}
