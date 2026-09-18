# Deep Restructure — Execution Plan (P3-2, P3-3, P3-5, P4-2)

These four items are large and cross-file. Do them **with a running build/test loop**
(`npm run dev` + `npm test`), one commit per numbered step, so each change is
verifiable before the next. Order matters: backend first (P3-2, P3-3), then the
frontend split (P3-5), then the import-hub UX (P4-2).

Prereq: `npm install` (picks up eslint/prettier/vitest added in P3-4), then
confirm the baseline is green: `npm test && npm run build`.

---

## Progress log

**2026-09-18 — P3-2 service-layer extraction (partial, no build/test loop available)**

No `npm run dev` / `npm test` / lint access was available on this pass, so instead of the
prereq'd build-verified workflow above, each route was extracted via careful manual
read-through, behavior-preserving lift-and-shift, and a `grep -rn "supabase" routes/<file>`
zero-references check before commit. Per explicit direction, this stayed strictly in
**"small pieces only"** mode — no Setu/SnapTrade/Plaid/`cron.js` work, no further `App.jsx`
restructuring beyond the earlier `useAuth` hook extraction (all still pending a real
build loop; see P3-3 and P3-5 below, unchanged).

Routes moved to a service file and verified `supabase`-free (✅ committed & pushed):
- `services/notifications.service.js` ← `routes/notifications.js`
- `services/push.service.js` ← `routes/push.js` (kept VAPID/webpush setup + exports)
- `services/tax.service.js` ← `routes/tax.js`
- `services/audit.service.js` ← `routes/audit.js`
- `services/watchlist.service.js` ← `routes/watchlist.js`
- `services/concall.service.js` ← `routes/concall.js` (kept multer/provider orchestration)
- `services/analytics.service.js` ← `routes/analytics.js` (kept XIRR/FIFO math + helpers)
- `services/import.service.js` ← `routes/import.js` (surgical: only the query lines moved,
  branching/parsing logic untouched) — also reused by `routes/import_v2.js` for its
  identical CAS-unlock-context query (no duplicate function written)
- `services/ai-tools.service.js` ← `routes/ai.js` (surgical: all 9 `execTool` case-branch
  queries moved one function each; response shaping/aggregation/math stayed in the route)

**2026-09-18 (same session, follow-up) — `routes/export.js` resolved and extracted**

The FD-filter question was put to the user directly: the Excel export's FD sheet was
unfiltered (included closed/matured FDs) while the app's Holdings view excludes them via
`NOT_CLOSED`/`NOT_EXITED`. User decision: **filter to match Holdings** (a deliberate
behavior change, not a preservation of the old export output). Extracted into
`services/export.service.js` ✅ committed & pushed:
- `listAllTransactions(userId)` — used by both the CSV `/transactions` route and the
  `/xlsx` route's Transactions sheet (previously two copies of the same query).
- `getProfileEmail(userId)` — used by the `/report` route.
- `listActiveFds(userId)` — the `/xlsx` FD sheet query, now filtered with the same
  `NOT_CLOSED`/`NOT_EXITED` `.or()` filters and graceful-degradation fallback as
  `holdings.service.js`'s `list()`.
`routes/export.js` verified `supabase`-free.

**2026-09-18 (same session, second follow-up) — Setu/SnapTrade/Plaid/cron.js extracted**

User explicitly authorized moving into the real-money/bank-linked tier that was previously
held back, confirming there is still no build/test loop available and to proceed carefully
anyway (same manual-review + `grep` zero-references verification as every file above; no
behavior changes except where called out). All four ✅ committed & pushed:
- `services/plaid.service.js` ← `routes/plaid.js` — 9 functions covering connections,
  token-exchange upsert, sync (statement/transaction inserts, cursor update), and delete;
  preserved the original's fire-and-forget (unchecked) error handling everywhere it was
  unchecked, and the `/status` route's checked-error branch where it was checked.
