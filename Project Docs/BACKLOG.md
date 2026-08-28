# WealthLens Hub — Product Backlog

> Last reviewed: August 2026  
> P0 security items audited — all confirmed resolved, removed from backlog.  
> Items 1 (Mobile PWA) and 5 (MF Overlap) shipped August 2026 and moved to Completed.
> Value Masker (P1 Item 1) shipped August 2026 and moved to Completed; remaining P1 items renumbered.  
> P2 items 5, 6, 7, 11, 12 shipped August 2026 and moved to Completed; remaining P2 items renumbered.  
> All items in the Completed section are live in the codebase.  
> August 2026: Items 1, 3, 6, 7 moved to Won't Do / Deprioritized; remaining items renumbered.
> August 2026: SnapTrade Auto-Sync (P2 Item 3) also moved to Won't Do — SnapTrade is already a live connection.
> August 2026: Embedded Financial News Feed (P3 Item 9) shipped and moved to Completed; Item 10 renumbered to 9.
> August 2026: Financial News Feed upgraded — Indian market RSS sources (ET Markets, Livemint), macro RSS sources (SEBI, ET Economy), and per-stock filter UI added.

---

## 🟠 P1 — High Value / Near-term

### 1. Recurring Transaction Templates (SIP Automation)
Users manually log every monthly SIP transaction. A recurring-transaction template would:
- Let users define a template (fund, amount, day-of-month)
- Auto-create a pending transaction entry on schedule with a one-click confirm step
- Distinct from Budget2Tab's recurring *detection* — this creates portfolio transactions

### 2. Family Consolidated Tax Report (Excel)
Export a per-member and consolidated LTCG/STCG summary as a multi-sheet Excel workbook formatted for CA filing — including grandfathering calculations and a summary row matching ITR Schedule 112A format.

---

## 🟡 P2 — Medium Priority

*No active P2 items.*

---

## 🔵 P3 — Nice-to-Have / Research

### 4. NPS (National Pension System) Support
Add NPS as a 14th asset type with Tier-I / Tier-II distinction, contribution tracking, government co-contribution modelling, and 60/40 corpus tax split projection.

### 5. SGBs (Sovereign Gold Bonds) Tracking
SGBs have fixed tenors, semi-annual interest payouts, and premature redemption windows. A dedicated SGB tracker with maturity countdown and interest calendar would surface these clearly.

### 6. EPF / PPF Auto-Import via Setu
Explore whether the Setu AA or UMANG integration can auto-pull EPF balance and passbook, removing the need for manual EPF/PPF updates.

### 7. Alternative Investment Tracking (AIF / PMS)
High-net-worth users may hold AIF or PMS products. Model these as a new asset type with quarterly NAV updates and benchmark comparison.

### 8. Broker-Native Ledger Reconciliation
Compare transactions recorded in WealthLens Hub against broker contract note PDFs to surface discrepancies — missing trades, price differences, or quantity mismatches.

### 9. Collaborative Budget (Shared Budget View)
Extend portfolio sharing to the Budget tab so couples or families can view, categorise, and annotate joint expenses together.

---

## 🚫 Won't Do / Deprioritized

These items have been reviewed and deprioritized — either low ROI relative to effort, superseded by other capabilities, or out of current product scope.

### Multi-Currency Portfolio View Toggle *(was P1 Item 1)*
All values are normalised to INR at rest. Users with significant US holdings want to flip the entire dashboard to USD without touching stored data.  
**Reason deprioritized:** The live USD/INR FX rate is already displayed alongside INR values on KPI tiles. Full currency toggle adds significant display complexity across all components for limited incremental value given the India-first user base.

### Plaid Transaction Categorisation Improvement *(was P1 Item 3)*
Auto-categorisation currently relies on keyword rules. An LLM-assisted pass using the transaction description + merchant name would significantly reduce manual recategorisation.  
**Reason deprioritized:** Plaid is US-only and used by a small subset of users. LLM categorisation latency on import would degrade UX. The existing keyword rules cover 80%+ of common merchants adequately.

### Watchlist Price Alerts *(was P2 Item 6)*
The Watchlist tab shows live prices but has no alert capability. Extend the existing holding-alert system to watchlist items so users get notified (email/in-app) when a target price is hit.  
**Reason deprioritized:** The Watchlist feature itself has low engagement relative to the holdings-level alert system already in place. Adding alerts to watchlist items duplicates effort without clear portfolio action tied to the trigger.

