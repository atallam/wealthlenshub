# WealthLens Hub — Product Backlog

> Last reviewed: August 2026  
> P0 security items audited — all confirmed resolved, removed from backlog.  
> Items 1 (Mobile PWA) and 5 (MF Overlap) shipped August 2026 and moved to Completed.
> Value Masker (P1 Item 1) shipped August 2026 and moved to Completed; remaining P1 items renumbered.  
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

### 5. Unified In-App Notification Centre
All alerts go to email only. An in-app notification bell with unread count and a slide-in drawer would surface FD maturities, price alerts, and stale nudges without requiring the user to check email.  
**Scope:** `notifications` table; bell icon in the header; mark-as-read; clear-all.

### 6. Dark Mode
The app uses CSS variables (`--bg`, `--text`, etc.) but only defines a light palette. Adding dark mode requires:
- A second set of CSS variable values under `@media (prefers-color-scheme: dark)` and a `[data-theme="dark"]` attribute
- A theme toggle button in Settings
- Testing across all tabs for hardcoded colour values that need to move to variables

### 7. Audit Log Filtering & Export
The AuditLogPanel shows recent events but has no filter controls. Add:
- Filters by date range, action type (create / update / delete / import), and member
- Export to CSV button for compliance or personal records

### 8. SnapTrade Auto-Sync (Background Frequency Control)
SnapTrade sync is currently manual (user triggers it). Add an optional scheduled background sync (every 24 hours) so US brokerage holdings stay current without manual intervention.

### 9. Watchlist Price Alerts
The Watchlist tab shows live prices but has no alert capability. Extend the existing holding-alert system to watchlist items so users get notified (email/in-app) when a target price is hit.

### 10. SIP / SWP Return Attribution
XIRR captures the aggregate effect of SIPs but there is no breakdown showing which installments contributed most. A contribution-weighted return view would help users evaluate SIP timing decisions.

### 11. Goal Progress Milestone Notifications
When a goal crosses 25%, 50%, 75%, or 100%, send a celebratory email or in-app notification. Low effort, high motivation value.

### 12. Insurance Premium Renewal Reminders
Insurance renewal dates are tracked but no cron job fires reminder emails. Add a job similar to `fd-alerts` that sends reminders 30 and 7 days before an insurance policy renewal date.

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
