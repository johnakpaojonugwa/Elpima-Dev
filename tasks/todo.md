# Scenario B — Public Launch (Todo)

Companion to `tasks/plan.md`. Every checkbox is a single commit's
worth of work. Tasks are grouped by phase and ordered by dependency.

Conventions:
- ✅ = done (placeholder; update as you go)
- Each task has acceptance criteria, verification, dependencies,
  files, and a size. No task is larger than M.
- Pre-commit hygiene per the git-workflow skill: `git diff --staged`
  for secrets, `npm test`, `npx tsc --noEmit`, `npx prisma validate`,
  PHI grep on the diff.

---

## Phase 0: Pre-Domain Infrastructure (Ops)

Blocks the public launch but does not block the Domain track
(Phases 1-4). Run in parallel with Phase 1.

### T0.1 — CI workflow
- [ ] Description: GitHub Actions workflow. On PR: lint, typecheck,
  unit tests, integration tests (against `supabase start`), no-secrets
  grep. On merge to main: build image, push to registry.
- [ ] Acceptance:
  - [ ] PR with a no-op change goes green
  - [ ] Merge to main pushes a new image tag to the registry
  - [ ] Secrets never appear in the workflow logs
- [ ] Verification: `git push` a no-op PR; check the Actions tab
- [ ] Dependencies: none
- [ ] Files: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- [ ] Size: M

### T0.2 — Env contract doc + .env.example
- [ ] Description: a single file enumerating every env var the
  runtime reads, with type, required/optional, default, and a one-
  line purpose. A `.env.example` mirroring that contract, with safe
  defaults (never real secrets).
- [ ] Acceptance:
  - [ ] `src/docs/env-contract.md` lists every var from
    `src/config/env.js` plus `DATABASE_URL_DIRECT`, `PORT`, `NODE_ENV`
  - [ ] `.env.example` at repo root with the same variables, all
    values obviously fake
  - [ ] grep across the repo for `process.env.` matches the contract
- [ ] Verification: `grep -rE 'process\.env\.' src/ | sort -u` shows
  nothing outside the contract
- [ ] Dependencies: none
- [ ] Files: `src/docs/env-contract.md`, `.env.example`
- [ ] Size: S

### T0.3 — Supabase env separation
- [ ] Description: split `supabase/config.toml` into dev/staging/
  prod profiles. Add a one-shot `supabase-bootstrap` script that
  provisions a new project with the env wiring and the right
  RLS-policy / migrations applied.
- [ ] Acceptance:
  - [ ] Three config profiles, none of them committing real secrets
  - [ ] Bootstrap script: provisions a fresh project, applies
    migrations, applies the custom access token hook, prints the
    env vars the API needs (without the secret values)
  - [ ] Staging environment runs against its own project; dev runs
    against `supabase start`; production has its own
- [ ] Verification: bootstrap a fresh dev project, deploy the API,
  smoke test `/auth/me`
- [ ] Dependencies: T0.1
- [ ] Files: `supabase/config.{dev,staging,prod}.toml`,
  `scripts/supabase-bootstrap.{sh,ps1}`
- [ ] Size: M

### T0.4 — Staging environment
- [ ] Description: pick a hosting target (Render / Fly / Railway),
  deploy the Dockerfile from commit 10 against the staging Supabase
  project, set the env vars from T0.2's contract.
- [ ] Acceptance:
  - [ ] Staging URL serves `/health` with 200
  - [ ] `/auth/me` returns 401 without a token, 200 with a real one
  - [ ] Logs include correlation IDs (proof T0.4 wired up the env
    that `correlationId.js` reads)
  - [ ] Health check from the Dockerfile's `HEALTHCHECK` passes
- [ ] Verification: hit staging from `curl`; check log aggregator
- [ ] Dependencies: T0.1, T0.3
- [ ] Files: deployment config in the hosting target's repo /
  IaC; the API repo is read-only here
- [ ] Size: M

### Checkpoint: Pre-Domain Infra
- [ ] PR CI green on a no-op PR
- [ ] Image builds and pushes from a `main` merge
- [ ] Staging environment serves `/health` against real Supabase
- [ ] `git diff --staged | grep -iE "password|secret|key|token"`
  returns nothing across every commit in this phase

