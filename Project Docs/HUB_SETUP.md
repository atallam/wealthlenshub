# Wealth Lens Hub — Setup Guide

## What's different from WealthLens Pro

| Feature | WealthLens Pro | Wealth Lens Hub |
|---|---|---|
| Audience | Private family (allowlist) | Public (anyone can sign up) |
| Auth | Google only | Google OAuth + Email/Password |
| Data isolation | Single shared DB | Row-Level Security per user |
| Currency | INR hardcoded | User-selectable (10 currencies) |
| Asset types | Hardcoded list | User-configurable |
| Scale | 1 family | 100–500 users |
| Encryption | App-layer (budget) | RLS + app-layer (budget) |

---

## Supabase Setup

### 1. Create a new Supabase project
Go to supabase.com → New Project. Use a strong database password.

### 2. Enable Email Auth
Dashboard → Authentication → Providers → Email → Enable.
Optionally enable "Confirm email" for extra security.

### 3. Enable Google OAuth
Authentication → Providers → Google → Enable.
Add your Google OAuth Client ID and Secret (from Google Cloud Console).

### 4. Run the migration
Paste `migrations/database.sql` (or `hub_migration.sql` for a Hub-only setup) into the Supabase SQL Editor and run it, then run the numbered migrations in `migrations/` in order (see `migrations/README.md`). Migration 0029 is required for CAS import.

This creates:
- `profiles` — one row per user, stores display name + currency
- `asset_types` — user-configurable asset categories
- `portfolio` — members, goals, alerts (JSONB, per user)
- `holdings`, `transactions`, `artifacts` — all RLS-scoped to `user_id`
- `budget_statements`, `budget_transactions`, `budget_categories`
- `encryption_audit` — event log
- Auto-trigger: seeds default asset types + budget categories on signup

### 5. Set Redirect URLs
Authentication → URL Configuration:
- Site URL: `https://your-hub-app.onrender.com`
- Redirect URLs: `https://your-hub-app.onrender.com/**`

---

## Render Deployment

### Environment Variables

```
SUPABASE_URL               = https://xxxx.supabase.co
SUPABASE_SERVICE_KEY       = eyJ...  (service_role key, NOT anon)
VITE_SUPABASE_URL          = https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY     = eyJ...  (anon/public key)
ANTHROPIC_KEY              = sk-ant-...
BUDGET_ENCRYPT_KEY         = [64-char hex — generate once, keep safe]

# DO NOT set ALLOWED_EMAILS — Hub is open to all registered users
```

### Generate your encryption key
On any machine with Node.js:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Build & Start
- Use the included `render.yaml` (Node 22, region Singapore, health check `/health`). Its build command also installs the Python CAS parser:
  `pip install casparser==1.4.1 casparser-isin pymupdf --break-system-packages --quiet && npm install --include=dev && npx vite build`
- Start command: `node server.js`

---

## Security Architecture

### Row-Level Security (RLS)
Every table has RLS enabled. Supabase enforces:
```sql
auth.uid() = user_id
```
This means even if someone guesses another user's holding ID, Supabase
returns 0 rows. No user can ever see another user's data.

### Application-layer encryption
Budget transaction descriptions and balances are AES-256-GCM encrypted
before storage. The `BUDGET_ENCRYPT_KEY` never leaves your server.

### JWT verification
Every `/api/*` request verifies the Supabase JWT using the service key.
No JWT = 401. Tampered JWT = 401.

### No shared state
The old WealthLens Pro used `id = "family"` — a single shared portfolio
row. Hub uses `id = user_id` everywhere. There is no cross-user data.

---

## Scalability (100–500 users)

Supabase free tier: 50,000 monthly active users, 500MB DB.
- 500 users × ~50 holdings × ~24 transactions = ~600,000 rows → fine
- Use Supabase Pro ($25/mo) for > 50,000 requests/day

Render:
- Free tier sleeps after 15 min inactivity (bad for shared app)
- Use Starter ($7/mo) for always-on

For 500 active users consider:
- Render Starter + auto-scaling
- Supabase Pro for connection pooling (PgBouncer)
- Add Redis caching for Yahoo Finance / MFAPI responses

---

## Currency Support

Users select their base currency in ⚙️ Settings:
INR, USD, EUR, GBP, SGD, AED, AUD, JPY, CAD, CHF

All display formatting adapts. FX conversions use live Yahoo Finance rates.

## Asset Types

Each user gets 10 default types (Indian Stock, MF, ETF, US Stock, FD, PPF, EPF, Real Estate, Gold, Crypto).
Users can add custom types (Bonds, REITs, International ETFs etc.) in ⚙️ Settings.
Default types can be edited but not deleted.

---

## Import Options

Open **Import Hub** from the header or the Holdings tab.

- **NSDL / CDSL CAS PDF** — covers all brokers and mutual funds in one file (request it from cdslindia.com or nsdl.co.in); parsed with `casparser`
- **Broker holdings CSV / Excel** — 20+ formats auto-detected (Zerodha, Groww, ICICI Direct, HDFC Securities, Upstox, Angel One, Schwab, Fidelity, Robinhood, and more)
- **Broker tradebook** — transaction history
- **SnapTrade** — US brokerage sync
- **Account Aggregator (Setu)** — RBI consent flow (set `SETU_ENABLED=true` after running migration 0027)
- **Fixed deposits** — manual or AI scan; **manual entry** for anything else
- **Bank statements** (HDFC, ICICI, Axis, SBI, Kotak and others, India and US) — in the Family Budget tab

## Optional production settings

- `BODY_SCHEMA_MODE` and `CSP_MODE` start in permissive modes; see `ROLLOUT_ENFORCEMENT.md` before switching to enforce.
- `VAPID_*` keys enable push notifications; `RESEND_API_KEY` enables alert emails.
