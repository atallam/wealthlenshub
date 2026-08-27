# WealthLens Hub

> **Version 2.1.0** — A full-stack family portfolio dashboard for tracking Indian and US investments, with live market prices, agentic AI advisor, tax analytics, multi-source data import, and budget tracking.

---

## ✨ What It Does

WealthLens Hub is a personal finance command centre built for families managing wealth across Indian and US markets. It aggregates investments from brokers, mutual funds, fixed deposits, real estate, and bank accounts into a single dashboard — with AI-powered analysis, tax calculations, and goal planning built in.

---

## 🗂️ Features at a Glance

### 📊 Portfolio & Holdings
- **13 asset types** — IN/US Stocks, ETFs, Mutual Funds, FD, PPF, EPF, Real Estate, Crypto, Bonds, Cash, Other + custom types
- **Multi-member family portfolio** — per-member filtered views and attribution
- **Liabilities panel** — true net worth (assets − liabilities)
- **Per-holding document attachments** — PDF, images, statements via Supabase Storage (15 MB max)
- **Per-holding AI Analysis** — Claude analyses valuation, risk, and portfolio fit on demand
- **Concall Analysis** — fetch and AI-summarise latest earnings call transcripts (NSE → BSE → Tickertape → Screener → Motley Fool)
- **Stale holdings nudge** — in-app banner + weekly email for un-updated manual holdings

### 📈 Live Prices & Returns

| Asset | Primary Source | Fallback |
|---|---|---|
| Indian Stocks | Twelve Data (.NS / .BO) | Yahoo Finance |
| US Stocks / ETFs | Twelve Data | Yahoo Finance |
| Mutual Fund NAV | AMFI → MFAPI | — |
| USD/INR FX | exchangerate-api | Yahoo USDINR=X |

Return calculation cascades: **XIRR** → **CAGR** → **Simple return**

### 📥 Data Import

| Source | Format |
|---|---|
| CAS PDF (NSDL/CDSL) | PAN-based encrypted PDF |
| SIP Bulk Import | Historical NAVs from MFAPI |
| SnapTrade | US brokerage OAuth (Robinhood, Schwab, …) |
| Plaid | US bank transaction import |
| Zerodha Kite | Direct broker import |
| Breeze Connect (ICICI) | Direct broker import |
| Setu Account Aggregator | RBI AA-compliant Indian accounts |
| ImportHub | 14+ bank CSV / Excel / PDF parsers |
| Gmail Auto-Import | Scans inbox for CAS emails every 6 h |

### 💰 Budget Tracker
- Import statements from 14+ Indian and US banks
- Auto-categorisation of transactions; Plaid sync for US accounts
- AI-generated spend insights + Spending→Investment nudge after each import

### 🧾 Tax Analytics
- LTCG / STCG calculator with FIFO lot matching and January 2018 grandfathering
- Financial year selector; tax-loss harvesting hints; LTCG exemption headroom
- **AI Tax Strategy** — streaming 3-step action plan from Claude

### 🎯 Goals & Planning
- Goal creation with target amount, date, and member
- AI gap analysis and scenario modelling
- Amortisation calculator; FD scan sheet; FD maturity alerts (7 / 30 / 60 days)

### 🔖 Watchlist
- Track stocks/ETFs/MFs outside the portfolio with live price enrichment and target-price notes

### 🤖 AI Advisor
- Conversational AI with **agentic tool-use** — Claude calls portfolio tools mid-conversation for grounded answers
- Streaming responses; conversation persistence; dynamic suggested questions
- Full portfolio context on every turn

### 📅 Calendar Tab
- Monthly event calendar (FD maturities, SIP dates, dividend dates, alerts)
- **Month Briefing** — streaming Claude narrative of upcoming financial events

### 📸 Net Worth Snapshots
- 24-month rolling history auto-triggered on every price refresh
- Nifty 50 and S&P 500 benchmark comparison

### 💵 Dividends, Bonus Shares & SWP
- Dividend and corporate-action tracking per holding
- SWP tracked separately from SELL so withdrawals don't distort returns

### 🛡️ Insurance Tracker
- Term life and health insurance policy tracking alongside investments
- Renewal date visibility with alert system integration

### 🤝 Portfolio Sharing
- Invite any email as **viewer** or **editor**; revoke anytime

### 📤 Export
- Excel (4 sheets: Holdings, Transactions, FDs, Summary)
- Print-optimised PDF portfolio report

### 🔔 Alert System
- Holding price and return threshold alerts
- FD maturity reminders; stale holdings weekly digest
- All emails sent via Resend

### 📱 Progressive Web App
- Service worker, install prompt, offline cache; mobile-optimised UX

