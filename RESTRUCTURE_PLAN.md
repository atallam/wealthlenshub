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

**Deferred / explicitly out of scope for this pass:**
- Setu (`routes/setu.js`, 21 raw queries), SnapTrade (11), Plaid (10), `routes/cron.js` (16) —
  real-money/bank-linked integrations, explicitly held back until either a build/test loop
  exists or this is re-authorized.
- `App.jsx` further restructuring (P3-5) — only the initial `useAuth` hook extraction is done.

**Acceptance check for the above 10 files:** `grep -rn "supabase" routes/notifications.js
routes/push.js routes/tax.js routes/audit.js routes/watchlist.js routes/concall.js
routes/analytics.js routes/import.js routes/import_v2.js routes/ai.js routes/export.js`
→ zero matches. Full-repo `grep -rn "supabase.from" routes/` acceptance bar (line 43) is
**not yet met** — `setu.js`, `snaptrade.js`, `plaid.js`, `cron.js` still have direct calls.

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

## P3-3 — Broker sync consolidation

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

---

## Suggested cadence
Backend (P3-2, P3-3) is mechanical and low-risk with tests — do it first and commit often.
P3-5 is the high-risk item; reserve a focused session with the dev server running. P4-2 is
best paired with P3-5 since both touch the frontend structure.
