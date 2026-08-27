# WealthLens Hub — Product Backlog

> Last reviewed: August 2026  
> All items in the "Completed" section are shipped and live.  
> Items below represent genuine open work identified from code review, known issues, and architectural gaps.

---

## 🔴 P0 — Critical / Security

> ✅ **Audit complete — August 2026. All 5 P0 items confirmed resolved in the codebase.**

### ✅ 1. PAN Exposure in API Response — RESOLVED
`GET /api/profile/cas-credentials` already returns only `pan_masked` (e.g. `ABCD****Z`) via `services/profile.service.js`. The raw PAN is decrypted server-side solely to produce the masked display value and is never included in any API response.

### ✅ 2. SnapTrade Disconnect Wipes All Holdings — RESOLVED
`DELETE /api/snaptrade/connections/:authId` in `routes/snaptrade.js` fetches the remaining SnapTrade accounts after the authorization is removed, builds a `remainingAccountIds` Set, and only deletes holdings whose `source_account` is not in that set. Other broker accounts are untouched.

### ✅ 3. AI Chat — No Per-User Rate Limiting — RESOLVED
`routes/ai.js` defines `aiLimiter` with `keyGenerator: (req) => req.user?.id || ipKeyGenerator(req)` — per-authenticated-user limiting at 20 requests / 60 seconds. A model allowlist (`ALLOWED_MODELS`) also prevents arbitrary model selection.

### ✅ 4. Missing Cascade Delete for Transactions — RESOLVED
`migrations/transactions_migration.sql` declares `holding_id text not null references holdings(id) on delete cascade`. Deleting a holding removes its transactions at the database level.

### ✅ 5. ENCRYPTION_KEY Not Documented — RESOLVED
`lib/crypto.js` uses `BUDGET_ENCRYPT_KEY` (the correct variable name), which is documented in `.env.example` with a generation command. In production mode the server **throws at startup** if the key is absent, preventing silent data loss.

---

## 🟠 P1 — High Value / Near-term

### 6. Mobile App (React Native / PWA Enhancements)
The current PWA works on mobile but lacks native-feel gestures, push notifications (beyond email), and offline write capability. Consider:
- True push notifications via Web Push API for price alerts and FD reminders.
- Swipe-to-delete / swipe-to-edit on holdings rows.
- Offline queue for adding transactions when connectivity is poor.

### 7. Multi-Currency Portfolio View
Currently all values are normalised to INR. Users with significant US holdings want to toggle between INR and USD views without affecting the stored data.  
**Scope:** Add a currency toggle (INR / USD) to the global header; re-compute KPI tiles using the live FX rate.

### 8. Recurring Transaction Templates (SIP Automation)
Users manually log monthly SIP transactions. A recurring-transaction template would auto-create a transaction entry on a set schedule (monthly, quarterly) with a confirmation step.

### 9. Plaid Transaction Categorisation Improvement
Auto-categorisation relies on keyword rules. A short ML or LLM-assisted categorisation pass (using the transaction description + merchant name) would significantly reduce manual recategorisation effort.

### 10. Portfolio Rebalancing Advisor
Given a target asset allocation (e.g. 60% equity / 30% debt / 10% gold), compute the buy/sell amounts needed to rebalance. Surface as an AI-generated rebalancing order list in the Strategy tab.

### 11. Mutual Fund Overlap Analysis
For users holding multiple MFs, show stock-level overlap across funds (what % of holdings are duplicated across schemes). Useful for avoiding unintentional concentration.

### 12. Family Consolidated Tax Report (Excel)
Export a per-member and consolidated LTCG/STCG summary as an Excel workbook formatted for CA filing, including grandfathering calculations.

---

## 🟡 P2 — Medium Priority

### 13. Unified Notification Centre (In-App)
All alerts currently go only to email. An in-app notification bell with unread count and a notification drawer would surface FD maturities, price alerts, and stale nudges without requiring the user to check email.

### 14. Dark Mode
The UI uses hardcoded light-mode colours throughout App.jsx and the feature tabs. A CSS variable-based theme system would enable dark mode toggling, improving mobile night-time usability.

### 15. Audit Log Filtering & Export
The AuditLogPanel shows recent events but lacks filtering by date range, action type, or member. Add filter controls and an export-to-CSV button.

### 16. SnapTrade Holdings Sync Frequency Control
Currently SnapTrade sync is manual (user triggers it). Add an optional automatic background sync (e.g. every 24 hours) so US brokerage holdings stay fresh without manual intervention.

### 17. Watchlist Price Alerts
The Watchlist tab shows live prices but has no alert capability. Extend the existing alert system to watchlist items so users get notified when a target price is hit.

### 18. SIP / SWP Return Attribution
Currently, XIRR captures the aggregate effect of SIPs, but there is no breakdown showing which SIP installments contributed most to total return. A contribution-weighted return view would help users evaluate the SIP strategy.

### 19. Goal Progress Notifications
When a goal crosses a milestone (25%, 50%, 75%, 100%), send a celebratory email/push notification. Low effort, high motivation value.

### 20. Insurance Premium Reminder
Insurance renewal dates are tracked but no in-app or email reminder is triggered. Add a cron job similar to FD alerts that sends reminders 30 and 7 days before renewal.

---

## 🔵 P3 — Nice-to-Have / Research

### 21. NPS (National Pension System) Support
Add NPS as a 14th asset type with tier-I / tier-II distinction, contribution tracking, and government-co-contribution modelling.

### 22. SGBs (Sovereign Gold Bonds) Tracking
SGBs have fixed tenors, interest payouts, and premature redemption windows. A dedicated SGB tracker with maturity countdown and interest calendar would be useful.

### 23. EPF / PPF Auto-Import via Setu
EPFO and PPF portals expose limited APIs. Explore whether Setu AA or a UMANG integration can auto-pull EPF balance and statement, removing the need for manual updates.

### 24. Alternative Investment Tracking (AIF / PMS)
High-net-worth users may hold AIF or PMS products. Model these as a new asset type with quarterly NAV updates and benchmark comparison.

### 25. Broker-Native Ledger Reconciliation
Compare the transactions recorded in WealthLens Hub against the broker contract note PDFs to surface any discrepancies (missing trades, price differences).

### 26. Embedded Financial News Feed
Pull a curated news feed (NSE announcements, corporate actions, RBI circulars) filtered to holdings in the portfolio. Surface inside the Overview tab or as a dedicated News tab.

### 27. Collaborative Budget (Shared Budget View)
Extend portfolio sharing to the Budget tab so a couple or family can view and categorise joint expenses together in real time.

---

## ✅ Completed (Reference)

All items below are shipped and should not be re-added to the active backlog.

- PAN masking in `casCredentials` (never returns plaintext PAN) — `services/profile.service.js`
- SnapTrade disconnect scoped to removed broker accounts only — `routes/snaptrade.js`
- Per-user AI rate limiting (20 req/min, keyed on `req.user.id`) + model allowlist — `routes/ai.js`
- Transactions `ON DELETE CASCADE` FK constraint — `migrations/transactions_migration.sql`
- `BUDGET_ENCRYPT_KEY` documented in `.env.example`; production fail-fast guard in `lib/crypto.js`
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
- .env.example with all 20+ env vars documented
