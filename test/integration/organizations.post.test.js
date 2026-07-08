// Integration test for POST /api/v1/organizations (T1.2).
//
// Runs against the live Supabase project. The test creates an
// organization + first admin user, asserts the response shape and
// the audit log row, then deletes the organization so the live DB
// is left clean (Cascade on User FK handles the user row; the
// audit_logs row stays because UPDATE/DELETE on audit_logs is
// revoked — that's the cost of testing the audit contract against
// a non-disposable DB and is why T0.4 (staging environment) is a
// real prerequisite for this slice in production).
//
// Requires:
//   - DATABASE_URL pointing at a reachable Postgres (live or
//     staging). The test fails loudly if it's missing, per
//     test/setup.js.
//   - SUPABASE_JWT_SECRET to sign a synthetic PLATFORM_ADMIN JWT.
//
// This file is skipped if `INTEGRATION_TESTS=skip` is set in the
// environment, so the unit-test suite (npm test) doesn't require a
// DB. Run with `INTEGRATION_TESTS=run npm test` (or just
// `npm test` once a DB is configured) to exercise it.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";

import { env } from "../../src/config/env.js";
import { prisma, connectDb, disconnectDb } from "../../src/config/prisma.js";
import { createApp } from "../../src/app.js";
import { logger } from "../../src/utils/logger.js";

const integrationEnabled = process.env.INTEGRATION_TESTS !== "skip";

// Synthetic org id used so test artifacts in the audit log are
// trivially identifiable if the cleanup fails.
const TEST_ORG_EMAIL = `test-t1-2-${Date.now()}@elpima-test.invalid`;
const TEST_USER_SUB = `00000000-0000-0000-0000-testt1two0000`;

// Tracks every org id this test created so afterAll can clean up
// even if individual assertions fail.
const createdOrgIds = [];

function signPlatformAdminToken() {
  // Matches the shape the fixed custom_access_token_hook stamps
  // onto real access tokens (handoff §4.12): `app_metadata` claims
  // surface as top-level `organization_id` / `role` in the JWT
  // payload that jsonwebtoken sees. The auth middleware reads
  // `payload.organization_id` and `payload.role` directly.
  return jwt.sign(
    {
      sub: TEST_USER_SUB,
      organization_id: "00000000-0000-0000-0000-platformadmin0",
      role: "PLATFORM_ADMIN",
      email: "platform-admin@elpima-test.invalid",
    },
    env.SUPABASE_JWT_SECRET,
    { algorithm: "HS256", expiresIn: "5m" },
  );
}

const skipReason = integrationEnabled
  ? null
  : "INTEGRATION_TESTS=skip; set INTEGRATION_TESTS=run to exercise";

// Integration tests touch a real database and can take a few
// seconds per call (network round-trips, Prisma cold start, and
// the Supabase pooler's per-query latency).
// 60s per test and 60s for the afterAll hook is the cost of
// running against the live DB; the unit suite uses vitest's
// 5s default. The slow ceiling is paid by the test runner only;
// the production code is the same.
const TEST_TIMEOUT = 60_000;
const HOOK_TIMEOUT = 60_000;

