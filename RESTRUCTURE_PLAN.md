# Deep Restructure — Execution Plan (P3-2, P3-3, P3-5, P4-2)

These four items are large and cross-file. Do them **with a running build/test loop**
(`npm run dev` + `npm test`), one commit per numbered step, so each change is
verifiable before the next. Order matters: backend first (P3-2, P3-3), then the
frontend split (P3-5), then the import-hub UX (P4-2).

Prereq: `npm install` (picks up eslint/prettier/vitest added in P3-4), then
confirm the baseline is green: `npm test && npm run build`.

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