- `services/snaptrade.service.js` ← `routes/snaptrade.js` — 11 functions covering
  `getSnapConn`, registration, the holdings-diff query, flush-and-fill import, and
  connection/holding cleanup on disconnect. Same fire-and-forget vs. checked-error split
  as the original per call site.
- `services/setu.service.js` ← `routes/setu.js` — 13 functions covering consent
  create/update (both user-scoped and the webhook's unscoped variant, kept as two
  distinct functions since the webhook has no authenticated user), FI-data session
  bookkeeping, holdings upsert, and the budget-import dedup/insert loop. Largest and
  most complex file in this batch; all API calls, token handling, and FI-data/transaction
  parsing stayed in the route untouched.
- `services/cron.service.js` ← `routes/cron.js` — 11 functions covering the price-refresh
  user list, Gmail auto-import profile list, FD-alert query (with its existing
  migration-0028 fallback preserved), a shared `getProfileEmail` reused across all 4
  alert routes that needed it, and portfolio/holdings queries for the stale-nudge,
  alert-check, insurance-reminder, and goal-milestone crons. The goal-milestone route's
  `.update(...).catch(...)` chaining pattern was preserved exactly (service returns the
  un-awaited query builder so the route's own `.catch()` still applies).

**Deferred / explicitly out of scope for this pass:**
- `App.jsx` further restructuring (P3-5) — only the initial `useAuth` hook extraction is
  done; still paused pending a real build/test loop, per the plan's own note that this
  step MUST be done with `npm run dev`.

**Acceptance check for all 15 files touched this session:** `grep -rn "supabase"
routes/notifications.js routes/push.js routes/tax.js routes/audit.js routes/watchlist.js
routes/concall.js routes/analytics.js routes/import.js routes/import_v2.js routes/ai.js
routes/export.js routes/plaid.js routes/snaptrade.js routes/setu.js routes/cron.js` →
zero matches on every file. Full-repo `grep -rn "supabase.from" routes/` acceptance bar
(line 43 below) is now **met** for every route file — P3-2's backend goal is complete
modulo the "run the app and verify" step this session couldn't do (no build/test loop).

**2026-09-18 (same session, third follow-up) — P3-3 investigated and marked obsolete**

Before executing the plan below as written, the codebase was checked for whether its
targets (`kite.js`, `breeze.js`) still exist. They don't: `src/App.jsx` already carries
its own comment `// KiteImport and BreezeImport decommissioned — integrations removed`,
there are no `routes/kite.js` / `routes/breeze.js` files, no Kite/Breeze SDK dependencies
in `package.json`, and no related env vars. SnapTrade is the only broker left and already
has its own `services/snaptrade.service.js` (from the P3-2 pass above) — there is nothing
left to consolidate into a shared adapter pattern. The only artifact of the old broker
tier was `services/brokers/persistSync.js` (an unused, dead `persistBrokerSync` function,
referenced by nothing) — this session flagged it for manual deletion since `device_bash`
(shell access to the user's machine) was down all session; **the user has since deleted
it manually along with the empty `services/brokers/` folder**, confirmed gone as of this
follow-up. P3-3 is marked **OBSOLETE** below; its original text is kept for reference.

**2026-09-18 (same session, fourth follow-up) — P3-5 investigated, P4-2 groundwork started**

User asked to tackle P3-5 (App.jsx split) and P4-2 (import hub) together. Investigated
both against the current codebase before touching anything, since P3-3 above showed the
plan's premises can go stale:

- **P3-5 findings:** step 1 of the plan (feature folders) turned out to already be done —
  `src/features/<name>/` already exists for every tab (`overview`, `holdings`, `goals`,
  `tax`, `budget`, `budget2`, `familyBudget`, `strategy`, `advisor`, `watchlist`, `news`,
  `calendar`, `members`, `audit`) with `src/components/tabs/` now empty. `App.jsx`'s
  `useState` count is down to ~24 (from the plan's stated 56), and no `AppShellContext`
  exists yet (step 2 not started). `TaxTab`, the plan's suggested first extraction target,
  turned out to have zero tab-specific state left in `App.jsx` — nothing to extract. The
  next-simplest candidate, Goals, has a ~130-line "Add/Edit Goal" modal still living
  directly in `App.jsx`'s render, wired into shared portfolio state (`allHoldings`,
  `valINRCache`, `goals`, `portfolio.addGoal`) and shared components (`Overlay`, `FG`,
  `FmtInput`, `HoldingsPicker`, `MA`) — judged too risky to extract blind, with no
  `npm run dev` available to verify the app still renders after the change. Per the
  plan's own acceptance note ("This step MUST be done with `npm run dev`"), and the
  user's explicit choice this session, **P3-5 is deferred again**, no code changed.

- **P4-2 findings:** the plan assumed `ImportHub` still needed to be built. It already
  exists (`src/components/modals/ImportHub.jsx`) and is already fully wired into
  `App.jsx` (`showImportHub` state, `handleImportSelect(key)` router, multiple entry
  points in the header/mobile-sheet/settings), satisfying the "one entry point for all
  imports" half of P4-2's acceptance bar. `LoadingSkeleton.jsx` and `Toast.jsx` already
  exist too, covering part of the loading/empty-states half. What was genuinely still
  missing: a reusable `<SourceStatus>` connection-status banner (connected / needs-reauth
  / not-connected / error), and real per-source status data wired into `ImportHub`'s rows
  — both require a running app to verify safely, so **only the groundwork piece was
  built this pass**: `src/components/shared/SourceStatus.jsx` (NEW, ✅ committed —
  see git commands below) — a presentational, props-driven status banner, not yet
  imported or rendered anywhere, so it carries zero behavior risk. Its header comment
  documents the mapping from each source to its existing status endpoint for the future
  wiring step: SnapTrade → `GET /api/snaptrade/connections`, Setu AA →
  `GET /api/setu/connections`, Plaid → `GET /api/plaid/status`, Gmail →
  `profile.gmail_auto_import` + `profile.gmail_token` (no dedicated status route yet).

**Still deferred, pending a real `npm run dev` session:** the rest of P3-5 (Goals modal
extraction onward, `AppShellContext`), and the rest of P4-2 (wiring `SourceStatus` into
`ImportHub` with live per-source status calls, plus a full loading/empty-states audit).

**2026-09-18 (same session, fifth follow-up) — P3-5 Goals modal extracted; P4-2 SourceStatus wired in**

User asked to go ahead with both pieces flagged as deferred above. Same no-`npm run dev`
constraint applied, so both changes were kept behavior-preserving and were checked with a
`babel --presets=@babel/preset-react` parse pass (catches JSX/syntax errors, though not
runtime behavior) before committing — this is now the standard sanity check for any JSX
change made without a dev server.

- **P3-5 — Goals modal extracted:** the ~130-line "Add/Edit Goal" modal moved out of
  `App.jsx` into `src/features/goals/GoalFormModal.jsx` ✅ committed & pushed. This is a
  markup-only lift-and-shift — `goalForm`, `editGoalId`, and `modal` state all stay owned
  by `App.jsx` and are passed down as props, so it doesn't attempt the riskier "lift state
  into a hook" step from the plan. `App.jsx` shrank from 99,123 to 92,186 bytes (~130
  lines removed, replaced by an 11-line component call + a new import). `AppShellContext`
  (plan step 2) still not started — the remaining ~24 `useState`s in `App.jsx` are mostly
  cross-tab (tab, selMember, modal, and per-tab form state for Alerts/Members/etc.) and
  still need a live app to extract safely one at a time.
- **P4-2 — SourceStatus wired into ImportHub:** `src/components/modals/ImportHub.jsx`
  now fetches real connection status on open for the two sources that have a persistent
  connection — SnapTrade (`GET /api/snaptrade/connections`) and Setu AA
  (`GET /api/setu/status` gate, then `GET /api/setu/connections`) — and renders the
  `SourceStatus` banner under those rows ✅ committed & pushed. CAS/FD/CSV/manual are
  one-shot imports with nothing to report, so they're intentionally left without a
  banner. Any fetch failure (including the normal "no connection registered yet" case,
  which the backend currently returns as a generic error rather than a distinct
  not-found) is treated as `not_connected` rather than surfaced as an alarming `error`
  state — verified against the actual route/service code (`getSnapConn` throws a plain
  `Error`, routed through `sendError` at a default HTTP 500) rather than assumed. Setu's
  response fields were checked against `migrations/0027_setu_connections.sql` rather than
  guessed. One layout bug caught and fixed before committing: wrapping each row in a
  container div for the optional banner broke the button's full-width stretch (it relied
  on being a direct flex child), fixed with an explicit `width: 100%`. Plaid and Gmail
  remain unwired — Plaid isn't even a source in `ImportHub`'s current `SECTIONS` list, and
  Gmail has no dedicated status endpoint yet (both still noted in `SourceStatus.jsx`'s
  header comment for a future pass).

