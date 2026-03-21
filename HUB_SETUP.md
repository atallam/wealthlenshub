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
Paste `hub_migration.sql` into Supabase SQL Editor → Run.

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
- Build command: `npm install --include=dev && npx vite build`
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

## Import Position Options

### Currently supported
- CSV from any Indian broker (HDFC Sec, ICICI Direct, Zerodha, Groww, Upstox)
- Excel/XLSX (holdings export)
- Bank statements (HDFC, ICICI, Axis, SBI, Kotak) — for Budget module

### Recommended for best experience
- **Zerodha Console**: Holdings → Export CSV
- **Groww**: Portfolio → Download
- **CDSL/NSDL CAS**: Request via cdslIndia.com — covers ALL brokers in one file

### On the roadmap
- CDSL CAS automatic parser
- Account Aggregator (AA) integration via Setu/Finvu
- Kuvera direct import