### 🔐 Security
- Google OAuth, GitHub OAuth, and email/password via Supabase Auth
- JWT Bearer on all `/api/*` routes; AES-256-GCM encryption for PAN and tokens
- Rate limiting (`express-rate-limit`) and security headers (`helmet`)

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Lucide React |
| Backend | Node.js ≥ 20, Express.js |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (Google / GitHub / Email) |
| File Storage | Supabase Storage |
| AI | Anthropic Claude (`@anthropic-ai/sdk`) |
| Brokerage | SnapTrade SDK, Plaid |
| Email | Resend |
| PDF Parsing | pdf-parse, pdfjs-dist, casparser (Python) |
| CSV / Excel | papaparse, exceljs |

See [Project Docs/TOOLS_AND_TECH.md](Project%20Docs/TOOLS_AND_TECH.md) for the full tool inventory.

---

## 🚀 Quick Start

### 1. Supabase Project
1. [supabase.com](https://supabase.com) → New project → Region: South Asia (Mumbai)
2. SQL Editor → paste `database.sql` → Run
3. Run incremental migrations from `migrations/` in order

### 2. Auth Providers
- Authentication → Providers → Enable **Google** and/or **GitHub**
- Add OAuth credentials from [console.cloud.google.com](https://console.cloud.google.com)

### 3. Environment Variables
```bash
cp .env.example .env
# Fill in at minimum:
# SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_KEY, BUDGET_ENCRYPT_KEY
```

### 4. Install and Run
```bash
npm install          # also installs casparser Python deps via postinstall
npm run dev          # Vite dev server (frontend)
node server.js       # Express API (backend)
```

### 5. Deploy
- **Render** — `render.yaml` included
- **Railway** — `railway.json` included
- **Replit** — `.replit` included

After deploying, update Supabase → Authentication → URL Configuration with your live URL.

---

## ⚙️ Environment Variables

See `.env.example` for the full annotated template. Key variables:

### Server-side (required)
| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (private) |
| `ANTHROPIC_KEY` | Anthropic API key for all AI features |
| `BUDGET_ENCRYPT_KEY` | 64-char hex for AES-256-GCM — generate: `openssl rand -hex 32` |

### Server-side (optional)
| Variable | Purpose |
|---|---|
| `TWELVE_DATA_KEY` | Live prices (falls back to Yahoo Finance if absent) |
| `RESEND_API_KEY` | Email delivery for alerts and reminders |
| `RESEND_FROM` | Verified sender address |
| `APP_URL` | Base URL for email CTAs |
| `CRON_SECRET` | Secures all `/api/cron/*` endpoints |
| `SNAPTRADE_CLIENT_ID / CONSUMER_KEY` | US brokerage sync |
| `PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV` | US bank import |
| `GMAIL_CLIENT_ID / SECRET / REDIRECT_URI / STATE_SECRET` | Gmail CAS auto-import |
| `SETU_CLIENT_ID / SECRET / PRODUCT_INSTANCE_ID / WEBHOOK_SECRET` | Setu AA integration |

### Client-side (Vite)
| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase URL (public) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (public) |

---

## ⏰ Cron Schedule

All endpoints require the header `x-cron-secret: $CRON_SECRET`.

| Endpoint | Recommended Schedule | Purpose |
|---|---|---|
| `POST /api/cron/refresh-all-prices` | Every 4 hours | Refresh stock / MF / FX prices |
| `POST /api/cron/alert-check` | Daily 08:00 | Evaluate alert rules → email digest |
| `POST /api/cron/fd-alerts` | Daily 08:00 | FD maturity reminders (7 / 30 / 60 days) |
| `POST /api/cron/nudge-stale` | Weekly | Stale holdings digest email |
| `POST /api/cron/check-cas-email` | Every 6 hours | Auto-import CAS from Gmail |

---

## 📁 Project Documentation

Detailed documentation lives in the [`Project Docs/`](Project%20Docs/) folder:

| Document | Description |
|---|---|
| [FEATURES.md](Project%20Docs/FEATURES.md) | In-depth explanation of every feature by tab/module |
| [TOOLS_AND_TECH.md](Project%20Docs/TOOLS_AND_TECH.md) | Full inventory of libraries, APIs, and services used |
| [BACKLOG.md](Project%20Docs/BACKLOG.md) | Open backlog — P0 security fixes through P3 enhancements |

---

## 🗄️ Database Schema

Core tables: `portfolio` · `holdings` · `transactions` · `profiles` · `asset_types` · `artifacts` · `portfolio_shares` · `net_worth_snapshots` · `snaptrade_connections` · `plaid_connections` · `watchlist` · `concall_analyses`

Initial schema: `database.sql` · Incremental changes: `migrations/`

---

## 📄 License

Private — personal / family use. Not licensed for redistribution.
