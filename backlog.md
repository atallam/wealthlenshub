# WealthLens Hub — Production Backlog

_Last updated: 2026-09-18_

---

## ✅ Already Fixed (pre-Sep 2026)

| Item | File(s) |
|------|---------|
| AMFI NAV 8-field format (parse `parts[parts.length-2]` for NAV) | `lib/prices.js` |
| PAN masking — `casCredentials()` returns only `{pan_masked, has_credentials}` | `services/profile.service.js` |

---

## P0 — Critical / Deploy-blocking

### P0-1 · Parallelize ISIN resolution in CAS import
**File:** `routes/import.js`  
**Problem:** Serial `for` loop with `await setTimeout(2000)` between each demat holding — 10 stocks = 20+ sec, any CAS with 50+ stocks times out Render (30 s limit).  
**Fix:** Replace serial loop with `pLimit(8)` parallel batches + 25 s hard deadline. Import `resolveIsinSymbol` from `lib/prices.js` and `pLimit` from `lib/refresh.js`.  
**Status:** ✅ Fixed Sep 18 2026

### P0-2 · Add `/health` endpoint + fix render.yaml healthCheckPath
**Files:** `server.js`, `render.yaml`  
**Problem:** `healthCheckPath: /` causes Render to treat HTML SPA as health signal — a deploy regression can go undetected.  
**Fix:** Add `GET /health → { ok: true, ts: Date.now() }` before static middleware; update `healthCheckPath: /health`.  
**Status:** ✅ Fixed Sep 18 2026

---

## P1 — High priority (UX / correctness)

### P1-1 · Gmail check-now: fire-and-forget + job polling
**File:** `routes/gmail.js`  
**Problem:** `POST /check-now` awaits `autoImportCASForUser()` synchronously — PDF fetch + casparser can take 2–5 min, well beyond Render's 30 s timeout.  
**Fix:** Return `{ started: true, job_id }` immediately; run import in background; add `GET /gmail/job/:id` for polling.  
**Status:** ✅ Fixed Sep 18 2026

### P1-2 · Flush-and-fill destructive UX warning in CAS Import modal
**File:** `src/components/modals/CASImportModal.jsx`  
**Problem:** The replace-count warning was buried in a yellow generic warning box — users didn't realize all existing CAS holdings would be wiped and re-added.  
**Fix:** Split warnings: generic yellow box + distinct orange "🔄 Full Replace — CAS Source" box showing the replace count, with explanation text.  
**Status:** ✅ Fixed Sep 18 2026

---

## P2 — Nice-to-have / low risk

### P2-1 · CSP headers
**File:** `server.js`  
**Problem:** Helmet CSP is disabled (`contentSecurityPolicy: false`) to avoid breaking Vite SPA. No content security policy in production.  
**Fix:** Audit exact asset origins (CDN, Supabase, Yahoo Finance APIs) and enable CSP with a tight allowlist.  
**Effort:** Medium — needs SPA asset audit first.

### P2-2 · pLimit from lib/refresh.js — extract to shared util
**Files:** `lib/refresh.js`, `routes/import.js`  
**Problem:** `pLimit` is defined inside `lib/refresh.js` for the nightly price cron; `import.js` borrows it by named export. Semantically it belongs in a shared `lib/utils.js`.  
**Fix:** Move `pLimit` to `lib/utils.js`, update all import sites.  
**Effort:** Low — pure refactor, no logic change.

### P2-3 · gmail job store: persistent / Redis-backed
**File:** `routes/gmail.js`  
**Problem:** `pendingJobs` is an in-process `Map` — lost on server restart, not shared across Render instances.  
**Fix:** Store job state in Supabase (a `gmail_jobs` table) or Redis. Add TTL cleanup.  
**Effort:** Medium.

### P2-4 · CAS import — surface `statement_date` and `depository` in done screen
**File:** `src/components/modals/CASImportModal.jsx`  
**Problem:** After import completes the "done" screen shows only a generic success message; the parsed statement date and depository name are available but not shown.  
**Fix:** Display `casDepository` and `casStatementDate` in the done step.  
**Effort:** Low.

### P2-5 · GitHub Actions cron — add error alerting
**File:** `.github/workflows/scheduled-jobs.yml`  
**Problem:** Cron runs silently fail with no notification unless the user watches GitHub Actions.  
**Fix:** Add `on-failure` step that POSTs to a Slack/email webhook, or enable GitHub Actions email notifications.  
**Effort:** Low.

---

## Known Gaps / Watch Items

- `pendingJobs` Map is in-process — see P2-3 for persistence upgrade path
- No CSP in production — see P2-1
- `pLimit` shared via `lib/refresh.js` export — clean up in P2-2
