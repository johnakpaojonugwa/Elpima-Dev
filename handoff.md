# Handoff: MVP readiness assessment

## 1. Goal

Determine whether the codebase is ready to ship as an MVP and, if not,
identify the smallest set of work that gets it there.

The handoff's conclusion: **not yet, but close on the expensive parts
(auth, observability) and missing on the cheap parts (domain logic,
staging environment, basic ops hooks).** Specific guidance for three
plausible MVP scenarios (manual-first-customer, public launch, pilot)
is in section 6.

## 2. Current state

**Master HEAD:** `77c078d` (1 commit ahead of where the prior handoff
landed). Working tree clean.

| # | Commit | Status |
|---|---|---|
| 1 | `feat(auth): short-circuit requireOrgType when JWT carries organization_type` | ✅ `23f271e` |
| 2 | `chore(env): move .env loading out of src/config/env.js to entry points` | ✅ `629dac4` |
| 3 | `feat(auth): optional SUPABASE_JWT_AUDIENCE check` | ✅ `4593307` |
| 4 | `feat(rate-limit): tighter 30/15min limit on /auth/me` | ✅ `aabd77f` |
| 5 | `feat(observability): correlation IDs in access logs and error responses` | ✅ `64c3dae` |
| 6 | `feat(auth): optional JWKS / RS256 verification` | ✅ `daf98b0` |
| 7 | `fix(auth, logging): preserve JWT error class and render access log fields in dev` | ✅ `77c078d` |

**Test suite:** 34/34 unit tests pass. No integration tests, no
coverage thresholds, no CI workflow.

**What the codebase actually is:** an auth + plumbing skeleton.

- `src/routes/` ships two routers: `/health` and `/auth` (which only
  exposes `/me`).
- `src/routes/index.js` has commented-out placeholders for
  `organizations`, `products`, `quotes` — none of them exist.
- `src/models/` is **empty**.
- There is no `Dockerfile`, no `docker-compose.yml`, no CI workflow,
  no staging environment.
- `src/docs/production-readiness.md` enumerates a 7-item pre-deploy
  checklist; **none of the 7 items are satisfied**.

**What's working well:** the auth middleware, the correlation-ID
plumbing, the structured error envelope, the env validation, and the
test patterns for env-conditional modules. These are the parts that
get expensive to retrofit, and they're done.

## 3. Active files

Files touched across the seven-commit series. Anything outside this
list is unmodified.

**Source**
- `src/middlewares/auth.js` — `requireAuth`, `requireRole`,
  `requireOrgType`, `verifySupabaseJwt` (HS256 + optional JWKS/RS256).
  Branch on `env.SUPABASE_JWKS_URL`. Async after commit 6.
- `src/middlewares/correlationId.js` — mints/validates
  `X-Request-Id`, sets response header.
- `src/middlewares/errorHandler.js` — `classifyError` by name,
  `errorHandler` reads `req.correlationId`.
- `src/middlewares/rateLimitAuth.js` — 30/15min on `/auth/me`.
- `src/utils/logger.js` — winston logger + morgan stream (parses
  JSON access log line). Dev `printf` now renders the access-log
  fields (commit 7).
- `src/app.js` — mounts `correlationId` before morgan, custom
  `jsonAccessLog` format.
- `src/config/env.js` — zod-validated env, including
  `SUPABASE_JWT_AUDIENCE` and `SUPABASE_JWKS_URL`. Side-effect-free
  import; `.env` loading is the entry point's job.
- `src/routes/auth.route.js` — `/me` mounted with
  `authRateLimit, requireAuth`.
- `server.js` — entry point, loads `.env`, owns graceful shutdown.

**Tests**
- `test/middlewares/auth.test.js` — 19 cases: HS256 round-trip,
  audience enforcement, JWT claim short-circuit, JWKS RS256
  round-trip, algorithm pinning, JWKS error translation.
- `test/middlewares/correlationId.test.js` — 6 cases covering
  mint/echo, log-injection guard, oversize, boundary.
- `test/middlewares/rateLimitAuth.test.js` — 2 cases: 30× 200, 31st
  is 429 with `Retry-After`.
