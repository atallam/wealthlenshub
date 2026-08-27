# WealthLens Hub — Feature Reference

> Version 2.1.0 · Last updated August 2026

This document describes every feature available in WealthLens Hub in detail, organised by the tab/module in which it appears.

---

## 1. Overview Tab

The landing screen users see after login. It gives an at-a-glance financial pulse for the day.

- **Portfolio Morning Brief** — AI-generated streaming narrative (powered by Claude) summarising overnight market moves, top movers in the portfolio, and actionable notes for the day.
- **Net Worth KPI tiles** — Total invested, current value, absolute gain/loss, and overall return % displayed as prominent cards.
- **Asset-class breakdown** — Pie / donut split of portfolio by asset class (Indian stocks, US stocks, Mutual Funds, FD, PPF, EPF, Real Estate, Crypto, etc.).
- **Top gainers / losers** — Holdings sorted by absolute and percentage return for quick scanning.
- **Benchmark comparison** — Net worth plotted against Nifty 50 and S&P 500 over the past 24 months.
- **Stale holdings banner** — Amber alert if any manual holdings (FD, PPF, Cash, etc.) haven't been updated past their staleness threshold.

---

## 2. Holdings Tab

The core portfolio management screen.

### 2a. Holding Management
- Add, edit, and delete holdings across **13 asset types**: IN_STOCK, IN_ETF, US_STOCK, US_ETF, MF, FD, PPF, EPF, REAL_ESTATE, CRYPTO, US_BOND, CASH, OTHER.
- Custom asset types — create your own categories beyond the built-in 13.
- Per-holding **document attachments** — upload PDFs, images, or statements (up to 15 MB per file) stored in Supabase Storage with 5-minute signed URL access.
- Assign each holding to a **family member** for multi-member attribution.
- **Liabilities panel** — enter loan balances or other liabilities; the dashboard shows true net worth (assets − liabilities).

### 2b. Live Price Refresh
| Asset Class | Primary Source | Fallback |
|---|---|---|
| Indian Stocks | Twelve Data (.NS / .BO) | Yahoo Finance |
| US Stocks / ETFs | Twelve Data | Yahoo Finance |
| Mutual Fund NAV | AMFI → MFAPI | — |
| USD/INR FX rate | exchangerate-api | Yahoo USDINR=X |

Price refresh also auto-triggers a net-worth snapshot.

### 2c. Return Calculation
Returns cascade through three methods until one succeeds:
1. **XIRR** — Newton-Raphson from the full transaction history (most accurate).
2. **CAGR** — Compounded annual growth using purchase date and quantity.
3. **Simple return** — (current − invested) / invested.

### 2d. Per-Holding AI Analysis
- "✦ Analyse" button on each holding opens an AI panel.
- Claude analyses the holding in the context of the full portfolio and provides a structured view: valuation, risk, recommendation, and fit within the user's overall allocation.

### 2e. Concall Analysis
- "✦ Concall" panel fetches the latest earnings call transcript from a multi-provider chain: **NSE filings → BSE filings → Tickertape → Screener → Motley Fool**.
- AI summarises key management commentary, guidance, risks, and standout quotes.
- Supports 250+ BSE stock codes with dynamic fallback ticker search.

### 2f. Holding-Level Alerts
- Set price-threshold or return-threshold alerts on any holding.
- Bell icon in the desktop row opens an inline `HoldingAlertPanel`.
- Evaluated daily by the `/api/cron/alert-check` job; email digest sent via Resend.

### 2g. Stale Holdings Nudge
Detects manual holdings that haven't been updated past per-type thresholds:

| Type | Threshold |
|---|---|
| FD, PPF, EPF | 90 days |
| Real Estate | 180 days |
| Cash | 14 days |
| Insurance | 365 days |
| Other | 60 days |

An amber in-app banner appears with one-click filter to view only stale rows. A weekly email digest lists all stale holdings sorted most-stale first.

---

## 3. Members Tab

- **Add / manage family members** — each member has a name and optional avatar.
- **Member-filtered views** — all tabs (Holdings, Tax, Goals) can be scoped to one member.
- **AI Family Allocation Narrative** — streaming Claude summary of how assets are distributed across family members, with diversification commentary.
- **Allocation chart** — visual split of portfolio value per member.

---

## 4. Import Hub

Unified import interface supporting multiple data sources.

| Source | Format | Notes |
|---|---|---|
| CAS PDF (NSDL/CDSL) | PDF | PAN-based password, multi-holder mapping |
| SIP Bulk Import | Manual entry | Fetches historical NAVs month-by-month from MFAPI |
| SnapTrade | OAuth brokerage link | Robinhood, Schwab, and others |
| Plaid | OAuth bank link | US bank transaction import |
| Zerodha Kite | API / CSV | Direct broker import |
| Breeze Connect (ICICI) | API | Direct broker import |
| Setu Account Aggregator | AA consent flow | RBI-compliant Indian account data |
| ImportHub | CSV / Excel / PDF | 14+ Indian and US bank statement parsers |
| Gmail CAS Auto-import | Gmail OAuth | Scans inbox for CAS emails every 6 hours |

---

## 5. Budget Tracker (Budget Tab)

Comprehensive expense tracking with bank-statement import and AI insights.

- **14+ bank parsers** — supports CSV, Excel, and PDF statements from HDFC, ICICI, SBI, Axis, Kotak, Zerodha, and major US banks.
- **Plaid sync** — real-time US bank transaction pull (sandbox / development / production).
- **Auto-categorisation** — transactions are bucketed into categories (Food, Transport, EMI, etc.) automatically.
- **Manual categorisation** — edit, split, or recategorise any transaction.
- **Server-side search + deduplication** — prevents double-importing the same statement.
- **AI Spend Insights** — after each import, Claude generates a streaming spend narrative: top categories, anomalies, and a Spending→Investment Nudge suggesting what portion of discretionary spend could be redirected to savings.
- **Editable CAGR** — set a personalised expected return rate used in nudge calculations.