### SnapTrade Auto-Sync *(was P2 Item 3)*
SnapTrade sync is currently manual (user triggers it). Add an optional scheduled background sync (every 24 hours) so US brokerage holdings stay current without manual intervention.  
**Reason deprioritized:** SnapTrade is a live connection — `GET /snaptrade/holdings/:accountId` fetches real-time positions directly from the broker on every call. A background cron sync would replicate what the user already gets on demand with no real benefit, and adds unnecessary cron complexity.

### SIP / SWP Return Attribution *(was P2 Item 7)*
XIRR captures the aggregate effect of SIPs but there is no breakdown showing which installments contributed most. A contribution-weighted return view would help users evaluate SIP timing decisions.  
**Reason deprioritized:** XIRR already provides the correct time-weighted return for SIPs. Per-installment attribution is analytically complex, hard to explain to non-finance users, and risks confusion more than insight.

---

## ✅ Completed (Reference)

> These are shipped and live — do not re-add to the active backlog.


### Embedded Financial News Feed (Enhanced)
Shipped August 2026 (was P3 Item 9). Enhanced August 2026 with Indian market RSS sources, additional macro feeds, and per-stock filtering.
- **Backend** — `routes/news.js`; `GET /api/news?tickers=...`; Yahoo Finance news for up to 12 portfolio tickers; RSS feeds added: ET Markets + Livemint (Indian market), RBI + SEBI + ET Economy (macro); regex RSS 2.0 parser; 15-min in-process cache per source; deduplicates, sorts newest-first, returns up to 60 articles; `rssSources` list in response distinguishes portfolio tickers from feed sources
- **Frontend** — `src/features/news/NewsTab.jsx`; two-row filter UI — Row 1 Market category (All / Indian / US / Macro); Row 2 per-stock chips (All Stocks + one chip per portfolio ticker with articles, colour-coded by market); clicking a ticker filters to that stock only; active filter summary bar with Clear; ticker tag on each card is clickable; `rssSources` set suppresses ticker tags on RSS articles
- **Wiring** — `server.js` mounts `/api/news`; `App.jsx` adds News tab (Newspaper icon) to nav

### Unified In-App Notification Centre
Shipped August 2026 (was P2 Item 5).
- **DB migration** — `migrations/0025_notifications.sql`; `notifications` table with `user_id`, `kind`, `title`, `body`, `url`, `read`, `created_at`; RLS enabled
- **Backend** — `routes/notifications.js`; GET `/api/notifications`, POST `/:id/read`, POST `/read-all`, DELETE `/clear`; `insertNotification()` helper exported for cron use
- **Frontend** — `src/components/notifications/NotificationCentre.jsx`; bell icon in desktop header with unread badge; slide-in drawer with mark-read-on-click, Mark-all-read, Clear-read buttons; polls every 60s
- **Cron integration** — `fd-alerts`, `alert-check`, `insurance-reminders`, `goal-milestones` all call `insertNotification()` after sending email

### Dark Mode
Shipped August 2026 (was P2 Item 6).
- **CSS variables** — `src/styles.css`; dark palette under `@media (prefers-color-scheme: dark)` + `[data-theme="dark"]`; explicit light override under `[data-theme="light"]`; uses deep sage dark tones matching the app's editorial design
- **Theme toggle** — Appearance section added in Settings panel; Moon/Sun icon button; theme persisted to `localStorage` under key `wl-theme`; applied via `document.documentElement.dataset.theme`

### Audit Log Date Range Filter & CSV Export
Shipped August 2026 (was P2 Item 7).
- **Date inputs** — `from`/`to` date pickers in `AuditLogPanel.jsx`; wired to existing backend `from`/`to` query params in `routes/audit.js`
- **CSV export** — "Export CSV" button fetches all filtered logs (limit 9999) and triggers browser download via `Blob` + `URL.createObjectURL`; filename includes ISO date

### Goal Progress Milestone Notifications
Shipped August 2026 (was P2 Item 11).
- **Cron endpoint** — `POST /api/cron/goal-milestones` in `routes/cron.js`; scans all portfolios with goals; computes portfolio total value vs `targetAmount`; detects 25/50/75/100% milestone crossings; persists `notified_milestone` back into JSONB so each milestone fires only once
- **Delivery** — Resend email with per-goal milestone cards; web push via `sendPushToUser()`; `insertNotification()` for in-app centre

### Insurance Premium Renewal Reminders
Shipped August 2026 (was P2 Item 12).
- **Cron endpoint** — `POST /api/cron/insurance-reminders` in `routes/cron.js`; queries all INSURANCE holdings with `premium` + `start_date`; computes next premium due date by advancing `start_date` by `premium_frequency` (ANNUAL/HALF_YEARLY/QUARTERLY/MONTHLY) until future
- **Windows** — 7-day and 30-day reminders; skips already-matured policies; Resend email with premium details; `insertNotification()` for in-app centre