- `test/fixtures/rsaKeypair.js` — node:crypto keypair + RS256 signer.
- `test/setup.js` — seeds `SUPABASE_JWT_SECRET`, strips
  `SUPABASE_JWT_AUDIENCE` and `SUPABASE_JWKS_URL`, Windows-safe
  `.env` path.

**Docs**
- `src/docs/production-readiness.md` — official pre-deploy checklist.
  Reference only; items are mostly unsatisfied.
- `src/docs/compliance-standards.md` — PHI/PII rules referenced by
  CLAUDE.md.
- `src/docs/service-development.md` — coding/testing patterns.
- `src/docs/agents-integration.md` — handoff to other agents.

## 4. Changes made

This section summarizes the seven commits. The commit messages
themselves are the source of truth for the *why*; this is a guide to
the *what*.

### 4.1 — `feat(auth): short-circuit requireOrgType when JWT carries organization_type` (`23f271e`)

- `requireAuth` now surfaces `payload.organization_type` on
  `req.user.organizationType`.
- `requireOrgType` uses the claim when present (skipping the
  `prisma.organization.findUnique` round-trip) and falls back to the
  DB lookup when the claim is absent. Forward-compatible with the
  Supabase-side hook change (out of scope, see 6).
- 5 new tests. Suite 19/19.

### 4.2 — `chore(env): move .env loading out of src/config/env.js to entry points` (`629dac4`)

- `env.js` no longer imports `dotenv/config`. Entry points
  (`server.js`, `test/setup.js`) own `.env` loading.
- Fixes a Windows-specific bug in `test/setup.js`:
  `new URL("../.env", import.meta.url).pathname` returns
  `/C:/path/.env` on Windows; `fileURLToPath` normalizes to
  `C:\path\.env`.
- This was a precondition for the audience and JWKS tests, which
  need `vi.resetModules()` to be a no-op for env loading.

### 4.3 — `feat(auth): optional SUPABASE_JWT_AUDIENCE check` (`4593307`)

- New `SUPABASE_JWT_AUDIENCE` env var. When set, jsonwebtoken
  enforces the `aud` claim. Fail-closed: tokens with no `aud` are
  rejected.
- 3 new tests (matching aud / wrong aud / missing aud). Suite 22/22.

### 4.4 — `feat(rate-limit): tighter 30/15min limit on /auth/me` (`aabd77f`)

- New `authRateLimit` (30/15min) mounted on `/auth/me` *before*
  `requireAuth` so an attacker can't burn CPU on signature
  verification per probe.
- 2 new tests (drives a real Express app). Suite 24/24.

### 4.5 — `feat(observability): correlation IDs in access logs and error responses` (`64c3dae`)

- New `correlationId` middleware: mints a UUID, or echoes a valid
  `X-Request-Id` (allow-list `^[A-Za-z0-9._-]{1,128}$`), or
  silently re-mints on log-injection attempts.
- `morganStream.write` now `JSON.parse`s the access log line and
  forwards structured fields to winston. Wrapped in try/catch for
  forward compatibility.
- `errorHandler` reads `req.correlationId` instead of minting a
  per-error UUID, so the access log line and the error log line
  for the same request share the same ID.
- 6 new tests. Suite 30/30.

### 4.6 — `feat(auth): optional JWKS / RS256 verification` (`daf98b0`)

- New `SUPABASE_JWKS_URL` env var. When set, `verifySupabaseJwt`
  fetches signing keys from JWKS by `kid` and verifies with
  RS256. When unset, the legacy HS256 + shared-secret path runs
  unchanged.
- JWKS lookup failures (e.g. "No matching key") are translated to
  `JsonWebTokenError` at the auth boundary so the global
  `errorHandler` classifies them as 401 instead of 500.
- `verifySupabaseJwt` is now async; `requireAuth` was already
  express-5 async-safe, so its call site picks up the await with
  no further changes.
- New `test/fixtures/rsaKeypair.js` (node:crypto keypair + RS256
  signer).
- 4 new tests. Suite 34/34.

### 4.7 — `fix(auth, logging): preserve JWT error class and render access log fields in dev` (`77c078d`)

Two follow-ups from the code review of 4.1–4.6:

- `requireAuth`'s catch was empty (`catch {}`), so every JWT
  failure was downgraded to `AppError(401, "Authentication
  required")` and `err.name` was lost. `errorHandler.classifyError`
  uses `err.name` to pick "Session expired" for
  `TokenExpiredError`. Now: `catch (err) { return next(err); }`.
  Verified end-to-end: expired token now produces
  `401 { error: { message: "Session expired" } }`.
- Dev `winston` `printf` was destructuring only `{ level, message,
  timestamp, stack }`, dropping the access-log fields. Correlation
  IDs were invisible in dev. Now: destructures the access-log
  fields and renders them when present, gated on
  `correlationId && method` so non-access-log lines render
  unchanged. Prod's `json()` formatter is untouched.
- Suite 34/34, no regressions.

## 5. Failed attempts

Three things tried during this round that didn't land as originally
planned, plus one stale concern to retire.

### 5.1 — Bash here-doc with backticks broke the commit

The first attempt to write the commit message for 4.7 used
PowerShell-style `git commit -m @'...'@`, but the shell that ran
the tool was Git Bash, which expanded backticks in the body as
command substitutions. Output: `error: pathspec 'formatter' did
not match any file(s) known to git` and several `command not
found` errors for tokens inside the message body.

**Resolution:** switched to `git commit -F -` reading a
`<<'COMMIT_MSG' ... COMMIT_MSG` heredoc with a *quoted* delimiter,
which suppresses expansion. The staged state survived the failed
commit, so no rework was needed; the second attempt landed
cleanly.

**Takeaway for next time:** on Windows, prefer `git commit -F -`
with a quoted heredoc, or write the message to a temp file with
`Write` and `git commit -F <file>`. Don't try to inline multi-line
commit messages with shell-special characters in tool calls.

### 5.2 — `node -e` smoke tests need a project cwd to resolve `dotenv`

Tried to verify the auth fix with a one-liner
`node -e "import('dotenv/config')..."`. The script lived in
`/tmp` and Node couldn't resolve `dotenv` from outside the project
tree (`ERR_MODULE_NOT_FOUND`).

**Resolution:** moved the test inline as a PowerShell
`node -e` invocation that runs from the project cwd. Worked first
try.

**Takeaway:** anything that imports from the project's
`node_modules` has to run from the project cwd, or from a script
file that lives inside the project tree.

### 5.3 — Live-server smoke test on commit 5 was failing on the access log line

Recorded in the prior handoff (section 4 of the original
`handoff.md`). Investigation found that the dev `winston` `printf`
only renders the message, not the structured fields attached as
the second argument to `logger.info(...)`. The fix landed in
commit 7, so this is now resolved — not a failure, but worth
keeping in the historical record so a future agent doesn't re-litigate
the "dev mode is silent on access log fields" complaint.

### 5.4 — Concerns from the prior handoff that have since been resolved

- **5a (dev-mode log rendering):** resolved by commit 7. Dev now
  renders `info: http_request GET /auth/me 200 42ms [test-123]`.
- **5b (JWKS deploy order):** operational, not a code change.
  Remains out of scope; flagged in the SUPABASE_JWKS_URL env
  schema comment and in the `verifySupabaseJwt` JSDoc. **Action
  required by user**, not by this codebase.
- **5c (rate-limit tuning on `/auth/me`):** no change needed
  per user decision. If real usage shows 30/15min is too tight,
  bump to 60/15min in `src/middlewares/rateLimitAuth.js`.

## 6. Next steps

The handoff's primary conclusion: **the codebase is not yet MVP.**
Specifically, it is an auth + plumbing skeleton. `src/models/` is
empty; the only mounted routes are `/health` and `/auth/me`; there
is no `Dockerfile`, no staging environment, no CI workflow, no
Prometheus metrics, no runbook.

The right next move depends on which MVP scenario you're aiming
for. Three plausible scenarios, with the smallest credible work
for each:

### 6.1 — Scenario A: "Onboard one hospital, build a quote, close the deal."

- **Goal:** one full vertical slice working end-to-end against a
  real Supabase project. No public launch, no marketing, no
  scaling concerns.
- **Estimated work:** 2–3 weeks of focused development, mostly
  domain logic.