---

## 6. Tax Tab

Full Indian capital-gains tax analytics.

- **LTCG / STCG calculator** — FIFO lot matching across all holdings.
- **Financial year selector** — view tax liability for any past or current year.
- **Grandfathering** — January 2018 fair-value grandfathering for equity LTCG.
- **Tax-loss harvesting hints** — identifies holdings where realising a loss now would offset gains.
- **LTCG exemption headroom** — shows how much of the ₹1 lakh LTCG exemption remains.
- **AI Tax Strategy (streaming)** — Claude generates a 3-step personalised action plan covering LTCG exemption usage, harvest candidates, FD renewal timing, and regime-switch analysis.

---

## 7. Goals & Planning Tab

Goal-based financial planning with AI gap analysis.

- **Create goals** — set a target amount, target date, and link to a specific member.
- **Progress tracking** — current portfolio value vs. goal target shown as a progress bar with projected shortfall/surplus.
- **AI Goal Gap Analysis** — Claude explains what rate of return or SIP amount is needed to close any gap.
- **Scenario modelling** — Goal Plan Modal lets users model different contribution amounts and expected returns.
- **Amortisation calculator** — compute EMI, total interest, and amortisation schedule for loans or FDs.
- **FD Scan Sheet** — lists all FDs with maturity dates, expected interest, and days-to-maturity.
- **FD maturity alerts** — email reminders 7, 30, and 60 days before FD maturity.

---

## 8. Watchlist Tab

- Add any stock, ETF, or MF to a personal watchlist independent of holdings.
- **Live price enrichment** — prices refreshed from the same sources as holdings.
- **Target price notes** — annotate each watchlist item with a buy-target or thesis note.
- CRUD operations backed by the `watchlist` Supabase table.

---

## 9. AI Advisor Tab

A full conversational AI interface with deep portfolio awareness.

- **Agentic tool-use loop** — Claude can call portfolio tools (fetch holdings, run tax calc, look up a price) mid-conversation and return grounded answers.
- **Streaming responses** — token-by-token output for a real-time feel.
- **Conversation persistence** — chat history stored per session; users can resume prior conversations.
- **Dynamic suggested questions** — context-aware question chips change based on the current portfolio state.
- **Full portfolio context** — all holdings, transactions, member allocations, and recent market data are available to the AI on every turn.

---

## 10. Strategy Tab

- **Investment strategy builder** — Claude helps craft a personalised investment policy statement (IPS) based on member goals, risk tolerance, and current allocation.
- Outputs a structured strategy document the user can save and revisit.

---

## 11. Calendar Tab

- **Monthly financial calendar** — events plotted on a calendar (FD maturities, SIP dates, dividend expected dates, alert trigger dates).
- **Month Briefing (streaming)** — at the start of each month, Claude generates a narrative covering upcoming events, what to act on, and which holdings to review.

---

## 12. Net Worth Snapshots

- Automated 24-month rolling history of total net worth.
- Snapshots auto-triggered on every price refresh.
- Charted against Nifty 50 and S&P 500 benchmarks for relative performance view.

---

## 13. Dividends & Cash Events

- Track dividends received per holding.
- Distinct event types: **Dividend**, **Bonus Shares**, **Rights Issue**, **Other Cash Event**.
- **SWP (Systematic Withdrawal Plan)** tracked separately from SELL transactions so withdrawals don't distort return calculations.

---

## 14. Insurance Tracker

- Track **term life** and **health insurance** policies alongside investment assets.
- Fields: insurer, policy number, sum assured, annual premium, renewal date.
- Renewal reminders integrated with the alert/email system.

---

## 15. Portfolio Sharing & Collaboration

- Invite any email address as a **viewer** or **editor** on your portfolio.
- Viewers see the full dashboard in read-only mode via a shared link.
- Editors can add/edit holdings.
- Permissions managed per-user via `portfolio_shares` table.
- Sharing can be revoked at any time.

---

## 16. Export

| Format | Endpoint | Contents |
|---|---|---|
| Excel (XLSX) | `GET /api/export/xlsx` | 4 sheets: Holdings, Transactions, FDs, Summary |
| PDF Report | `GET /api/export/report` | Print-optimised HTML → browser PDF |

---

## 17. Alert System

- **Holding price alerts** — trigger when a holding crosses a set price.
- **Holding return alerts** — trigger when a holding's return crosses a set % threshold.
- **FD maturity alerts** — 7 / 30 / 60-day advance reminders.
- **Stale holdings nudge** — weekly digest for un-updated manual holdings.
- All alert emails sent via **Resend** with configurable sender domain.

---

## 18. Progressive Web App (PWA)

- Full PWA with service worker and install prompt.
- Works offline for cached portfolio data.
- Add-to-home-screen support on iOS and Android.
- Mobile UX audited: correct font sizes, touch targets, bottom navigation, and modal behaviour on small screens.

---

## 19. Audit Log

- Every data-changing operation (add holding, edit transaction, import, delete) is recorded in an audit log.
- `AuditLogPanel` in the UI lets admins review recent activity with timestamp, action type, and affected record.

---

## 20. Authentication & Security

- **Google OAuth** and **GitHub OAuth** via Supabase Auth.
- **Email / password** login with email verification.
- All `/api/*` routes protected by JWT Bearer token.
- Sensitive fields (PAN, Plaid tokens, budget data) encrypted with **AES-256-GCM** using `BUDGET_ENCRYPT_KEY`.
- Rate limiting on all API routes via `express-rate-limit`.
- Security headers via `helmet`.
