# WealthLens Hub — Feature Reference

> Version 2.1.0 · Last updated November 2026

This document describes what the app does today, organised by the tab or module where each feature appears. For setup see the [README](../README.md); for what is planned see [BACKLOG.md](BACKLOG.md).

The app has nine tabs: **Overview, Holdings, Goals, Strategy, Family, Family Budget, Calendar, Advisor, News**. On mobile the bottom bar shows Overview, Holdings, Family Budget and Advisor; the rest sit in a "more" sheet.

Features that were removed and are *not* in the app any more: the Tax tab (tax maths now backs the Advisor's tax tool), the Watchlist tab, portfolio sharing, Zerodha Kite / Breeze Connect imports, Gmail CAS auto-import, and the scheduled cron jobs.

---

## 1. Overview Tab

- **Net worth tiles** — invested, current value, gain/loss and return %, with INR and USD handled per holding
- **AI morning brief** — a short streaming portfolio summary from Claude
- **Asset allocation** — donut split by asset class
- **Member breakdown** — value and share per family member
- **Wealth progression** — net worth over time against Nifty 50 and S&P 500
- **Health score** — a summary score of diversification and portfolio hygiene
- **SIP analytics** — what you invest monthly and how it has performed
- **Liabilities panel** — loans with amortisation, so net worth is assets minus liabilities
- **Protection coverage** — insurance cover held against what you have entered
- **NRI summary** — appears when the portfolio has NRI-relevant holdings
- **Data freshness** — which member / depository statement each imported holding came from and how old it is

---

## 2. Holdings Tab

### 2a. Holding management
- Add, edit and delete holdings across stocks, ETFs, mutual funds, FD, PPF, EPF, bonds, crypto, cash, real estate, insurance and other; add custom asset types in Settings
- Assign each holding to a family member
- Holdings are grouped into **US**, **Indian** and **Other** assets with a total, invested amount and gain per group; US assets stay in USD with an INR equivalent
- Filter by asset type; sort by any column; switch to a stale-only view
- Mobile shows swipeable cards instead of the table
- **Demo mode** loads sample data for exploring

### 2b. Live prices
| Asset | Source |
|---|---|
| Indian and US stocks / ETFs | Twelve Data, falling back to Yahoo Finance |
| Mutual fund NAV | AMFI, falling back to MFAPI |
| USD/INR | exchangerate-api, falling back to Yahoo |

A badge shows when prices last refreshed and lists holdings that did not update with the latest run. Refreshing also saves a net-worth snapshot.

### 2c. Returns
XIRR from the transaction ledger where possible, then CAGR, then simple return. Cost basis is lot-based (FIFO) and viewable per holding.

### 2d. Transactions
- Per-holding transaction list: buys, sells, SIP instalments, dividends, bonus shares, rights issues and **SWP** (tracked separately from sells so withdrawals do not distort returns)
- Mutual fund transaction form with historical NAV lookup
- Broker **tradebook import** for transaction history
- Ledger inference can build BUY/SELL history from successive monthly statements

### 2e. Fixed deposits
- FD scan: upload a certificate and AI fills in the details
- FD ladder planner
- **Matured FD banner** at the top of the tab with Renew (next term), Convert to cash and Mark closed

### 2f. Holding-level tools
- **Alerts** — set a price or return threshold from the bell icon on any row
- **Documents** — attach PDFs and images to a holding
- **AI analysis** — valuation, risk and portfolio fit for one holding
- **Concall analysis** — fetch the latest earnings-call transcript (NSE, BSE, Screener, Tickertape, then Motley Fool; US stocks try API Ninjas and EarningsCalls.dev first when keys are set) and get an AI summary with a signal and score, plus a quarter-on-quarter trend
- **Mutual fund overlap** — appears with two or more funds and shows shared stocks pairwise

### 2g. Stale-data nudges
Manual holdings are flagged when they pass a per-type threshold (FD / PPF / EPF 90 days, real estate 180, cash 14, insurance 365, other 60 — configurable in Settings). An amber banner offers a one-click filter. Scheduled email nudges were removed with the cron jobs.

### 2h. Export
An Export menu downloads an Excel workbook or opens a print-ready PDF report, either for the rows currently on screen or for everything.

---

## 3. Goals Tab

- Create goals with a target amount, date and member
- Status against target using portfolio value and expected returns
- **Goal planner** — models the gap and what would close it, with AI commentary
- Goal-behind-schedule and goal-conflict warnings also surface in Strategy

---

## 4. Strategy Tab

- **Alerts** — price and return thresholds, FD maturity and other rules, shown with a human-readable description; deleting an alert offers undo; an **email digest** button sends the currently triggered alerts
- **Triggered alerts** panel for anything firing right now
- **Rebalancing** — choose a member, set a target allocation (with presets) and a cash amount, and get a buy/sell trade list; **AI explanation** of the plan; copy the plan to the clipboard; hints for redirecting SIPs
- **Long-term-gain drill-down** — see which holdings a trim would come from and their holding periods
- **Warnings** — goal conflicts, goals behind schedule, FD maturity

---

## 5. Family Tab

- Add and edit family members; filter every tab by member
- Member summary with allocation and totals
- AI narrative on how assets are spread across the family

---

## 6. Family Budget Tab

Sub-views: **Overview, Transactions, Categories, Goals, Import**.

- **Import** — CSV, Excel and PDF statements from 14+ Indian and US banks (HDFC, ICICI, SBI, Axis, Kotak, PNB, Bank of Baroda, Canara, Union Bank, IDFC First, IndusInd, Yes Bank, RBL, Standard Chartered, HSBC, IDBI, Federal Bank and US banks); duplicate statements are detected; the account holder is matched to a family member, and card / account last-4 aliases are remembered so repeat imports assign themselves
- **Plaid** — optional US bank transaction sync
- **Categories** — auto-categorisation from editable keywords, manual recategorise, rename (existing transactions follow), essential vs. discretionary flag, icon and colour
- **Split transactions** — divide one transaction across family members
- **Limits** — a monthly limit per category, with optional per-member overrides
- **Insights** — essential / goals / discretionary view, merchant rollup, recurring-spend detection, cash-flow and trend charts, period selector (month, quarter, year, all time) and member filter
- **Budget goals** — savings targets tracked inside the budget
- Transaction descriptions and balances are encrypted at rest

---

## 7. Calendar Tab

- Month view of FD and policy maturities, insurance premiums, SIP dates and your alerts
- Standing India tax and savings dates: advance-tax instalments, ITR deadlines, PPF contribution dates, 80C / ELSS last date
- **Concall outlook** — expected next earnings-call windows for holdings, upgraded to confirmed dates when a board-meeting notice is found
- Filter by event type

---

## 8. Advisor Tab

- Streaming chat with **tool use**: Claude calls tools to fetch holdings, portfolio summary, transactions, goal progress, tax summary (current Indian LTCG/STCG rules), budget summary, net-worth history, FD maturities, and concall analysis or transcripts
- Tool calls are shown as chips so you can see where an answer came from
- Dynamic suggested questions based on the current portfolio

---

## 9. News Tab

- Headlines tied to your holdings (Yahoo Finance), plus Indian market and macro RSS feeds including ET Markets, Livemint, RBI and SEBI
- Category filter (All / Indian / US / Macro) and per-stock chips

---

## 10. Import Hub

Opened from the header and the Holdings tab. Sources:

| Group | Source | Notes |
|---|---|---|
| India | **NSDL / CDSL CAS** | PAN-protected PDF read with `casparser`. Imports are keyed and atomic, support multi-statement files and let you keep only the newest of a fund held at two depositories. Demat ETFs are classified as ETFs, and fund names and NAVs come from AMFI |
| India | **Broker tradebook** | Transaction history |
| India | **Fixed deposit** | Manual or AI scan |
| India | **Account Aggregator (Setu)** | RBI consent flow for bank and investment data |
| US / Global | **SnapTrade** | Read-only brokerage sync including 401(k); each sync replaces that account's positions atomically |
| Manual | **CSV / Excel** | 20+ broker formats auto-detected (Zerodha, Groww, ICICI Direct, HDFC Securities, Upstox, Angel One, Schwab, Fidelity, Robinhood, Vanguard, IBKR, E*TRADE, Coinbase, Merrill, JPMorgan, Webull, SoFi, Wealthfront, Betterment, Firstrade, Ally, Public, Tastytrade) plus a generic fallback |
| Manual | **Add manually** | Any holding by hand |

Connected sources show a status banner (connected, needs re-auth, last synced). Rows are validated on import and problems are flagged without blocking the rest.

---

## 11. Net Worth Snapshots

Saved on every price refresh with a rolling history, charted against Nifty 50 and S&P 500.

---

## 12. Notifications & PWA

- **In-app notification centre** from the header bell, with unread badge and mark-read / clear
- **Web Push** (VAPID) notifications, toggled in Settings
- Installable PWA with a service worker, offline cache and an offline queue for transactions entered without a connection
- Mobile navigation, swipe gestures and touch-sized controls

---

## 13. Settings & Privacy

- **Appearance** — light and dark theme
- **Value masker** — an eye toggle in the header hides amounts on screen (session only)
- **Balance refresh reminders** — staleness thresholds per asset type
- **Government scheme rates** — PPF / EPF rates used for projections
- **Push notifications** toggle
- **Delete your account and all data** — typed-email confirmation; removes Plaid / SnapTrade links, stored files and every per-user table

---

## 14. Audit Log

Every data-changing action is recorded with timestamp, action and affected record; secrets are redacted by key pattern. The Audit Log panel supports date-range filtering and CSV export.

---

## 15. Security

- Supabase Auth with Google, GitHub and email / password; a JWT is required on every `/api` route (the Setu webhook uses its own shared secret)
- Ownership checks on every write; tests fail when a write is not scoped to its owner
- AES-256-GCM encryption for PAN, tokens and budget data
- Zod request-body validation (`BODY_SCHEMA_MODE`), Content-Security-Policy (`CSP_MODE`), `helmet`, global and per-user upload / analysis rate limits
- Uploads are filtered by extension and size; errors are masked in production

See [ROLLOUT_ENFORCEMENT.md](ROLLOUT_ENFORCEMENT.md) for moving validation and CSP from log-only to enforce.