---

## Phase 1: Organizations + Auth (Domain)

Foundation: every other slice FKs `organizations.id`.

### T1.1 — Module skeleton + zod schemas
- [ ] Description: `src/modules/organizations/` with `route.js`,
  `service.js`, `validation.js`, `*.test.js`. Zod schemas for
  create / read / update payloads. The folder layout matches
  `service-development.md §Core Logic` (domain-driven, not flat
  `routes/` + `models/`).
- [ ] Acceptance:
  - [ ] `src/modules/organizations/validation.js` exports
    `CreateOrganizationSchema`, `UpdateOrganizationSchema`,
    `OrganizationIdParamSchema`
  - [ ] Zod schemas reject: missing name, missing type, invalid
    email, non-UUID id, status values not in the `OrgStatus` enum
  - [ ] Unit tests cover the boundary cases (each rejection + the
    happy path)
- [ ] Verification: `npm test -- --grep "organizations validation"`
- [ ] Dependencies: T0.1 (CI exists), T0.2 (env contract)
- [ ] Files: `src/modules/organizations/{route,service,validation}.js`,
  `src/modules/organizations/validation.test.js`
- [ ] Size: S

### T1.2 — POST /api/v1/organizations
- [ ] Description: create org + first admin user in a single
  Prisma transaction. The transaction wraps both rows; if either
  fails, neither persists. One audit log row written in the same
  transaction (or as a follow-up — see T1.2 notes).
- [ ] Acceptance:
  - [ ] Authenticated, org-admin-or-above request creates exactly
    one `organizations` row and one `users` row in a transaction
  - [ ] The created user's `organizationId` matches the new org's id
  - [ ] One `audit_logs` row with `action='create'`,
    `entityType='organization'`, `entityId=<new id>`,
    `organizationId=<new id>`
  - [ ] Validation rejects: missing name, missing type, duplicate
    email
- [ ] Verification: integration test against a real Supabase
  (rolled-back transaction) + manual against staging
- [ ] Dependencies: T1.1
- [ ] Files: `src/modules/organizations/route.js`,
  `src/modules/organizations/service.js`,
  `test/integration/organizations.post.test.js`
- [ ] Size: M

### T1.3 — GET /api/v1/organizations/:id
- [x] Description: read the caller's own org. Scope comes from
  `req.user.organizationId` (set by `requireAuth`), **not** from the
  URL param. The URL param exists only for path consistency.
