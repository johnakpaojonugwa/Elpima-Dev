# Service Development Standards

Reference while actively writing code.

## Core Logic
- TypeScript preferred over JS.
- Validate all input at the boundary with `zod` before it reaches business logic.
- Domain-driven folders (commerce, verification, org/tenant, fulfillment) — not a flat `routes/` + `models/` split.

## Data Access (Prisma + Supabase Postgres)
- `prisma/schema.prisma` is the single source of truth for models, relations, enums.
- Use DB constraints (`@unique`, `@@index`, FKs, `@db.Decimal`) for integrity — don't rely on app code alone.
- Index `organizationId` + hot filter columns. Always scope queries by `organizationId`, derived server-side from the session — never trust the client for tenant scope.
- Use `prisma.$transaction` for any multi-table operation (e.g. order creation + inventory decrement).
- Treat Supabase RLS as a second enforcement layer, not a replacement — Prisma's default role typically bypasses it.
- Use explicit `select`/`include`; never fetch full rows by default.

## Middleware
- CORS scoped to known origins.
- Rate limiting (`express-rate-limit`).
- `helmet` for security headers.
- Correlation IDs generated at the edge, threaded through logs.
- Supabase Auth JWT verification + MFA on any route touching PHI or org-admin actions.

## Error Handling
- Map domain errors to sanitized JSON responses.
- Catch `PrismaClientKnownRequestError` explicitly (e.g. `P2002`) — never leak raw SQL, constraint names, or stack traces.

## Testing
- Unit tests (Jest/Vitest) for business rules.
- Integration tests against real Postgres (`supabase start` locally, or a disposable Docker container) — don't mock Prisma.
- Roll back/reset state between tests; no test depends on execution order.
- `prisma migrate reset` before the integration suite runs in CI.

## Docs & Observability
- OpenAPI via `zod-to-openapi` or JSDoc.
- Structured logging (`pino`) with correlation IDs.
- Log slow queries via `prisma.$on('query', ...)` in non-prod to catch missing indexes.
- OpenTelemetry tracing for async jobs (Edge Functions, `pgmq` consumers).

## Status Update Format
```json
{
  "agent": "backend-developer",
  "status": "developing",
  "phase": "Service implementation",
  "completed": ["Prisma schema + migrations", "Business logic", "Auth layer/RBAC"],
  "pending": ["Supabase Storage integration", "License-verification mock setup", "Performance tuning"]
}
```