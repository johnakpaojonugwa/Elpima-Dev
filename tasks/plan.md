# Implementation Plan: Scenario B — Public Launch (Elpima MVP)

## Overview

Ship the Elpima B2B medical/surgical procurement backend as a
production-grade service. The codebase already has the expensive
non-functional work in place: Supabase Auth (HS256 + RS256/JWKS),
correlation IDs, structured logging, sanitized error envelope, env
validation, multi-tenant RLS (19 policies, 9 tables), a fixed
custom access token hook, a multi-stage production Dockerfile, and
a working local Supabase stack. What's missing is the **domain
surface** (the four business slices) and the **operational surface**
(CI, staging, secrets, observability, runbooks).

This plan covers Scenario B from `handoff.md §6.2`: a 4-8 week
engagement that produces a service trustworthy enough to charge for.
We sequence the work as **two parallel tracks** — a Domain track
(four vertical slices, bottom-up by dependency) and an Ops track
(foundational infra that blocks production deploys) — synchronized
at a single end-of-plan checkpoint where both tracks converge for
the launch gate.

## Architecture Decisions

- **Vertical slicing only.** Each business slice delivers schema
  → API → tests → audit → RLS verification in one phase. No
  horizontal "build all routes then add all tests" ordering.
- **RLS is the second enforcement layer, not the first.** All
  Prisma queries scope by `organizationId` derived from the session
  via `requireAuth`; RLS catches the case where a future query
  forgets. The current Prisma role bypasses RLS — that switch is a
  discrete ops-track task.
- **Audit log is append-only by DB construction.** No application
  code can `UPDATE` or `DELETE` `audit_logs`; the privilege revoke
  and the absence of an RLS policy are two independent layers.
- **No PHI in logs, errors, or commit messages.** Compliance gate.
  License document storage is Supabase Storage (private bucket,
  signed URLs); the DB holds only the reference URL + metadata.
- **Tests must run against real Postgres, not mocks.** The
  integration suite uses `supabase start` (already wired in commit 9)
  and rolls back per-test in a transaction. RLS is observable only
  in this mode — mocking Prisma would silently let a missing policy
  pass.
- **Domain folder structure, not flat `routes/` + `models/`.** The
  four slices live under `src/modules/{organizations,products,
  licenses,quotes,orders}/`, each with `route.js`, `service.js`,
  `validation.js`, and `*.test.js`. This matches
  `service-development.md §Core Logic` and keeps the service-
  boundary guidance in `CLAUDE.md` honest.
- **Async work goes through `pgmq`.** No in-process queues, no
  setTimeout-based retries. License verification emails, WhatsApp
  delivery for quotes, and any future notification jobs land in
  `pgmq` queues consumed by Edge Functions or a worker process.
- **Versioning is real.** Every business route lives under
  `/api/v1/...`. The first release that exposes an endpoint to a
  non-Elpima client gets a `MAJOR.MINOR.PATCH` tag and a changelog
  entry.

## Tracks

Two parallel tracks. The Domain track is the user-visible product;
the Ops track is what makes it shippable. They share the same
end-of-plan launch checkpoint but have different in-flight
dependencies.

### Domain Track (bottom-up by foreign-key dependency)

```
Phase 1: Organizations + Auth
    ↓ (other tables FK organizations.id)
Phase 2: Products (vendor catalog)
    ↓ (quotes FK products.id)
Phase 3: License verification (PHI surface)
    ↓ (verified hospitals can send quotes)
Phase 4: Quotes → Orders
```

### Ops Track (must finish before public launch)

```
Phase 0: Pre-domain infra (CI, secrets, env separation)
    ↓
Phase 1: Observability (/metrics, /healthz/ready, runbooks)
    ↓
Phase 2: Supabase rotation (RS256 + JWKS endpoint)
    ↓
Phase 3: Non-bypassing Prisma role
    ↓
Phase 4: pgmq workers
```

## Task List

### Phase 0: Pre-Domain Infrastructure (Ops Track, blocks the rest)