- [x] Acceptance:
  - [x] Authenticated request returns the caller's own org
  - [x] Cross-tenant request (a different org's id in the URL) 404s
  - [x] Unauthenticated request 401s
  - [x] One `audit_logs` row written with `action='read'`
- [x] Verification: integration test asserts cross-tenant 404;
  manual staging check
- [x] Dependencies: T1.2
- [x] Files: `src/modules/organizations/route.js`,
  `src/modules/organizations/service.js`,
  `test/integration/organizations.get-patch.test.js`
- [x] Size: S

### T1.4 — PATCH /api/v1/organizations/:id
- [x] Description: org admin updates own org. PLATFORM_ADMIN can
  update any org. Audit log row on every change.
- [x] Acceptance:
  - [x] `requireRole("ORG_ADMIN", "PLATFORM_ADMIN")` gates the
    route
  - [x] Update only the fields the role is allowed to touch
  - [x] One `audit_logs` row per successful update
  - [x] Cross-tenant update rejected
- [x] Verification: integration test asserts the role gate and the
  audit row; manual staging check
- [x] Dependencies: T1.3
- [x] Files: `src/modules/organizations/route.js`,
  `src/modules/organizations/service.js`,
  `test/integration/organizations.get-patch.test.js`
- [x] Size: S

### T1.5 — Unit + integration tests for the slice
- [x] Description: integration suite that drives the slice end-to-
  end against a real Supabase project (local or staging). Includes
  RLS verification: a request authenticated as org A cannot read or
  update org B even if it guesses the id.
- [x] Acceptance:
  - [x] All T1.2-T1.4 integration tests pass
  - [x] Cross-tenant read/update 404s
  - [x] Audit log rows present and correctly shaped for every
    successful operation
- [x] Verification: `npm test` passing with 76/76 tests
- [x] Dependencies: T1.4
- [x] Files: `test/integration/organizations.*.test.js`
- [x] Size: M

### Checkpoint: Organizations
- [x] Tenant scoping verified: org A cannot read/update org B
- [x] Audit trail verified for create, read, and update
- [x] Test suite green (76/76 passing)

---

## Phase 2: Products (Domain)

Non-PHI; the catalog must exist before quotes can reference it.

### T2.1 — Module skeleton + zod schemas
- [x] Description: same shape as T1.1 but for products.
- [x] Acceptance:
  - [x] `src/modules/products/validation.js` exports
    `CreateProductSchema`, `UpdateProductSchema`,
    `ProductIdParamSchema`, `ListProductsQuerySchema`
  - [x] `unitPrice` is a positive decimal; `currency` defaults to
    `NGN`; `categoryId` is optional UUID
- [x] Verification: `npm test -- --grep "products validation"` (11/11 passing)
- [x] Dependencies: T1.5
- [x] Files: `src/modules/products/validation.{js,test.js}`
- [x] Size: S

### T2.2 — POST /api/v1/products
- [x] Description: vendor-only create product. `requireOrgType("VENDOR")`.
- [x] Acceptance:
  - [x] VENDOR can create; HOSPITAL 403s
  - [x] One `audit_logs` row with `action='create'`
  - [x] Validation rejects: negative price, missing name
- [x] Verification: integration test (201, 403, 400 verified)
- [x] Dependencies: T2.1
- [x] Files: `src/modules/products/route.js`,
  `src/modules/products/service.js`,
  `test/integration/products.test.js`
- [x] Size: S

### T2.3 — GET /api/v1/products
- [x] Description: cross-tenant browse (intentionally permissive per
  the existing RLS policy). Pagination via cursor.
- [x] Acceptance:
  - [x] Returns all products across tenants
  - [x] Pagination: `?cursor=<id>&limit=20` works
  - [x] Filter by `categoryId` and `vendorId` (if provided)
- [x] Verification: integration test (verified with hospital & vendor users)
- [x] Dependencies: T2.2
- [x] Files: `src/modules/products/route.js`,
  `test/integration/products.test.js`
- [x] Size: S

### T2.4 — PATCH /api/v1/products/:id
- [x] Description: vendor-only, scoped by `vendorId` (the row's
  vendor, not the URL param).
- [x] Acceptance:
  - [x] VENDOR can update their own products; cannot update another
    vendor's (404 anti-enumeration)
  - [x] One `audit_logs` row per update
- [x] Verification: integration test
- [x] Dependencies: T2.3
- [x] Files: `src/modules/products/route.js`,
  `test/integration/products.test.js`
- [x] Size: S

### T2.5 — DELETE /api/v1/products/:id
- [x] Description: vendor-only delete.
- [x] Acceptance:
  - [x] Cross-tenant delete rejected with 404
  - [x] One `audit_logs` row with `action='delete'`
  - [x] Foreign key conflict handling (P2003 -> 409 conflict)
- [x] Verification: integration test
- [x] Dependencies: T2.4
- [x] Files: `src/modules/products/route.js`,
  `src/modules/products/service.js`,
  `test/integration/products.test.js`
- [x] Size: M

### T2.6 — Slice integration tests
- [x] Description: end-to-end verification for products catalog.
- [x] Acceptance:
  - [x] Vendor A cannot update/delete vendor B's products (404)
  - [x] Cross-tenant browse shows both vendors' products
  - [x] Audit log rows present for every operation
- [x] Verification: 15/15 passing tests in `test/integration/products.test.js`
- [x] Dependencies: T2.5
- [x] Files: `test/integration/products.test.js`
- [x] Size: M

### Checkpoint: Products
- [x] Tenant scoping verified: vendor A cannot modify/delete vendor B's products
- [x] Audit trail verified for create, update, and delete
- [x] Full test suite green (102/102 passing)

---

## Phase 3: License Verification (Domain, PHI surface)

The most compliance-heavy slice. Plan accordingly.

### T3.1 — Module skeleton + zod schemas
- [ ] Description: `src/modules/licenses/`. Schemas for
  create (upload metadata), read, approve, reject.
- [ ] Acceptance:
  - [ ] `CreateLicenseSchema` requires `hospitalId`, `licenseNumber`,
    `issuingBody`, `documentUrl` (signed URL, validated as a URL)
  - [ ] `ApproveLicenseSchema` and `RejectLicenseSchema` accept
    optional `rejectionReason` (required on reject)
- [ ] Verification: `npm test -- --grep "licenses validation"`
- [ ] Dependencies: T2.6
- [ ] Files: `src/modules/licenses/validation.{js,test.js}`
- [ ] Size: S

### T3.2 — POST /api/v1/hospitals/:id/licenses
- [ ] Description: hospital admin uploads license document metadata.
  The actual file goes to a private Supabase Storage bucket
  (created in T3.5); the API receives a signed-URL reference.
- [ ] Acceptance:
  - [ ] Hospital admin can upload for their own hospital only
  - [ ] Cross-tenant upload rejected
  - [ ] One `audit_logs` row with `action='create'`,
    `entityType='license'`
  - [ ] `documentUrl` validated as a URL, sanitized
- [ ] Verification: integration test
- [ ] Dependencies: T3.1
- [ ] Files: `src/modules/licenses/route.js`,
  `src/modules/licenses/service.js`,
  `test/integration/licenses.post.test.js`
- [ ] Size: M

### T3.3 — GET /api/v1/hospitals/:id/licenses
- [ ] Description: PLATFORM_ADMIN sees all; hospital sees own only.
  Every read audited.
- [ ] Acceptance:
  - [ ] Hospital admin gets their hospital's licenses
  - [ ] Hospital admin cannot see another hospital's licenses
  - [ ] PLATFORM_ADMIN sees all
  - [ ] One `audit_logs` row per read
  - [ ] Response payload never includes the raw `documentUrl` —
    only metadata (id, status, expiresAt, issuingBody)
- [ ] Verification: integration test, including a PHI-leak assertion
- [ ] Dependencies: T3.2
- [ ] Files: `src/modules/licenses/route.js`,
  `test/integration/licenses.get.test.js`
- [ ] Size: M

### T3.4 — Approve / reject endpoints
- [ ] Description: PLATFORM_ADMIN only. Approve sets status=APPROVED,
  sets `reviewedBy`/`reviewedAt`. Reject requires a `rejectionReason`.
- [ ] Acceptance:
  - [ ] `requireRole("PLATFORM_ADMIN")` gates both routes
  - [ ] Reject without reason 400s
  - [ ] State transition: PENDING → APPROVED / REJECTED only
  - [ ] One `audit_logs` row per transition
- [ ] Verification: integration test
- [ ] Dependencies: T3.3
- [ ] Files: `src/modules/licenses/route.js`,
  `test/integration/licenses.transitions.test.js`
- [ ] Size: M

### T3.5 — Storage bucket RLS
- [ ] Description: private Supabase Storage bucket for license
  documents. Path scheme: `licenses/<hospitalId>/<licenseId>/<uuid>.<ext>`.
  RLS: anon denied, service-role writes, authenticated reads only
  via signed URL.
- [ ] Acceptance:
  - [ ] Bucket created with `public = false`
  - [ ] RLS policies in place
  - [ ] Service-role key never appears in the API response
  - [ ] Test: anon GET on the bucket URL 403s; signed URL works
- [ ] Verification: smoke test in staging
- [ ] Dependencies: T3.2
- [ ] Files:
  `prisma/migrations/<ts>_license_storage_bucket/migration.sql`,
  `scripts/create-license-bucket.{sh,ps1}`
- [ ] Size: M

### T3.6 — pgmq queue for verification workflow
- [ ] Description: every state transition enqueues a message for
  downstream consumers (notification, future OCR). v1 has no
  consumer; the message shape is stable.
- [ ] Acceptance:
  - [ ] `pgmq` queue created
  - [ ] Send on every state transition
  - [ ] Message shape includes `licenseId`, `hospitalId`,
    `previousStatus`, `newStatus`, `actorId` — never PHI
- [ ] Verification: integration test asserts the message is enqueued
- [ ] Dependencies: T3.4
- [ ] Files:
  `prisma/migrations/<ts>_pgmq_license_queue/migration.sql`,
  `src/modules/licenses/queue.js`,
  `test/integration/licenses.queue.test.js`
- [ ] Size: S

### T3.7 — Slice integration + PHI-isolation tests
- [ ] Description: end-to-end RLS verification, PHI-isolation
  assertions, audit log verification.
- [ ] Acceptance:
  - [ ] Cross-hospital license reads 404
  - [ ] Raw `documentUrl` never appears in any response
  - [ ] Audit log rows present and correctly shaped for every read,
    every state transition, every create
  - [ ] No log line in the integration run contains the document
    URL, license number, or any other PHI
- [ ] Verification: `npm run test:integration`; manual PHI grep
- [ ] Dependencies: T3.6
- [ ] Files: `test/integration/licenses.*.test.js`
- [ ] Size: M

### Checkpoint: License Verification
- [ ] Manual: hospital uploads a license, PLATFORM_ADMIN approves,
  hospital sees status change; second hospital's license upload
  is invisible to the first hospital's users
- [ ] PHI leak scan: `grep` the logs, error responses, and stored
  responses for any of the document URL, license number, or staff
  identifiers — must be empty
- [ ] Audit log: every read and every state transition has a row
- [ ] Advisors MCP: no RLS warnings on `licenses`
- [ ] `docs/compliance-standard.md` Pre-Feature Checklist all green

---

## Phase 4: Quotes + Orders (Domain, longest tail)

### T4.1 — Module skeleton + zod schemas
- [ ] Description: `src/modules/quotes/` and `src/modules/orders/`.
  Schemas for create quote, line items, state transitions.
- [ ] Acceptance:
  - [ ] `CreateQuoteSchema` accepts `vendorId` and a list of
    `QuoteItemInputSchema` (productId, quantity)
  - [ ] `quantity` is a positive integer; `lineTotal` is computed
    server-side, not accepted from the client
- [ ] Verification: `npm test -- --grep "quotes validation"`
- [ ] Dependencies: T3.7
- [ ] Files: `src/modules/quotes/validation.{js,test.js}`,
  `src/modules/orders/validation.{js,test.js}`
- [ ] Size: S

### T4.2 — POST /api/v1/quotes
- [ ] Description: hospital-only create quote. Line items fetched
  server-side; `lineTotal` computed in code; `totalAmount` is the
  sum of `lineTotal`s, computed in code.
- [ ] Acceptance:
  - [ ] HOSPITAL can create; VENDOR 403s
  - [ ] Server-side `unitPrice` lookup (never trust client-supplied
    prices)
  - [ ] `totalAmount` = SUM(`lineTotal`); assertion in the test
  - [ ] One `audit_logs` row
  - [ ] Single Prisma transaction across `quotes` and `quote_items`
- [ ] Verification: integration test
- [ ] Dependencies: T4.1
- [ ] Files: `src/modules/quotes/route.js`,
  `src/modules/quotes/service.js`,
  `test/integration/quotes.post.test.js`
- [ ] Size: M

### T4.3 — GET /api/v1/quotes
- [ ] Description: vendor sees their sent quotes; hospital sees
  their received quotes. Scoped by `req.user.organizationId`.
- [ ] Acceptance:
  - [ ] Hospital A's `GET /api/v1/quotes` returns only A's quotes
  - [ ] Vendor V's `GET /api/v1/quotes?direction=sent` returns only
    V's sent quotes
  - [ ] Cross-tenant GET 404s
  - [ ] One `audit_logs` row per read
- [ ] Verification: integration test
- [ ] Dependencies: T4.2
- [ ] Files: `src/modules/quotes/route.js`,
  `test/integration/quotes.get.test.js`
- [ ] Size: S

### T4.4 — POST /api/v1/quotes/:id/send
- [ ] Description: vendor-only. DRAFT → SENT. Enqueues a `pgmq`
  message for WhatsApp delivery (consumer is a stub in v1).
- [ ] Acceptance:
  - [ ] `requireRole("ORG_ADMIN", "PLATFORM_ADMIN")` plus
    `requireOrgType("VENDOR")`
  - [ ] State transition: DRAFT → SENT only (SENT → SENT 409s)
  - [ ] `whatsappStatus` set to `QUEUED`
  - [ ] One `audit_logs` row
  - [ ] One `pgmq` message enqueued
- [ ] Verification: integration test
- [ ] Dependencies: T4.3
- [ ] Files: `src/modules/quotes/route.js`,
  `src/modules/quotes/queue.js`,
  `test/integration/quotes.send.test.js`
- [ ] Size: S

### T4.5 — Accept / decline / view
- [ ] Description: hospital-only accept/decline. View counter
  increment on any read of a SENT quote by the hospital.
- [ ] Acceptance:
  - [ ] HOSPITAL can accept/decline; VENDOR 403s
  - [ ] State transitions: SENT → ACCEPTED, SENT → DECLINED, SENT →
    EXPIRED (the last via a scheduled job — out of scope, but the
    state is valid)
  - [ ] One `audit_logs` row per transition
- [ ] Verification: integration test
- [ ] Dependencies: T4.4
- [ ] Files: `src/modules/quotes/route.js`,
  `test/integration/quotes.transitions.test.js`
- [ ] Size: S

### T4.6 — POST /api/v1/orders
- [ ] Description: derive an order from an ACCEPTED quote in a
  single transaction. Copies `quote_items` to `order_items` with
  the same `unitPrice`/`lineTotal`.
- [ ] Acceptance:
  - [ ] Source quote must be `ACCEPTED` (409 otherwise)
  - [ ] Single transaction across `orders` and `order_items`
  - [ ] `Order.totalAmount` = SUM(`OrderItem.lineTotal`)
  - [ ] One `audit_logs` row
- [ ] Verification: integration test
- [ ] Dependencies: T4.5
- [ ] Files: `src/modules/orders/route.js`,
  `src/modules/orders/service.js`,
  `test/integration/orders.post.test.js`
- [ ] Size: M

### T4.7 — GET /api/v1/orders
- [ ] Description: hospital's own orders; vendor sees orders
  against their quotes. Scoped by `req.user.organizationId`.
- [ ] Acceptance:
  - [ ] Hospital A's `GET /api/v1/orders` returns only A's orders
  - [ ] Vendor V's `GET /api/v1/orders?direction=received` returns
    orders against V's quotes
  - [ ] One `audit_logs` row per read
- [ ] Verification: integration test
- [ ] Dependencies: T4.6
- [ ] Files: `src/modules/orders/route.js`,
  `test/integration/orders.get.test.js`
- [ ] Size: S

### T4.8 — Slice integration + state-machine tests
- [ ] Description: totalAmount consistency, state-machine validity,
  no order from a non-accepted quote.
- [ ] Acceptance:
  - [ ] All T4.2-T4.7 integration tests pass
  - [ ] State-machine assertions: every invalid transition 409s
  - [ ] Quote → Order consistency: line items match, totalAmount
    matches, audit log shows the chain
- [ ] Verification: `npm run test:integration`
- [ ] Dependencies: T4.7
- [ ] Files: `test/integration/quotes.workflow.test.js`,
  `test/integration/orders.workflow.test.js`
- [ ] Size: M

### Checkpoint: Quotes + Orders
- [ ] Manual: hospital creates a quote with three line items,
  sends, accepts, becomes an order. Cross-tenant read denied.
  Audit log on every state transition.
- [ ] `quote_items` immutability decision applied: split into
  `FOR INSERT` + `FOR UPDATE` (sent quotes are immutable)
- [ ] Advisors MCP: no RLS warnings on `quotes`, `quote_items`,
  `orders`, `order_items`

---

## Phase 5: Production-Ops (Ops, blocks public launch)

### T5.1 — /metrics endpoint
- [ ] Description: Prometheus metrics. Counters (requests, errors),
  histograms (latency), gauges (DB pool utilization, pgmq backlog).
- [ ] Acceptance:
  - [ ] `/metrics` returns 200 with all required series
  - [ ] Scrape with `promtool` validates the format
  - [ ] Auth-gated: not exposed without `METRICS_TOKEN` (or similar)
- [ ] Verification: Prometheus scrape config in staging
- [ ] Dependencies: T0.4
- [ ] Files: `src/routes/metrics.route.js`,
  `src/utils/metrics.js`,
  `test/metrics.test.js`
- [ ] Size: M

### T5.2 — /healthz split
- [ ] Description: rename `/health` to `/healthz/live` (deep,
  `SELECT 1`); add `/healthz/ready` (shallow, process-only).
- [ ] Acceptance:
  - [ ] `/healthz/live` returns 200 only if the DB is reachable
  - [ ] `/healthz/ready` returns 200 as long as the process is up
  - [ ] Dockerfile's `HEALTHCHECK` updated to `/healthz/live`
- [ ] Verification: kill the DB connection in staging; `/healthz/ready`
  still 200, `/healthz/live` 503
- [ ] Dependencies: T0.4
- [ ] Files: `src/routes/health.route.js`, `Dockerfile`
- [ ] Size: S

### T5.3 — JWKS rotation
- [ ] Description: rotate the Supabase project to issue RS256 and
  expose a JWKS endpoint. Set `SUPABASE_JWKS_URL` in staging,
  verify, then set in production.
- [ ] Acceptance:
  - [ ] Staging: tokens signed with RS256 verify successfully
  - [ ] Staging: a pre-rotation HS256 token is rejected
  - [ ] Production rotation rehearsed; rollback path documented
- [ ] Verification: smoke test in staging with a freshly minted
  RS256 token; document the rollback
- [ ] Dependencies: T5.2
- [ ] Files: deployment config; Supabase dashboard settings
- [ ] Size: M

### T5.4 — Non-bypassing Prisma role
- [ ] Description: split `DATABASE_URL` (authenticator, RLS-enforced)
  from `DATABASE_URL_DIRECT` (owner, migrations only). The API uses
  the authenticator for every business query.
- [ ] Acceptance:
  - [ ] Integration test: a request authenticated as org A attempting
    to update org B's row is rejected by RLS (was silently passing
    under the owner role)
  - [ ] Migrations still apply via `DATABASE_URL_DIRECT`
  - [ ] The Prisma client is constructed with the authenticator URL
