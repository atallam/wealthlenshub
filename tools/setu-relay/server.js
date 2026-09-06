// Plain Node alternative for a Mumbai VPS / container: `RELAY_KEY=... node server.js` (port 8787).
import http from "http";
import { relay } from "./relay.js";

const PORT = process.env.PORT || 8787;
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const [path, query = ""] = req.url.split("?");
    const segments = path.replace(/^\/api\//, "").split("/").filter(Boolean);
    const headers = {}; for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    const out = await relay({ method: req.method, segments, query, headers, body: body || undefined });
    res.writeHead(out.status, { "content-type": out.contentType }); res.end(out.body);
  });
}).listen(PORT, () => console.log(`setu-relay listening on :${PORT}`));
