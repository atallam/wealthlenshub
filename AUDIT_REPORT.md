# WealthLens Hub — Codebase Audit & Remediation Plan

**Audit date:** 2026-07-02
**Scope:** Full codebase — maintainability, CRUD correctness, security, UI/UX
**Status:** Audit only. No code changed. This document is the plan to review before touching code.
**Stack:** Express (ESM) + Supabase (service key) + React 18 / Vite. ~13.4k LOC.

---

## 0. Remediation Applied — Phases 0, 1, 2 (2026-07-02)

**Phase 0 — corruption repair**
- Restored `routes/budget.js`, `routes/cron.js`, `routes/snapshots.js` from the intact git objects (working copy had NUL/UTF-16 corruption). All three are now clean UTF-8.
- The git *index* is still corrupted; run locally once: `del .git\index && git reset` (Windows) to fix `git status`.

**Phase 1 — security**
- **New `lib/guards.js`** — `assertOwnsHolding` / `assertOwnsArtifact`. This is both the IDOR fix and the seed of the Phase 3 service layer.
- **P0-1…P0-5 fixed:** artifact download / list / upload now verify holding ownership (`routes/artifacts.js`); `holdings.js GET /:id/transactions` and the AI `get_transactions` tool now scope by `user_id`.
- **P1-1:** `lib/crypto.js` now throws on startup if `BUDGET_ENCRYPT_KEY` is missing in production (and validates key length).
- **P1-3:** `helmet` + optional `cors` allowlist added in `server.js` (CSP left off for now — see note there).
- **P1-5:** Setu webhook now requires a secret unconditionally (`routes/setu.js`).
- **P1-6:** Gmail OAuth `state` is now HMAC-signed with a 10-min TTL (`routes/gmail.js`).

**Phase 2 — CRUD / data hardening**
- `strictLimiter` (30/15min) applied to `artifacts /upload`, `fd /scan`, `kite /sync`, `breeze /sync`.
- **New `migrations/` folder** with an ordered `README.md` and `0009_reconcile_artifacts_and_security.sql` — adds & backfills `artifacts.user_id`, adds FK + index, aligns RLS. Resolves the `database.sql` ↔ `hub_migration.sql` drift.

### ⚠️ Required follow-up on your machine (sandbox can't run these against OneDrive)
1. `npm install` — pulls new deps (`helmet`, `cors`) and applies the `ws` override.
2. `npm audit fix` — clears the remaining moderate advisories (qs/body-parser/postcss).
3. `npm run build` — confirm the app builds with the new imports.
4. Apply `migrations/0009_reconcile_artifacts_and_security.sql` in Supabase.
5. Set new env vars in your deploy environment (see below).
6. `del .git\index && git reset` to repair the git index.

### New / relevant environment variables
| Var | Purpose | Required |
|---|---|---|
| `BUDGET_ENCRYPT_KEY` | 64-hex AES key; **app now refuses to start in prod without it** | **yes (prod)** |
| `SETU_WEBHOOK_SECRET` | Setu webhook auth (falls back to `CRON_SECRET`) | if using Setu |
| `GMAIL_STATE_SECRET` | HMAC key for OAuth state (falls back to `GMAIL_CLIENT_SECRET`) | optional |
| `CORS_ORIGINS` | comma-separated allowlist; leave unset for same-origin | optional |

**P2 remainder — applied**
- **P2-1:** global API error handler no longer leaks internal messages/stack on 5xx in prod (`server.js`, gated by `IS_PROD`).
- **P2-3:** `kite`/`breeze` sync now call `takeSnapshot()` directly instead of a self-HTTP `fetch` reconstructed from the `Host` header.
- **P2-4:** FD OCR model is now `process.env.FD_MODEL || "claude-sonnet-4-5"` (was the pinned `claude-3-5-sonnet-20241022`).
- **P2-5:** holdings `/import` now returns a `validation` block (invalid row count + sample) instead of log-only; lenient behavior documented in code.

