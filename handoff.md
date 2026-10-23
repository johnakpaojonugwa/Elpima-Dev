# Handoff: MVP readiness assessment

## 1. Goal

Determine whether the codebase is ready to ship as an MVP and, if not,
identify the smallest set of work that gets it there.

The handoff's conclusion: **executing Scenario B (public launch).**
The user picked Scenario B from section 6 of the prior handoff and
asked for the full 36-task plan to be built, "in batches, starting
from the first." A plan was committed at `a5bdcf8` (`tasks/plan.md`
+ `tasks/todo.md`). The Domain track is now in flight: T1.1
(organizations validation) and T1.2 (POST /api/v1/organizations)
are landed. T1.3 (GET by id) is next. The Ops track (T0.1–T0.4) is
still untouched and is a parallel concern. The auth,
observability, containerization, and multi-tenant RLS work that was
the bottleneck is unchanged from the prior round and remains done.
Specific guidance for the three scenarios, with Scenario B's
expansion now anchored in the live plan, is in section 6.

## 2. Current state

**Master HEAD:** `abfef78`. Working tree clean. The Scenario B plan
(`tasks/plan.md`, `tasks/todo.md`) is committed at `a5bdcf8`. The
Domain track's first two slices — T1.1 (organizations validation
schemas) and T1.2 (POST /api/v1/organizations) — are landed and
covered by 60/60 passing tests (34 pre-existing unit + 21 orgs
validation unit + 5 organizations POST integration). Integration
tests are skipped when `INTEGRATION_TESTS=skip`; the default
`npm test` exercises them against the live Supabase project.

| # | Commit | Status |
|---|---|---|
| 1 | `feat(auth): short-circuit requireOrgType when JWT carries organization_type` | ✅ `23f271e` |
| 2 | `chore(env): move .env loading out of src/config/env.js to entry points` | ✅ `629dac4` |
| 3 | `feat(auth): optional SUPABASE_JWT_AUDIENCE check` | ✅ `4593307` |
| 4 | `feat(rate-limit): tighter 30/15min limit on /auth/me` | ✅ `aabd77f` |
| 5 | `feat(observability): correlation IDs in access logs and error responses` | ✅ `64c3dae` |
| 6 | `feat(auth): optional JWKS / RS256 verification` | ✅ `daf98b0` |
| 7 | `fix(auth, logging): preserve JWT error class and render access log fields in dev` | ✅ `77c078d` |
| 8 | `chore(deps): add supabase CLI to devDependencies` | ✅ `770bf46` |
| 9 | `chore(supabase): add local stack config` | ✅ `7470cd3` |
| 10 | `chore(docker): add production Dockerfile and .dockerignore` | ✅ `a451d67` |
| 11 | `fix(db): repair public.custom_access_token_hook` | ✅ `14cb50d` (was uncommitted; committed via the "refresh handoff" series) |
| 12 | `feat(db): apply RLS policies + DML grants` | ✅ `11a6158` (was uncommitted; committed via the "refresh handoff" series) |
| 13 | `docs: refresh handoff to include hook fix and RLS patch` | ✅ `28a0a8b` |
| 14 | `docs(planning): add Scenario B implementation plan and todo` | ✅ `a5bdcf8` |
| 15 | `feat(orgs): add organizations validation schemas` (T1.1) | ✅ `629a9a0` |
| 16 | `feat(orgs): POST /api/v1/organizations endpoint` (T1.2) | ✅ `abfef78` |

**Test suite:** 60/60 pass. Composition: 19 auth (HS256 round-trip,
audience, JWKS RS256, claim short-circuit, algorithm pinning, error
translation), 6 correlationId (mint/echo, log-injection guard,
oversize, boundary), 2 rateLimitAuth (30× 200 + 31st 429 with
Retry-After), 21 organizations validation (Create / Update /
IdParam schemas — happy path, trimming, strict, length caps,
type/status immutability on update, UUID format), and 5
organizations POST integration (201 happy path with audit log
assertion, 401 unauthenticated, 403 wrong role, 400 invalid
payload, 409 duplicate email). No coverage thresholds, no CI
workflow yet — both belong to T0.1 in the Ops track.

**What the codebase actually is:** an auth + plumbing skeleton
with containerization, a working local Supabase stack, a fully
multi-tenant RLS layer in the live database, and the first vertical
slice of domain logic (organizations) wired end-to-end.

- `src/routes/` ships two routers: `/health` and `/auth` (which only
  exposes `/me`), and now also mounts the organizations router
  under `/api/v1/organizations` with `requireAuth` +
  `requireRole("PLATFORM_ADMIN")` at the mount site.
- `src/modules/organizations/` is the new domain module: a thin
  Express router, a service that does the writes + audit log, and
  a validation module with three zod schemas. See section 4.15 and
  4.16 for the design notes.
- `src/models/` is **empty**. The first data-access layer lives in
  `src/modules/organizations/service.js` (Prisma calls are inlined
  rather than wrapped in a `models/organization.js` — see the open
  question in section 6 about when to extract that).
