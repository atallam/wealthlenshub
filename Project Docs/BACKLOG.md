# WealthLens Hub — Product Backlog

> Last reviewed: August 2026  
> P0 security items were audited and all confirmed resolved — removed from backlog.  
> All items in the "Completed" section are shipped and live in the codebase.

---

## 🟠 P1 — High Value / Near-term

### 2. Multi-Currency Portfolio View Toggle
All values are normalised to INR at rest. Users with significant US holdings want to flip the entire dashboard to USD without touching stored data.  
**Scope:** Global INR / USD toggle in the header; KPI tiles and charts re-computed using the live FX rate already fetched by the backend. Settings already expose a base currency field — wire it up to all display components.

### 3. Recurring Transaction Templates (SIP Automation)
Users manually log every monthly SIP transaction. A recurring-transaction template would:
- Let users define a template (fund, amount, day-of-month)
- Auto-create a pending transaction entry on schedule with a one-click confirm step
- Distinct from Budget2Tab's recurring *detection* — this creates portfolio transactions

### 4. Plaid Transaction Categorisation Improvement
Auto-categorisation currently relies on keyword rules. An LLM-assisted pass using the transaction description + merchant name would significantly reduce manual recategorisation.  
**Scope:** POST categorisation requests to `/api/ai/chat` after import; cache results by description hash to avoid re-calling for known merchants.

### 6. Family Consolidated Tax Report (Excel)
Export a per-member and consolidated LTCG/STCG summary as a multi-sheet Excel workbook formatted for CA filing — including grandfathering calculations and a summary row matching ITR Schedule 112A format.

---

## 🟡 P2 — Medium Priority

### 7. Unified In-App Notification Centre
All alerts go to email only. An in-app notification bell with unread count and a slide-in drawer would surface FD maturities, price alerts, and stale nudges without requiring the user to check email.  
**Scope:** `notifications` table; bell icon in the header; mark-as-read; clear-all.

### 8. Dark Mode
The app uses CSS variables (`--bg`, `--text`, etc.) but only defines a light palette. Adding dark mode requires:
- A second set of CSS variable values under `@media (prefers-color-scheme: dark)` and a `[data-theme="dark"]` attribute
- A theme toggle button in Settings
- Testing across all tabs for hardcoded colour values that need to move to variables

### 9. Audit Log Filtering & Export
The AuditLogPanel shows recent events but has no filter controls. Add:
- Filters by date range, action type (create / update / delete / import), and member
- Export to CSV button for compliance or personal records

### 10. SnapTrade Auto-Sync (Background Frequency Control)
SnapTrade sync is currently manual (user triggers it). Add an optional scheduled background sync (every 24 hours) so US brokerage holdings stay current without manual intervention.

### 11. Watchlist Price Alerts
The Watchlist tab shows live prices but has no alert capability. Extend the existing holding-alert system to watchlist items so users get notified (email/in-app) when a target price is hit.

### 12. SIP / SWP Return Attribution
XIRR captures the aggregate effect of SIPs but there is no breakdown showing which installments contributed most. A contribution-weighted return view would help users evaluate SIP timing decisions.

### 13. Goal Progress Milestone Notifications
When a goal crosses 25%, 50%, 75%, or 100%, send a celebratory email or in-app notification. Low effort, high motivation value.

### 14. Insurance Premium Renewal Reminders
Insurance renewal dates are tracked but no cron job fires reminder emails. Add a job similar to `fd-alerts` that sends reminders 30 and 7 days before an insurance policy renewal date.

---

## 🔵 P3 — Nice-to-Have / Research

### 15. NPS (National Pension System) Support
Add NPS as a 14th asset type with Tier-I / Tier-II distinction, contribution tracking, government co-contribution modelling, and 60/40 corpus tax split projection.

### 16. SGBs (Sovereign Gold Bonds) Tracking
SGBs have fixed tenors, semi-annual interest payouts, and premature redemption windows. A dedicated SGB tracker with maturity countdown and interest calendar would surface these clearly.

### 17. EPF / PPF Auto-Import via Setu
Explore whether the Setu AA or UMANG integration can auto-pull EPF balance and passbook, removing the need for manual EPF/PPF updates.

### 18. Alternative Investment Tracking (AIF / PMS)
High-net-worth users may hold AIF or PMS products. Model these as a new asset type with quarterly NAV updates and benchmark comparison.

