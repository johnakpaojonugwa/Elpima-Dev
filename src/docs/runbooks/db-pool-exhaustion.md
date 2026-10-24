# Runbook: Database Pool Exhaustion & Connectivity Failure

- **Severity:** Critical
- **Alerts:** `DatabaseProbeDegraded`, `SlowHttpResponseLatency`
- **Owner:** Backend Infrastructure / On-Call Engineer

---

## 1. Symptoms
- Deep readiness probe `GET /healthz/ready` returns HTTP 503 (`Database unreachable`).
- API latency surges with `SlowHttpResponseLatency` firing across multiple routes.
- Application logs display `PrismaClientInitializationError` or `P1001` (Can't reach database server).

---

## 2. Immediate First Checks
1. **Check Live Health Endpoint:**
   ```bash
   curl -i http://localhost:8080/healthz/ready
   ```
   Inspect `dbLatencyMs` or the error message returned.
2. **Verify Supabase Status:**
   - Check [Supabase Status Page](https://status.supabase.com) for provider incidents.
   - Check Supabase Dashboard > Project Health > Database CPU and Connection Count.
3. **Inspect Application Logs:**
   Filter logs for `msg: "Readiness probe failed"` and review `correlationId`.

---

## 3. Root Cause & Mitigations

### A. Connection Pool Exhaustion (PgBouncer)
- **Cause:** High traffic or unclosed connections saturated PgBouncer connection slots.
- **Mitigation:**
  - In `DATABASE_URL`, ensure `?pgbouncer=true&connection_limit=1` is configured per Node container instance.
  - Scale down rogue background workers or restart stalled API containers to free pool connections.

### B. Long-Running Interactive Transactions ($transaction)
- **Cause:** Uncompleted multi-table writes holding locks via `DIRECT_URL`.
- **Mitigation:**
  - Run active query inspection in Supabase SQL editor:
    ```sql
    SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
    FROM pg_stat_activity
    WHERE state != 'idle' AND query NOT ILIKE '%pg_stat_activity%'
    ORDER BY duration DESC;
    ```
  - Terminate blocking queries:
    ```sql
    SELECT pg_terminate_backend(<pid>);
    ```

---

## 4. Escalation Path
1. **Primary On-Call:** Lead Backend Engineer.
2. **Secondary:** Cloud Infrastructure Lead / Database Administrator.
3. **Escalation Contact:** Elpima Surgicals DevOps Incident Channel.
