# Production Readiness Standards

Reference before shipping.

## Pre-Deploy Checklist
- [ ] OpenAPI docs match implementation.
- [ ] Prisma migrations reviewed for zero-downtime safety, then `prisma migrate deploy` run against prod.
- [ ] Multi-stage Docker image on `node:*-alpine`/distroless, `prisma generate` run at build time.
- [ ] All config via env vars + secret injection — nothing hardcoded.
- [ ] Load tests include real pooled-connection latency, not an in-memory mock.
- [ ] Prometheus metrics + alert rules defined.
- [ ] Runbook exists for: connection pool exhaustion, Supabase Auth outage, `pgmq` backlog, Edge Function failures.

## Zero-Downtime Migrations
- Don't drop/rename a column in the same migration that removes app-code references — deploy code first, migrate after (or reverse), so both versions can run mid-rollout.
- Adding a required column to a populated table: add nullable → backfill → add `NOT NULL` in a follow-up migration.
- Use `CREATE INDEX CONCURRENTLY` for large tables instead of a blocking build.
- Use `prisma migrate deploy` (not `migrate dev`) in CI/production.

## Docker
- Multi-stage build; runtime image ships only prod `node_modules` + compiled output + generated Prisma Client.
- Run as non-root (`USER node`).
- Set explicit CPU/memory limits.
- Container filesystem is ephemeral — clinical/license/transaction data lives in Supabase, never on a volume.
- On `SIGTERM`/`SIGINT`: `prisma.$disconnect()`, drain in-flight requests within a 15s grace window.

## Environment Management
- Separate Supabase projects per dev/staging/production — never point staging at prod data.
- Secrets via Vault/Secrets Manager/injected runtime env — `.env` is local-only, never committed. Covers `DATABASE_URL`, `DIRECT_URL`, service-role key.
- Validate required env vars on startup (`envalid`/`zod`); fail fast on missing keys or a malformed URL.
- Service-role key is server-only — never exposed to any client-facing context.

## Monitoring
- `/metrics` for Prometheus (counts, error rates, latencies).
- `/healthz/ready` (shallow), `/healthz/live` (deep — `SELECT 1` via Prisma to confirm DB connectivity).
- Watch Supabase pool metrics (`pg_stat_activity`) for PgBouncer exhaustion.

## Delivery Notification Template
> "Backend implementation complete. Delivered medical e-commerce service using Node.js/Express in `/services/`. Features: Supabase Postgres via Prisma with column-level encryption for PHI/license data, Redis caching for non-PHI, Supabase Auth (JWT + MFA) with RBAC, `pgmq`-backed background jobs. 88% test coverage, sub-100ms p95 latency."