# Setu India relay

Setu's AA hosts (`orgservice-prod.setu.co`, `fiu-sandbox.setu.co`, `fiu.setu.co`) return a bare
`403 Forbidden` to non-India IPs. Render/Railway have no India region, so the main app can't reach
Setu directly. This folder is a ~40-line pass-through you deploy on an Indian IP; the main app
talks to it instead of Setu. Setu's webhooks (inbound) are unaffected and still hit the main app.

## Deploy on Vercel (bom1 = Mumbai, free tier)

```bash
cd tools/setu-relay
npx vercel login
npx vercel --prod            # accept defaults; note the https://<name>.vercel.app URL
npx vercel env add RELAY_KEY production   # paste a long random string, e.g. `openssl rand -hex 32`
# optional: SETU_UPSTREAM_FIU=https://fiu.setu.co when you move to Setu prod
npx vercel --prod            # redeploy so the env var is picked up
```

Sanity check (expect 401 without the key, 400 from Setu with it):

```bash
curl -i -X POST https://<name>.vercel.app/api/auth
curl -i -X POST https://<name>.vercel.app/api/auth -H "x-relay-key: <RELAY_KEY>" -H "client: bridge" -H "content-type: application/json" -d '{}'
```

## Point the main app at it (Render → Environment)

| Variable         | Value                                   |
|------------------|-----------------------------------------|
| `SETU_AUTH_URL`  | `https://<name>.vercel.app/api/auth`    |
| `SETU_BASE_URL`  | `https://<name>.vercel.app/api/fiu`     |
| `SETU_RELAY_KEY` | same value as the relay's `RELAY_KEY`   |

Existing `SETU_CLIENT_ID`, `SETU_CLIENT_SECRET`, `SETU_PRODUCT_INSTANCE_ID`, `SETU_ENABLED` stay as
they are — credentials are forwarded per request and never stored on the relay.

## Alternative: any Mumbai VPS

`RELAY_KEY=... node server.js` (port 8787) behind Caddy/nginx for TLS. Same env vars on the main app.