- A production `Dockerfile` (multi-stage, non-root, with tini + health
  check) and `.dockerignore` exist (commit 10). There is still no
  `docker-compose.yml`, no CI workflow, no staging environment.
- A local Supabase stack config (`supabase/config.toml`) exists
  (commit 9), wired with `env(...)` placeholders for all secrets and a
  `supabase/.gitignore` excluding CLI runtime state.
- The Supabase CLI is installed as a devDependency (commit 8), so
  `npm run` + `supabase start` works in any clone.
- The live Supabase project has:
  - **19 RLS policies** on the 9 tenant-scoped public tables
    (commit 12). Every authenticated read/write is scoped by
    `current_org_id()`, which reads
    `app_metadata.organization_id` from the JWT.
  - **`public.current_org_id()` helper** (commit 12): `SECURITY
    INVOKER`, `STABLE`, locked `search_path`.
  - **Default DML grants** to `authenticated` on all 9 tenant tables
    (commit 12). Without these, RLS policies are unreachable.
  - **`audit_logs` UPDATE/DELETE revoked** (commit 12). Second line of
    defense; `pg_policy` has no UPDATE/DELETE policy for audit_logs
    either.
  - **Fixed `custom_access_token_hook`** (commit 11). Was referencing
    a non-existent `public.user_organizations` table; now correctly
    reads from `public.users.supabaseUserId`, gates on `isActive =
    true`, and stamps `app_metadata.organization_id` and
    `app_metadata.user_role`.
  - **Seeded `Elpima Platform Admin` org** with id
    `00000000-0000-0000-0000-platformadmin0` (created in the
    previous session). Required for the audit log's FK to
    satisfy the policy: a PLATFORM_ADMIN's audit row has
    `organizationId` = this seeded id, and the FK to
    `organizations.id` needs the row to exist. Without it, every
    PLATFORM_ADMIN-issued audit write would 23503.
- `src/docs/production-readiness.md` enumerates a 7-item pre-deploy
  checklist. **One item is satisfied** (containerization, item 5 in
  section 6.1) — six remain. The RLS work unblocks item 11 (Prisma
  non-bypassing role) — see section 6.

**What's working well:** the auth middleware, the correlation-ID
plumbing, the structured error envelope, the env validation, the
test patterns for env-conditional modules, the production Dockerfile,
the local Supabase stack, the fixed JWT custom hook, the full
multi-tenant RLS layer, and now the first vertical slice of domain
logic (organizations) wired through validation → route → service →
Prisma → audit log. The TDD loop on T1.1–T1.2 surfaced two
architectural decisions that are documented in the commits and
inline comments: (1) `prisma.config.ts` needs `DIRECT_URL` for
migrations because the pooled `DATABASE_URL` cannot hold an
interactive transaction; (2) the organizations service uses
sequential writes (not `$transaction`) for the same reason —
the full analysis is in `src/modules/organizations/service.js`.

**What's working well:** the auth middleware, the correlation-ID
plumbing, the structured error envelope, the env validation, the
test patterns for env-conditional modules, the production Dockerfile,
the local Supabase stack, the fixed JWT custom hook, and the full
multi-tenant RLS layer. These are the parts that get expensive to
retrofit, and they're done.

## 3. Active files

Files touched across the sixteen committed changes. Anything outside
this list is unmodified.

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
- `src/utils/AppError.js` — domain error with HTTP status; used by
  the organizations service to map P2002 → 409.
- `src/app.js` — mounts `correlationId` before morgan, custom
  `jsonAccessLog` format.
- `src/config/env.js` — zod-validated env, including
  `SUPABASE_JWT_AUDIENCE`, `SUPABASE_JWKS_URL`, and **`DIRECT_URL`**
  (required for Prisma migrations; the pooled `DATABASE_URL`
  remains the API connection). Side-effect-free import; `.env`
  loading is the entry point's job.
- `src/config/prisma.js` — single pooled `PrismaClient` (uses
  `PrismaPg` adapter against `DATABASE_URL`).
- `src/config/supabase.js` — Supabase client factory.
- `src/routes/auth.route.js` — `/me` mounted with
  `authRateLimit, requireAuth`.
- `src/routes/health.route.js` — uptime probe.
- `src/routes/index.js` — mounts `/health`, `/auth`, and (as of
  commit 16) `/api/v1/organizations` with
  `requireAuth, requireRole("PLATFORM_ADMIN"), organizationsRouter`.
  The role gate lives at the mount site, not inside the module, so
  every route in the module inherits it without per-handler
  re-checks.
- `src/modules/organizations/validation.js` (T1.1) — three zod
  schemas: `CreateOrganizationSchema`, `UpdateOrganizationSchema`,
  `OrganizationIdParamSchema`. `.strict()` rejects unknown keys;
  `type` and `status` are immutable on update; empty string
  optionals normalize to `undefined`.
