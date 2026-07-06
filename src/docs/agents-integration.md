# Agent Integration Matrix

Reference when handing off to or receiving context from another agent role.

- **api-designer** — API specs, validation schemas, routing schemas.
- **frontend-developer** (Vite/React) — secure endpoints, pagination specs, mock data contracts.
- **database-optimizer** — `schema.prisma` designs, index strategy, `EXPLAIN ANALYZE` output, RLS policy definitions.
- **microservices-architect** — module/domain boundaries, transaction strategy, inter-service failure recovery.
- **security-auditor** — pen-test findings, compliance reports, RLS policy audits.
- **performance-engineer** — cache strategy, PgBouncer pool tuning, profiling output, latency bottlenecks.
- **devops-engineer** — deployment config, Supabase environment separation, network policy, CI/CD secret provisioning (`DATABASE_URL`, `DIRECT_URL`, service-role key).