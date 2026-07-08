# WealthLens Hub

A full-stack family portfolio dashboard for tracking Indian and US investments, with live market prices, agentic AI advisor, tax analytics, and multi-source data import.

---

## Core Features

### Portfolio & Holdings
- **13 asset types** — IN/US Stocks, ETFs, Mutual Funds, FD, PPF, EPF, Real Estate, Crypto, Bonds, Cash, Other
- **Multi-member family portfolio** — per-member filtered views and attribution
- **Liabilities panel** — true net worth (assets minus liabilities)
- **Document attachments** — per-holding file upload (PDF, images, statements) via Supabase Storage
- **Custom asset types** — create and manage your own categories

### Live Prices & Returns
| Asset | Source |
|-------|--------|
| Indian Stocks | Twelve Data / Yahoo Finance (.NS / .BO) |
| US Stocks | Twelve Data / Yahoo Finance |
| Mutual Fund NAV | AMFI → MFAPI |
| USD/INR FX | exchangerate-api → Yahoo fallback |

Return calculation cascades: **XIRR** (Newton-Raphson) → **CAGR** → **Simple return**

### Data Import
- **CAS PDF** — NSDL/CDSL CAS files, PAN-based password, multi-holder mapping
- **SIP bulk import** — historical NAVs fetched per month from MFAPI
- **SnapTrade** — US brokerage linking (Robinhood, Schwab, and more)
- **Plaid** — US bank transaction import
- **Zerodha Kite** — direct broker import
- **Breeze Connect** (ICICI) — direct broker import
- **Setu Account Aggregator** — AA-compliant Indian account data
- **ImportHub** — unified import UI with 14+ bank CSV / Excel / PDF parsers

### Budget Tracker
- Import statements from 14+ Indian and US banks
- Auto-categorization of transactions
- Plaid sync for US accounts
- AI-generated spend insights after each load

### Tax Analytics
- LTCG / STCG calculator with FIFO lot matching
- Financial year selector
- Tax-loss harvesting hints
- AI Tax Strategy — streaming recommendations on LTCG exemption headroom, harvest candidates, FD renewal angles

### Goals & Planning
- Goal creation with target amount and timeline
- Progress tracking with AI-powered gap analysis
- Scenario modeling via Goal Plan Modal
- Amortization calculator for loan/FD planning
- FD scan sheet for maturity tracking

### Net Worth History
- 24-month net worth snapshots (auto-triggered on price refresh)
- Nifty 50 and S&P 500 benchmark comparison

### Dividends & Cash Events
- Dividend tracking per holding
- Bonus shares, rights issues, and other cash events
- SWP (Systematic Withdrawal Plan) modeled distinctly from SELL

### Insurance
- Term life and health insurance policy tracking
- Premium and coverage visibility alongside investment assets

### Export
- Portfolio export to Excel and PDF (for CA filing or offline review)

### Alerts
- Threshold-based alerts with email / push notifications via alert-mailer service

### Stale Holdings Nudge
- Detects manual holdings (FD, PPF, EPF, Real Estate, Cash, Insurance, Other) that haven't been updated past their per-type threshold
- **Thresholds:** FD 90d · PPF 90d · EPF 90d · Real Estate 180d · Cash 14d · Insurance 365d · Other 60d
- **In-app:** amber banner in Holdings tab with count + one-click filter to view only stale rows
- **Email:** batched weekly digest — all stale holdings for a user in one email, sorted most-stale first (via `/api/cron/nudge-stale`)

### Sharing & Collaboration
- Share portfolio with viewer or editor roles via email invite

### Auth & Security
- Google OAuth, GitHub OAuth, email/password — all via Supabase
- JWT Bearer on every `/api/*` route
- Encrypted CAS credentials at rest
- Signed URLs for file access (5-min expiry)

---

## AI Features

All AI features use Claude and stream responses token-by-token via SSE.

### AI Advisor (AdvisorTab)
- Full conversational chat with your portfolio as context
- **Agentic tool-use loop** — multi-turn reasoning with 5 tools:
  - `get_portfolio_summary` — overall allocation and returns
  - `get_holdings` — full holdings list
  - `get_transactions` — transaction history
  - `get_goal_progress` — goal status and gap
  - `get_tax_summary` — LTCG/STCG snapshot
- Tool call indicators animate (spinning → ✓) as each tool resolves
- **Dynamic suggested questions** — generated from current portfolio state (triggered alerts, goal status, upcoming events)
- **Conversation persistence** — history saved across page refreshes

### Overview Tab — Morning Brief
On-demand streaming narrative summarising portfolio health, top movers, and action items for the day.

### Calendar Tab — Month Briefing
Per-month streaming AI summary — upcoming FD maturities, SIP dates, and events in view.

### Members Tab — Family Allocation Narrative
Streaming breakdown of how wealth is distributed across family members with rebalancing commentary.

### Holdings Tab — Per-Holding Analysis
"✦ Analyse" button on each holding row streams a 2-sentence read: XIRR vs asset-type benchmark and a hold/exit signal.

