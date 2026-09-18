# WealthLens Hub — Product Backlog

> Last reviewed: September 2026  
> P0 security items audited — all confirmed resolved, removed from backlog.  
> Items 1 (Mobile PWA) and 5 (MF Overlap) shipped August 2026 and moved to Completed.
> Value Masker (P1 Item 1) shipped August 2026 and moved to Completed; remaining P1 items renumbered.  
> P2 items 5, 6, 7, 11, 12 shipped August 2026 and moved to Completed; remaining P2 items renumbered.  
> All items in the Completed section are live in the codebase.  
> August 2026: Items 1, 3, 6, 7 moved to Won't Do / Deprioritized; remaining items renumbered.
> August 2026: SnapTrade Auto-Sync (P2 Item 3) also moved to Won't Do — SnapTrade is already a live connection.
> August 2026: Embedded Financial News Feed (P3 Item 9) shipped and moved to Completed; Item 10 renumbered to 9.
> August 2026: Financial News Feed upgraded — Indian market RSS sources (ET Markets, Livemint), macro RSS sources (SEBI, ET Economy), and per-stock filter UI added.
> September 2026: Production-readiness review — P0-1, P0-2, P1-1, P1-2 shipped Sep 18; P2-2, P2-4 shipped shortly after. All six moved to Completed (Production-Readiness Fixes, Sep 2026); remaining P2 items renumbered.
> September 2026: Concall Trend Agent, portfolio-wide Concall Calendar, and Concall Insights shipped — moved to Completed (Concall Intelligence Extensions, Sep 2026).
> September 2026: Six items added following a backlog brainstorm — P1 Item 4 (AI Concall Chat via Advisor tool-use), P2-4..P2-6 (YouTube transcript fallback, News-to-Portfolio Impact Agent, Weekly Portfolio Copilot digest), P3 Items 10-11 (LangGraph Portfolio Advisor Agent, Multi-user Goal Tracker).

---

## 🟠 P1 — High Value / Near-term

### 1. Recurring Transaction Templates (SIP Automation)
Users manually log every monthly SIP transaction. A recurring-transaction template would:
- Let users define a template (fund, amount, day-of-month)
- Auto-create a pending transaction entry on schedule with a one-click confirm step
- Distinct from Budget2Tab's recurring *detection* — this creates portfolio transactions

### 2. Family Consolidated Tax Report (Excel)
Export a per-member and consolidated LTCG/STCG summary as a multi-sheet Excel workbook formatted for CA filing — including grandfathering calculations and a summary row matching ITR Schedule 112A format.

### 3. Gmail check-now — frontend polling integration
`routes/gmail.js` now returns `{job_id}` immediately (P1-1 above), but the Gmail status panel frontend still expects the old synchronous response structure.  
Update the Gmail status panel in the frontend to:
- Call `POST /api/gmail/check-now` and get `{started, job_id}`
- Show a "Checking…" spinner
- Poll `GET /api/gmail/job/:id` every 3 s until status is `done` or `error`
- Surface the result (emails found, CAS imported, errors) as before

### 4. AI Concall Chat — as Advisor tool-use, not a separate chat surface
**Recommendation from architecture review (Sep 2026):** don't build a standalone chat UI inside `ConcallPanel.jsx`, and don't fork `AdvisorTab.jsx` into a "concall mode." The Advisor already runs a full agentic tool-use loop (`routes/ai.js` — `ADVISOR_TOOLS` + streaming SSE + tool-call chips already rendered in `AdvisorTab.jsx`) with conversation history and persistence solved. Adding transcript-grounded Q&A is a two-tool extension of that existing loop, not a new feature surface:
- `get_concall_analysis(holding)` — cheap Supabase read of the latest stored `concall_analyses` row (score, signal, summary, bull/bear points, trend if already computed). No network call.
- `get_concall_transcript(holding, quarter)` — runs the existing provider chain (`lib/concall/providers.js`) live for direct quote-level Q&A ("what exactly did management say about margins"). No new persistence needed for v1 — re-fetches on demand, same reliability profile as the existing `/analyze` endpoint. Revisit if latency/flakiness becomes a problem (store the prepared transcript text in Supabase Storage alongside the existing `artifacts` bucket).

This means a user can ask "What did Infosys say about margins last quarter?" in the same Advisor chat they already use for portfolio questions, and get the tool-call chip UI for free.
**Optional follow-up:** a "💬 Ask the Advisor" button in `ConcallPanel.jsx` that switches to the Advisor tab with the holding + quarter baked into a pre-filled question, for discoverability from the panel where the user is already looking at one holding's call.
**Files:** `routes/ai.js` (ADVISOR_TOOLS array + switch/case dispatcher + system prompt mention), `services/ai-tools.service.js` (new data-fetcher functions, same pattern as `getHoldingsData` etc.).

---

## 🟡 P2 — Medium Priority

### P2-1 · CSP Headers
**File:** `server.js`  
Helmet CSP is currently disabled (`contentSecurityPolicy: false`) to avoid breaking the Vite SPA. No content security policy in production is an audit finding.  
**Fix:** Audit exact asset origins (Supabase, Yahoo Finance, CDN scripts) and enable Helmet CSP with a tight allowlist.  
**Effort:** Medium — needs SPA asset origin audit first.