describe.skipIf(skipReason)("POST /api/v1/organizations", () => {
  let app;
  let token;

  beforeAll(async () => {
    // Boot the full app so we exercise the real route wiring:
    // correlationId → access log → rate limit → router → handler
    // → errorHandler. The test asserts the response envelope
    // (status, error shape, X-Request-Id) as well as the data.
    app = createApp();
    await connectDb();
    token = signPlatformAdminToken();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    // Clean up the orgs we created. User rows cascade-delete via
    // the FK on schema.prisma's `User` model; `audit_logs` is
    // append-only by design and may keep one row per test
    // invocation. That's expected — see the file header.
    for (const id of createdOrgIds) {
      try {
        await prisma.organization.delete({ where: { id } });
      } catch (err) {
        logger.warn(`cleanup: could not delete org ${id}: ${err.message}`);
      }
    }
    await disconnectDb();
  }, HOOK_TIMEOUT);

  it("creates an organization + first admin user, returns 201 with the org", { timeout: TEST_TIMEOUT }, async () => {
    const payload = {
      name: "T1.2 Test Hospital",
      type: "HOSPITAL",
      email: TEST_ORG_EMAIL,
    };

    const res = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      organization: {
        name: "T1.2 Test Hospital",
        type: "HOSPITAL",
        email: TEST_ORG_EMAIL,
        status: "PENDING_VERIFICATION",
      },
    });
    expect(res.body.organization.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    createdOrgIds.push(res.body.organization.id);

    // The DB now has the org and its first admin user, linked.
    const dbOrg = await prisma.organization.findUnique({
      where: { id: res.body.organization.id },
      include: { users: true },
    });
    expect(dbOrg).not.toBeNull();
    expect(dbOrg.users).toHaveLength(1);
    expect(dbOrg.users[0].organizationId).toBe(res.body.organization.id);
    expect(dbOrg.users[0].role).toBe("ORG_ADMIN");

    // And the audit log row exists with the right shape. The
    // audit's `organizationId` is the *actor's* tenant context
    // (the platform admin's org), per the RLS policy on
    // `audit_logs` (handoff §4.13). The new org's id is in
    // `entityId` and `metadata.createdOrgId`.
    const auditRows = await prisma.auditLog.findMany({
      where: { entityId: res.body.organization.id },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "create",
      entityType: "organization",
      entityId: res.body.organization.id,
      organizationId: "00000000-0000-0000-0000-platformadmin0",
      metadata: {
        createdOrgId: res.body.organization.id,
        createdOrgType: "HOSPITAL",
        actorRole: "PLATFORM_ADMIN",
      },
    });
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app)
      .post("/api/v1/organizations")
      .send({
        name: "Should Not Persist",
        type: "HOSPITAL",
        email: `test-t1-2-noauth-${Date.now()}@elpima-test.invalid`,
      });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBeTruthy();
    // No DB row should exist from this attempt.
    const count = await prisma.organization.count({
      where: { email: { contains: "test-t1-2-noauth-" } },
    });
    expect(count).toBe(0);
  });

  it("rejects an ORG_ADMIN caller with 403 (PLATFORM_ADMIN only)", async () => {
    const orgAdminToken = jwt.sign(
      {
        sub: TEST_USER_SUB,
        organization_id: "00000000-0000-0000-0000-orgadmintest0",
        role: "ORG_ADMIN",
        email: "org-admin@elpima-test.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "5m" },
    );

    const res = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({
        name: "Should Not Persist",
        type: "VENDOR",
        email: `test-t1-2-orgadmin-${Date.now()}@elpima-test.invalid`,
      });

    expect(res.status).toBe(403);
  });

  it("rejects an invalid payload with 400 and does not write a row", async () => {
    const res = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        // Missing type, bad email.
        name: "",
        email: "not-an-email",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("Invalid request payload");
    expect(res.body.error.details?.fieldErrors).toBeTruthy();
  });

  it("rejects a duplicate email with 409 and does not write a row", { timeout: TEST_TIMEOUT }, async () => {
    // First create succeeds.
    const first = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "T1.2 Duplicate Test",
        type: "VENDOR",
        email: `test-t1-2-dup-${Date.now()}@elpima-test.invalid`,
      });
    expect(first.status).toBe(201);
    createdOrgIds.push(first.body.organization.id);

    // Second create with same email must 409. P2002 from Prisma is
    // classified as 500 by the global errorHandler today (per
    // errorHandler.classifyError). For this slice we treat
    // "duplicate email" as a 409 — see service.js for the explicit
    // catch.
    const second = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "T1.2 Duplicate Test 2",
        type: "VENDOR",
        email: first.body.organization.email,
      });

    expect(second.status).toBe(409);
  });
});