- [ ] Verification: integration suite runs against the new role
- [ ] Dependencies: T4.8
- [ ] Files: `src/config/prisma.js`, `src/config/env.js`,
  `prisma.config.ts`, `src/docs/env-contract.md` (update)
- [ ] Size: M

### T5.5 — Alert rules
- [ ] Description: Prometheus alert rules (or equivalent) for
  connection pool exhaustion, 5xx rate spike, `/auth/me` 401 storm,
  pgmq backlog > N.
- [ ] Acceptance:
  - [ ] Rules committed in a format the staging Prometheus can
    consume
  - [ ] Each rule has a runbook link in the alert message
- [ ] Verification: trigger each alert in staging; confirm the
  notification fires
- [ ] Dependencies: T5.1, T3.6
- [ ] Files: `infra/prometheus/alerts/*.yml`,
  `src/docs/runbooks/*.md`
- [ ] Size: M

### T5.6 — Runbooks
- [ ] Description: runbook per `production-readiness.md §Runbook`:
  pool exhaustion, Supabase Auth outage, pgmq backlog, Edge
  Function failures.
- [ ] Acceptance:
  - [ ] Each runbook has: symptom, first check, mitigation,
    escalation path, owner
  - [ ] Reviewed by at least one engineer not on this team
- [ ] Verification: walk-through with a fresh engineer
- [ ] Dependencies: T5.5
- [ ] Files: `src/docs/runbooks/*.md`
- [ ] Size: S