### P2-2 · Gmail `pendingJobs` — persistent / multi-instance store
**File:** `routes/gmail.js`  
`pendingJobs` is an in-process `Map` — lost on server restart, not shared across Render instances if scaled horizontally.  
**Fix:** Store job state in a `gmail_jobs` Supabase table (or Redis). Add TTL-based cleanup for old jobs.  
**Effort:** Medium.

### P2-3 · GitHub Actions cron — add failure alerting
**File:** `.github/workflows/scheduled-jobs.yml`  
Cron failures are silent unless the user monitors the GitHub Actions tab.  
**Fix:** Add `on-failure` step that POSTs to a Slack/email webhook, or enable GitHub Actions email notifications for workflow failures.  
**Effort:** Low.

### P2-4 · YouTube-recording transcript fallback provider
**File:** `lib/concall/providers.js`  
Small/midcap concalls often only get an IR-channel YouTube recording, no PDF transcript — NSE (Cloudflare), BSE, Screener, and Tickertape can all come up empty for these. Add a 5th provider that searches the company's official IR YouTube channel (YouTube Data API v3 — needs `YOUTUBE_API_KEY`) and pulls the public auto-caption track for the most recent earnings-call video.  
**Note:** this is the company's own official video and its own public captions — distinct from, and not to be confused with, scraping a third-party site like Concall.in (whose Terms of Service explicitly forbid that; see the Sep 2026 conversation where that was ruled out).  
**Effort:** Medium — new provider class + caption-fetch helper, no schema changes.

### P2-5 · News-to-Portfolio Impact Agent
**File:** `routes/news.js`, `src/features/NewsTab.jsx`  
The News tab shows a flat chronological feed. Add a per-article relevance pass: for each article tied to a portfolio ticker, ask Claude whether it's likely to move the investment thesis (earnings-relevant, regulatory, management change, competitive threat) and surface a compact impact tag instead of making the user read everything.  
**Pairs naturally with Concall Insights** — same "is my thesis at risk" framing, different data source (news flow vs. quarterly calls).  
**Effort:** Medium — one Claude call per new article batch, cached like the existing 15-min RSS cache.

### P2-6 · Weekly Portfolio Copilot digest
**Files:** new `routes/cron.js` endpoint, reuses `services/ai-tools.service.js`, `lib/concall/trend.js`, `routes/news.js`, `insertNotification()`  
Orchestrate the AI features that already exist per-tab (Overview morning brief, AI Tax Strategy, News, Concall Insights) into one scheduled agent run producing a single weekly digest, delivered via the existing notification centre / email digest infrastructure. Only surfaces sections with something to say — skip tax if nothing changed since last week, skip concall if no signal flipped — rather than always running every sub-agent.  
**Effort:** Medium-High — first genuinely multi-tool orchestration run on a schedule rather than on-demand; a good candidate for the LangGraph experiment below if that's built first.

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

### 10. AI Portfolio Advisor Agent — Python/LangGraph microservice
From the original Hub/Pro backlog — never built. A standalone FastAPI service running an actual LangGraph graph (pull holdings → pull Concall Insights + News → reason about cross-holding correlations → produce a cited recommendation), called from `routes/ai.js` the same way `services/cas_casparser_service.py` is already shelled out to for CAS parsing.  
**Distinct from the existing Advisor tool-use loop** (Node + Anthropic SDK directly) — this is explicitly for hands-on multi-step agent-orchestration work in Python, not a replacement for the Advisor tab. Good candidate to also host the Weekly Portfolio Copilot (P2-6) once it exists, since that's the first genuinely multi-tool scheduled orchestration in the app.

### 11. Multi-user Goal Tracker (shared/collaborative goals)
GoalsTab currently models one goal per member with scenario modelling. Extend to shared family goals (e.g. a joint house-down-payment goal) with per-member contribution tracking and a shared progress view, building on the existing portfolio-sharing viewer/editor role infrastructure rather than a new permissions model.

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

### Production-Readiness Fixes (Sep 2026)
Identified in the Sep 2026 production-readiness review.

- ✅ **P0-1 — Parallelize ISIN resolution in CAS import** — `routes/import.js`  
  **Problem:** Serial `for` loop with `await setTimeout(2000)` between each demat holding — 10 stocks = 20+ s, any CAS with 15+ stocks timed out Render's 30 s request limit.  
  **Fix:** Replaced with `pLimit(8)` parallel worker pool + 25 s hard deadline. Imports `resolveIsinSymbol` from `lib/prices.js`.  
  **Shipped:** Sep 18 2026
- ✅ **P0-2 — Add `/health` endpoint + fix render.yaml healthCheckPath** — `server.js`, `render.yaml`  
  **Problem:** `healthCheckPath: /` caused Render to treat the HTML SPA shell as the health signal — a broken deploy could go undetected.  
  **Fix:** Added `GET /health → {ok: true, ts: Date.now()}` before static middleware. Updated `healthCheckPath: /health` in render.yaml.  
  **Shipped:** Sep 18 2026