- `src/modules/organizations/service.js` (T1.2) — `createOrganization`
  does three sequential Prisma writes (org → user → audit log)
  rather than a `$transaction`, because pgBouncer in transaction
  mode cannot hold an interactive transaction. P2002 is mapped to
  `AppError(409)`. Full analysis in the module header.
- `src/modules/organizations/route.js` (T1.2) — thin POST handler:
  parse, call service, return 201. The service owns the audit
  contract.
- `server.js` — entry point, loads `.env`, owns graceful shutdown.

**Build / infra (committed across the round)**
- `Dockerfile` — multi-stage, `node:22-bookworm` builder, `node:22-bookworm-slim`
  production stage, runs as `node` (UID 1000), tini as PID 1,
  `HEALTHCHECK` on `/health` every 30s, `EXPOSE 3000`.
  No secrets in the image; runtime config via env. `prisma generate`
  runs in the builder; `npm prune --omit=dev` shrinks the final
  layer; Prisma migrations are deliberately NOT copied (applied
  out-of-band).
- `.dockerignore` — excludes `node_modules`, `.env*`, `.git`, IDE
  dirs, test/coverage artifacts, the Dockerfile itself, Prisma
  migrations, `.claude` tooling, `*.md` docs.
- `supabase/config.toml` — local Supabase stack config (Postgres,
  GoTrue, PostgREST, Studio). API on 54321; standard auth/studio/
  storage ports; all secrets wired as `env(...)` placeholders.
- `supabase/.gitignore` — excludes CLI runtime state (`.branches`,
  `.temp`, `pgdelta`).
- `prisma.config.ts` — Prisma 7 config; uses `DIRECT_URL` for
  migrations (the pooled `DATABASE_URL` is for the running app).
  Required because pgBouncer in transaction mode cannot hold an
  interactive transaction. `env.js` now makes `DIRECT_URL`
  mandatory.
- `package.json` — adds `supabase@^2.109.1` as a devDependency
  (commit 8) and `supertest@^7.2.2` as a devDependency (commit
  16) for the organizations integration tests.

**Tests**
- `test/middlewares/auth.test.js` — 19 cases: HS256 round-trip,
  audience enforcement, JWT claim short-circuit, JWKS RS256
  round-trip, algorithm pinning, JWKS error translation.
- `test/middlewares/correlationId.test.js` — 6 cases covering
  mint/echo, log-injection guard, oversize, boundary.
- `test/middlewares/rateLimitAuth.test.js` — 2 cases: 30× 200, 31st
  is 429 with `Retry-After`.
- `test/modules/organizations/validation.test.js` (T1.1) — 21 cases
  covering the three zod schemas: happy path with default status,
  trim, partial update, type/status immutability on update, UUID
  format, strict-mode rejection of extra keys, length caps.
- `test/integration/organizations.post.test.js` (T1.2) — 5 cases
  that boot the real Express app and exercise the route against
  the live Supabase project: 201 happy path with full response
  shape and audit-log assertion, 401 unauthenticated, 403 ORG_ADMIN
  caller, 400 invalid payload, 409 duplicate email. Skipped when
  `INTEGRATION_TESTS=skip`; default `npm test` runs them. 60s
  per-test ceiling reflects live-DB latency, not a code smell.
- `test/fixtures/rsaKeypair.js` — node:crypto keypair + RS256 signer.
- `test/setup.js` — seeds `SUPABASE_JWT_SECRET`, strips
  `SUPABASE_JWT_AUDIENCE` and `SUPABASE_JWKS_URL`, Windows-safe
  `.env` path.

**Docs**
- `tasks/plan.md` (commit 14) — Scenario B implementation plan:
  36 tasks across Domain (Phases 1–4) and Ops (Phases 0, 5)
  tracks, converging at a Phase 6 launch gate. Two-track
  parallelism is encoded in the task's `addBlocks` /
  `addBlockedBy` graph; only T1.1 → T1.2 → T1.3 → T1.4 → T1.5 is
  a hard dependency chain in Phase 1.
- `tasks/todo.md` (commit 14) — per-task cards: acceptance
  criteria, verification, dependencies, files-likely-touched,
  estimated scope. 756 lines.
- `src/docs/production-readiness.md` — official pre-deploy checklist.
  Reference only; items are mostly unsatisfied.
- `src/docs/compliance-standards.md` — PHI/PII rules referenced by
  CLAUDE.md.
- `src/docs/service-development.md` — coding/testing patterns.
- `src/docs/agents-integration.md` — handoff to other agents.

**Database migrations (new in this round)**
- `prisma/migrations/20260708120000_fix_custom_access_token_hook/migration.sql`
  — rewrites `public.custom_access_token_hook` to look up the
  user's org via `public.users.supabaseUserId` (instead of the
  non-existent `public.user_organizations`), gate on `isActive`,
  and stamp `app_metadata.organization_id` plus
  `app_metadata.user_role`. Locked `search_path`. Idempotent
  (`CREATE OR REPLACE FUNCTION`).
