# Runbook: High 5xx Error Rate Spikes

- **Severity:** Critical
- **Alert:** `HighHttp5xxErrorRate`
- **Owner:** Backend On-Call Engineer

---

## 1. Symptoms
- Over 5% of API requests return HTTP 500/502/503 responses within 5 minutes.
- Error logs spike with uncaught exceptions or database failures.
- Front-end applications display error banners or degraded workflows.

---

## 2. Immediate First Checks
1. **Locate Correlation IDs:**
   Every error response returned by the API contains an envelope with `correlationId`:
   ```json
   {
     "success": false,
     "error": {
       "message": "Internal server error",
       "kind": "internal_error",
       "correlationId": "a3b1c2d4-e5f6-7890-abcd-ef1234567890"
     }
   }
   ```
   Search the centralized log aggregator (Render Logs / Datadog / Papertrail) for this `correlationId`.
2. **Identify Top Failing Route:**
   Query Prometheus for top error routes:
   ```promql
   topk(5, sum by (route) (rate(elpima_http_errors_total{status_code=~"5.."}[5m])))
   ```
3. **Verify Database Connectivity:**
   Hit `GET /healthz/ready` to rule out database degradation.

---

## 3. Mitigation Steps
- **If caused by recent code deployment:**
  - Execute instantaneous rollback to the previous green deployment in Render / container registry.
- **If caused by third-party upstream outage (e.g. Resend, Twilio, Supabase):**
  - Verify if circuit breaker / fallback paths are firing.
  - Temporarily throttle non-essential async queues.

---

## 4. Escalation Path
1. **Primary On-Call:** Incident Commander / Lead Backend Engineer.
2. **Secondary:** CTO / Technical Director.