### 19. Broker-Native Ledger Reconciliation
Compare transactions recorded in WealthLens Hub against broker contract note PDFs to surface discrepancies — missing trades, price differences, or quantity mismatches.

### 20. Embedded Financial News Feed
Pull a curated, portfolio-filtered news feed (NSE announcements, corporate actions, RBI circulars) and surface it in the Overview tab or a dedicated News tab.

### 21. Collaborative Budget (Shared Budget View)
Extend portfolio sharing to the Budget tab so couples or families can view, categorise, and annotate joint expenses together.

---

## ✅ Completed (Reference)

### Mobile PWA Enhancements (was P1 Item 1)
Shipped August 2026.
- **Web Push notifications** — `routes/push.js` (VAPID), `src/hooks/usePushNotifications.js`, `public/sw.js` push handler; toggle in Settings; wired into cron alert digest via `sendPushToUser()`
- **Swipe gestures** — `src/components/shared/SwipeableRow.jsx`; integrated into HoldingsTab mobile card list
- **Offline write queue** — `src/lib/offlineQueue.js` (IndexedDB); `sw.js` Background Sync handler; offline-aware transaction POST in `usePortfolio.js`
- **DB migration** — `migrations/0024_push_subscriptions.sql`

### Mutual Fund Overlap Analysis (was P1 Item 5)
Shipped August 2026.
- Backend `POST /api/mf/overlap` in `routes/mf.js` — fetches AMFI monthly portfolio disclosures, 7-day cache, pairwise Jaccard + weighted overlap computation
- Frontend `src/features/holdings/MFOverlapPanel.jsx` — auto-appears in HoldingsTab when ≥ 2 MF holdings with scheme codes; expandable pair cards with shared-stock breakdown

These are shipped and should not be re-added to the active backlog.

- PAN masking in `casCredentials` — `services/profile.service.js`
- SnapTrade disconnect scoped to removed broker accounts only — `routes/snaptrade.js`
- Per-user AI rate limiting (20 req/min, keyed on `req.user.id`) + model allowlist — `routes/ai.js`
- Transactions `ON DELETE CASCADE` FK — `migrations/transactions_migration.sql`
- `BUDGET_ENCRYPT_KEY` documented + production fail-fast guard — `lib/crypto.js` + `.env.example`
- **Portfolio Rebalancing Advisor** — StrategyTab has target allocation sliders, buy/sell amounts, and AI rebalancing explanation (✦ Explain this rebalance plan)
- Multi-member family portfolio with per-member filtered views
- Live price refresh (Indian stocks, US stocks, MF NAV, FX)
- XIRR → CAGR → Simple return cascade
- CAS PDF import (NSDL/CDSL)
- SIP bulk import with historical NAVs
- SnapTrade US brokerage linking
- Plaid US bank transaction import
- Zerodha Kite, Breeze Connect, Setu AA integrations
- 14+ bank CSV/Excel/PDF parsers (ImportHub)
- Gmail CAS auto-import (every 6 hours)
- AI Advisor with agentic tool use, streaming, and conversation persistence
- Portfolio Morning Brief (streaming)
- Per-holding AI Analysis (✦ Analyse)
- Concall Analysis (NSE → BSE → Tickertape → Screener → Motley Fool)
- LTCG/STCG calculator with FIFO lot matching and grandfathering
- AI Tax Strategy (streaming)
- Budget Tracker with AI Spend Insights and Investment Nudge
- Goals Tab with scenario modelling and AI gap analysis
- Watchlist Tab with live price enrichment
- Net worth snapshots (24-month history, Nifty/S&P benchmark)
- Dividends, Bonus Shares, Rights Issues, SWP tracking
- Insurance policy tracking
- Liabilities panel (true net worth)
- Portfolio sharing (viewer/editor roles)
- Excel and PDF export
- Holding-level price and return alerts with email digest
- FD maturity alerts (7/30/60 days)
- Stale holdings nudge (in-app banner + weekly email)
- Calendar Tab with Month Briefing
- Members Tab with AI Family Allocation Narrative
- Strategy Tab
- Audit Log with AuditLogPanel
- PWA (service worker, install prompt, mobile UX audit)
- AES-256-GCM encryption for PAN, Plaid tokens, budget data
- Rate limiting and security headers (express-rate-limit, helmet)
- .env.example with all env vars documented