- `prisma/migrations/20260708130000_apply_rls_policies_and_grants/migration.sql`
  — 19 RLS policies across 9 tenant tables, the
  `public.current_org_id()` helper, the DML grants to
  `authenticated`, and the `audit_logs` UPDATE/DELETE revoke. All
  statements idempotent (DROP POLICY IF EXISTS, CREATE OR REPLACE
  FUNCTION, GRANT/REVOKE are all idempotent).

## 4. Changes made

This section summarizes the sixteen committed changes. The commit
messages themselves are the source of truth for the *why*; this is
a guide to the *what*.

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

### 4.8 — `chore(deps): add supabase CLI to devDependencies` (`770bf46`)

- Adds `supabase@^2.109.1` as a devDependency. No runtime impact.
  Lets `npx supabase start` / `db reset` / `migration diff` work in
  any clone without a global install.
- Unblocks commit 9 (which adds config that the CLI consumes) and
  commit 10 (which adds a Dockerfile that benefits from the same
  local workflow).

### 4.9 — `chore(supabase): add local stack config` (`7470cd3`)

- `supabase/config.toml` (414 lines): standard `supabase init` output,
  tuned for this project (project_id, API on 54321, public +
  graphql_public schemas, standard auth/studio/storage ports).
- `supabase/.gitignore`: excludes CLI runtime state (`.branches`,
  `.temp`, `pgdelta`) so transient migration bookkeeping never lands
  in the repo.
- All secrets (`openai_api_key`, `sendgrid`, `twilio`, `s3 keys`, etc.)
  are wired as `env(...)` placeholders. No credentials in VCS.
- The local stack does NOT replace a staging environment — it's a
  dev tool. Production-bound deploys still need a real Supabase
  project (see section 6.2, item 9).

### 4.10 — `chore(docker): add production Dockerfile and .dockerignore` (`a451d67`)

- `Dockerfile` (94 lines): multi-stage build.
  - **Builder:** `node:22-bookworm`. Full dep tree, `prisma generate`
    (requires devDeps), then `npm prune --omit=dev` to shrink the
    final layer.
  - **Production:** `node:22-bookworm-slim` (NOT Alpine — Prisma's
    query engine depends on glibc + OpenSSL 3.x; Alpine's musl causes
    segfaults). Runs as unprivileged `node` user (UID 1000), tini as
    PID 1 for proper SIGTERM forwarding under `docker stop` / k8s.
  - **Healthcheck:** `node -e` one-liner hitting `/health` every 30s.
  - **Port:** `EXPOSE 3000`, configurable via `PORT` env.
- `.dockerignore` (63 lines): excludes `node_modules`, `.env*`, `.git`,
  IDE dirs, test/coverage artifacts, the Dockerfile itself, Prisma
  migrations (applied out-of-band by an orchestrator/init container),
  `.claude` tooling, and `*.md` docs.
- No secrets in the image — runtime configuration is supplied via
  env vars only. This satisfies item 5 of
  `src/docs/production-readiness.md` for the "containerization"
  line, though the larger production-readiness checklist (secrets
  via Vault/Secrets Manager, full observability, runbooks, etc.) is
  still open.

### 4.11 — `docs: refresh MVP handoff assessment` (`f4d55bd`)

- The prior version of this file. Wrote the seven-commit assessment
  that section 4 above has been extended from.

### 4.12 — `fix(db): repair public.custom_access_token_hook` (`14cb50d`, migration `20260708120000_fix_custom_access_token_hook`)

- The previous version of the hook (deployed via the Supabase
  dashboard template) read from `public.user_organizations`, a table
  that does not exist in this schema. On every JWT mint, the hook
  raised `relation does not exist` and the `organization_id` custom
  claim was never set. Every RLS policy that keyed off
  `auth.jwt() ->> 'organization_id'` silently matched zero rows for
  every authenticated request.
- New hook body: extracts `event ->> 'user_id'` (the Supabase Auth
  user UUID), looks up `public.users.organizationId` and
  `public.users.role` via `public.users.supabaseUserId =
  current_user_id::text AND isActive = true`, and stamps both into
  `claims.app_metadata` via `jsonb_set`.
- **Why `app_metadata`, not the top level:** Supabase strips /
  overwrites top-level reserved claims (`iss`, `aud`, `exp`, `sub`,
  `role`, `iat`, `jti`, `session_id`). Stamping `organization_id` at
  the top level gets silently dropped. `app_metadata` is preserved
  across token refreshes and is the documented place for
  app-defined claims.
- **Why gate on `isActive = true`:** a deactivated staff member
  should not get a valid token. The fail-closed behavior is "no
  org_id stamped → every RLS predicate returns NULL → every
  authenticated request 401s." Pair with a `requireActive` API
  middleware (out of scope this round) to return a friendlier 403
  if desired.
- **Why `SECURITY DEFINER` with locked `search_path`:** the hook
  runs in the auth pipeline before any request reaches the API and
  must read `public.users` regardless of caller context. The
  `search_path = public, pg_catalog` setting prevents search-path
  hijacking from redirecting the function to an attacker's table.
