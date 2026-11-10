# Switching the hardening modes to "enforce"

Two switches ship in a permissive mode so a bad rule cannot break the UI for real users.
Flip each one only after its logs are clean. Both are Render environment variables
(Dashboard -> wealthlens-hub -> Environment); changing one restarts the service.

## 1. `BODY_SCHEMA_MODE` (log -> enforce)
What it does: budget and profile request bodies are validated with zod (`lib/validate.js`).
In `log` mode a body that fails is accepted and a line is written; `enforce` returns 400.
(Unknown keys such as `user_id` are stripped in both modes.)

1. Deploy, then use the app normally for 3-5 days (budget categories/goals/limits, profile, asset types).
2. Render -> Logs, search `[validate]`.
3. No lines -> set `BODY_SCHEMA_MODE=enforce`. Lines -> each one names the field and reason;
   either the schema is too strict (fix `lib/validate.js`) or the UI sends something wrong (fix the UI).
4. After switching, search Logs for `Invalid` and watch for user reports of "can't save".
5. Rollback: set it back to `log`.

## 2. `CSP_MODE` (report-only -> enforce)
What it does: sets the Content-Security-Policy. In `report-only` nothing is blocked; the browser
POSTs each would-be violation to `/csp-report`, which logs `[csp] <directive> blocked=<uri> page=<uri>`.

1. Deploy, then click through every tab and every import path (CAS, tradebook, Setu, SnapTrade,
   Plaid, artifacts view/download, push notifications, install-as-app).
2. Render -> Logs, search `[csp]`.
3. Empty -> set `CSP_MODE=enforce`. Otherwise add the origin to `cspDirectives` in `server.js`
   only if it is legitimate; browser-extension noise (blocked=`chrome-extension://...`, `moz-extension://...`) can be ignored.
4. After switching, open the app once in a private window with DevTools open and check the Console for "Refused to ...".
5. Rollback: set it back to `report-only` (or `off`).

The boot check (`lib/env.js`) prints a warning in production while either switch is still permissive.
