# WealthLens Hub

> **Version 2.1.0** — A full-stack family wealth dashboard for tracking Indian and US investments, with live prices, an agentic AI advisor, multi-source import (CAS, brokers, Account Aggregator, bank statements) and a shared family budget.

Live at [wealthlens.pro](https://wealthlens.pro).

---

## ✨ What It Does

WealthLens Hub is a personal finance command centre for families who hold money across India and the US. It pulls mutual funds, stocks, ETFs, fixed deposits, PPF/EPF, real estate, insurance and bank accounts into one place, then adds returns analysis, rebalancing, goal planning, a family budget and an AI advisor that can look things up in your own data.

---

## 🗂️ The App at a Glance

The app has nine tabs (a four-tab bottom bar plus a "more" sheet on mobile):

| Tab | What you do there |
|---|---|
| **Overview** | Net worth, allocation, health score, SIP analytics, liabilities, NRI summary, protection coverage |
| **Holdings** | Every holding grouped by market, with per-holding transactions, alerts, documents, concall analysis and cost basis |
| **Goals** | Goal tracking, status vs. target, AI-assisted goal planner |
| **Strategy** | Price/return alerts, rebalancing against a target allocation, goal-conflict warnings |
| **Family** | Members, per-member views and attribution |
| **Family Budget** | Bank-statement import, categories, splits across members, per-member limits, recurring spend |
| **Calendar** | FD maturities, SIP/dividend dates, alerts and the upcoming concall outlook |
| **Advisor** | Streaming AI chat that calls tools against your portfolio |
| **News** | Market, RBI and SEBI headlines plus news tied to your holdings |

### 📊 Portfolio & Holdings
- **Asset types** — Indian and US stocks, ETFs, mutual funds, FD, PPF, EPF, bonds, crypto, cash, real estate, insurance, plus custom types
- **Grouped by market** — US, Indian and other assets with per-group totals; USD holdings shown in native currency with an INR equivalent
- **Multi-member family portfolio** — filter every tab by member
- **Transactions per holding** — buys, sells, SIPs, dividends, bonus shares, SWP (tracked separately from sells so withdrawals do not distort returns), with a lot-based cost basis view
- **Matured FD handling** — matured deposits surface in a banner with Renew / Convert to cash / Close actions
- **FD tools** — scan an FD certificate with AI, FD ladder planner, maturity alerts
- **Mutual fund overlap** — see which stocks your funds hold in common
- **Liabilities** — loan amortisation and true net worth (assets − liabilities)
- **Documents** — attach PDFs and images to any holding
- **Concall analysis** — fetches the latest earnings-call transcript and summarises it with AI
- **Stale-data nudges** — per-type thresholds flag manual holdings that have not been updated, and a banner shows how fresh each imported statement is
- **Demo mode** — load sample data to explore without importing anything

### 📈 Live Prices & Returns

| Asset | Source |
|---|---|
| Indian and US stocks / ETFs | Twelve Data, falling back to Yahoo Finance |
| Mutual fund NAV | AMFI (NAVAll), falling back to MFAPI |
| USD/INR | exchangerate-api, falling back to Yahoo |

A freshness badge shows when prices last updated and which holdings missed the latest refresh. Returns use **XIRR** where transaction history exists, then CAGR, then simple return. Net-worth snapshots are saved on refresh and charted against Nifty 50 and S&P 500.

### 📥 Import Hub

| Source | Notes |
|---|---|
| **NSDL / CDSL CAS** | PAN-protected PDF parsed with `casparser`; demat ETFs are recognised as ETFs, fund names and NAVs are enriched from AMFI, re-imports update in place |
| **Broker tradebook** | Transaction history from Indian brokers |
| **Broker holdings CSV / Excel** | 20+ parsers with auto-detection: Zerodha, Groww, ICICI Direct, HDFC Securities, Upstox, Angel One, Schwab, Fidelity, Robinhood, Vanguard, IBKR, E*TRADE, Coinbase, Merrill, JPMorgan, Webull, SoFi, Wealthfront, Betterment, Firstrade, Ally, Public, Tastytrade and a generic fallback |
| **SnapTrade** | Read-only US brokerage sync (including 401(k) accounts); each sync replaces that account's positions atomically |
| **Account Aggregator (Setu)** | RBI-regulated consent flow for Indian bank and investment data |
| **Fixed deposit** | Manual entry or AI scan of a certificate |
| **Manual entry** | Add any holding by hand |

### 💰 Family Budget
- **Statement import** — CSV, Excel and PDF from 14+ Indian and US banks, with duplicate detection and account-holder matching to family members
- **Plaid** — optional US bank transaction sync
- **Categories** — auto-categorisation, editable keywords, rename (existing transactions follow), essential vs. discretionary flag
- **Split transactions** — divide one transaction across family members
- **Limits** — monthly limit per category, overridable per member
- **Insights** — merchant rollup, recurring-spend detection, cash-flow and trend charts, budget goals
- **Privacy** — transaction descriptions and balances are encrypted at rest

### 🤖 AI Advisor
- Streaming chat with **tool use**: Claude calls tools for holdings, portfolio summary, transactions, goal progress, tax summary (LTCG/STCG under current Indian rules), budget summary, net-worth history, FD maturities and concall data, so answers come from your own numbers
- Dynamic suggested questions based on the current portfolio
- Also powers the morning brief, goal planning, rebalance explanations, concall summaries and FD scanning

### 🎯 Strategy & Goals
- **Alerts** — price and return thresholds, FD maturity reminders, undo on delete, optional email digest
- **Rebalancing** — set a target allocation and get a trade list, with an AI explanation and a per-holding long-term-gain drill-down
- **Warnings** — goal conflicts, goals behind schedule, FD maturity
- **Goals** — target amount and date, progress vs. plan, and a planner that models the gap

### 🔔 Notifications & PWA
- In-app notification centre and Web Push (VAPID) notifications
- Installable PWA with a service worker, offline cache and mobile-first navigation
- Privacy mask to hide balances on screen, light/dark theme

### 📤 Export
- Excel workbook and a print-ready PDF report, scoped to the rows you have on screen or to everything

### 🔐 Security
- Supabase Auth (Google, GitHub, email/password); JWT on every `/api` route, with the Setu webhook protected by its own shared secret
- Ownership checks on every write so one user can never touch another user's rows
- AES-256-GCM encryption for PAN, tokens and budget data
- Request-body validation with Zod (`BODY_SCHEMA_MODE`), Content-Security-Policy (`CSP_MODE`), `helmet`, rate limiting
- Audit log of data-changing actions; error details hidden in production

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Lucide React; code-split tabs and modals |
| Backend | Node.js ≥ 22, Express |
| Database | Supabase (PostgreSQL) |
| Auth / Storage | Supabase Auth and Storage |
| AI | Anthropic Claude (`@anthropic-ai/sdk`) |
| Brokerage / banks | SnapTrade, Plaid, Setu Account Aggregator |
| Email / push | Resend, Web Push |
| PDF parsing | `casparser` (Python), pdf-parse, pdfjs-dist |
| Spreadsheets | papaparse, exceljs |
| Tests | Vitest |

See [Project Docs/TOOLS_AND_TECH.md](Project%20Docs/TOOLS_AND_TECH.md) for the full inventory.

---

## 📁 Repository Layout

```
server.js            Express app: security middleware, routers, static frontend
routes/              HTTP layer, one router per area (holdings, budget, ai, setu, ...)
services/            Business logic and database access
  budget/            Budget service split by area (statements, categories, splits, ...)
lib/                 Shared helpers: prices, tax maths, XIRR, crypto, validation, guards
  parsing/           CSV / Excel / PDF parsers (banks, brokers, CAS)
  concall/           Earnings-call transcript providers
src/                 React app
  features/          One folder per tab (holdings, budget, strategy, goals, ...)
  components/        Shared UI, modals and the notification centre
  hooks/             State and data hooks (portfolio, import, AI, derived values)
migrations/          Ordered SQL migrations (see migrations/README.md)
tests/               Vitest suites (parsers, ownership, guards, budget, CAS, ...)
scripts/             Repo tooling (file-size check)
tools/setu-relay/    Small relay used to reach Setu from outside India
Project Docs/        Feature reference, audits, backlog, rollout notes
```

---

## 🚀 Quick Start

### 1. Supabase project
1. [supabase.com](https://supabase.com) → New project (Mumbai region works well)
2. SQL Editor → run `migrations/database.sql`
3. Run the numbered migrations in `migrations/` in order (see `migrations/README.md`)

### 2. Auth providers
Authentication → Providers → enable **Google** and/or **GitHub**, and add your OAuth credentials.

### 3. Environment variables
```bash
cp .env.example .env
# At minimum: SUPABASE_URL, SUPABASE_SERVICE_KEY, VITE_SUPABASE_URL,
#             VITE_SUPABASE_ANON_KEY, ANTHROPIC_KEY, BUDGET_ENCRYPT_KEY
```

### 4. Install and run
```bash
npm install          # also installs the casparser Python packages via postinstall
npm run dev          # Vite dev server (frontend)
node server.js       # Express API (backend)
```

### 5. Deploy
The app deploys to **Render** using `render.yaml` (Node 22). The build installs the Python CAS parser, builds the frontend and serves everything from `server.js`; `/health` is the health check. After deploying, add your live URL under Supabase → Authentication → URL Configuration.

---

## ⚙️ Environment Variables

See `.env.example` for the full annotated list.

### Required
| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Supabase project and service-role key (server only) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Supabase URL and anon key for the browser |
| `ANTHROPIC_KEY` | All AI features |
| `BUDGET_ENCRYPT_KEY` | 64-char hex for AES-256-GCM (`openssl rand -hex 32`); changing it makes existing encrypted data unreadable |

### Optional
| Variable | Purpose |
|---|---|
| `TWELVE_DATA_KEY` | Live stock prices (Yahoo Finance is used if absent) |
| `API_NINJAS_KEY`, `EARNINGSCALLS_DEV_KEY` | US earnings-call transcript APIs |
| `RESEND_API_KEY`, `RESEND_FROM`, `APP_URL` | Email alerts and links |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT` | Web Push (leave blank to disable) |
| `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY` | US brokerage sync |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` | US bank import |
| `SETU_ENABLED`, `SETU_BASE_URL`, `SETU_CLIENT_ID`, `SETU_CLIENT_SECRET`, `SETU_PRODUCT_INSTANCE_ID`, `SETU_WEBHOOK_SECRET` | Account Aggregator |
| `BODY_SCHEMA_MODE` | `log` (default) or `enforce` request-body validation |
| `CSP_MODE` | `report-only` (default), `enforce` or `off` |
| `CORS_ORIGINS` | Comma-separated allowed origins |

Before switching `BODY_SCHEMA_MODE` or `CSP_MODE` to enforce, read [ROLLOUT_ENFORCEMENT.md](Project%20Docs/ROLLOUT_ENFORCEMENT.md).

---

## 🧪 Development

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm test` | Run the Vitest suites |
| `npm run lint` | ESLint, failing on any warning |
| `npm run build` | Production frontend build |
| `npm run check:size` | Warn about source files over 800 lines |

**CI** (GitHub Actions) runs lint with zero warnings allowed, the production build, `npm audit` (non-blocking), the JS tests and the Python CAS tests on every push and pull request. Dependabot opens weekly dependency PRs, and a small workflow pings Supabase twice a week to keep a free-tier project awake.

Several tests are guard rails rather than unit tests: one fails if a database write is not scoped to its owner, another fails if an id-keyed upsert skips the ownership check. If you add a new write path, expect them to ask for the same.

---

## 📚 Project Documentation

| Document | Description |
|---|---|
| [FEATURES.md](Project%20Docs/FEATURES.md) | Feature-by-feature reference |
| [TOOLS_AND_TECH.md](Project%20Docs/TOOLS_AND_TECH.md) | Libraries, APIs and services used |
| [BACKLOG.md](Project%20Docs/BACKLOG.md) | Open backlog |
| [AUDIT_2026-11.md](Project%20Docs/AUDIT_2026-11.md) | Latest code audit |
| [ROLLOUT_ENFORCEMENT.md](Project%20Docs/ROLLOUT_ENFORCEMENT.md) | Switching validation and CSP from log-only to enforce |
| [HUB_SETUP.md](Project%20Docs/HUB_SETUP.md) | Hub setup notes |

---

## 🗄️ Database

Core tables include `holdings`, `transactions`, `portfolio`, `profiles`, `asset_types`, `artifacts`, `net_worth_snapshots`, the budget tables (`budget_statements`, `budget_transactions`, `budget_categories`, `budget_goals`, `budget_transaction_splits`, `budget_category_limits`), connection tables for SnapTrade, Plaid and Setu, `concall_analyses`, `audit_logs`, `notifications` and `push_subscriptions`.

The initial schema is `migrations/database.sql`; incremental changes are the numbered files beside it.

---

## 📄 License

Private — personal / family use. Not licensed for redistribution.