### T5.7 — Slow-query logging
- [ ] Description: `prisma.$on('query', ...)` gated on
  `NODE_ENV !== 'production'`. Whitelist tables — never
  `licenses`, never `audit_logs`. Never include parameter values
  (PHI risk).
- [ ] Acceptance:
  - [ ] Slow query (>100ms) logged at `warn` level with the query
    text but no params
  - [ ] Test: run a license read; assert the log line has the query
    but not the params
  - [ ] Production builds do not register the listener
- [ ] Verification: integration test; manual staging observation
- [ ] Dependencies: T4.8
- [ ] Files: `src/config/prisma.js`
- [ ] Size: S

### T5.8 — Dependency scan in CI
- [ ] Description: `npm audit --audit-level=high` in CI. Follow-up
  Snyk pass scheduled.
- [ ] Acceptance:
  - [ ] CI fails on any high/critical vulnerability
  - [ ] Snyk pass scheduled (or its equivalent)
- [ ] Verification: introduce a known-vulnerable dep; CI fails
- [ ] Dependencies: T0.1
- [ ] Files: `.github/workflows/ci.yml`
- [ ] Size: S

### Checkpoint: Production-Ops
- [ ] `/metrics` returns 200 with all required series
- [ ] JWKS rotation done in staging; production rehearsed
- [ ] Prisma non-bypassing role: integration test asserts RLS
  rejection