**P1-2 — applied (server-side CAS unlock)**
- `routes/import.js` now resolves the CAS PDF password via `resolveCasPassword()`: prefers a password typed for the request, otherwise decrypts the stored PAN **server-side**. The plaintext PAN no longer travels to the browser.
- `routes/profile.js` `GET /cas-credentials` no longer returns `pan_for_cas_unlock` or plaintext `dob` — only `has_credentials` + masked PAN.
- `src/hooks/useCASImport.js` and `src/hooks/useImport.js` no longer fetch the plaintext PAN; the first upload relies on server-side auto-unlock, and if that fails the user types their PAN (optionally saved encrypted for next time).

### Deferred (not yet applied)
- **P2-6** — ops check only (confirm no secrets in git history, env vars set) — not a code change.

*Note: minor UX change — the CAS password prompt no longer pre-fills the PAN (it can't, since the browser never receives it). In practice the prompt rarely appears now, because the server auto-unlocks with the stored PAN first.*

---

## 1. Executive Summary

The app is functionally rich (multi-source imports: CAS, Kite, Breeze, SnapTrade, Plaid, Gmail; budgeting; tax; AI advisor) and already has good bones: a shared `auth` middleware, Zod validation helpers, field-level AES-256-GCM encryption for PII, and route modularization. Most write endpoints correctly scope to `req.user.id`.

However, there is **one class of high-severity bug that repeats across several endpoints**: because the server talks to Supabase with the **service-role key** (which *bypasses* Row-Level Security), every ownership check must be done manually in code — and a handful of read endpoints skip it. The result is Insecure Direct Object Reference (IDOR): an authenticated user can read another user's documents and transactions by supplying an ID.

The single most important takeaway: **RLS is enabled in your SQL migrations but provides no protection at runtime, because the service key ignores it.** Every finding in §3 flows from that fact.

Severity counts: **5 P0 (IDOR / auth), 6 P1, 6 P2.** Plus maintainability and UX workstreams.

> ⚠️ **Working-copy corruption warning:** `routes/budget.js`, `routes/cron.js`, and `routes/snapshots.js` contain embedded NUL bytes / UTF-16 encoding in this checkout (snapshots.js is ~57% NUL bytes), and `git log` reports `fatal: unknown index entry format`. This is likely OneDrive-sync or git-index corruption of the local copy, not the true repo state. **Verify these three files against GitHub before editing anything** — otherwise a save could commit garbage.

---

## 2. CRUD Matrix (route → table → ownership scoping)

Legend: ✅ scoped to `req.user.id` · ❌ **not scoped (IDOR)** · 🔒 verifies ownership via parent · n/a no user data

| Route | Method(s) | Table | Ownership check |
|---|---|---|---|
| `portfolio.js` | GET/POST | portfolio | ✅ `user_id` |
| `holdings.js` GET `/` | R | holdings | ✅ `user_id` |
| `holdings.js` GET `/:id/transactions` | R | transactions | ❌ **only `holding_id`** |
| `holdings.js` POST `/import`, delete demo | C/U/D | holdings | ✅ `user_id` |
| `transactions.js` GET `/:holdingId` | R | transactions | ✅ `user_id` |
| `transactions.js` POST `/` | C | transactions | 🔒 verifies holding belongs to user |
| `transactions.js` POST `/import` | C | transactions | ✅ maps only user's holdings |
| `artifacts.js` GET `/:holdingId` | R | artifacts | ❌ **no check** |
| `artifacts.js` POST `/upload` | C | artifacts + storage | ❌ **holdingId not verified** |
| `artifacts.js` GET `/download/:id` | R | artifacts + storage | ❌ **no check — signed URL to anyone** |
| `artifacts.js` DELETE `/:id` | D | artifacts | ✅ 🔒 verifies holding owner |
| `ai.js` tool `get_transactions` | R | transactions | ❌ **only `holding_id`** |
| `ai.js` other tools | R | holdings/portfolio | ✅ `user_id` |
| `profile.js` all | R/U | profiles | ✅ `id` |
| `budget.js` txns/statements/categories | CRUD | budget_* | ✅ `user_id` |
| `shares.js` | CRUD | portfolio_shares | ✅ `owner_id`/`shared_with` |
| `kite/breeze/snaptrade/plaid.js` | CRUD | *_connections, holdings | ✅ `user_id` |
| `gmail.js` GET `/callback` | — | profiles | ⚠️ state param unsigned (see P1) |
| `setu.js` POST `/webhook` | U | setu_consents | ⚠️ open if `CRON_SECRET` unset |
| `cron.js` | R/U | holdings (all users) | 🔒 `x-cron-secret` header |
| `snapshots.js` | CRUD | net_worth_snapshots | ✅ `user_id` |
| `fd.js` POST `/scan` | — (OCR) | none | ✅ auth-gated |
| `tax.js` GET `/gains` | R | holdings/transactions | ✅ `user_id` |

**Also flagged:** `artifacts` table schema drift — `database.sql` defines it *without* `user_id`; `hub_migration.sql` defines it *with* `user_id NOT NULL`. The upload route never sets `user_id`. Depending on which migration is live, uploads either silently lack an owner column or would violate NOT NULL. Reconcile before adding the ownership fix.

---

## 3. Security Findings

### P0 — Insecure Direct Object Reference (fix all before any public use)

**P0-1 · Artifact download leaks any user's files** — `routes/artifacts.js` `GET /download/:id` (L69–80).
Fetches the artifact row by `id` and returns a 300s signed storage URL with **no ownership check**. Any logged-in user can enumerate `art_*` IDs and download other users' financial statements/CAS PDFs.
*Fix:* join to `holdings` and verify `holdings.user_id === req.user.id` (mirror the DELETE handler at L82–95, which does this correctly).

**P0-2 · Artifact listing not scoped** — `routes/artifacts.js` `GET /:holdingId` (L26–33).
Returns all artifacts for any `holdingId` with no check that the holding belongs to the caller.
*Fix:* verify holding ownership first.

**P0-3 · Artifact upload to arbitrary holding** — `routes/artifacts.js` `POST /upload` (L36–67).
`holdingId` from the body is trusted; a user can attach files to another user's holding and (with P0-1) create a cross-tenant read/write channel.
*Fix:* verify holding ownership; set `user_id` on insert.

**P0-4 · Holding transactions read not scoped** — `routes/holdings.js` `GET /:id/transactions` (L74–82).
Filters by `holding_id` only. IDOR on another user's full transaction history.
*Fix:* add `.eq("user_id", req.user.id)` (the `transactions` table has a `user_id` column, used elsewhere).

**P0-5 · AI advisor tool reads unscoped transactions** — `routes/ai.js` `execTool → get_transactions` (L190–198).
Queries `transactions` by `holding_id` alone. A user can prompt the advisor with someone else's `holding_id` and exfiltrate their transactions through the model.
*Fix:* verify the holding belongs to `userId` before returning, or filter `transactions` by both `holding_id` and `user_id`.

> **Root cause for all five:** `lib/db.js` creates the client with `SUPABASE_SERVICE_KEY`, which bypasses RLS. The `CREATE POLICY … auth.uid() = user_id` statements in your migrations therefore **do nothing at runtime**. Manual checks are the only enforcement. Recommendation: add a tiny `assertOwnsHolding(userId, holdingId)` helper and call it in every route that takes an object ID from the client.

### P1 — High

**P1-1 · Ephemeral encryption key silently used** — `lib/crypto.js` (L5–13).
If `BUDGET_ENCRYPT_KEY` is unset, a random key is generated per process and only a `console.warn` is emitted. In production this means all PANs, DOBs, broker tokens and budget descriptions become **permanently undecryptable after any restart/redeploy**, with no hard failure.
*Fix:* throw on startup when `IS_PROD && !BUDGET_ENCRYPT_KEY`.

**P1-2 · Plaintext PAN returned to client** — `routes/profile.js` `GET /cas-credentials` (L~33–43) returns `pan_for_cas_unlock` (full decrypted PAN). It's auth-scoped, but shipping full PII to the browser widens the attack surface (XSS, logs, browser cache).
*Fix:* perform CAS PDF unlock server-side so the raw PAN never leaves the backend; return only a masked value to the client.

**P1-3 · No security headers / CORS policy** — `server.js`. No `helmet`, no explicit CORS, no HSTS/CSP. XSS and clickjacking surface is wide open for a finance app.
*Fix:* add `helmet` with a CSP, and an explicit CORS allowlist.

**P1-4 · Dependency vulnerabilities** — `npm audit`: **9 vulns (3 high, 5 moderate, 1 low)**. High: `ws` (uninitialized memory disclosure + DoS). Moderate: `express`/`body-parser`/`qs` (DoS), `postcss` (XSS).
*Fix:* `npm audit fix`; re-run and pin.

**P1-5 · Setu webhook open when secret unset** — `routes/setu.js` `POST /webhook` (L128–135). Auth is `if (process.env.CRON_SECRET && …)` — if `CRON_SECRET` is not configured, the webhook accepts unauthenticated consent-status writes.
*Fix:* require the secret unconditionally; reject if unconfigured.

**P1-6 · Gmail OAuth `state` is unsigned** — `routes/gmail.js` (L~189, callback L194). `state` is base64 JSON of `{userId}` with no signature/nonce. The callback trusts `userId` from `state`, so a forged `state` could bind a Gmail account to an arbitrary user id (CSRF-style).
*Fix:* sign `state` (HMAC) or store a server-side nonce mapped to the session.

### P2 — Medium

- **P2-1** Global error handler logs `err.stack` and echoes messages (`server.js`); in prod, ensure stacks aren't leaked to clients (currently gated by `IS_PROD` in `sendError` but the global handler is separate) — align both.
- **P2-2** Heavy endpoints (uploads, broker `/sync`, AI) rely only on the 200-req/15min global limiter. Apply `strictLimiter` (already defined) to uploads and sync.
- **P2-3** Internal fire-and-forget `fetch` to `/api/snapshots` in `kite.js`/`breeze.js` re-sends the user's bearer token to `req.get("host")` — fragile and reconstructs base URL from a client-controlled `Host` header. Prefer calling `takeSnapshot()` directly (as `cron.js` does).
- **P2-4** `fd.js` pins `claude-3-5-sonnet-20241022`; no allow-list, and OCR runs on any auth'd upload with only a 15MB multer cap — cost/DoS vector. Add per-user rate limiting and a current model.
- **P2-5** `holdings.js POST /import` validates rows but **does not reject invalid ones** (logs only). Malformed parser output can persist. Decide on strict vs. lenient and document it.
- **P2-6** `.env` is empty in the repo (good, and git-ignored), but confirm no secrets ever landed in history and that `SUPABASE_SERVICE_KEY`/`ANTHROPIC_KEY`/`CRON_SECRET` are set in the deploy env.

---

## 4. Maintainability

**Current strengths:** hooks are extracted (`usePortfolio`, `useBudget`, …), routes are modular, Zod schemas exist, a shared `api()` client attaches the JWT.

**Problems:**

1. **`App.jsx` is a God component** — 1,126 lines, **56 `useState`** calls in one component. This is the biggest single maintainability and performance liability (see §6 re-render impact).
2. **No data/service layer** — routes call `supabase.from(...)` inline everywhere, so ownership checks, encryption, and shaping are duplicated and easy to forget (exactly how the P0 IDORs happened).
3. **Duplicated business logic** — FIFO LTCG/STCG gains are implemented twice (`routes/tax.js` and `routes/ai.js`); broker sync (`kite`/`breeze`/`snaptrade`) repeats the same fetch→map→upsert→snapshot pattern.
4. **Migration sprawl & schema drift** — 8 loose `.sql` files with overlapping/contradasting statements (RLS enabled in `hub_migration.sql` / `security_migration.sql` but *disabled* in `database.sql` and `budget_migration.sql`; `artifacts.user_id` present in one, absent in another). No ordering or "applied" tracking.
5. **No lint / format / tests** — no ESLint, Prettier, or a single test. No CI gate.
6. **Working-copy encoding corruption** in three route files (see banner in §1).

---

## 5. Deep-Restructure Target Architecture (as requested)

Goal: introduce a **service layer** between routes and Supabase, and reorganize the frontend by feature. Proposed layout:

```
/db
  client.js            # supabase service client (unchanged)
  guards.js            # assertOwnsHolding(userId,id), assertOwnsArtifact(...)  ← kills IDOR class
/services              # ALL Supabase access lives here; routes never touch supabase directly
  holdings.service.js
  transactions.service.js
  artifacts.service.js
  portfolio.service.js
  budget.service.js
  brokers/
    kite.adapter.js    # fetch+map only; shared sync() runner
    breeze.adapter.js
    snaptrade.adapter.js
  tax.service.js       # single FIFO gains impl, imported by tax route AND ai tool
/routes                # thin: parse → validate → call service → respond
/lib                   # crypto, validate, prices (unchanged)
```

Frontend (feature folders instead of tab/shared/modal split):
```
/src/features/{overview,holdings,goals,budget,tax,advisor,members,calendar}/
   <Feature>Tab.jsx  +  use<Feature>.js  +  components/
/src/shared/          # Overlay, Toast, DonutChart, FmtInput, api client
/src/app/App.jsx      # shell + routing only; lift the 56 states into feature hooks/context
```

**Migration path (safe, incremental):**
1. Add `db/guards.js` and wire it into the 5 IDOR routes **first** (this is a security fix that also seeds the service layer).
2. Extract one service at a time (`artifacts`, then `holdings`, then brokers), moving the inline queries with no behavior change.
3. Consolidate the FIFO tax logic into `services/tax.service.js`; delete the duplicate.
4. Consolidate migrations into an ordered `/migrations` folder (or adopt Supabase CLI migrations) and write a single canonical schema; resolve the RLS + `artifacts.user_id` drift.
5. Split `App.jsx` by lifting each tab's state into its feature hook; App becomes a shell.
6. Add ESLint + Prettier + a minimal Vitest/Supertest suite; gate in CI.

Tooling-only items (ESLint, Prettier, tests, migrations folder) can also be done independently and early — they're low-risk and make the restructure safer.

---

## 6. UI/UX Recommendations

1. **Accessibility is near-absent.** Only `AdvisorTab` uses any `aria-*`/`role`. Modals (`Overlay`, import modals, `FDScanSheet`) need focus trapping, `role="dialog"`, `aria-modal`, Esc-to-close, and focus return. Interactive icons need labels. This is both a usability and (for a finance tool) a compliance concern.
2. **Performance from state centralization.** 56 states in `App.jsx` means most interactions re-render the whole tree. Lifting state into feature hooks/context (see §5) will make tab switches and inputs feel snappier.
3. **Fragmented import experience.** Each broker (Kite, Breeze, SnapTrade, CAS, Plaid, Gmail) is a separate modal/component. Unify into one "Connect a source" hub with a consistent connect → authorize → sync → status pattern, and a single reusable status/needs-reauth banner.
4. **Consistent loading & error states.** `LoadingSkeleton` and `Toast` exist — audit every async action to ensure it shows a skeleton and surfaces failures via Toast (several routes throw plain errors the UI may swallow).
5. **Empty/first-run states.** Add guided empty states (e.g., "No holdings yet — import from a broker or add manually") to shorten time-to-value.
6. **Mobile responsiveness.** Single 605-line `styles.css`; verify the 9-tab nav, tables, and modals reflow on narrow screens (bottom-nav or overflow menu on mobile).
7. **Sensitive-data affordances.** With PAN/DOB in play, add explicit masking toggles and a clear indication of what is encrypted, to build user trust.

---

## 7. Prioritized Roadmap

| Phase | Work | Effort |
|---|---|---|
| **0 — now** | Verify/repair the 3 corrupted route files vs. GitHub | S |
| **1 — security** | Fix P0-1…P0-5 via `db/guards.js`; P1-1 fail-fast key; `npm audit fix`; helmet+CORS; setu/gmail auth | M |
| **2 — CRUD/data** | Reconcile `artifacts.user_id` + migration drift; consolidate migrations; strict-limit uploads/sync | M |
| **3 — restructure** | Introduce service layer + guards; dedupe tax/broker logic; split `App.jsx`; ESLint/Prettier/tests | L |
| **4 — UX** | Accessibility pass; unified import hub; loading/empty states; mobile | M |

Recommended: do **Phase 1 as the first code change** — it's small, high-impact, and its `guards.js` helper is the seed of the Phase 3 service layer.

---

*Prepared as an audit-only deliverable. Say the word and I'll start with Phase 0/1.*