- [ ] **T0.1** `chore(ci): add GitHub Actions workflow — lint, typecheck, test on PR; build+push image on merge to main`
- [ ] **T0.2** `chore(env): document env var contract in src/docs/env-contract.md; add a `.env.example` with every var the runtime actually reads`
- [ ] **T0.3** `chore(supabase): split supabase/config.toml into dev/staging/prod profiles; create a one-shot supabase-bootstrap script that provisions a project with the right env wiring`
- [ ] **T0.4** `chore(infra): set up Render/Fly staging environment — Dockerfile is already in commit 10, just need the target and env-var injection`

**Checkpoint: Pre-Domain Infra**
- [ ] PR CI green on a no-op PR (proves the workflow)
- [ ] Image builds and pushes to a registry from a `main` merge
- [ ] Staging environment serves `/health` against a real Supabase
- [ ] No secrets in the repo (grep clean across all .env*, config.toml, Dockerfile, .dockerignore, .github/)

### Phase 1: Organizations + Auth (Domain Track, foundation)

- [ ] **T1.1** `feat(orgs): module skeleton + validation schemas (zod) for create/update/read`
- [ ] **T1.2** `feat(orgs): POST /api/v1/organizations — create org + first admin user in a single transaction`
- [ ] **T1.3** `feat(orgs): GET /api/v1/organizations/:id — read own org (scoped by req.user.organizationId, not by URL param trust)`
- [ ] **T1.4** `feat(orgs): PATCH /api/v1/organizations/:id — org admin only, audit log row on every change`
- [ ] **T1.5** `feat(orgs): unit + integration tests (RLS verifies org A cannot read/update org B)`

**Checkpoint: Organizations**
- [ ] Manual: register a hospital and a vendor, confirm both visible only to their own admin
- [ ] Audit log: every write to `organizations` produced exactly one row with the right shape
- [ ] `mcp__supabase__get_advisors security` reports no RLS warnings on `organizations`
- [ ] Test suite green: `npm test` and a real-DB integration pass

### Phase 2: Products (Domain Track)

- [ ] **T2.1** `feat(products): module skeleton + validation (zod) for create/update/list`
- [ ] **T2.2** `feat(products): POST /api/v1/products — vendor-only, requireOrgType("VENDOR")`
- [ ] **T2.3** `feat(products): GET /api/v1/products — cross-tenant browse (intentionally permissive per RLS policy)`
- [ ] **T2.4** `feat(products): PATCH /api/v1/products/:id — vendor-only, scoped by vendorId`
- [ ] **T2.5** `feat(products): DELETE /api/v1/products/:id — vendor-only, soft delete vs hard delete decision (see Open Questions)`
- [ ] **T2.6** `feat(products): unit + integration tests (cross-tenant update rejected, vendor cannot edit another vendor's product)`

**Checkpoint: Products**
- [ ] Manual: vendor A creates a product, vendor B's admin cannot see it in the management list but cross-tenant browse shows both
- [ ] Audit log rows for create/update/delete
- [ ] Advisors MCP: no RLS warnings on `products` or `categories`

### Phase 3: License Verification (Domain Track, PHI surface)

This is the most compliance-heavy slice. Plan accordingly.

- [ ] **T3.1** `feat(licenses): module skeleton + validation (zod) for create/read/approve/reject`
- [ ] **T3.2** `feat(licenses): POST /api/v1/hospitals/:id/licenses — upload license document metadata; document goes to private Supabase Storage bucket; DB holds only the signed-URL reference + metadata`
- [ ] **T3.3** `feat(licenses): GET /api/v1/hospitals/:id/licenses — always audit-logged; PLATFORM_ADMIN sees all, hospital sees own only`
- [ ] **T3.4** `feat(licenses): PATCH /api/v1/licenses/:id/approve and /reject — PLATFORM_ADMIN only, with mandatory rejection reason`
- [ ] **T3.5** `feat(licenses): storage bucket RLS — anon denied, service-role writes, authenticated reads only via signed URL`
- [ ] **T3.6** `feat(licenses): pgmq queue for the verification workflow — manual approval in v1, but the message shape is stable so an OCR/automated consumer can drop in later`
- [ ] **T3.7** `feat(licenses): unit + integration tests including PHI-isolation assertions (a hospital's license is invisible to another hospital, raw document URL never appears in any response, audit log row present for every read)`

