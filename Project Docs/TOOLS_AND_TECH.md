# WealthLens Hub — Tools & Technologies

> Version 2.1.0 · Last updated November 2026

A full inventory of every tool, library, API, and service used to build and run WealthLens Hub.

---

## Frontend

| Tool | Version | Purpose |
|---|---|---|
| **React** | 18.3 | UI component framework |
| **Vite** | 8.x | Build tool and dev server |
| **Lucide React** | 1.21 | Icon library |
| **Supabase JS** | 2.108 | Auth client and database queries from the browser |

The frontend is a **single-page application** in React 18 using functional components and hooks. `src/App.jsx` is a thin shell (about 300 lines) that owns state and composes `AppMain` (the tab router), `AppModals`, and the hooks in `src/hooks/`. Each tab lives in `src/features/<tab>/`; tabs and heavy modals are lazy-loaded. Styling is plain CSS with variables (`src/styles.css`), with light and dark themes.

---

## Backend

| Tool | Version | Purpose |
|---|---|---|
| **Node.js** | ≥ 22 | Server runtime |
| **Express.js** | 4.22 | HTTP server and REST API routing |
| **express-rate-limit** | 8.5 | Per-route rate limiting |
| **Helmet** | 8.1 | HTTP security headers (CSP, HSTS, etc.) |
| **CORS** | 2.8 | Cross-origin resource sharing middleware |
| **Multer** | 2.2 | Multipart file upload handling |
| **Zod** | 3.23 | Request validation and schema enforcement |

The backend is a single **ES-module Express server** (`server.js`) with route modules under `routes/` and service logic under `services/`.

---

## Database & Storage

| Tool | Purpose |
|---|---|
| **Supabase (PostgreSQL)** | Primary database — all portfolio, holdings, transactions, and user data |
| **Supabase Auth** | Google OAuth, GitHub OAuth, and email/password authentication |
| **Supabase Storage** | File storage for document attachments (bucket: `artifacts`) |

### Database Tables
`portfolio` · `holdings` · `transactions` · `profiles` · `asset_types` · `artifacts` · `net_worth_snapshots` · `snaptrade_connections` · `plaid_connections` · `setu_connections` · `setu_consents` · `concall_analyses` · `budget_statements` · `budget_transactions` · `budget_categories` · `budget_category_limits` · `budget_goals` · `budget_transaction_splits` · `budget_account_aliases` · `audit_logs` · `notifications` · `push_subscriptions` · `import_logs`

---

## AI & Machine Learning

| Tool | Purpose |
|---|---|
| **Anthropic Claude (claude-haiku / claude-3-5-sonnet)** | AI Advisor chat, portfolio analysis, tax strategy, concall analysis, spend insights, goal gap analysis, morning brief |
| **@anthropic-ai/sdk** | Official Anthropic TypeScript/JS SDK for streaming and tool-use |

Claude is used in **agentic tool-use mode** in the Advisor tab — it can call portfolio-data tools mid-conversation to fetch live holdings, run tax calculations, and look up prices before formulating a response. Streaming (SSE) is used across all AI features for real-time token-by-token output.

---

## Data Import & Parsing

| Tool | Version | Purpose |
|---|---|---|
| **papaparse** | 5.4 | CSV parsing for bank statement imports |
| **pdf-parse** | 1.1 | Plain-text extraction from PDF bank statements |
| **pdfjs-dist** | 4.4 | Advanced PDF parsing for CAS files (NSDL/CDSL) |
| **casparser** (Python) | latest | NSDL/CDSL CAS PDF decryption and structured data extraction |
| **casparser-isin** (Python) | latest | ISIN mapping for CAS holdings |
| **pymupdf** (Python) | latest | PDF rendering used by casparser |
| **exceljs** | 4.4 | Excel (.xlsx) parsing for bank statements and export generation |
| **cheerio** | 1.0 | HTML scraping for concall transcript providers (BSE/NSE filings) |

---

## Financial Data APIs

| API | Purpose | Fallback |
|---|---|---|
| **Twelve Data** | Live prices for Indian and US stocks/ETFs | Yahoo Finance |
| **Yahoo Finance** (unofficial) | Price fallback for .NS and .BO tickers | — |
| **AMFI / MFAPI** | Mutual fund NAV data and historical NAVs for SIP import | — |
| **exchangerate-api** | USD/INR foreign exchange rate | Yahoo USDINR=X |
| **NSE India** | Earnings call filings | BSE → Tickertape |
| **BSE India** | Earnings call filings (250+ codes) | Tickertape |
| **Tickertape** | Concall transcript provider (position 3 in chain) | Screener |
| **Screener.in** | Concall transcript provider | Motley Fool |
| **Motley Fool** | Concall transcript provider (last resort) | — |

