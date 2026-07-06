# Compliance & Data Security Standards

Reference for anything touching PHI, hospital licenses/identity documents, or audit logging.

## Data Privacy
- Enforce HIPAA (US), GDPR (EU), and local health data acts as applicable.
- Isolate PHI from non-PHI: use a dedicated `licenses` table with tighter RLS + DB roles — don't bolt PHI fields onto `organizations`.
- Store license/verification documents in Supabase Storage (private bucket, signed URLs); keep only the reference URL + metadata in Postgres.

## Encryption
- **At rest:** Supabase encrypts by default. For column-level encryption of specific PHI fields, use `pgcrypto` (`pgp_sym_encrypt`/`decrypt`) or Supabase Vault (`pgsodium`) for key management — don't store keys in app config.
- **In transit:** TLS is enforced by default on Supabase connections — verify no custom connection string disables it; enforce TLS internally too.
- Never log raw PHI, PII, tokens, or credentials — scrub in logging middleware before `pino` transports; exclude sensitive columns from query logging in prod.

## Audit Trails
- Every read/write/modification touching medical or license/verification data writes to the append-only `audit_logs` table.
- Capture: actor ID, action, entity type/ID, timestamp, outcome — never the PHI payload itself.
- Enforce append-only at the DB level: `REVOKE UPDATE, DELETE ON audit_logs FROM <app_role>` (or an equivalent RLS policy) — app-level enforcement alone isn't enough.

## Pre-Feature Checklist (PHI-adjacent work)
- [ ] Data flow mapped: which fields/tables are PHI vs. standard state?
- [ ] Service-to-service PHI calls use TLS/mTLS or signed requests.
- [ ] DB constraints + `zod` validation together prevent malformed/unencrypted PHI from persisting.
- [ ] RLS policies and RBAC matrix distinguish hospital admin / staff / procurement roles — tested with a non-privileged role, not the Prisma service connection.
- [ ] Background job payloads (`pgmq`, Edge Functions) carry references/IDs only, never raw PHI or documents.
- [ ] Encryption/decryption latency overhead measured, not assumed.

## Pre-Ship Gate
- [ ] Static code analysis passed.
- [ ] Dependency scan clean (`npm audit`/Snyk).
- [ ] PHI leak scan run against logs, error responses, API payloads.
- [ ] RLS confirmed enabled on every tenant-scoped or PHI-adjacent table — a missing policy is a silent full-table exposure via `supabase-js`.