**Note on this session's `RESTRUCTURE_PLAN.md` / `App.jsx` sync issue:** the very first
commit of `App.jsx` in this follow-up reported success but the device's copy still held
the pre-edit content moments later (same file-revert symptom seen earlier on this plan
doc, now also seen on a code file). Caught by re-staging and diffing immediately after
every commit — now standard practice this session — and fixed with a forced re-commit,
verified stable across two follow-up re-stages. If this keeps recurring across file
types, it's worth checking for a sync conflict (e.g. OneDrive syncing this repo across
two devices) outside of what this session can diagnose.

**Still deferred, pending a real `npm run dev` session:** the rest of P3-5
(`AppShellContext` + extracting remaining cross-tab state one tab at a time), the rest of
P4-2 (Plaid/Gmail status wiring if desired, plus the full loading/empty-states audit),
and — now more than ever — an actual run-and-click-through verification pass, since
nothing from this session's P3-2 through P4-2 work has been executed in a live app yet.

**2026-09-18 (same session, sixth follow-up) — first live verification pass; local backend never worked, now fixed**

User got `npm run dev` running and walked through the Goals modal and Import Hub live —
the first time anything from this entire session (P3-2 through P4-2) was actually
executed rather than reviewed by reading code. Two real problems surfaced, both fixed:

- **Stale Vite dev cache / service worker** — first load crashed with `Invalid hook
  call` / `Cannot read properties of null (reading 'useState')` at the very first hook
  call in `App.jsx` (`useAuth`). Not caused by this session's edits (nothing touched
  `useAuth.js` or the App component's hook order) — `npm ls react react-dom` confirmed
  a single deduped React 18.3.1, ruling out a duplicate-copy issue. Root cause was Vite's
  stale dependency pre-bundle cache combined with the registered PWA service worker
  serving an old bundle. **Fix (no code change):** delete `node_modules/.vite` and
  reload in an incognito window. Resolved.
- **Backend was never runnable locally at all — `server.js` never loaded `.env`.**
  `npm start` (`node server.js`) crashed immediately with `Error: supabaseUrl is
  required.` `server.js` has no `dotenv` import anywhere, and `dotenv` isn't even in
  `package.json` — it only ever worked in production because Render's `startCommand`
  (`node server.js`, confirmed in `render.yaml` — it does **not** go through `npm start`)
  injects real env vars via its own dashboard, no `.env` file involved. Locally, without
  something loading `.env` into `process.env`, the backend could never start, which is
  consistent with this entire session's "no build/test loop available" constraint — the
  backend-verification gap wasn't a tooling limitation of this session, it was a real,
  pre-existing local-dev gap in the repo itself.
  **Fix ✅ committed & pushed:** added `import "dotenv/config";` as the first line of
  `server.js`, and added `dotenv` (`^16.4.5`) to `package.json` dependencies. Chosen over
  the alternative (changing the `start` script to `node --env-file=.env server.js`)
  because that would only fix the `npm start` path — running `node server.js` directly
  (as `npm start` itself does, and as Render's `startCommand` does) would still crash,
  which is exactly what had just happened. The in-file `dotenv/config` import works no
  matter how the file is launched, and is a no-op in production (no `.env` file exists
  there, and real env vars are already set). Confirmed safe for prod by checking
  `render.yaml`'s `startCommand` directly rather than assuming.

**Verified working, live, for the first time this session:**
- App loads and logs in cleanly (after the Vite cache fix above).
- **Goals modal (P3-5 extraction):** open, fill, save, edit-prefill, and cancel all work
  identically to before the extraction — confirmed by the user directly.
- **Import Hub (P4-2 SourceStatus wiring):** SnapTrade's "Bad Gateway" was purely the
  missing local backend — gone once the server was actually reachable. Setu AA correctly
  shows the existing (pre-session) "Setu AA Not Configured" screen rather than a banner,
  because this session's `fetchSetuStatus` deliberately checks `/api/setu/status` first
  and skips rendering a banner when Setu isn't configured/enabled — confirmed behaving
  as designed, not a bug.

**Not yet verified live:** the 15 P3-2 route/service extractions from earlier in this
session (notifications, push, tax, audit, watchlist, concall, analytics, import/import_v2,
ai, export, plaid, snaptrade's non-status endpoints, setu's non-status endpoints, cron),
and the export.js FD-filter behavior change. These still only have manual-review +
`grep` verification, not a live run.

**2026-09-18 (same session, seventh follow-up) — live route-by-route walkthrough; one real pre-existing bug found and fixed**

User walked through most of the extracted P3-2 routes live. Results, grouped by what
turned out to be true bugs vs. expected behavior misread as bugs:

**Confirmed correct / expected, no code issue:**
- Notifications — blank with no error. Correct: the table is only ever populated by
  cron jobs (goal-milestone, FD-maturity, stale-nudge alerts) that run on Render's
  schedule and never fire locally, so an empty list is the right result on local dev.
- Push — works.
- Tax and Watchlist tabs — reported as "hidden." Confirmed in `App.jsx`: both are
  explicitly commented out of the nav menu with `// hidden — not actively used`,
  pre-existing and unrelated to this session.
- Audit Log — works.
- Analytics / XIRR — reported as not calculating. Confirmed via `routes/analytics.js`'s
  own comments: pooled XIRR requires a transaction ledger, which only a **detailed** CAS
  statement (or manual entries) populates — a **consolidated** CAS statement (what the
  user imports) has no per-transaction history to build one from. This is documented,
  pre-existing product behavior, not a P3-2 extraction bug — the extraction only moved
  the two Supabase read functions; all XIRR math and the ledger/estimated/none fallback
  stayed in the route untouched.
- Concall — reported as "Fetch & analyse doesn't work." Network tab showed the request
  taking 8.69s before a 404 with body consistent with the route's own
  `"Could not auto-source an earnings call transcript for this holding"` response — i.e.
  it genuinely tried every provider (NSE, BSE, Screener, Motley Fool) and found nothing
  for that specific (smaller-cap) stock, which is the designed failure path that reveals
  the manual-upload fallback. Confirms the `concall.service.js` extraction works
  correctly; the feature simply couldn't source a transcript for that company.
- CSV import (Group 3) — works end to end.

**Real, pre-existing bug found and fixed ✅ committed & pushed:**
- `src/hooks/usePortfolio.js` called `/api/asset-types` and `/api/benchmark?period=1Y`
  with no router prefix. The actual routes are `/api/profile/asset-types`
  (`routes/profile.js`, mounted at `/api/profile`) and `/api/budget/benchmark`
  (`routes/budget.js`, mounted at `/api/budget` — confirmed the right one by matching
  its `period` query param and Nifty50/S&P500-index response shape against a second,
  wrong candidate at `/api/prices/benchmark`, which takes a different `symbol`/`range`
  shape entirely). Both calls were silently `.catch()`-wrapped, so the app never crashed
  — it just silently lost custom asset types and the benchmark-comparison data on every
  load. Confirmed via response timing (7–19ms, consistent with Express's own
  "no route matched" 404, not app logic) that this was a routing mismatch, not a
  legitimate not-found response. Not caused by this session — `server.js`'s route
  mounting, `routes/profile.js`, `routes/budget.js`, and `usePortfolio.js` were all
  untouched by anything else this session did; this was simply never caught before
  because the backend had never been run locally until this pass. Fixed by correcting
  both paths in `usePortfolio.js`.
  **Status: fix applied and committed, but not yet confirmed working live** — the user
  re-checked after the fix and reported "still not working" without further detail (no
  updated console/network output was captured), then chose to pause verification here
  and revisit later. Next session should re-check `asset-types` and `benchmark` in the
  Network tab after a hard refresh (not just HMR) before assuming the fix is complete —
  it's possible HMR didn't pick up the hook change cleanly, or there's a second issue
  underneath the routing one.

**Still not attempted:** Group 4 (AI tools) and Group 5 (Excel export FD-filter check)
from the verification walkthrough, plus everything already listed above as not yet
verified live (most of the 15 P3-2 files still only have manual-review + `grep`
verification for their non-status/non-UI-visible endpoints).

---

## P3-2 — Service layer across all routes

**Goal:** routes never call `supabase.from(...)` directly. All DB access + ownership
checks + encryption live in `/services`. This is what structurally prevents the
IDOR class that Phase 1 patched by hand.

**Target layout**
```
/services
  holdings.service.js       # list, getById, importRows, deleteBySource, deleteDemo
  transactions.service.js   # listForHolding, add, importRows
  artifacts.service.js      # listForHolding, create, getSignedUrl, remove  (uses lib/guards)
  portfolio.service.js      # get/upsert, member self-repair, PAN masking
  budget.service.js         # statements/transactions/categories CRUD + analytics
  profile.service.js        # profile + asset-types + cas-credential lookups
  brokers/                  # see P3-3
  index.js                  # re-exports
```

**Steps (one commit each):**
1. Create `services/artifacts.service.js` first (smallest, already guarded). Move the
   4 supabase calls out of `routes/artifacts.js`; route becomes parse→call→respond.
   Run the app, upload/download/delete an artifact. Commit.
2. `services/transactions.service.js` — move logic from `routes/transactions.js` and the
   `/:id/transactions` handler in `routes/holdings.js`. Keep the `user_id` scoping.
3. `services/holdings.service.js` — the big one. Move the import/flush-and-fill logic and
   `enrichHoldings`/`sanitizeDates` (currently exported from `routes/portfolio.js`).
4. `services/portfolio.service.js`, `services/budget.service.js`, `services/profile.service.js`.
5. Delete now-dead helpers from routes; run `npm run lint` to catch unused imports.

**Acceptance:** `grep -rn "supabase.from" routes/` returns nothing (all moved to services);
every endpoint still returns the same shape (diff responses against `git stash` baseline).

---

## P3-3 — Broker sync consolidation — **OBSOLETE (2026-09-18)**

> **This item is moot and will not be implemented as written.** It targeted `kite.js`,
> `breeze.js`, and `snaptrade.js`, but Kite Connect and ICICI Breeze integrations were
> already decommissioned before this restructure work started (see the Progress Log
> entry above for how this was confirmed). SnapTrade is the only broker remaining and
> already has its own service file from the P3-2 pass — there is no remaining
> duplication to consolidate into a shared adapter. The dead `persistBrokerSync`
> leftover (`services/brokers/persistSync.js`) has been deleted by the user. No further
> action needed on this item. Original text preserved below for reference.

**Observation:** `kite.js`, `breeze.js`, `snaptrade.js` repeat the same shape:
`getConn → validate token → fetch equity + MF → map to holdings rows → upsert → snapshot`.

**Target**
```
/services/brokers
  runSync.js        # shared runner: takes an adapter, does upsert + takeSnapshot + last_synced
  kite.adapter.js   # { name, getConn, isTokenValid, fetchHoldings(conn) -> {equity[],mf[]}, mapRow }
  breeze.adapter.js
  snaptrade.adapter.js
```
`runSync(userId, adapter, { member_id })` returns `{ synced, equity_count, mf_count }`.
Routes shrink to: auth → strictLimiter → `runSync(...)` → respond.

**Steps:** extract `runSync` from the current `kite.js` sync (it's the reference impl),
port breeze then snaptrade to adapters one at a time, testing a real sync after each.
Keep the row-id scheme (`kite_…`, `breeze_…`) identical so upserts stay idempotent.

**Acceptance:** each broker sync still produces the same holdings rows; `takeSnapshot`
still fires once per sync.

---

## P3-5 — Split App.jsx (1,126 lines, 56 useState)

**Strategy: incremental, never a big-bang rewrite.** App.jsx already imports extracted
tab components and hooks — the remaining bulk is cross-tab state and orchestration.

1. **Feature folders:** move each `components/tabs/XTab.jsx` + its state into
   `src/features/<x>/`. Co-locate a `use<X>.js` hook that owns that tab's state
   (lift the relevant `useState`s out of App.jsx into the hook).
2. **Shared UI context:** the truly cross-cutting state (current `tab`, `selMember`,
   `modal`, toast) goes into a small `AppShellContext` — not 56 props.
3. **App.jsx becomes a shell:** auth gate + `<Header>` + `<TabNav>` + `<BottomNav>` +
   the active feature. Target < 200 lines.
4. Do it **one tab at a time**, verifying the app renders after each extraction. Start
   with the most self-contained (Tax, Goals) before Overview/Holdings (most wired).

**Acceptance:** `App.jsx` under ~200 lines; each feature owns its state; no prop drilling
of more than ~5 props; app behaves identically. This step MUST be done with `npm run dev`.

**Status (2026-09-18):** step 1 is already done — all tab components live under
`src/features/<name>/`. The Goals "Add/Edit" modal has been extracted to
`src/features/goals/GoalFormModal.jsx` (markup only — `goalForm`/`editGoalId`/`modal`
state still lives in `App.jsx`). `TaxTab` had no extractable state, so nothing to do
there. `App.jsx` is now 92,186 bytes (was 99,123). Step 2 (`AppShellContext`) not started
— still needs a real `npm run dev` session to extract the remaining ~24 `useState`s
(mostly cross-tab: `tab`, `selMember`, `modal`, and other tabs' form state) one at a time.
See Progress Log above.

---

## P4-2 — Unified import hub + loading/empty states

**Import hub:** replace the per-broker modals (`SnapTradeImport`, `KiteImport`,
`BreezeImport`, CAS, Plaid, Gmail) with one `ImportHub` that renders a list of sources
sharing a common state machine: `idle → connecting → authorize → syncing → connected/error`,
plus one reusable `<SourceStatus>` banner (connected / needs-reauth / last-synced).
Each source becomes a small config `{ id, name, icon, connect(), sync(), status() }`.

**Loading/empty states:** audit every async action to (a) show `LoadingSkeleton` while
pending and (b) surface failures via `Toast`. Add guided empty states (e.g. Holdings:
"No holdings yet — connect a broker or add manually").

**Acceptance:** one entry point for all imports; consistent status UI; no silent failures;
every list has a skeleton + empty state.

**Status (2026-09-18):** `ImportHub.jsx` already existed and was fully wired into
`App.jsx` (satisfies the "one entry point" acceptance bar). `LoadingSkeleton` and `Toast`
already exist. `src/components/shared/SourceStatus.jsx` (the banner component) is now
wired into `ImportHub.jsx`'s SnapTrade and Setu AA rows with real status calls — see
Progress Log above for the endpoints, the not-connected-vs-error handling, and the
button-width fix that came out of it. Still open: Plaid/Gmail status (Plaid isn't in
`ImportHub`'s source list at all; Gmail has no status endpoint), and the full
loading/empty-states audit — both deferred to a session with `npm run dev` available.

---

## Suggested cadence
Backend (P3-2, P3-3) is mechanical and low-risk with tests — do it first and commit often.
P3-5 is the high-risk item; reserve a focused session with the dev server running. P4-2 is
best paired with P3-5 since both touch the frontend structure.
