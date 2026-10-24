# Changelog

All notable changes to the Elpima Medical & Surgical B2B Procurement API will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-10-24

### Added
- **Multi-Tenant Organizations (`/api/v1/organizations`):**
  - Tenant provisioning and administrative root onboarding in atomic transaction (`POST /`).
  - Read (`GET /:id`) and update (`PATCH /:id`) scoped to tenant boundaries with 404 anti-enumeration protections.
  - Comprehensive immutable audit logging on tenant creation, reads, and updates.
- **Medical & Surgical Product Catalog (`/api/v1/products`):**
  - Vendor-restricted product management (`POST`, `PATCH`, `DELETE`) enforced by `requireOrgType("VENDOR")`.
  - Cross-tenant catalog search with cursor pagination and multi-parameter filters (`categoryId`, `vendorId`, `search`).
  - Referential integrity conflict handling (HTTP 409) preventing deletion of products tied to active RFQs or orders.
- **Compliance & License Verification (`/api/v1/licenses`):**
  - Hospital compliance credential upload and expiration tracking (`POST /`).
  - Tenant-isolated license retrieval and global platform administrator oversight (`GET /`).
  - Administrative review workflow (`PATCH /:id`) requiring formal `rejectionReason` on rejected submissions.
- **Quotations & RFQs (`/api/v1/quotes`):**
  - Hospital-initiated price quotation requests (`POST /`) with server-side catalog price lookup and total calculation.
  - Multi-tenant quote listing scoped strictly to buyer hospital and supplier vendor.
  - Quotation state transitions (`DRAFT` $\to$ `SENT` $\to$ `ACCEPTED` / `DECLINED`).
  - **Automated Order Generation:** Atomic provisioning of purchase orders and item lines upon quotation acceptance.
- **Order Management & Fulfillment (`/api/v1/orders`):**
  - Bi-tenant isolated order tracking between purchasing hospital and fulfilling vendor.
  - Vendor order confirmation and shipment fulfillment lifecycle (`PENDING` $\to$ `CONFIRMED` $\to$ `FULFILLED`).
  - Strict cancellation safeguards preventing cancellation of confirmed or fulfilled orders.
- **Observability & Health Probes:**
  - Prometheus metrics exposition (`GET /metrics`) with request counters, error tracking, and latency histograms.
  - Optional `METRICS_TOKEN` bearer authentication for scraper security.
  - Orchestrator probe split: shallow liveness (`/healthz/live`) and deep database readiness (`/healthz/ready`).
  - Slow database query listener alerting on operations $\ge 100\text{ ms}$.
- **API Documentation:**
  - OpenAPI 3.0 specification generated from JSDoc tags across all endpoints.
  - Interactive Swagger UI mounted at `/api/v1/docs` and raw specification at `/api/v1/docs/openapi.json`.
- **Operational Infrastructure:**
  - Prometheus alert rules committed in `infra/prometheus/alerts/alerts.yml`.
  - Incident runbooks committed in `src/docs/runbooks/` for pool exhaustion, authentication outages, and error spikes.
  - Authoritative environment variable contract in `src/docs/env-contract.md` and template in `.env.example`.

### Security
- Cryptographic JWT authentication via Supabase GoTrue with HS256 symmetric verification and configurable RS256 JWKS asymmetric rotation.
- Multi-tenant data segregation with 404 Not Found returns on cross-tenant ID accesses to prevent ID enumeration.
- Parameter-stripped database logging guaranteeing zero PHI or credential exposure in development and test environments.
- Zero high or critical vulnerabilities across production and development dependency graphs verified via `npm audit`.