**Checkpoint: License Verification**
- [ ] Manual: hospital uploads a license, PLATFORM_ADMIN approves, hospital sees status change; second hospital's license upload is invisible to the first hospital's users
- [ ] PHI leak scan: `grep` the logs, error responses, and stored responses for any of the document URL, license number, or staff identifiers — must be empty
- [ ] Audit log: every read and every state transition has a row with the right shape
- [ ] Advisors MCP: no RLS warnings on `licenses`
- [ ] Compliance review: `docs/compliance-standard.md` Pre-Feature Checklist all green

### Phase 4: Quotes → Orders (Domain Track, longest tail)

- [ ] **T4.1** `feat(quotes): module skeleton + validation for create/read/list/state-transition`
- [ ] **T4.2** `feat(quotes): POST /api/v1/quotes — hospital-only, line-item math (lineTotal = quantity * unitPrice) computed server-side, totalAmount = SUM(lineTotal)`
- [ ] **T4.3** `feat(quotes): GET /api/v1/quotes — vendor sees their sent quotes, hospital sees their received quotes, scoped by req.user.organizationId`
- [ ] **T4.4** `feat(quotes): PATCH /api/v1/quotes/:id/send — vendor-only; flips DRAFT → SENT; queues a `pgmq` message for WhatsApp delivery`
- [ ] **T4.5** `feat(quotes): PATCH /api/v1/quotes/:id/{accept,decline,view} — hospital-only accept/decline, vendor+hospital view counter`
- [ ] **T4.6** `feat(orders): POST /api/v1/orders — derived from an ACCEPTED quote in a single transaction (quote + order + order_items)`
- [ ] **T4.7** `feat(orders): GET /api/v1/orders — hospital's own orders; vendor sees orders against their quotes`
- [ ] **T4.8** `feat(quotes,orders): unit + integration tests — totalAmount consistency, state-machine validity, no order can be created from a non-accepted quote`

