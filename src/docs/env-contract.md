# Environment Variables Contract

This document provides the authoritative specification for all environment variables consumed by the Elpima B2B Procurement API runtime.

Runtime parsing and validation are enforced at boot time by `src/config/env.js` using Zod. Missing or malformed required variables trigger an immediate non-zero exit (`process.exit(1)`).

---

## Variable Registry

| Variable Name | Type | Required / Optional | Default Value | Purpose / Notes |
|:---|:---:|:---:|:---:|:---|
| `NODE_ENV` | String (`development` \| `test` \| `production`) | Optional | `development` | Defines the execution mode. Disables query event listeners in production to protect PHI. |
| `PORT` | Number (Positive integer) | Optional | `8080` | TCP port the Express HTTP server listens on. In container platforms (Render, Fly, ECS), injected by the orchestrator. |
| `DATABASE_URL` | String (PostgreSQL URL) | **Required** | *None* | Pooled Postgres connection string (via PgBouncer in transaction mode) for single-table reads, writes, and health probes. |
| `DIRECT_URL` | String (PostgreSQL URL) | **Required** | *None* | Direct non-pooled Postgres connection string. Required for Prisma migrations and interactive multi-statement `$transaction` blocks. |
| `SUPABASE_URL` | String (HTTP/HTTPS URL) | **Required** | *None* | Supabase project API gateway endpoint URL. |
| `SUPABASE_SECRET_KEY` | String | **Required** | *None* | Supabase service-role secret key for administrative operations and webhook authentication. |
| `SUPABASE_JWT_SECRET` | String | **Required** | *None* | Symmetric secret key used to verify incoming HS256 JWT access tokens minted by GoTrue. |
| `SUPABASE_JWT_AUDIENCE` | String | Optional | *Unset* | Expected `aud` claim on incoming JWTs. If set, tokens with mismatched audience are rejected with 401. |
| `SUPABASE_JWKS_URL` | String (HTTP/HTTPS URL) | Optional | *Unset* | Asymmetric JSON Web Key Set (JWKS) endpoint URL. When set, verifies tokens with RS256 rather than HS256. |
| `METRICS_TOKEN` | String | Optional | *Unset* | Secret bearer token required to scrape `/metrics`. If set, requests must supply `Authorization: Bearer <METRICS_TOKEN>`. |
| `CORS_ORIGIN` | String (CSV or `*`) | Optional | `*` | Allowed CORS origins. Accepts comma-separated URLs or wildcard `*`. |
| `INTEGRATION_TESTS` | String | Optional | *Unset* | Set to `skip` in CI/test environments where live Supabase connection is intentionally disabled. |

---

## Security Invariants

1. **No Production Secrets in Source Control:** `.env` is strictly gitignored. Only `.env.example` (with dummy values) is committed.
2. **Never Log Sensitive URLs or Tokens:** Connection strings containing credentials (`DATABASE_URL`, `DIRECT_URL`) and JWT secrets must never appear in application logs or error response payloads.
3. **Fail-Fast Schema Enforcement:** Any undeclared or invalid variable aborts server boot before accepting network requests.