- **Why also stamp `user_role`:** not consumed by the current RLS
  policies, but the existing `requireRole` middleware in
  `src/middlewares/auth.js` would benefit from it on the next
  round (no DB lookup needed). Costs nothing now and avoids a
  second hook rewrite later. Safe to drop if you'd rather keep
  this PR surgical.
- **Verification:**
  - Function metadata: `SECURITY DEFINER`, `STABLE`, `search_path =
    public, pg_catalog`, signature `event jsonb → jsonb`.
  - Synthetic smoke tests (in transactions that rolled back, so
    the live DB is unchanged):
    - Active user with row in `public.users` →
      `app_metadata.organization_id` and `app_metadata.user_role`
      both set.
    - Deactivated user (`isActive = false`) → no claims stamped.
    - Unknown auth user → no claims stamped (fail-closed).
  - All five tenant tables still at 0 rows after the smoke tests.

### 4.13 — `feat(db): apply RLS policies + DML grants` (`11a6158`, migration `20260708130000_apply_rls_policies_and_grants`)

- The committed migration `20260706120000_rls_policies` described
  the intended RLS layout but was never actually applied to the
  live DB: `pg_policy` had zero rows, `public.current_org_id()`
  didn't exist, the `audit_logs` UPDATE/DELETE revoke was missing,
  and the `authenticated` role had no DML grants on any tenant
  table (so any future per-request supabase-js client would have
  been denied at the table-privilege layer before RLS was even
  consulted).
- This migration is a faithful application of the committed intent,
  plus the `users` INSERT/UPDATE policies the committed file lacked
  (a future per-request supabase-js client could not otherwise
  create or edit its own User row).
- **`current_org_id()`** reads from `app_metadata → organization_id`
  (matching the JWT shape the fixed hook produces). This is a
  deliberate divergence from the committed file's
  `auth.jwt() ->> 'organization_id'` path — the latter would have
  returned NULL against the actual JWT shape and made every policy
  match zero rows. If you'd rather keep the committed path and have
  me fix the hook to stamp at the top level instead, say so —
  `app_metadata` is the right place per Supabase's documented
  contract.
- **Policy distribution** (19 policies across 9 tables):
  | Table | SELECT | INSERT | UPDATE | DELETE |
  |---|---|---|---|---|
  | organizations | 1 | — | — | — |
  | users | 1 | 1 | 1 | — |
  | licenses | 1 | — | — | — |
  | products | 1 | 1 | 1 | 1 |
  | categories | 1 | — | — | — |
  | quotes | 1 | 1 | 1 | — |
  | quote_items | 1 | 1 (FOR ALL) | 1 (FOR ALL) | 1 (FOR ALL) |
  | orders | 1 | — | — | — |
  | order_items | 1 | — | — | — |
  | audit_logs | 1 | 1 | — | — |
- **Grants:** `authenticated` has full DML on 9 tenant tables;
  `audit_logs` has SELECT + INSERT only. `_prisma_migrations` keeps
  the pre-existing REFERENCES/TRIGGER/TRUNCATE noise (no DML grant,
  Prisma connects as the owner).
- **`audit_logs` UPDATE/DELETE:** both denied — the bare privilege
  is revoked from `authenticated` AND `PUBLIC`, and no RLS policy
  permits them. Two independent layers of defense.
- **Verification (end-to-end smoke tests, all transactions rolled
  back, live DB unchanged):**
  1. `authenticated` reads `products` → both orgs visible (cross-
     tenant browse is intentionally permissive).
  2. `authenticated` reads `organizations` → only own org visible.
  3. `authenticated` INSERTs product with foreign `vendorId` →
     rejected by RLS WITH CHECK.
  4. `authenticated` UPDATEs foreign-org product → 0 rows changed
     (USING filter).
  5. `authenticated` INSERTs `audit_log` with foreign org → rejected
     by RLS WITH CHECK.
  6. `authenticated` UPDATEs `audit_log` → rejected by REVOKE.
  7. `authenticated` DELETEs `audit_log` → rejected by REVOKE.
  8. `authenticated` with no `organization_id` claim → products
     visible, all four tenant-scoped tables hidden. Fail-closed.

**Net effect:** a complete multi-tenant security story end-to-end.
A signed-in user with a valid `users` row gets a JWT with
`app_metadata.organization_id` set (commit 11). Every table with
tenant data has at least one RLS policy that scopes reads/writes to
that org (commit 12). Cross-tenant writes raise PostgreSQL
exceptions, not silent denials. The audit log is doubly protected.
A user with no org claim (hook misfire, signup race) sees the
public catalog but zero tenant data.

### 4.14 — `docs(planning): add Scenario B implementation plan and todo` (`a5bdcf8`)

The prior handoff ended with an open question — "which scenario
(A, B, or C) are you aiming for?" The user picked **Scenario B
(public launch)** and asked for the full plan to be built, "in
batches, starting from the first." This commit materializes the
plan as two files the build skill consumes:

- `tasks/plan.md` (270 lines): the architecture decisions, the
  phase structure, the checkpoint definition, the risks, the
  open questions. Two parallel tracks:
  - **Domain** (Phases 1–4): organizations → products → license
    verification (PHI) → quotes/orders.
  - **Ops** (Phases 0, 5): CI → env contract → env separation →
    staging → secrets → observability → runbook.
  The two tracks converge at Phase 6 (launch gate).
- `tasks/todo.md` (756 lines): one card per task, with
  acceptance criteria, verification commands, dependency edges,
  files-likely-touched, and estimated scope. The dependency
  graph is encoded in the TaskList tool's `addBlocks` /
  `addBlockedBy` fields, not just prose.

The plan is explicit about one design choice: T1.2's
`createOrganization` was originally specified to use a
`$transaction`. The implementation in 4.16 departs from that
because pgBouncer cannot hold an interactive transaction. The
plan's open questions are tracked separately in section 6 of
this handoff; T5.4 (non-pgBouncer pool) is the right time to
wrap the organizations service back in a real transaction.

### 4.15 — `feat(orgs): add organizations validation schemas` (`629a9a0`, T1.1)

The first domain-track task. Three zod schemas in
`src/modules/organizations/validation.js`, each with a
co-located vitest file:

- `CreateOrganizationSchema`: required `name` (≤ 200), `type`
  (`HOSPITAL | VENDOR`), `email` (RFC-compliant, ≤ 254);
  optional `phone`, `address`, `city`, `state`. `.strict()` to
  reject unknown keys (e.g. an attempt to inject `id` or
  `organizationId`). `.transform()` to force `status =
  PENDING_VERIFICATION` regardless of caller input — the
  service does not trust the client to set a status. Empty
  string optionals normalize to `undefined` so the DB's NULL
  semantics stay predictable.
- `UpdateOrganizationSchema`: every field optional, accepts
  an empty object (no-op is valid). Deliberately excludes
  `type` and `status` — `type` is immutable for a tenant
  (a hospital does not become a vendor), and status
  transitions get their own PLATFORM_ADMIN-only route so
  the audit log row carries the actor's intent. `.strict()`
  on the same reasoning.
- `OrganizationIdParamSchema`: UUID-only path parameter.
  The server never accepts a tenant's slug or a numeric id.

Field-level max lengths (kept in one place so the column types
in `schema.prisma` can be cross-checked): name 200, email 254
(RFC 5321), phone 40, address 500, city 100, state 100. All
strings are trimmed on parse so a frontend that sends
`"  Hospital  "` doesn't end up with leading whitespace in the
unique-email index.

21 unit tests, all green. The route handler in 4.16 calls
`CreateOrganizationSchema.parse(req.body)` and lets the global
`errorHandler` classify the resulting `ZodError` as a 400 with
a sanitized `fieldErrors` map.

### 4.16 — `feat(orgs): POST /api/v1/organizations endpoint` (`abfef78`, T1.2)

Wires the create-org path end-to-end. The route is thin (parse,
call, respond); the service does the work. Three layers:

- `src/modules/organizations/route.js`: `POST /` on
  `organizationsRouter`. Validates the body with
  `CreateOrganizationSchema`, calls
  `createOrganization(prisma, input, actor)`, returns 201 with
  `{ organization, user }`. Errors forward to the global
  `errorHandler` via `next(err)`.
- `src/modules/organizations/service.js`:
  `createOrganization(db, input, actor)`. Three sequential
  Prisma writes: `organization.create` → `user.create` →
  `auditLog.create`. P2002 on the org's email is caught and
  mapped to `AppError(409, "An organization with that email
  already exists")`. Pre-generates the org id, the user id,
  and a placeholder `supabaseUserId` (`pending-<orgId>`) so
  the user row can be created with the right FK in a single
  statement. The placeholder is deterministic so a future
  linking migration can find and update it when the actual
  Supabase auth user is created (invitation / email signup).
- `src/routes/index.js`: mounts the router under
  `/api/v1/organizations` with `requireAuth,
  requireRole("PLATFORM_ADMIN")` at the mount site. The role
  gate is not inside the module so every route in the module
  inherits it without per-handler re-checks.

**Architectural deviation from the plan:** the plan called for
`$transaction`; the implementation is sequential. pgBouncer in
transaction mode cannot hold an interactive transaction, and
even the array form (`db.$transaction([...])`) requires a
server-side BEGIN/COMMIT that times out after the first call
in a given process. The sequential shape accepts a narrow
atomicity loss: if the user write or audit log write fails
after the org write succeeds, an orphaned PENDING org with
no user is the worst-case outcome. The cost is bounded (a
PENDING org with no users and no audit row is a no-op) and
clean-up is straightforward. A future migration to a
non-pgBouncer pool (T5.4) is the right time to wrap this back
in a real transaction. Full analysis is in the service's
module header.

