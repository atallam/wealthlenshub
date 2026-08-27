# WealthLens Hub — Product Backlog

> Last reviewed: August 2026  
> P0 security items audited — all confirmed resolved, removed from backlog.  
> Items 1 (Mobile PWA) and 5 (MF Overlap) shipped August 2026 and moved to Completed.
> Value Masker (P1 Item 1) shipped August 2026 and moved to Completed; remaining P1 items renumbered.  
> P2 items 5, 6, 7, 11, 12 shipped August 2026 and moved to Completed; remaining P2 items renumbered.  
> All items in the Completed section are live in the codebase.

---

## 🟠 P1 — High Value / Near-term

### 1. Multi-Currency Portfolio View Toggle
All values are normalised to INR at rest. Users with significant US holdings want to flip the entire dashboard to USD without touching stored data.  
**Scope:** Global INR / USD toggle in the header; KPI tiles and charts re-computed using the live FX rate already fetched by the backend. Settings already expose a base currency field — wire it up to all display components.

### 2. Recurring Transaction Templates (SIP Automation)
Users manually log every monthly SIP transaction. A recurring-transaction template would:
- Let users define a template (fund, amount, day-of-month)
- Auto-create a pending transaction entry on schedule with a one-click confirm step
- Distinct from Budget2Tab's recurring *detection* — this creates portfolio transactions

### 3. Plaid Transaction Categorisation Improvement
Auto-categorisation currently relies on keyword rules. An LLM-assisted pass using the transaction description + merchant name would significantly reduce manual recategorisation.  
**Scope:** POST categorisation requests to `/api/ai/chat` after import; cache results by description hash to avoid re-calling for known merchants.

### 4. Family Consolidated Tax Report (Excel)
Export a per-member and consolidated LTCG/STCG summary as a multi-sheet Excel workbook formatted for CA filing — including grandfathering calculations and a summary row matching ITR Schedule 112A format.

---

## 🟡 P2 — Medium Priority

### 5. SnapTrade Auto-Sync (Background Frequency Control)
SnapTrade sync is currently manual (user triggers it). Add an optional scheduled background sync (every 24 hours) so US brokerage holdings stay current without manual intervention.

### 6. Watchlist Price Alerts
The Watchlist tab shows live prices but has no alert capability. Extend the existing holding-alert system to watchlist items so users get notified (email/in-app) when a target price is hit.

### 7. SIP / SWP Return Attribution
XIRR captures the aggregate effect of SIPs but there is no breakdown showing which installments contributed most. A contribution-weighted return view would help users evaluate SIP timing decisions.

---

## 🔵 P3 — Nice-to-Have / Research

### 13. NPS (National Pension System) Support
Add NPS as a 14th asset type with Tier-I / Tier-II distinction, contribution tracking, government co-contribution modelling, and 60/40 corpus tax split projection.

### 14. SGBs (Sovereign Gold Bonds) Tracking
SGBs have fixed tenors, semi-annual interest payouts, and premature redemption windows. A dedicated SGB tracker with maturity countdown and interest calendar would surface these clearly.

### 15. EPF / PPF Auto-Import via Setu
Explore whether the Setu AA or UMANG integration can auto-pull EPF balance and passbook, removing the need for manual EPF/PPF updates.

### 16. Alternative Investment Tracking (AIF / PMS)
High-net-worth users may hold AIF or PMS products. Model these as a new asset type with quarterly NAV updates and benchmark comparison.

### 17. Broker-Native Ledger Reconciliation
Compare transactions recorded in WealthLens Hub against broker contract note PDFs to surface discrepancies — missing trades, price differences, or quantity mismatches.

### 18. Embedded Financial News Feed
Pull a curated, portfolio-filtered news feed (NSE announcements, corporate actions, RBI circulars) and surface it in the Overview tab or a dedicated News tab.

### 19. Collaborative Budget (Shared Budget View)
Extend portfolio sharing to the Budget tab so couples or families can view, categorise, and annotate joint expenses together.

---

## ✅ Completed (Reference)

> These are shipped and live — do not re-add to the active backlog.


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