**Checkpoint: Quotes + Orders**
- [ ] Manual: hospital creates a quote with three line items, sends, accepts, becomes an order. Cross-tenant read denied. Audit log on every state transition.
- [ ] quote_items immutability decision: keep `FOR ALL` (current) or split into `FOR INSERT` + `FOR UPDATE` (recommended; the handoff's "outstanding items" §5.5 raised this)
- [ ] Advisors MCP: no RLS warnings on `quotes`, `quote_items`, `orders`, `order_items`

### Phase 5: Production-Ops (Ops Track, blocks the launch gate)

- [ ] **T5.1** `feat(observability): /metrics endpoint for Prometheus — request count, error rate, p50/p95/p99 latency, DB pool utilization, pgmq backlog`
- [ ] **T5.2** `feat(observability): /healthz/ready (DB SELECT 1) and /healthz/live (process-only) split — staging already has /health; rename per production-readiness.md §Monitoring`
- [ ] **T5.3** `chore(supabase): rotate to RS256 + expose JWKS endpoint; set SUPABASE_JWKS_URL in staging first, then prod (deploy order critical, see auth.js JSDoc)`
- [ ] **T5.4** `feat(db): switch Prisma to a non-bypassing role for user-facing queries — separate DATABASE_URL_DIRECT (owner, migrations only) from DATABASE_URL (authenticator, RLS-enforced)`
- [ ] **T5.5** `feat(observability): alert rules for connection pool exhaustion, 5xx rate spike, /auth/me 401 storm, pgmq backlog > N`
- [ ] **T5.6** `docs(runbooks): connection pool exhaustion, Supabase Auth outage, pgmq backlog, Edge Function failures — per production-readiness.md`
- [ ] **T5.7** `chore(observability): slow-query logging via prisma.$on('query', ...) gated on NODE_ENV !== 'production'`
- [ ] **T5.8** `chore(deps): dependency scan in CI (npm audit --audit-level=high) and a follow-up Snyk pass`

**Checkpoint: Production-Ops**
- [ ] `/metrics` returns 200 with all required series; Prometheus scrapes it
- [ ] JWKS rotation done in staging; production rotation rehearsed; rollback path documented
- [ ] Prisma non-bypassing role: integration test asserts RLS actually rejects a cross-tenant write (would have silently passed under the owner role)
- [ ] Runbook reviewed by at least one engineer not on this team
- [ ] `npm audit --audit-level=high` clean

### Phase 6: Launch Gate (convergence)

- [ ] **T6.1** `docs: changelog for v1.0.0 with curated entries (not git log) — public launch release`
- [ ] **T6.2** `chore(release): tag v1.0.0, push tag, verify image build, verify production env vars match the contract`
- [ ] **T6.3** `docs: pre-launch checklist signed off (every item in src/docs/production-readiness.md + every outstanding item in handoff.md §6.2)`
- [ ] **T6.4** `chore(post-launch): set up a `feedback.md` channel — first 50 production requests are the design partner's reality check`

**Checkpoint: Public Launch**
- [ ] Tag pushed, image built and pushed, production env wired
- [ ] OpenAPI spec at `/api/v1/docs` matches implementation
- [ ] Audit log retention policy documented
- [ ] First 50 production requests traced end-to-end via correlation IDs

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Custom access token hook is unverified in staging post-rotation | High | Rotate in staging first; verify a synthetic user mints a token with `app_metadata.organization_id` set; document the rollback (unset `SUPABASE_JWKS_URL`) before prod. |
| Prisma non-bypassing role surfaces an existing query that depends on owner privileges | High | Run an integration suite that exercises every business route against the new role *before* swapping the env var. A separate migration (T5.4) is a hard gate. |
| RLS policy drift between committed migrations and live DB | Med | The handoff §5.5 already flagged that `20260706120000_rls_policies` is functionally superseded. Add a follow-up migration that drops the committed file's content. The `advisors` MCP tool catches drift on every deploy. |
| PHI appears in a log line via `prisma.$on('query', ...)` | High | T5.7's slow-query log must whitelist tables (never `licenses`, never `audit_logs`) and never include parameter values. Test by running a license read and asserting the log line has the query but not the params. |
| Quote `totalAmount` drifts from `SUM(quote_items.lineTotal)` | Med | Compute both in the same transaction; assert equality in an integration test. |
| pgbouncer connection pool exhaustion under load | High | T5.5 alert + runbook + a load test in T0.4's staging environment that exercises the pool against the actual pooled connection latency (not in-memory). |
| `quote_items` `FOR ALL` policy permits a same-tenant DELETE on a quote that's already been sent | Med | Decide in Phase 4 checkpoint; the recommendation is to split into `FOR INSERT` + `FOR UPDATE` (sent quotes are immutable). |
| The two uncommitted migrations in the working tree (4.12, 4.13) are still uncommitted | Med | Land them as separate commits before Phase 0 starts. The handoff's recent log already has them on `master` HEAD; verify. |
| `master` vs `main` mismatch in CI config | Low | Pick one. The current `git status` says current is `master`, default is `main`. The CI workflow from T0.1 should target the agreed trunk and fail fast on the other. |
| Stale `20260706120000_rls_policies` migration reapplied by a fresh `prisma migrate deploy` | Low | Idempotent, so no functional bug, but document the supersession or drop it in a follow-up commit. |
| The `updatedAt NOT NULL` no-default column on three tables (handoff §5.5) breaks a future raw-SQL insert | Low | A follow-up migration adding `DEFAULT CURRENT_TIMESTAMP` to `organizations.updatedAt`, `users.updatedAt`, `products.updatedAt`. Cheap. |

## Open Questions

- **Public launch timing.** Is there a hard external date? If yes, some of Phase 5 is parallelizable with Phase 4 (the observability work doesn't block the domain slices). If no, we run them serially for safety.
- **Quote items immutability.** Keep `FOR ALL` (current) or split into `FOR INSERT` + `FOR UPDATE` only? Recommendation: split. Quotes are an immutable record once sent; same-tenant DELETE is currently permitted and probably shouldn't be.
- **Product soft vs hard delete.** Soft delete preserves referential integrity in `quote_items` and `order_items`; hard delete is simpler. Recommendation: soft delete (`deletedAt` column, RLS policy that filters it out for non-owners). This is a schema decision; flag for confirmation before T2.5.
- **License document storage path.** Private Supabase Storage bucket keyed by `hospitalId/licenseId/<uuid>.<ext>`, with a service-role signed-URL endpoint? Or a separate storage provider? Recommendation: Supabase Storage, single bucket, RLS-enforced; matches `service-development.md §Data Privacy`.
- **WhatsApp delivery for quotes.** The schema has a `WhatsappStatus` enum and `whatsappStatus` field on `Quote`, but no delivery mechanism. Is there a Twilio / Meta Business API integration in flight, or do we land the `pgmq` enqueue side and stub the consumer? Recommendation: enqueue in v1, stub the consumer; wire the real provider in a follow-up.
- **`master` vs `main`.** The repo's working branch is `master` and the default is `main`. Pick one and update CI. Trunk-based development assumes a single trunk.
- **The two uncommitted migrations.** `20260708120000_fix_custom_access_token_hook` and `20260708130000_apply_rls_policies_and_grants` are uncommitted at the time of this plan. Confirm they are on a branch and ready to merge before Phase 0.

## Definition of Done (per task, this project)

A task is done when **all** of the following are true:

- [ ] Acceptance criteria in the task card are met
- [ ] Tests written and passing (unit + integration where applicable)
- [ ] Lint and typecheck clean
- [ ] For PHI-touching code: PHI isolation verified, audit log row verified
- [ ] Commit message follows Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`) and explains *why*
- [ ] No secrets, no real PHI, no real license numbers, no real staff IDs in the diff
- [ ] No formatting-only changes mixed with behavior changes
- [ ] PR / branch is small enough to review in one sitting (~100-300 lines for behavior changes)
- [ ] For new tables: RLS enabled, `advisors security` clean, audit log row on every read/write

## Parallelization Notes

- **Phases 1-4 (Domain)** are sequential by foreign-key dependency. Within a phase, the validation schema can be drafted in parallel with the route handler, but the route's tests need the schema.
- **Phase 0 (Pre-Domain Infra)** and **Phase 1 (Organizations)** can run in parallel — T0.* doesn't depend on the domain track.
- **Phase 5 (Production-Ops)** can overlap with Phases 3-4 — the observability work is independent of which business routes exist. Keep T5.3 (JWKS rotation) and T5.4 (Prisma role swap) serialized after Phase 4, since they affect every route.
- **Test-writing for an implemented slice** is safe to parallelize with the next slice's implementation.
- **Docs and changelog** are safe to parallelize with anything else.

## Sizing Check

| Phase | Tasks | Total estimated size |
|---|---|---|
| Phase 0 | 4 | 4 S-M |
| Phase 1 | 5 | 5 S-M |
| Phase 2 | 6 | 4 S + 2 M |
| Phase 3 | 7 | 2 S + 4 M + 1 L (split if L emerges) |
| Phase 4 | 8 | 3 S + 4 M + 1 L (split if L emerges) |
| Phase 5 | 8 | 5 S + 3 M |
| Phase 6 | 4 | 4 S |

No task should be larger than M. If a task in Phase 3 or 4 grows to L, split it before implementing.

## See Also

- `tasks/todo.md` — checklist form of this plan
- `handoff.md` — repo state at the time of this plan; the basis for the outstanding items
- `src/docs/production-readiness.md` — pre-deploy checklist that Phase 5 and Phase 6 implement
- `src/docs/compliance-standard.md` — PHI/PII rules referenced by every task that touches `licenses`
- `src/docs/service-development.md` — coding patterns, testing patterns, the folder structure this plan adopts
- `src/docs/agents-integration.md` — handoff targets for code that crosses agent boundaries