---

## Brokerage & Bank Integrations

| Integration | Type | Purpose |
|---|---|---|
| **SnapTrade** | OAuth SDK (`snaptrade-typescript-sdk`) | Link US brokerage accounts (Robinhood, Schwab, etc.) and sync holdings |
| **Plaid** | REST API + Link UI | Link US bank accounts and import transactions |
| **Setu Account Aggregator** | AA consent flow + webhook | RBI-compliant aggregation of Indian bank/investment accounts; Setu blocks non-India IPs, so requests go through the small relay in `tools/setu-relay` |

---

## Email & Notifications

| Tool | Purpose |
|---|---|
| **Resend** | Transactional email delivery for alert digests |
| **web-push (VAPID)** | Browser push notifications |
| **alert-mailer.js** | Internal service that formats and dispatches alert digest emails |

---

## Security & Encryption

| Tool | Purpose |
|---|---|
| **AES-256-GCM** (Node `crypto`) | Encryption of PAN, Plaid tokens, and budget-sensitive data |
| **JWT** (via Supabase Auth) | Bearer token authentication on all API routes |
| **Helmet** | HTTP security headers |
| **express-rate-limit** | API rate limiting |
| **lib/guards.js** | Ownership guards — ensure users can only access their own data |
| **lib/validate.js + Zod** | Input validation on all write endpoints |

---

## Testing

| Tool | Purpose |
|---|---|
| **Vitest** 4 | Test runner for ~30 suites (~350 tests) |
| **tests/parsers.test.js** | Tests for all bank statement CSV/PDF parsers |
| **tests/tax.test.js** | Tests for LTCG/STCG calculation logic and FIFO lot matching |
| **tests/guards.test.js** | Tests for ownership guard logic |
| **tests/ownership.test.js** | Drives ~30 routes as a second user to prove no cross-user reads or writes |
| **tests/unscopedWrites.test.js** | Fails if a database write is not scoped to its owner or an id-keyed upsert skips the ownership check |
| **tests/migrationsDocs.test.js** | Fails if a migration is not listed in `migrations/README.md` |

---

## DevOps & Deployment

| Tool | Purpose |
|---|---|
| **Render** | Primary cloud deployment (`render.yaml` included) |
| **GitHub Actions** | CI (lint with zero warnings, build, `npm audit`, JS and Python tests) and a twice-weekly Supabase keep-alive |
| **Dependabot** | Weekly npm and monthly GitHub Actions update PRs || **Supabase** | Managed PostgreSQL + Auth + Storage (no self-hosting required) |

---

## Developer Tooling

| Tool | Version | Purpose |
|---|---|---|
| **ESLint** | 9.13 | JavaScript/JSX linting |
| **eslint-plugin-react** | 7.37 | React-specific lint rules |
| **eslint-plugin-react-hooks** | 5.0 | Hooks rule enforcement |
| **Prettier** | 3.3 | Code formatting |
| **scripts/check-file-size.mjs** | — | Warns about source files over 800 lines (`npm run check:size`) |
| **Python (pip)** | ≥ 3.x | Used by `casparser` — installed as a postinstall step |

---

## PWA Infrastructure

| Component | Details |
|---|---|
| **Service Worker** (`public/sw.js`) | Caches static assets for offline access |
| **Web App Manifest** (`public/manifest.json`) | Enables Add-to-Home-Screen on iOS and Android |
| **Install Prompt** | In-app banner for PWA installation |

---

## Architecture Summary

```
Browser (React SPA)
        │
        │  HTTPS / JWT Bearer
        ▼
 Express API Server (Node.js)
        │
   ┌────┴──────────────────────────────────────────┐
   │                                               │
Supabase DB            External Services
(PostgreSQL)           ├── Anthropic (AI)
Supabase Auth          ├── Twelve Data / Yahoo (prices)
Supabase Storage       ├── AMFI / MFAPI (MF NAV)
                       ├── SnapTrade / Plaid (brokers)
                       ├── Setu AA (Indian banks)
                       ├── Resend (email)
                       └── Web Push (VAPID)
```