- ✅ **P1-1 — Gmail check-now: fire-and-forget + job polling** — `routes/gmail.js`  
  **Problem:** `POST /check-now` awaited `autoImportCASForUser()` synchronously — PDF fetch + casparser can take 2–5 min, well beyond Render's 30 s timeout.  
  **Fix:** Returns `{started: true, job_id}` immediately; runs import in the background via a `pendingJobs` Map; added `GET /gmail/job/:id` for client polling.  
  **Shipped:** Sep 18 2026
- ✅ **P1-2 — Flush-and-fill destructive UX warning in CAS Import modal** — `src/components/modals/CASImportModal.jsx`  
  **Problem:** The replace-count warning (e.g. "42 existing CAS holdings will be replaced") was buried in the same yellow generic warning box as informational notices — users didn't realize the action was destructive.  
  **Fix:** Matching step now splits warnings into two boxes: generic amber box (informational) + distinct orange "🔄 Full Replace — CAS Source" box showing the replace count with explanation. `casReplaceCount` derived locally from warning text.  
  **Shipped:** Sep 18 2026
- ✅ **P2-2 — pLimit extracted to shared `lib/utils.js`** — `lib/utils.js` now owns `pLimit()`; `lib/refresh.js` re-exports it for existing import sites; `routes/import.js` imports it directly from `lib/utils.js`
- ✅ **P2-4 — CAS done screen shows statement date + depository** — `CASImportModal.jsx`: done step now displays `casDepository` (CAMS/CDSL/NSDL/KFin) and `casStatementDate` alongside the success summary

### Concall Intelligence Extensions (Sep 2026)
Three additions on top of the existing per-holding Concall Analysis.
- ✅ **Quarter-over-quarter trend agent** — `lib/concall/trend.js`, `GET /api/concall/:holdingId/trend`  
  Reasons over the structured `concall_analyses` history already stored (no re-fetching transcripts) to produce a trend narrative (IMPROVING/STABLE/DETERIORATING/VOLATILE) with an inflection-point quarter when there is one. 24h in-process cache keyed to the holding's latest analysed quarter. Surfaced in `ConcallPanel.jsx` as a sparkline + narrative card.
- ✅ **Portfolio-wide Concall Calendar** — `lib/concall/calendar.js`, `GET /api/concall/calendar`  
  Deterministic next-concall window estimated from each holding's last analysed quarter + typical India reporting lag, upgraded to a confirmed date when a live BSE board-meeting filing parses cleanly for the 8 holdings due soonest. Bounded by `pLimit` concurrency + a 20s hard deadline; 12h per-user cache.
- ✅ **Concall Insights** — `GET /api/concall/insights`  
  Pure aggregation (no new LLM calls) of latest signal/score across every equity holding, sorted worst-first (BREAKS → CHALLENGES → NEUTRAL → CONFIRMS), flags holdings never analysed.
- **Frontend** — `src/features/calendar/ConcallOutlookCard.jsx`, wired into `CalendarTab.jsx` between the Upcoming card and the Legend card.
- **Explicitly ruled out:** integrating with Concall.in (the third-party AI concall platform) — their Terms of Service prohibit scraping/harvesting, so this was built natively on the existing NSE/BSE/Screener provider chain instead.

### Embedded Financial News Feed (Enhanced)
Shipped August 2026 (was P3 Item 9). Enhanced August 2026 with Indian market RSS sources, additional macro feeds, and per-stock filtering.
- **Backend** — `routes/news.js`; `GET /api/news?tickers=...`; Yahoo Finance news for up to 12 portfolio tickers; RSS feeds added: ET Markets + Livemint (Indian market), RBI + SEBI + ET Economy (macro); regex RSS 2.0 parser; 15-min in-process cache per source; deduplicates, sorts newest-first, returns up to 60 articles; `rssSources` list in response distinguishes portfolio tickers from feed sources
- **Frontend** — `src/features/NewsTab.jsx`; two-row filter UI — Row 1 Market category (All / Indian / US / Macro); Row 2 per-stock chips (All Stocks + one chip per portfolio ticker with articles, colour-coded by market); clicking a ticker filters to that stock only; active filter summary bar with Clear; ticker tag on each card is clickable; `rssSources` set suppresses ticker tags on RSS articles
- **Wiring** — `server.js` mounts `/api/news`; `App.jsx` adds News tab (Newspaper icon) to nav

### Unified In-App Notification Centre
Shipped August 2026 (was P2 Item 5).
- **DB migration** — `migrations/0025_notifications.sql`; `notifications` table with `user_id`, `kind`, `title`, `body`, `url`, `read`, `created_at`; RLS enabled
- **Backend** — `routes/notifications.js`; GET `/api/notifications`, POST `/:id/read`, POST `/read-all`, DELETE `/clear`; `insertNotification()` helper exported for cron use
- **Frontend** — `src/components/NotificationCentre.jsx`; bell icon in desktop header with unread badge; slide-in drawer with mark-read-on-click, Mark-all-read, Clear-read buttons; polls every 60s
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