### Mobile PWA Enhancements
Shipped August 2026 (was P1 Item 1).
- **Web Push notifications** — `routes/push.js` (VAPID), `src/hooks/usePushNotifications.js`, `public/sw.js` push handler; toggle in Settings; wired into cron alert digest via `sendPushToUser()`
- **Swipe gestures** — `src/components/shared/SwipeableRow.jsx` integrated into HoldingsTab mobile cards
- **Offline write queue** — `src/lib/offlineQueue.js` (IndexedDB); Background Sync in `sw.js`; offline-aware transaction POST in `usePortfolio.js`
- **DB migration** — `migrations/0024_push_subscriptions.sql`; VAPID env vars in `.env.example`

### Value Masker (Privacy Toggle)
Shipped August 2026 (was P1 Item 1).
- **MaskContext** — `src/contexts/MaskContext.jsx`; React context providing `{ masked, toggleMask }`; syncs a module-level `_masked` flag in `utils.js` via `setMasked()` so all format functions respond instantly on re-render
- **utils.js** — Added `MASK = '••••'`, `_masked`, `setMasked()`, `getMasked()`; updated `fmtINR`, `fmtUSD`, `fmtCrINR`, `fmtCrUSD`, `fmtNative`, `fmtCrNative`, `fmtSec`, `fmtCrSec` to return `MASK` when masked; `fmt`/`fmtCr` covered transitively
- **Header toggle** — Eye / EyeOff icon button in desktop header (before Settings); highlights purple (`--accent-2`) when active
- **Mobile more sheet** — Privacy / Show toggle item added before Settings in the `···` more sheet
- **MaskProvider** — wraps `<App />` in `main.jsx`; state is session-only (no persistence — resets on reload)

### Mutual Fund Overlap Analysis
Shipped August 2026 (was P1 Item 5).
- Backend `POST /api/mf/overlap` in `routes/mf.js` — AMFI monthly portfolio disclosures, 7-day cache, pairwise Jaccard + weighted overlap computation
- Frontend `src/features/holdings/MFOverlapPanel.jsx` — auto-appears in HoldingsTab when ≥ 2 MF holdings with scheme codes; expandable pair cards with shared-stock breakdown and "most duplicated stocks" summary

### P0 Security Fixes (audited August 2026 — all pre-existing)
- PAN masking in `casCredentials` — `services/profile.service.js`
- SnapTrade disconnect scoped to removed broker only — `routes/snaptrade.js`
- Per-user AI rate limiting (20 req/min) — `routes/ai.js`
- Transactions `ON DELETE CASCADE` FK — `migrations/transactions_migration.sql`
- `BUDGET_ENCRYPT_KEY` production fail-fast guard — `lib/crypto.js`

### Portfolio Rebalancing Advisor
StrategyTab — target allocation sliders, buy/sell amounts, AI rebalancing explanation.

### Core Platform (shipped at launch)
- Multi-member family portfolio with per-member filtered views
- Live price refresh — Indian stocks, US stocks, MF NAV, FX rates
- XIRR → CAGR → Simple return cascade
- CAS PDF import (NSDL/CDSL), SIP bulk import with historical NAVs
- SnapTrade US brokerage linking; Plaid US bank transaction import
- Zerodha Kite, Breeze Connect, Setu AA integrations
- 14+ bank CSV/Excel/PDF parsers (ImportHub); Gmail CAS auto-import (6-hourly)
- AI Advisor — agentic tool use, streaming SSE, conversation persistence
- Portfolio Morning Brief (streaming); Per-holding AI Analysis; Concall Analysis
- LTCG/STCG calculator — FIFO lot matching, grandfathering; AI Tax Strategy
- Budget Tracker — AI Spend Insights, Investment Nudge
- Goals Tab — scenario modelling, AI gap analysis
- Watchlist Tab with live price enrichment
- Net worth snapshots — 24-month history, Nifty/S&P benchmark
- Dividends, Bonus Shares, Rights Issues, SWP tracking
- Insurance policy tracking; Liabilities panel (true net worth)
- Portfolio sharing (viewer/editor roles); Excel and PDF export
- Holding-level price and return alerts with email digest
- FD maturity alerts (7/30/60 days); Stale holdings nudge
- Calendar Tab with Month Briefing; Members Tab with AI Family Allocation Narrative
- Strategy Tab; Audit Log with AuditLogPanel
- PWA — service worker, install prompt, mobile UX
- AES-256-GCM encryption (PAN, Plaid tokens, budget data)
- Rate limiting + security headers (express-rate-limit, helmet)
- `.env.example` with all env vars documented