**Audit log semantics:** `organizationId` on the audit row is
the *actor's* tenant context (the platform admin's org), per
the RLS policy on `audit_logs` (`WITH CHECK (organizationId =
current_org_id())`). The new org's id lives in `entityId` and
`metadata.createdOrgId` for traceability. This is the correct
shape for a multi-tenant audit log: it tracks "which tenant's
admin did what", not "which row was created". The actor's
public.users.id is `null` for now — the JWT carries
`sub` (the Supabase auth user id) but not the public.users.id.
A follow-up migration adding `app_metadata.user_id` is the
right fix; documented in the route's actor-passing comment.

**Live-DB dependency:** the integration test mints a synthetic
PLATFORM_ADMIN JWT whose `organization_id` claim matches the
seeded `Elpima Platform Admin` org id
(`00000000-0000-0000-0000-platformadmin0`). Without that
seeded row, the audit log write would 23503 on its FK to
`organizations.id`. The seeding happened in the previous
session; the test file documents the dependency in its
header.

**Integration tests:** 5 cases, all green against the live
Supabase project. The full Express app is booted so the
correlationId → access log → rate limit → router → handler →
errorHandler chain is exercised end-to-end. 60s per-test
ceiling reflects live-DB latency (~4–5s per write) — not a
code smell. The unit suite's 5s default is preserved for the
non-DB tests. Cleanup deletes created orgs; `users` cascade-
deletes via FK; `audit_logs` rows persist by design (the
table's UPDATE/DELETE is revoked). The persisted audit rows
are the cost of testing the audit contract against a
non-disposable DB; T0.4 (staging environment) is the
production fix.

**Test totals after this commit:** 60/60. Composition: 26 auth
+ 6 correlationId + 2 rateLimitAuth + 21 orgs validation + 5
orgs POST integration = 60. (The prior handoff's "34 unit"
count understated the auth suite at 19; it has 26.)

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
- **5d (no Dockerfile):** resolved by commit 10. Multi-stage
  build, non-root user, healthcheck, tini PID 1. Production
  readiness item 5 is now satisfied for the containerization line.
- **5e (no local Supabase stack):** resolved by commits 8 and 9.
  `supabase start` works in any clone.
- **5f (custom_access_token_hook references non-existent table):**
  resolved by commit 12. The hook now reads from `public.users`,
  gates on `isActive = true`, and stamps
  `app_metadata.organization_id` and `app_metadata.user_role`.
  End-to-end smoke tests confirm an active user gets a real org
  claim and a deactivated/unknown user gets none (fail-closed).
- **5g (RLS policies never applied to the live DB):** resolved by
  commit 13. 19 policies, the `current_org_id()` helper, the DML
  grants, and the audit-log UPDATE/DELETE revoke are all in
  place. 8 end-to-end smoke tests pass with the live DB
  unchanged.

### 5.5 — Smoke-test findings that aren't failures but are worth flagging

Two real things the smoke tests surfaced that the live codebase
hasn't addressed:

- **`updatedAt` is `NOT NULL` with no SQL DEFAULT** on
  `organizations`, `users`, and `products`. Prisma's `@updatedAt`
  model attribute writes the value from the client, which works
  for Prisma-mediated writes but breaks raw SQL inserts (each of
  my smoke tests had to supply `now()` explicitly). If you ever
  expose a path that writes via raw SQL or supabase-js, those
  inserts will 23502. A follow-up migration adding
  `DEFAULT CURRENT_TIMESTAMP` to the three columns would close
  this; so would documenting the constraint on the model.
- **The committed migration `20260706120000_rls_policies` is now
  functionally superseded by `20260708130000_apply_rls_policies_and_grants`.**
  Same intent, but the latter reads from
  `app_metadata → organization_id` (matching the actual JWT shape
  produced by the fixed hook) and adds the `users` INSERT/UPDATE
  policies. Worth deleting the committed file in a follow-up
  commit so a future `prisma migrate deploy` doesn't try to apply
  the wrong version (or apply the same content twice — the
  migration is idempotent, so it's not a bug, just noise).

## 6. Next steps

The handoff's primary conclusion: **the codebase is not yet MVP.**
Domain logic is the dominant remaining gap. The auth/observability/
containerization/multi-tenant-RLS work that was the bottleneck is
now in place; what's missing is the actual product surface (routes
for orgs, products, quotes, orders) and the infrastructure around
it (staging, CI, secrets, metrics, runbook).

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
     project). 1–2 days. The Dockerfile from commit 10 is
     ready to push; what's missing is the hosting target and
     the env-var injection story.
  3. **Write the first business route** — most likely
     `organizations` (so the hospital can register) or
     `products` (so the catalog exists). The `requireOrgType`
     middleware from commit 1 is exactly what this route needs.
     3–5 days.
  4. **Add a deep health check** (`/healthz/ready` that runs
     `SELECT 1` via Prisma). 30 minutes. Lets the staging
     environment detect DB outages. The Dockerfile's
     `HEALTHCHECK` already targets `/health`; `/healthz/ready`
     is a separate, deeper probe.
  5. ~~**Add a `Dockerfile`**~~ — **DONE** (commit 10). Skipped.
  6. **Seed script** for one org + one admin user, so the
     first customer can be onboarded manually. 1 day.