### ConcallPanel — Earnings Call Analysis
AI-powered earnings call analysis — extracts key figures, management commentary, and forward guidance from concall transcripts.

### Budget Tab — Spend Insights
After transactions load, auto-generates a summary of top spend categories, biggest month-over-month changes, and one budget recommendation.

### Goals Tab — AI Goal Planning
AI gap analysis and scenario recommendations per goal, powered by `useGoalAI` hook.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, inline styles |
| Backend | Express.js, Node >=18, ES modules |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase OAuth (Google, GitHub) + email/password |
| File Storage | Supabase Storage (`artifacts` bucket) |
| AI | Anthropic Claude (streaming SSE via `/api/ai/chat/stream`) |
| Brokerage | SnapTrade SDK |
| Bank data | Plaid |
| PDF parsing | pdf-parse, pdfjs-dist |
| CSV/Excel | PapaParse, xlsx |

---

## Project Structure

```
wealthlens-hub/
├── server.js              ← Express entry point
├── routes/                ← Modular API routes
│   ├── ai.js              ← Claude proxy + agentic tool loop
│   ├── tax.js             ← LTCG/STCG calculator
│   ├── budget.js          ← Budget import + categorization
│   ├── export.js          ← Excel/PDF export
│   ├── snaptrade.js       ← US brokerage integration
│   ├── plaid.js           ← US bank integration
│   ├── kite.js            ← Zerodha import
│   ├── breeze.js          ← ICICI Breeze import
│   ├── setu.js            ← Account Aggregator import
│   ├── concall.js         ← Earnings call analysis
│   └── ...
├── lib/                   ← Shared utilities
│   ├── prices.js          ← Price fetching logic
│   ├── tax.js             ← FIFO lot matching
│   ├── snapshot.js        ← Net worth snapshots
│   └── ...
├── services/              ← Business logic layer
├── src/
│   ├── App.jsx            ← Root app shell
│   ├── features/          ← Tab-level feature components
│   │   ├── advisor/       ← AI Advisor chat
│   │   ├── overview/      ← Morning brief
│   │   ├── holdings/      ← Holdings table + ConcallPanel
│   │   ├── budget/        ← Budget tracker
│   │   ├── tax/           ← Tax calculator
│   │   ├── goals/         ← Goals + planning
│   │   ├── calendar/      ← Calendar + events
│   │   ├── members/       ← Family allocation
│   │   └── strategy/      ← Strategy tab
│   ├── hooks/             ← useAI, useStreamAI, usePortfolio, ...
│   └── components/        ← Shared UI + modals
├── database.sql           ← Run once in Supabase SQL Editor
└── .env.example           ← Required environment variables
```

---

## Environment Variables

### Server-side (required)
| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (private) |
| `ANTHROPIC_KEY` | Anthropic API key for AI features |
| `ENCRYPTION_KEY` | Key for encrypting CAS credentials at rest |

### Server-side (optional)
| Variable | Purpose |
|----------|---------|
| `TWELVE_DATA_KEY` | Twelve Data API for stock prices |
| `SNAPTRADE_CLIENT_ID` | SnapTrade client ID |
| `SNAPTRADE_CONSUMER_KEY` | SnapTrade consumer key |
| `CRON_SECRET` | Secures `/api/cron/refresh-all-prices` and `/api/cron/nudge-stale` |
| `APP_URL` | Base URL for CTA links in nudge emails (e.g. `https://app.wealthlenshub.com`) |
| `PLAID_CLIENT_ID` | Plaid client ID |
| `PLAID_SECRET` | Plaid secret |
| `PLAID_ENV` | `sandbox` or `production` |

### Client-side (Vite)
| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase URL (public) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (public) |

---

## Setup

### 1. Supabase project
1. [supabase.com](https://supabase.com) → New project → Name: `wealthlens`, Region: South Asia (Mumbai)
2. SQL Editor → paste `database.sql` → Run

### 1b. Incremental migrations
After the initial `database.sql`, run any new files in `migrations/` in order via **Supabase → SQL Editor**:
```
migrations/0009_reconcile_artifacts_and_security.sql
migrations/0010_add_liabilities_column.sql
migrations/0011_drop_portfolio_sharing.sql
migrations/0012_concall_analyses.sql   ← required for Concall Analysis feature
migrations/0013_cash_events.sql
migrations/0014_fd_currency.sql
migrations/0015_insurance_fields.sql
```
Each file is idempotent (safe to re-run).

### 2. Auth providers
- Authentication → Providers → Enable **Google** and/or **GitHub**
- Add your OAuth client credentials from [console.cloud.google.com](https://console.cloud.google.com)

### 3. Environment
```bash
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_KEY, ENCRYPTION_KEY
```

### 4. Install and run
```bash
npm install
npm run dev       # frontend (Vite)
node server.js    # backend (Express)
```

### 5. Deploy
- **Render** — `render.yaml` included
- **Railway** — `railway.json` included
- **Replit** — `.replit` included

After deploying, update Supabase → Authentication → URL Configuration with your live URL.