- [ ] Runbook reviewed
- [ ] `npm audit --audit-level=high` clean

---

## Phase 6: Launch Gate

### T6.1 — Changelog v1.0.0
- [ ] Description: curated changelog entry for the public launch.
  Grouped by `Added / Changed / Fixed / Security`. User-impact
  phrasing, not commit archaeology.
- [ ] Acceptance:
  - [ ] `CHANGELOG.md` has a `## [1.0.0] - <date>` section
  - [ ] Every business route is mentioned in `Added`
  - [ ] RLS, custom access token hook fix, audit log are mentioned
    in `Security`
- [ ] Verification: read-through by a non-engineer
- [ ] Dependencies: T5.8
- [ ] Files: `CHANGELOG.md`
- [ ] Size: S

### T6.2 — Tag v1.0.0
- [ ] Description: `git tag -a v1.0.0 -m "Release 1.0.0"`. Push the
  tag. Verify image build.
- [ ] Acceptance:
  - [ ] Tag pushed
  - [ ] Tag-triggered build produces an image
  - [ ] Image tagged with the version
- [ ] Verification: tag is visible on the remote
- [ ] Dependencies: T6.1
- [ ] Files: git tag; release pipeline output
- [ ] Size: S

### T6.3 — Pre-launch checklist signoff
- [ ] Description: every item in `src/docs/production-readiness.md`
  and every outstanding item in `handoff.md §6.2` checked.