- **Defer:** Prometheus, load tests, runbook, JWKS deploy,
  Prisma non-bypassing role, integration tests, CI workflow,
  coverage thresholds. (The custom access token hook and RLS
  policies are no longer deferred — both shipped in this round.)

### 6.2 — Scenario B: "Public launch, real money, real uptime."

- **Goal:** ship a service that's trustworthy enough to charge
  for. Includes the items in `src/docs/production-readiness.md`.
- **Estimated work:** 4–8 weeks including infra and ops.
- **Required:** everything in 6.1, plus:
  7. Every item in `src/docs/production-readiness.md`:
     OpenAPI spec, ~~multi-stage Docker~~ (done — commit 10),
     secret injection via Vault/Secrets Manager, load tests
     with real pooled connection latency, `/metrics` for
     Prometheus with alert rules, runbook for pool exhaustion /
     Supabase Auth outage / `pgmq` backlog / Edge Function
     failures.
  8. CI workflow (lint + test + typecheck on PR; build and
     push image on merge to main).
  9. Separate dev / staging / production Supabase projects. No
     shared data between them. `supabase/config.toml` (commit
     9) is the dev project's config; staging and prod need
     their own.
  10. The Supabase-side items the codebase has been waiting on:
      ~~custom access token hook stamps `organization_type`~~
      (item 1 of the original handoff — **DONE** in commit 12),
      Supabase project rotated to issue RS256 + expose JWKS
      (item 7 of the original handoff), and `SUPABASE_JWKS_URL`
      set in production (commit 6 of this round, deploy-order-
      critical). The Prisma RLS work is **DONE** in commit 13
      (19 policies applied; DML grants restored; audit log
      revoke in place).
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
  - Items 1, 2, 3, 4, 6 from 6.1 (Dockerfile done — item 5).
  - A minimal frontend (or just a Swagger UI on the existing
    OpenAPI stub — `swagger-ui-express` is already in
    `package.json`).
  - The correlation IDs from commit 5 are enough observability
    for the first 50 requests. Prometheus can wait.

### Outstanding out-of-scope items (carried over from the prior handoff)

These are not this round's responsibility, but are the natural
next round once an MVP slice is picked.

- **Item 2:** non-bypassing Prisma role for user-facing queries.
  RLS is now live (commit 13) and the policies will work the
  moment the Prisma role is switched — the policies no longer
  need a future change to become observable.
- **Item 6:** integration tests + CI workflow + coverage
  thresholds.
- ~~**Item 1 (Supabase):** extend the custom access token hook to
  stamp `organization_type`. Required for commit 1's fast path
  to actually skip the DB lookup.~~ — **RESOLVED** by commit 12.
  The hook now stamps `app_metadata.organization_id` from
  `public.users.organizationId` and `app_metadata.user_role`,
  gated on `isActive = true`.
- **Item 7 (Supabase):** rotate the Supabase project to issue
  RS256 + expose a JWKS endpoint. **Deploy-order-critical** with
  commit 6 — set `SUPABASE_JWKS_URL` only *after* this lands.
- **5c:** if real usage shows the 30/15min rate limit on
  `/auth/me` is too tight, bump to 60/15min in
  `src/middlewares/rateLimitAuth.js`. One-line change.
- **New (this round):** decide whether `quote_items` should be
  `FOR ALL` (current) or `FOR INSERT` + `FOR UPDATE` only, to
  match the "quotes are an immutable record" stance. A
  cross-tenant DELETE on `quote_items` is still prevented by
  the parent-quote EXISTS check, but a same-tenant DELETE is
  permitted by the current `FOR ALL` policy. One-line change.
- **New (this round):** consider a friendlier deactivated-user
  flow. The hook's `isActive` gate is the right place for the
  security lever (no org claim stamped → every RLS predicate
  fails → all requests denied). But the user-facing message is
  currently a generic 401, not "your account is deactivated."
  Two options, in order of cost:
  1. **Cheap (no DB hit):** have the hook also stamp
     `app_metadata.is_active = true|false` and add a middleware
     that reads it and returns 403 with a clear message when
     false. ~10 lines.
  2. **Heavy (DB hit per request):** have a `requireActive`
     middleware query `public.users.isActive` and return the
     same 403. Costs a round trip on every authenticated
     request. Not recommended unless we move to a
     non-bypassing Prisma role first (item 2 above) and need
     a non-JWT source of truth.

### Open question for the user

**Which scenario (A, B, or C) are you aiming for?** The next commit
should be the first item from the corresponding section above.
The fastest path to value is to start with Scenario A's item 1
("pick the slice") before writing any code — the answer shapes
which domain route to build first.
