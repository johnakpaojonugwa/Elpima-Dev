# Runbook: Supabase Auth & JWT Verification Outage

- **Severity:** High
- **Alert:** `Auth401StormDetected`
- **Owner:** Security & Authentication Lead / On-Call Engineer

---

## 1. Symptoms
- High spike in HTTP 401 Unauthorized errors on `GET /auth/me` and versioned business endpoints (`/api/v1/*`).
- Front-end clients unexpectedly forced to re-login repeatedly or failing session bootstrap.
- Access logs show `msg: "http_request", status: 401` surging in Prometheus.

---

## 2. Immediate First Checks
1. **Validate Secret Synchronization:**
   - Verify whether `SUPABASE_JWT_SECRET` in environment variables matches the JWT secret configured in the Supabase Project Settings (Settings > API > JWT Secret).
2. **Check for In-Flight Asymmetric Key Rotation:**
   - If `SUPABASE_JWKS_URL` was recently set or changed, check whether the Supabase project has actually been rotated to RS256. If not rotated yet, incoming tokens are HS256 and will fail RS256 verification.
3. **Verify Token Audience:**
   - If `SUPABASE_JWT_AUDIENCE` is configured, confirm incoming tokens include `"aud": "<audience>"`.

---

## 3. Mitigation & Rollback
- **If caused by JWT secret mismatch:**
  - Update `SUPABASE_JWT_SECRET` in the hosting environment (Render / Fly) and trigger an immediate redeploy.
- **If caused by failed JWKS/RS256 rotation:**
  - Roll back `SUPABASE_JWKS_URL` in environment variables by unsetting it. This immediately falls back to HS256 symmetric verification using `SUPABASE_JWT_SECRET`.
- **If caused by GoTrue provider outage:**
  - Check [status.supabase.com](https://status.supabase.com). Existing valid tokens will continue to verify locally on the API without external network requests; only new token issuance is impacted.

---

## 4. Escalation Path
1. **Primary On-Call:** Security & Authentication Lead.
2. **Secondary:** Lead Backend Engineer.