- **Required:**
  1. **Pick the slice.** On paper: what does one org, one
     product, one quote, one order look like? Decide the data
     shape and the user flow *before* writing code. 1 day.
  2. **Stand up a staging environment** (Render/Fly/Railway +
     a real Supabase project, separate from any local dev
     project). 1–2 days.
  3. **Write the first business route** — most likely
     `organizations` (so the hospital can register) or
     `products` (so the catalog exists). The `requireOrgType`
     middleware from commit 1 is exactly what this route needs.
     3–5 days.
  4. **Add a deep health check** (`/healthz/ready` that runs
     `SELECT 1` via Prisma). 30 minutes. Lets the staging
     environment detect DB outages.
  5. **Add a `Dockerfile`** (multi-stage, non-root, on
     `node:*-alpine`). 1–2 hours. Unblocks anyone who isn't on
     your laptop.
  6. **Seed script** for one org + one admin user, so the
     first customer can be onboarded manually. 1 day.
- **Defer:** Prometheus, load tests, runbook, JWKS deploy,
  custom access token hook extension, Prisma non-bypassing role,
  integration tests, CI workflow, coverage thresholds.

### 6.2 — Scenario B: "Public launch, real money, real uptime."

- **Goal:** ship a service that's trustworthy enough to charge
  for. Includes the items in `src/docs/production-readiness.md`.
- **Estimated work:** 4–8 weeks including infra and ops.
- **Required:** everything in 6.1, plus:
  7. Every item in `src/docs/production-readiness.md`:
     OpenAPI spec, multi-stage Docker, secret injection via
     Vault/Secrets Manager, load tests with real pooled
     connection latency, `/metrics` for Prometheus with alert
     rules, runbook for pool exhaustion / Supabase Auth outage
     / `pgmq` backlog / Edge Function failures.
  8. CI workflow (lint + test + typecheck on PR; build and
     push image on merge to main).
  9. Separate dev / staging / production Supabase projects. No
     shared data between them.
  10. The Supabase-side items the codebase has been waiting on:
      custom access token hook stamps `organization_type`
      (item 1 of the original handoff), Supabase project
      rotated to issue RS256 + expose JWKS (item 7 of the
      original handoff), and `SUPABASE_JWKS_URL` set in
      production (commit 6 of this round, deploy-order-critical).
  11. Prisma switched to a non-bypassing role for user-facing
      queries (item 2 of the original handoff).
  12. `pgmq`-backed background jobs for any async work
      (email, license verification, etc.). Likely the largest
      single piece of new infrastructure.

### 6.3 — Scenario C: "Show this to a design partner or pilot customer."

- **Goal:** a thin slice that works end-to-end and looks real
  enough to take seriously. A real staging environment, one
  or two business routes, and enough observability to debug
  the first 50 requests.
- **Estimated work:** 1–2 weeks of business logic plus a
  staging deploy.
- **Required:**
  - Items 1, 2, 3, 4, 5 from 6.1.
  - A minimal frontend (or just a Swagger UI on the existing
    OpenAPI stub — `swagger-ui-express` is already in
    `package.json`).
  - The correlation IDs from commit 5 are enough observability
    for the first 50 requests. Prometheus can wait.

### Outstanding out-of-scope items (carried over from the prior handoff)

These are not this round's responsibility, but are the natural
next round once an MVP slice is picked.

- **Item 2:** non-bypassing Prisma role for user-facing queries.
- **Item 6:** integration tests + CI workflow + coverage
  thresholds.
- **Item 1 (Supabase):** extend the custom access token hook to
  stamp `organization_type`. Required for commit 1's fast path
  to actually skip the DB lookup.
- **Item 7 (Supabase):** rotate the Supabase project to issue
  RS256 + expose a JWKS endpoint. **Deploy-order-critical** with
  commit 6 — set `SUPABASE_JWKS_URL` only *after* this lands.
- **5c:** if real usage shows the 30/15min rate limit on
  `/auth/me` is too tight, bump to 60/15min in
  `src/middlewares/rateLimitAuth.js`. One-line change.

### Open question for the user

**Which scenario (A, B, or C) are you aiming for?** The next commit
should be the first item from the corresponding section above.
The fastest path to value is to start with Scenario A's item 1
("pick the slice") before writing any code — the answer shapes
which domain route to build first.