- [ ] Acceptance:
  - [ ] All checkboxes in the production-readiness checklist green
  - [ ] Handoff's outstanding items (non-bypassing Prisma role, CI,
    etc.) resolved
  - [ ] Signoff from the project owner
- [ ] Verification: signoff record in `handoff.md` or a new
  `LAUNCH.md`
- [ ] Dependencies: T6.2
- [ ] Files: `src/docs/production-readiness.md` (annotated),
  `LAUNCH.md`
- [ ] Size: S

### T6.4 — Post-launch feedback channel
- [ ] Description: a `feedback.md` (or equivalent) channel for the
  first 50 production requests.
- [ ] Acceptance:
  - [ ] Channel exists
  - [ ] First 50 requests traced end-to-end via correlation IDs
  - [ ] Findings become the next round's plan
- [ ] Verification: feedback channel in use
- [ ] Dependencies: T6.3
- [ ] Files: `feedback.md` (or issue tracker convention)
- [ ] Size: S

### Checkpoint: Public Launch
- [ ] Tag pushed, image built and pushed, production env wired
- [ ] OpenAPI spec at `/api/v1/docs` matches implementation
- [ ] Audit log retention policy documented
- [ ] First 50 production requests traced end-to-end

---

## Cross-cutting: Pre-commit hygiene (every commit)

- [ ] `git diff --staged` reviewed
- [ ] `git diff --staged | grep -iE "password|secret|key|token|license|staff_id"` returns nothing
- [ ] `npm test` passes
- [ ] `npm run lint` clean
- [ ] `npx tsc --noEmit` clean
- [ ] `npx prisma validate` clean (when the diff touches `schema.prisma`)
- [ ] For DB migrations: `supabase db diff` matches the committed file
- [ ] For DB migrations: `mcp__supabase__get_advisors security` clean
- [ ] For PHI-touching code: PHI isolation verified, audit log row verified
- [ ] Commit message: Conventional Commits type, explains *why*
- [ ] Diff size: ~100-300 lines for behavior changes; smaller is fine
